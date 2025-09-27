// index.js — improved debug-friendly parser for Render
const express = require("express");
const puppeteer = require("puppeteer");

const app = express();
const PORT = process.env.PORT || 3000;

async function tryGoto(page, url) {
  // try multiple ways to load the page (some sites are picky)
  let resp = null;
  try {
    resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    // try to wait for network idle (may never happen on badly-behaved pages)
    try { await page.waitForNetworkIdle({idleTime: 500, timeout: 5000}); } catch(e){}
  } catch (e) {
    // fallback: try again with different waitUntil
    try {
      resp = await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
    } catch (e2) {
      throw e2;
    }
  }
  return resp;
}

async function parsePageAndReturnMap(url, debug=false) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
  });

  const page = await browser.newPage();
  // realistic UA + viewport
  await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
  await page.setViewport({ width: 1366, height: 768 });
  await page.setExtraHTTPHeaders({
    "accept-language": "en-US,en;q=0.9",
    // add referer (some CDNs check this)
    "referer": (new URL(url)).origin
  });

  // small anti-detection tweaks
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    Object.defineProperty(navigator, 'plugins', { get: () => [1,2,3,4] });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US','en'] });
  });

  try {
    const resp = await tryGoto(page, url);
    const status = resp ? resp.status() : 0;

    // Wait a bit to let JS render content (some pages need extra time)
    await page.waitForTimeout(1200);

    // Get page content and visible text
    const pageContent = await page.content(); // full HTML
    const bodyText = await page.evaluate(() => document.body ? document.body.innerText : '');

    // Build candidate blocks: split text into blocks and also gather text of many node types
    const candidateBlocks = await page.evaluate(() => {
      // get text from likely containers (body + many elements)
      const nodes = Array.from(document.querySelectorAll('body, div, section, td, li, aside, article, pre, table, p'));
      const out = [];
      for (const n of nodes) {
        const txt = (n.innerText || '').trim();
        if (!txt) continue;
        // include if it mentions our keywords (or include a small sample of everything - to debug)
        if (/Question\s*ID|Chosen\s*Option|Option\s*\d+\s*ID/i.test(txt) || txt.length < 600) {
          out.push(txt);
        }
      }
      // Deduplicate
      const uniq = Array.from(new Set(out));
      return uniq.slice(0, 200); // limit length
    });

    // local parsing function applied to candidate blocks
    function extractFromTextBlocks(blocks) {
      const qidRe = /Question\s*ID\s*[:\u2013-]?\s*([A-Za-z0-9\-_]+)/i;
      const optIdRe = /Option\s*([1-9][0-9]?)\s*ID\s*[:\u2013-]?\s*([A-Za-z0-9\-_]+)/ig;
      const chosenRe = /Chosen\s*Option\s*[:\u2013-]?\s*([0-9]+)/i;
      const out = {};

      for (const block of blocks) {
        if (!/Question\s*ID/i.test(block)) continue;
        const qm = qidRe.exec(block);
        if (!qm) continue;
        const qid = qm[1].trim();
        const optMap = {};
        let m;
        optIdRe.lastIndex = 0;
        while ((m = optIdRe.exec(block)) !== null) {
          optMap[m[1]] = m[2].trim();
        }
        const chosenM = chosenRe.exec(block);
        let chosenNum = chosenM ? chosenM[1].trim() : null;
        let chosenID = null;
        if (chosenNum && optMap[chosenNum]) chosenID = optMap[chosenNum];
        // fallback: if chosenNum present & only one optId present, pick it
        else if (chosenNum && Object.keys(optMap).length === 1) chosenID = Object.values(optMap)[0];
        // final fallback: look for a 6+ digit id in block
        else {
          const idmatch = /([0-9]{6,})/.exec(block);
          if (idmatch) chosenID = idmatch[1];
        }
        out[qid] = chosenID || null;
      }
      return out;
    }

    const parsed = extractFromTextBlocks(candidateBlocks);

    await browser.close();

    if (debug) {
      // send back debug info: status, small snippets
      return {
        parsed,
        status,
        bodyTextSnippet: (bodyText || "").slice(0, 3000),
        htmlSnippet: (pageContent || "").slice(0, 3000),
        candidateBlocks: candidateBlocks.slice(0,50)
      };
    }

    return { parsed, status };

  } catch (err) {
    try { await browser.close(); } catch (e) {}
    throw err;
  }
}

app.get("/parse", async (req, res) => {
  const url = req.query.url;
  const debug = req.query.debug === "1" || req.query.debug === "true";
  if (!url) return res.status(400).json({ ok:false, error:"missing url" });
  try {
    const result = await parsePageAndReturnMap(url, debug);
    return res.json(Object.assign({ ok:true }, result));
  } catch (err) {
    return res.status(500).json({ ok:false, error: String(err) });
  }
});

app.listen(PORT, () => console.log("listening", PORT));


