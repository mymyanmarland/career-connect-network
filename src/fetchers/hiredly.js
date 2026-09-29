"use strict";
// Hiredly (Malaysia) — public category pages, no key.
// Job data lives in __NEXT_DATA__: props.pageProps.jobs

const KEYWORDS = [
  { category: "mep", slug: "mep-engineer" },
  { category: "electronic", slug: "electronics-engineer" },
  { category: "cad", slug: "autocad-revit" },
  { category: "telecom", slug: "telecom-engineer" },
  { category: "data", slug: "data-analyst" },
  { category: "python", slug: "python-developer" },
  { category: "pcb", slug: "pcb-circuit-design-engineer" },
  { category: "mobile", slug: "mobile-phone-engineer" },
];

function extractNextData(html) {
  const m = String(html).match(/<script[^>]+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

function parseRows(html) {
  const nd = extractNextData(html);
  const jobs = nd && nd.props && nd.props.pageProps && nd.props.pageProps.jobs;
  return Array.isArray(jobs) ? jobs : [];
}

function normalize(category, row) {
  if (row.active === false || row.expired === true) return null;
  const skills = Array.isArray(row.skills) ? row.skills.map((s) => s && s.name).filter(Boolean) : [];
  const salary = typeof row.salary === "string" && !/undisclosed/i.test(row.salary) ? "RM " + row.salary : "";
  return {
    source: "hiredly",
    source_id: String(row.id || ""),
    country: "MY",
    category,
    title: row.title || "",
    company: (row.company && row.company.name) || row.aggregatedCompanyName || "",
    location: [row.stateRegion, row.location].filter(Boolean).join(", ") || "Malaysia",
    salary,
    job_type: row.jobType || "",
    posted_at: String(row.activeAt || "").slice(0, 10),
    apply_url: `https://my.hiredly.com/jobs/${encodeURIComponent(String(row.slug || row.id))}`,
    apply_email: "",
    snippet: [row.gptSummary, skills.join(" ")].filter(Boolean).join(" ").slice(0, 600),
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchHiredly() {
  const all = [];
  let calls = 0;
  for (const q of KEYWORDS) {
    const url = `https://my.hiredly.com/${q.slug}-jobs`;
    calls++;
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) { console.warn(`[hiredly] ${q.category}: HTTP ${res.status}`); continue; }
      const html = await res.text();
      for (const row of parseRows(html)) {
        const job = normalize(q.category, row);
        if (job) all.push(job);
      }
    } catch (e) {
      console.warn(`[hiredly] ${q.category} failed: ${e.message}`);
    }
    await sleep(1500);
  }
  return { jobs: all, calls };
}

module.exports = { fetchHiredly, KEYWORDS, parseRows };
