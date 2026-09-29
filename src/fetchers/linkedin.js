"use strict";
// LinkedIn public guest job search — no login, no key, no signup.
// GET https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search
// Unofficial endpoint: parse HTML cards, stay polite (delays + backoff).

const QUERIES = [
  { key: "eng", q: "electrical electronics engineer" },
  { key: "cad", q: "autocad revit BIM drafter" },
  { key: "telecom", q: "telecom engineer" },
  { key: "tech", q: "data analyst python developer" },
  { key: "pcb", q: "PCB design circuit engineer" },
  { key: "mobile", q: "mobile phone engineer" },
];
const LOCATIONS = { SG: "Singapore", TH: "Thailand", MY: "Malaysia" };

const CATEGORY_KEYWORDS = [
  { category: "mep", rx: /mep\b|mechanical.*electrical/i },
  { category: "cad", rx: /autocad|revit|\bbim\b|drafter|draft/i },
  { category: "telecom", rx: /telecom|5g|network|rf engineer/i },
  { category: "data", rx: /data analy|data scien/i },
  { category: "python", rx: /python/i },
  { category: "mobile", rx: /mobile phone|smartphone|handset/i },
  { category: "pcb", rx: /pcb|circuit|hardware/i },
  { category: "electronic", rx: /electr/i },
];
function tagCategory(title) {
  for (const c of CATEGORY_KEYWORDS) if (c.rx.test(title)) return c.category;
  return "electronic";
}

function stripTags(s) {
  return s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}
function unesc(s) {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}
function grab(card, rx) {
  const m = card.match(rx);
  return m ? unesc(stripTags(m[1])) : "";
}

function parseCards(html, country) {
  const jobs = [];
  const cards = html.match(/<li>[\s\S]*?<\/li>/g) || [];
  for (const card of cards) {
    const id = grab(card, /data-entity-urn="urn:li:jobPosting:(\d+)"/);
    if (!id) continue;
    const hrefM = card.match(/href="([^"]+\/jobs\/view\/[^"]+)"/);
    const title = grab(card, /base-search-card__title">\s*([\s\S]*?)\s*<\/h3>/);
    if (!title) continue;
    const company = grab(card, /base-search-card__subtitle">\s*([\s\S]*?)\s*<\/h4>/);
    let location = grab(card, /job-search-card__location">\s*([\s\S]*?)\s*<\/div>/);
    location = location.split("Actively")[0].trim();
    const posted = grab(card, /<time[^>]*datetime="([^"]+)"/).slice(0, 10);
    const link = hrefM ? hrefM[1].replace(/&amp;/g, "&").split("?")[0] : `https://www.linkedin.com/jobs/view/${id}`;
    jobs.push({
      source: "linkedin",
      source_id: id,
      country,
      category: tagCategory(title),
      title,
      company,
      location: location || LOCATIONS[country],
      salary: "",
      job_type: "",
      posted_at: posted,
      apply_url: link,
      apply_email: "",
      snippet: "",
    });
  }
  return jobs;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchLinkedIn() {
  const all = [];
  let calls = 0;
  for (const [country, loc] of Object.entries(LOCATIONS)) {
    for (const q of QUERIES) {
      const url =
        "https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search" +
        `?keywords=${encodeURIComponent(q.q)}&location=${encodeURIComponent(loc)}&start=0`;
      calls++;
      try {
        const res = await fetch(url, {
          headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
          signal: AbortSignal.timeout(30000),
        });
        if (res.status === 429) {
          console.warn("[linkedin] 429 rate limited — backing off this cycle");
          await sleep(15000);
          continue;
        }
        if (!res.ok) { console.warn(`[linkedin] ${country}/${q.key}: HTTP ${res.status}`); continue; }
        const html = await res.text();
        all.push(...parseCards(html, country));
      } catch (e) {
        console.warn(`[linkedin] ${country}/${q.key} failed: ${e.message}`);
      }
      await sleep(2000); // stay polite
    }
  }
  return { jobs: all, calls };
}

module.exports = { fetchLinkedIn, QUERIES, parseCards };
