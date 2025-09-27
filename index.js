// index.js - simple parser service
const express = require('express');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// Helper: parse HTML text into { qid: chosenOptionID, ... }
function parseQIDChosenMap(html) {
  const qidRegex = /Question\s*ID\s*[:\u2013-]?\s*([A-Za-z0-9\-_]+)/ig;
  const optRegex = /Option\s*([1-9][0-9]?)\s*ID\s*[:\u2013-]?\s*([A-Za-z0-9\-_]+)/ig;
  const chosenRegex = /Chosen\s*Option\s*[:\u2013-]?\s*([0-9]+)/ig;

  const qids = [];
  let m;
  while ((m = qidRegex.exec(html)) !== null) {
    qids.push({ qid: m[1], index: m.index });
  }

  const map = {};
  for (let i = 0; i < qids.length; i++) {
    const start = qids[i].index;
    const end = (i + 1 < qids.length) ? qids[i+1].index : html.length;
    const block = html.slice(start, end);

    const optMap = {};
    optRegex.lastIndex = 0;
    while ((m = optRegex.exec(block)) !== null) {
      optMap[m[1]] = m[2];
    }

    chosenRegex.lastIndex = 0;
    const ch = chosenRegex.exec(block);
    if (ch) {
      const chosenNum = ch[1];
      const chosenOptionID = optMap[chosenNum] || "0";
      map[qids[i].qid] = chosenOptionID;
    } else {
      map[qids[i].qid] = "0";
    }
  }
  return map;
}

// Endpoint: health
app.get('/', (req, res) => {
  res.send('OSSC parser running. Use /parse?url=...');
});

// Endpoint: parse
app.get('/parse', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ ok:false, error: 'Missing url query parameter' });

  try {
    const resp = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; OSSC-Autoscorer/1.0)' },
      timeout: 30_000
    });

    const html = typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data);
    const parsed = parseQIDChosenMap(html);
    return res.json({ ok:true, parsed });
  } catch (err) {
    const msg = err && err.response ? (`HTTP ${err.response.status}`) : String(err.message || err);
    return res.status(500).json({ ok:false, error: msg, detail: err && err.response && String(err.response.data).slice(0,200) });
  }
});

app.listen(PORT, () => {
  console.log(`OSSC parser listening on ${PORT}`);
});
