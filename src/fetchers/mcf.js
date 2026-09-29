"use strict";
// MyCareersFuture — Singapore's national job bank (Workforce Singapore).
// Public zero-auth JSON API. No signup, no key, no card.
// POST https://api.mycareersfuture.gov.sg/v2/search?limit=N&page=N  { "search": "<keyword>" }

const KEYWORDS = [
  { category: "mep", keyword: "MEP engineer" },
  { category: "electronic", keyword: "electrical engineer" },
  { category: "cad", keyword: "AutoCAD Revit drafter" },
  { category: "telecom", keyword: "telecom engineer" },
  { category: "data", keyword: "data analyst" },
  { category: "python", keyword: "python developer" },
  { category: "pcb", keyword: "PCB design engineer" },
  { category: "mobile", keyword: "mobile phone engineer" },
];

function fmtSalary(s) {
  if (!s || (!s.minimum && !s.maximum)) return "";
  const f = (v) => Number(v).toLocaleString("en-US");
  const type = (s.type && s.type.salaryType) || "";
  const per = /month/i.test(type) ? "/month" : /year/i.test(type) ? "/year" : type ? `/${type}` : "";
  const body = s.minimum && s.maximum ? `S$${f(s.minimum)} – S$${f(s.maximum)}` : `S$${f(s.minimum || s.maximum)}`;
  return `${body} ${per}`.trim();
}

function normalize(category, item) {
  const md = item.metadata || {};
  const company = (item.hiringCompany && item.hiringCompany.name) || (item.postedCompany && item.postedCompany.name) || "";
  const skills = Array.isArray(item.skills)
    ? item.skills.map((s) => (typeof s === "string" ? s : s.skill)).filter(Boolean).slice(0, 8).join(", ")
    : "";
  const jobTypes = Array.isArray(item.employmentTypes)
    ? item.employmentTypes.map((t) => (typeof t === "string" ? t : t.employmentType)).filter(Boolean).join(", ")
    : "";
  return {
    source: "mcf",
    source_id: String(item.uuid || md.jobDetailsUrl || ""),
    country: "SG",
    category,
    title: item.title || "",
    company,
    location: "Singapore",
    salary: fmtSalary(item.salary),
    job_type: jobTypes,
    posted_at: (md.newPostingDate || "").slice(0, 10),
    apply_url: md.jobDetailsUrl || "",
    apply_email: "",
    snippet: skills,
  };
}

async function fetchMcf() {
  const all = [];
  let calls = 0;
  for (const q of KEYWORDS) {
    const url = "https://api.mycareersfuture.gov.sg/v2/search?limit=50&page=1";
    calls++;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": "CareerConnectNetwork/1.0" },
        body: JSON.stringify({ search: q.keyword }),
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) { console.warn(`[mcf] ${q.category}: HTTP ${res.status}`); continue; }
      const data = await res.json();
      for (const item of data.results || []) all.push(normalize(q.category, item));
    } catch (e) {
      console.warn(`[mcf] ${q.category} failed: ${e.message}`);
    }
  }
  return { jobs: all, calls };
}

module.exports = { fetchMcf, KEYWORDS };
