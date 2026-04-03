// AdRadar Live Data API - Vercel Serverless Function
// Reads from Google Sheets (Coupler.io source) and returns structured ad data

const SHEET_ID = '1sDNSCy7DtCl0K6bx-gELT2FeCts76vgXNrfx0zx5THk';

// Therapy classification from campaign/ad names
const THERAPIES = [
  { key: 'Pre-Diabetes', patterns: ['pre-diabetes', 'prediabetes', 'pre diabetes'] },
  { key: 'Diabetes', patterns: ['diabetes'] },
  { key: 'Obesity', patterns: ['obesity', 'weight'] },
  { key: 'CGM', patterns: ['cgm'] },
  { key: 'BCA', patterns: ['bca', 'body composition'] },
  { key: 'PCOS', patterns: ['pcos'] }
];

function classifyTherapy(campaign, adName, adset) {
  var text = ((campaign || '') + '|' + (adName || '') + '|' + (adset || '')).toLowerCase();
  // Pre-Diabetes must be checked before Diabetes
  for (var i = 0; i < THERAPIES.length; i++) {
    for (var j = 0; j < THERAPIES[i].patterns.length; j++) {
      if (text.indexOf(THERAPIES[i].patterns[j]) >= 0) return THERAPIES[i].key;
    }
  }
  return 'Other';
}

function classifyObjective(campaign) {
  var c = (campaign || '').toLowerCase();
  if (c.indexOf('purchase') >= 0 || c.indexOf('conversion') >= 0 || c.indexOf('sales') >= 0) return 'purchase';
  return 'lead';
}

function parseGvizDate(v) {
  if (!v) return null;
  if (typeof v === 'string' && v.indexOf('Date(') === 0) {
    var parts = v.replace('Date(', '').replace(')', '').split(',');
    var y = parseInt(parts[0]);
    var m = parseInt(parts[1]) + 1;
    var d = parseInt(parts[2]);
    return y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  }
  return null;
}

function num(v) {
  if (v === null || v === undefined || v === '') return 0;
  var n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

async function fetchSheet(gid) {
  var url = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/gviz/tq?tqx=out:json&gid=' + gid;
  var resp = await fetch(url);
  var text = await resp.text();
  var jsonStr = text.replace(/^[^{]*/, '').replace(/[^}]*$/, '');
  return JSON.parse(jsonStr);
}

module.exports = async function handler(req, res) {
  try {
    var perfData = await fetchSheet(0);
    var rows = perfData.table.rows;
    var dailyCreatives = {};
    var dateSet = {};
    var adNames = {};
    var classified = 0;
    for (var i = 0; i < rows.length; i++) {
      var c = rows[i].c;
      if (!c || !c[0]) continue;
      var dateVal = c[0].v;
      var date = parseGvizDate(typeof dateVal === 'string' ? dateVal : (c[0].f || String(dateVal)));
      if (!date) {
        if (dateVal && typeof dateVal === 'object') continue;
        if (typeof dateVal === 'string' && dateVal.match(/^\d{4}-\d{2}-\d{2}/)) {
          date = dateVal.substring(0, 10);
        } else { continue; }
      }
      var campaign = c[1] ? (c[1].v || '') : '';
      var impressions = num(c[2] ? c[2].v : 0);
      var adset = c[3] ? (c[3].v || '') : '';
      var adName = c[4] ? (c[4].v || '') : '';
      var clicks = num(c[15] ? c[15].v : 0);
      var atc = num(c[16] ? c[16].v : 0);
      var ci = num(c[21] ? c[21].v : 0);
      var purchases = num(c[26] ? c[26].v : 0);
      if (purchases === 0) purchases = num(c[5] ? c[5].v : 0);
      var lpv = num(c[31] ? c[31].v : 0);
      var spend = num(c[36] ? c[36].v : 0);
      var leads = num(c[47] ? c[47].v : 0);
      if (leads === 0) leads = num(c[10] ? c[10].v : 0);
      if (!campaign && !adName) continue;
      var therapy = classifyTherapy(campaign, adName, adset);
      var objective = classifyObjective(campaign);
      if (therapy !== 'Other') classified++;
      dateSet[date] = true;
      adNames[adName] = true;
      if (!dailyCreatives[date]) dailyCreatives[date] = [];
      dailyCreatives[date].push({
        n: adName, c: campaign, as: adset, t: therapy, o: objective,
        s: Math.round(spend * 100) / 100, i: Math.round(impressions),
        cl: Math.round(clicks), l: Math.round(leads), p: Math.round(purchases),
        atc: Math.round(atc), ci: Math.round(ci), lpv: Math.round(lpv)
      });
    }
    var creativeImages = {};
    try {
      var thumbData = await fetchSheet(1);
      var thumbRows = thumbData.table.rows;
      for (var t = 0; t < thumbRows.length; t++) {
        var tc = thumbRows[t].c;
        if (!tc || !tc[4]) continue;
        var name = tc[4].v || '';
        if (name && !creativeImages[name]) {
          var thruplay = num(tc[55] ? tc[55].v : 0);
          creativeImages[name] = { type: thruplay > 0 ? 'VIDEO' : 'IMAGE', url: '' };
        }
      }
    } catch (e) {}
    var dates = Object.keys(dateSet).sort();
    var meta = {
      dateRange: { min: dates[0] || '', max: dates[dates.length - 1] || '' },
      dates: dates.length, classified, totalAds: Object.keys(adNames).length,
      updated: new Date().toISOString()
    };
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    res.json({ dailyCreatives: dailyCreatives, creativeImages: creativeImages, meta: meta });
  } catch (err) {
    console.error('AdRadar API error:', err);
    res.status(500).json({ error: err.message });
  }
};
