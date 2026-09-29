"use strict";
// OpenAI-compatible gateway client + bilingual job-post summarizer.
// The gateway WRITES the post text; it never discovers jobs (no browsing).
// Summaries are strictly grounded: only facts from the job record may be used.

const DEFAULT_BASE_URL = "https://claude-n-codex.com:8443/v1";
const DEFAULT_MODEL = "claude-sonnet-5";

async function chatCompletion(baseUrl, apiKey, model, system, user, opts = {}) {
  const url = baseUrl.replace(/\/+$/, "") + "/chat/completions";
  const timeoutMs = opts.timeoutMs || 120000;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + apiKey },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: opts.temperature ?? 0.2,
        max_tokens: opts.maxTokens ?? 3000,
      }),
      signal: ctrl.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`gateway HTTP ${res.status}: ${text.slice(0, 300)}`);
    const data = JSON.parse(text);
    const content = data?.choices?.[0]?.message?.content;
    if (!content) throw new Error("gateway returned no content");
    return content;
  } finally {
    clearTimeout(t);
  }
}

const SYSTEM = `You are a precise bilingual (English + Myanmar/Burmese) job-post editor for "Career Connect Network".

For EACH job you receive, write:
- "en": ONE English sentence (max 25 words) summarizing the role and its single most important requirement.
- "my": the same summary in natural, correct Myanmar language (max 35 words).

STRICT RULES:
- Use ONLY facts present in the given job data. Never invent salary, location, requirements, or company facts.
- If salary is empty, do not mention salary.
- Do not add marketing fluff ("amazing opportunity", "apply now").
- Myanmar text must be grammatical and professional — this is shown to the public.
- Return ONLY a JSON array, one object per job in the same order: [{"id": <job id>, "en": "...", "my": "..."}]. No other text.`;

function summarizePrompt(jobs) {
  const lines = jobs.map((j) => {
    return `{"id": ${j.id}, "title": ${JSON.stringify(j.title)}, "company": ${JSON.stringify(j.company)}, "location": ${JSON.stringify(j.location)}, "country": "${j.country}", "category": "${j.category}", "job_type": ${JSON.stringify(j.job_type)}, "salary": ${JSON.stringify(j.salary)}, "posted_at": ${JSON.stringify(j.posted_at)}, "snippet": ${JSON.stringify((j.snippet || "").slice(0, 400))}}`;
  });
  return `Summarize these ${jobs.length} jobs:\n${lines.join("\n")}`;
}

function extractJsonArray(text) {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) throw new Error("no JSON array in gateway reply");
  return JSON.parse(text.slice(start, end + 1));
}

// Returns [{id, en, my}] — falls back to template summaries if the gateway fails.
async function summarizeJobs(cfg, jobs) {
  const fallback = jobs.map((j) => ({
    id: j.id,
    en: `${j.title} at ${j.company || "a company"}${j.location ? " in " + j.location : ""}.`,
    my: `${j.company || "ကုမ္ပဏီတစ်ခု"} တွင် ${j.title} ရာထူး${j.location ? " (" + j.location + ")" : ""} ခေါ်ယူနေပါသည်။`,
  }));
  if (!cfg.apiKey) return fallback;
  try {
    const raw = await chatCompletion(cfg.baseUrl, cfg.apiKey, cfg.model, SYSTEM, summarizePrompt(jobs), { temperature: 0.2, maxTokens: 3000 });
    const arr = extractJsonArray(raw);
    const byId = new Map(arr.map((o) => [Number(o.id), o]));
    return jobs.map((j) => {
      const o = byId.get(Number(j.id));
      const fb = fallback.find((f) => f.id === j.id);
      return {
        id: j.id,
        en: o && typeof o.en === "string" && o.en.trim() ? o.en.trim().slice(0, 500) : fb.en,
        my: o && typeof o.my === "string" && o.my.trim() ? o.my.trim().slice(0, 500) : fb.my,
      };
    });
  } catch (e) {
    console.warn("[gateway] summarize failed, using template fallback:", e.message);
    return fallback;
  }
}

module.exports = { DEFAULT_BASE_URL, DEFAULT_MODEL, chatCompletion, summarizeJobs };
