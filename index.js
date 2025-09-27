// index.js — parse QID -> chosenOptionID and return JSON
const express = require("express");
const puppeteer = require("puppeteer");

const app = express();
const PORT = process.env.PORT || 3000;

async function parsePageAndReturnMap(url, debug=false) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
  });

  const page = await browser.newPage();
  await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
  await page.setViewport({ width: 1366, height: 768 });
  await page.setExtraHTTPHeaders({ "accept-language": "en-US,en;q=0.9" });

  // reduce detection of headless
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    Object.defineProperty(navigator, 'plugins', { get: () => [1,2,3] });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US','en'] });
  });

  try {
    const resp = await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
    const status = resp ? resp.status() : 0;

    await page.waitForTimeout(1000); // give JS time to load

    // Get visible text
    const bodyText = await page.evaluate(() => document.body.innerText);

    // Regex patterns
    function extractPairs(text) {
      const qidRe = /Question\s*ID\s*[:\u2013-]?\s*([A-Za-z0-9\-_]+)/i;
      const optIdRe = /Option\s*(\d+)\s*ID\s*[:\u2013-]?\s*([A-Za-z0-9\-_]+)/ig;
      const chosenRe = /Chosen\s*Option\s*[:\u2013-]?\s*([0-9]+)/i;

      const candidates = Array.from(text.split(/\n{2,}/)); // blocks separated by blank lines
      const out = {};

      for (const block of candidates) {
        if (!/Question\s*ID/i.test(block)) continue;
        const qidM = qidRe.exec(block);
        if (!qidM) continue;
        const qid = qidM[1].trim();

        const optMap = {};
        let m;
        while ((m = optIdRe.exec(block)) !== null) {
          optMap[m[1]] = m[2].trim();
        }

        const chosenM = chosenRe.exec(block);
        let chosenNum = chosenM ? chosenM[1].trim() : null;

        let chosenID = null;
        if (chosenNum && optMap[chosenNum]) chosenID = optMap[chosenNum];

        out[qid] = chosenID || null;
      }

      return out;
    }

    const parsed = extractPairs(bodyText || "");

    await browser.close();

    if (debug) {
      return { parsed, bodyText: bodyText.slice(0, 2000), status };
    }
    return { parsed, status };

  } catch (err) {
    try { await browser.close(); } catch {}
    throw err;
  }
}

app.get("/parse", async (req, res) => {
  const url = req.query.url;
  const debug = req.query.debug === "1";
  if (!url) return res.status(400).json({ ok:false, error:"missing url" });
  try {
    const result = await parsePageAndReturnMap(url, debug);
    return res.json({ ok:true, ...result });
  } catch (err) {
    return res.status(500).json({ ok:false, error: String(err) });
  }
});

app.listen(PORT, () => console.log("listening", PORT));

