"use strict";
// JobThai (Thailand) — public search pages, no key.
// Job data lives in __NEXT_DATA__ (Apollo cache): ROOT_QUERY["searchJobs(...)"].data.data

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

function extractNextData(html) {
  const m = String(html).match(/<script[^>]+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

function parseRows(html) {
  const nd = extractNextData(html);
  const rq = nd && nd.props && nd.props.apolloState && nd.props.apolloState.ROOT_QUERY;
  if (!rq) return [];
  const key = Object.keys(rq).find((k) => k.startsWith("searchJobs("));
  const entry = key && rq[key];
  const rows = entry && entry.data && entry.data.data;
  return Array.isArray(rows) ? rows : [];
}

function normalize(category, row) {
  const tags = Array.isArray(row.tags) ? row.tags.map((t) => t && (t.name || t.tagName || t)).filter(Boolean) : [];
  const loc = [row.province && row.province.name, row.district && row.district.name, row.workLocation].filter(Boolean).join(", ");
  return {
    source: "jobthai",
    source_id: String(row.id || ""),
    country: "TH",
    category,
    title: row.jobTitle || "",
    company: row.companyName || "",
    location: loc || "Thailand",
    salary: typeof row.salary === "string" ? row.salary : "",
    job_type: (row.jobType && row.jobType.name) || "",
    posted_at: String(row.updatedAt || "").slice(0, 10),
    apply_url: `https://www.jobthai.com/en/company/job/${encodeURIComponent(String(row.id))}`,
    apply_email: "",
    snippet: tags.join(" ").slice(0, 600),
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJobThai() {
  const all = [];
  let calls = 0;
  for (const q of KEYWORDS) {
    for (const page of [1, 2]) {
      const url = `https://www.jobthai.com/en/jobs?keyword=${encodeURIComponent(q.keyword)}&page=${page}`;
      calls++;
      try {
        const res = await fetch(url, {
          headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
          signal: AbortSignal.timeout(30000),
        });
        if (!res.ok) { console.warn(`[jobthai] ${q.category} p${page}: HTTP ${res.status}`); continue; }
        const html = await res.text();
        for (const row of parseRows(html)) all.push(normalize(q.category, row));
      } catch (e) {
        console.warn(`[jobthai] ${q.category} p${page} failed: ${e.message}`);
      }
      await sleep(1500);
    }
  }
  return { jobs: all, calls };
}

module.exports = { fetchJobThai, KEYWORDS, parseRows };
