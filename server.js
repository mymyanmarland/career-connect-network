"use strict";
// 💼 Career Connect Network — public auto job board (SG/TH/MY).
// Pipeline: JobStreet(SG/MY) + JobsDB(TH) + MyCareersFuture(SG) + JobThai(TH) +
// Hiredly(MY) + LinkedIn guest(SG/TH/MY) — ALL keyless, no signup
// → dedup queue (60-day freshness) → 30-min publisher → gateway bilingual summaries (template fallback).
const express = require("express");
const path = require("path");
const cron = require("node-cron");
const store = require("./src/store");
const gw = require("./src/gateway");
const { fetchMcf } = require("./src/fetchers/mcf");
const { fetchLinkedIn } = require("./src/fetchers/linkedin");
const { fetchSeek } = require("./src/fetchers/seek");
const { fetchJobThai } = require("./src/fetchers/jobthai");
const { fetchHiredly } = require("./src/fetchers/hiredly");
const { runPublishCycle } = require("./src/publisher");

const app = express();
const PORT = process.env.PORT || 3014;
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

// ---------- public API ----------
app.get("/api/posts", (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 3, 30);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const { posts, total } = store.listPosts({
    country: String(req.query.country || "").toUpperCase().slice(0, 2),
    category: String(req.query.category || "").slice(0, 20),
    source: String(req.query.source || "").slice(0, 20),
    q: String(req.query.q || "").slice(0, 80),
    limit, offset,
  });
  res.json({ ok: true, posts, total });
});

app.get("/api/posts/:id", (req, res) => {
  const p = store.getPost(Number(req.params.id));
  if (!p) return res.status(404).json({ ok: false, error: "not found" });
  res.json({ ok: true, post: p });
});

app.get("/api/stats", (req, res) => {
  res.json({ ok: true, stats: store.stats() });
});

// ---------- settings ----------
app.get("/api/settings/status", (req, res) => {
  res.json({
    ok: true,
    gateway: !!store.getSecret("gateway_key"),
    gateway_model: store.getSetting("gateway_model", gw.DEFAULT_MODEL),
    sources: ["jobstreet", "jobsdb", "mcf", "jobthai", "hiredly", "linkedin"],
    last_mcf_fetch: store.getState("last_mcf_fetch", ""),
    last_linkedin_fetch: store.getState("last_linkedin_fetch", ""),
    last_seek_fetch: store.getState("last_seek_fetch", ""),
    last_jobthai_fetch: store.getState("last_jobthai_fetch", ""),
    last_hiredly_fetch: store.getState("last_hiredly_fetch", ""),
  });
});

app.post("/api/settings/keys", (req, res) => {
  const b = req.body || {};
  if ("gateway_key" in b) store.setSecret("gateway_key", String(b.gateway_key || "").trim());
  if ("gateway_model" in b) store.setSetting("gateway_model", String(b.gateway_model || gw.DEFAULT_MODEL).slice(0, 60));
  res.json({ ok: true });
});

// ---------- admin triggers ----------
async function runMcfFetch() {
  const { jobs, calls } = await fetchMcf();
  const { added, dupes } = store.insertJobs(jobs);
  store.setState("last_mcf_fetch", new Date().toISOString());
  console.log(`[fetch] mcf SG: ${jobs.length} fetched, ${added} new, ${dupes} dupes (${calls} calls)`);
  return { ok: true, fetched: jobs.length, added, dupes, calls };
}

async function runLinkedInFetch() {
  const { jobs, calls } = await fetchLinkedIn();
  const { added, dupes } = store.insertJobs(jobs);
  store.setState("last_linkedin_fetch", new Date().toISOString());
  console.log(`[fetch] linkedin SG/TH/MY: ${jobs.length} fetched, ${added} new, ${dupes} dupes (${calls} calls)`);
  return { ok: true, fetched: jobs.length, added, dupes, calls };
}

async function runSeekFetch() {
  const { jobs, calls } = await fetchSeek();
  const { added, dupes } = store.insertJobs(jobs);
  store.setState("last_seek_fetch", new Date().toISOString());
  console.log(`[fetch] seek JobStreet/JobsDB: ${jobs.length} fetched, ${added} new, ${dupes} dupes (${calls} calls)`);
  return { ok: true, fetched: jobs.length, added, dupes, calls };
}

async function runJobThaiFetch() {
  const { jobs, calls } = await fetchJobThai();
  const { added, dupes } = store.insertJobs(jobs);
  store.setState("last_jobthai_fetch", new Date().toISOString());
  console.log(`[fetch] jobthai TH: ${jobs.length} fetched, ${added} new, ${dupes} dupes (${calls} calls)`);
  return { ok: true, fetched: jobs.length, added, dupes, calls };
}

async function runHiredlyFetch() {
  const { jobs, calls } = await fetchHiredly();
  const { added, dupes } = store.insertJobs(jobs);
  store.setState("last_hiredly_fetch", new Date().toISOString());
  console.log(`[fetch] hiredly MY: ${jobs.length} fetched, ${added} new, ${dupes} dupes (${calls} calls)`);
  return { ok: true, fetched: jobs.length, added, dupes, calls };
}

app.post("/api/admin/fetch", async (req, res) => {
  const m = await runMcfFetch();
  const s = await runSeekFetch();
  const t = await runJobThaiFetch();
  const h = await runHiredlyFetch();
  const l = await runLinkedInFetch();
  res.json({ ok: true, mcf: m, seek: s, jobthai: t, hiredly: h, linkedin: l });
});
app.post("/api/admin/publish", async (req, res) => {
  res.json(await runPublishCycle({ manual: true }));
});

// ---------- schedules ----------
// Publish: every 30 minutes.
cron.schedule("*/30 * * * *", async () => {
  try { await runPublishCycle(); }
  catch (e) { console.error("[publisher] cycle failed:", e.message); }
});
// MyCareersFuture SG fetch: every 6 hours (public API, no limits to worry about).
cron.schedule("0 */6 * * *", async () => {
  try { await runMcfFetch(); }
  catch (e) { console.error("[fetch] mcf failed:", e.message); }
});
// SEEK (JobStreet SG/MY + JobsDB TH) fetch: every 6 hours, offset 1h.
cron.schedule("0 1,7,13,19 * * *", async () => {
  try { await runSeekFetch(); }
  catch (e) { console.error("[fetch] seek failed:", e.message); }
});
// JobThai TH fetch: every 6 hours, offset 2h.
cron.schedule("0 2,8,14,20 * * *", async () => {
  try { await runJobThaiFetch(); }
  catch (e) { console.error("[fetch] jobthai failed:", e.message); }
});
// Hiredly MY fetch: every 6 hours, offset 4h.
cron.schedule("0 4,10,16,22 * * *", async () => {
  try { await runHiredlyFetch(); }
  catch (e) { console.error("[fetch] hiredly failed:", e.message); }
});
// LinkedIn guest fetch: every 6 hours, offset 3h (polite, keyless).
cron.schedule("0 3,9,15,21 * * *", async () => {
  try { await runLinkedInFetch(); }
  catch (e) { console.error("[fetch] linkedin failed:", e.message); }
});

app.listen(PORT, () => {
  console.log(`💼 Career Connect Network on :${PORT}`);
  // Kick off one fetch cycle at boot (best-effort).
  runMcfFetch().catch((e) => console.error("[boot] mcf:", e.message));
  runSeekFetch().catch((e) => console.error("[boot] seek:", e.message));
  runJobThaiFetch().catch((e) => console.error("[boot] jobthai:", e.message));
  runHiredlyFetch().catch((e) => console.error("[boot] hiredly:", e.message));
  runLinkedInFetch().catch((e) => console.error("[boot] linkedin:", e.message));
});
