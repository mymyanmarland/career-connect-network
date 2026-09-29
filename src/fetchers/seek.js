"use strict";
// SEEK public job-search API — powers JobStreet (SG/MY) and JobsDB (TH).
// No signup, no key: https://<host>/api/jobsearch/v5/search?siteKey=..&keywords=..

const MARKETS = [
  { country: "SG", host: "sg.jobstreet.com", siteKey: "SG-Main" },
  { country: "MY", host: "my.jobstreet.com", siteKey: "MY-Main" },
  { country: "TH", host: "th.jobsdb.com", siteKey: "TH-Main" },
];

const KEYWORDS = [
  { category: "mep", keyword: "MEP engineer" },
  { category: "electronic", keyword: "electronics engineer" },
  { category: "cad", keyword: "AutoCAD Revit" },
  { category: "telecom", keyword: "telecom engineer" },
  { category: "data", keyword: "data analyst" },
  { category: "python", keyword: "Python developer" },
  { category: "pcb", keyword: "PCB circuit design engineer" },
  { category: "mobile", keyword: "mobile phone engineer" },
];

function normalize(market, category, row) {
  const locs = Array.isArray(row.locations) ? row.locations.map((l) => l && l.label).filter(Boolean) : [];
  const teaser = row.teaser || (Array.isArray(row.bulletPoints) ? row.bulletPoints.join(" ") : "");
  return {
    source: market.host.includes("jobsdb") ? "jobsdb" : "jobstreet",
    source_id: String(row.id || ""),
    country: market.country,
    category,
    title: row.title || "",
    company: row.companyName || (row.advertiser && row.advertiser.description) || "",
    location: locs.join(", ") || market.country,
    salary: row.salaryLabel || "",
    job_type: Array.isArray(row.workTypes) ? row.workTypes.filter(Boolean).join(", ") : "",
    posted_at: String(row.listingDate || row.listedAt || "").slice(0, 10),
    apply_url: `https://${market.host}/job/${encodeURIComponent(String(row.id))}`,
    apply_email: "",
    snippet: String(teaser).slice(0, 600),
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchSeek() {
  const all = [];
  let calls = 0;
  for (const market of MARKETS) {
    for (const q of KEYWORDS) {
      const url = `https://${market.host}/api/jobsearch/v5/search?siteKey=${encodeURIComponent(market.siteKey)}&page=1&keywords=${encodeURIComponent(q.keyword)}&sortmode=ListedDate`;
      calls++;
      try {
        const res = await fetch(url, {
          headers: { Accept: "application/json", "User-Agent": "CareerConnectNetwork/1.0" },
          signal: AbortSignal.timeout(30000),
        });
        if (!res.ok) { console.warn(`[seek] ${market.country}/${q.category}: HTTP ${res.status}`); continue; }
        const data = await res.json();
        for (const row of data.data || []) all.push(normalize(market, q.category, row));
      } catch (e) {
        console.warn(`[seek] ${market.country}/${q.category} failed: ${e.message}`);
      }
      await sleep(800);
    }
  }
  return { jobs: all, calls };
}

module.exports = { fetchSeek, MARKETS, KEYWORDS };
