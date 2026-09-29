"use strict";
// SQLite store for Career Connect Network: jobs + posts + settings.
// API keys encrypted with AES-256-GCM (APP_SECRET env).
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const DATA_DIR = path.join(__dirname, "..", "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, "jobs.db"));
db.exec(`
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
  CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    source_id TEXT NOT NULL,
    country TEXT NOT NULL,
    category TEXT NOT NULL,
    title TEXT NOT NULL,
    company TEXT DEFAULT '',
    location TEXT DEFAULT '',
    salary TEXT DEFAULT '',
    job_type TEXT DEFAULT '',
    posted_at TEXT DEFAULT '',
    apply_url TEXT NOT NULL,
    apply_email TEXT DEFAULT '',
    snippet TEXT DEFAULT '',
    en_summary TEXT DEFAULT '',
    my_summary TEXT DEFAULT '',
    posted INTEGER NOT NULL DEFAULT 0,
    post_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(source, source_id)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_apply_url ON jobs(apply_url);
  CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_ids TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS fetch_state (key TEXT PRIMARY KEY, value TEXT);
`);

// ---- encryption ----
let _key = null;
function appKey() {
  if (_key) return _key;
  const s = process.env.APP_SECRET;
  if (s && s.length >= 16) {
    _key = crypto.createHash("sha256").update(String(s)).digest();
  } else {
    _key = crypto.randomBytes(32);
    console.warn("[store] APP_SECRET not set — API keys will NOT survive a restart.");
  }
  return _key;
}
function enc(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", appKey(), iv);
  const ct = Buffer.concat([c.update(String(plain), "utf8"), c.final()]);
  return JSON.stringify({ iv: iv.toString("base64"), tag: c.getAuthTag().toString("base64"), data: ct.toString("base64") });
}
function dec(payload) {
  const o = JSON.parse(payload);
  const d = crypto.createDecipheriv("aes-256-gcm", appKey(), Buffer.from(o.iv, "base64"));
  d.setAuthTag(Buffer.from(o.tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(o.data, "base64")), d.final()]).toString("utf8");
}

function getSetting(key, fallback = null) {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
  return row ? row.value : fallback;
}
function setSetting(key, value) {
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}
function getSecret(key) {
  const v = getSetting("secret:" + key);
  if (!v) return null;
  try { return dec(v); } catch { return null; }
}
function setSecret(key, plain) {
  if (!plain) { db.prepare("DELETE FROM settings WHERE key = ?").run("secret:" + key); return; }
  setSetting("secret:" + key, enc(plain));
}

// ---- jobs ----
const insertJobStmt = db.prepare(`
  INSERT OR IGNORE INTO jobs
    (source, source_id, country, category, title, company, location, salary, job_type, posted_at, apply_url, apply_email, snippet)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
// Returns number of genuinely new rows (dedup: UNIQUE source+source_id and apply_url).
const EMAIL_RX = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
function extractEmail(j) {
  const m = [j.title, j.company, j.snippet].join(" ").match(EMAIL_RX);
  return m ? m[0].toLowerCase() : "";
}
const SIXTY_DAYS = 60 * 24 * 60 * 60 * 1000;
function isFresh(postedAt) {
  if (!postedAt) return true;
  const t = Date.parse(postedAt);
  if (!Number.isFinite(t)) return true;
  const now = Date.now();
  return t >= now - SIXTY_DAYS && t <= now + 24 * 60 * 60 * 1000;
}

function insertJobs(list) {
  let added = 0, dupes = 0;
  for (const j of list) {
    if (!j.apply_url || !j.source_id || !j.title) { dupes++; continue; }
    if (!isFresh(j.posted_at)) { dupes++; continue; } // stale (>60d) or future-dated
    if (!j.apply_email) j.apply_email = extractEmail(j);
    const r = insertJobStmt.run(
      j.source, String(j.source_id), j.country, j.category,
      String(j.title).slice(0, 300), String(j.company || "").slice(0, 200),
      String(j.location || "").slice(0, 200), String(j.salary || "").slice(0, 120),
      String(j.job_type || "").slice(0, 60), String(j.posted_at || "").slice(0, 30),
      String(j.apply_url).slice(0, 1000), String(j.apply_email || "").slice(0, 200),
      String(j.snippet || "").slice(0, 600)
    );
    if (r.changes > 0) added++; else dupes++;
  }
  return { added, dupes };
}

// Pick next N unposted jobs: newest-first, country-balanced (at least 1 per country when available).
function pickNextJobs(n = 5) {
  const picked = [];
  const seen = new Set();
  // Round 1: newest unposted from each country.
  for (const c of ["SG", "TH", "MY"]) {
    const row = db.prepare(
      "SELECT * FROM jobs WHERE posted = 0 AND country = ? ORDER BY posted_at DESC, id DESC LIMIT 1"
    ).get(c);
    if (row) { picked.push(row); seen.add(row.id); }
  }
  // Round 2: fill remaining with newest unposted overall.
  if (picked.length < n) {
    const rest = db.prepare(
      "SELECT * FROM jobs WHERE posted = 0 ORDER BY posted_at DESC, id DESC LIMIT 200"
    ).all().filter((r) => !seen.has(r.id));
    for (const r of rest) {
      if (picked.length >= n) break;
      picked.push(r);
    }
  }
  return picked.slice(0, n);
}

function saveSummaries(items) {
  const stmt = db.prepare("UPDATE jobs SET en_summary = ?, my_summary = ? WHERE id = ?");
  for (const it of items) stmt.run(String(it.en || "").slice(0, 500), String(it.my || "").slice(0, 500), it.id);
}
function markPosted(jobIds, postId) {
  const stmt = db.prepare("UPDATE jobs SET posted = 1, post_id = ? WHERE id = ?");
  for (const id of jobIds) stmt.run(postId, id);
}
function createPost(jobIds) {
  const r = db.prepare("INSERT INTO posts (job_ids) VALUES (?)").run(JSON.stringify(jobIds));
  return r.lastInsertRowid;
}

// ---- posts feed ----
function countPosts(where, params) {
  return db.prepare(`SELECT COUNT(*) AS c FROM posts p ${where}`).get(...params).c;
}
function listPosts({ country = "", category = "", q = "", source = "", limit = 10, offset = 0 } = {}) {
  // A post matches the filter if ANY of its jobs match.
  const conds = [];
  const params = [];
  if (country) { conds.push("j.country = ?"); params.push(country); }
  if (category) { conds.push("j.category = ?"); params.push(category); }
  if (source) { conds.push("j.source = ?"); params.push(source); }
  if (q) { conds.push("(j.title LIKE ? OR j.company LIKE ? OR j.snippet LIKE ?)"); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  const jobFilter = conds.length ? "AND " + conds.join(" AND ") : "";
  const total = db.prepare(`
    SELECT COUNT(*) AS c FROM posts p
    WHERE EXISTS (SELECT 1 FROM jobs j WHERE j.post_id = p.id ${jobFilter})
  `).get(...params).c;
  const rows = db.prepare(`
    SELECT p.id, p.job_ids, p.created_at
    FROM posts p
    WHERE EXISTS (SELECT 1 FROM jobs j WHERE j.post_id = p.id ${jobFilter})
    ORDER BY p.id DESC LIMIT ? OFFSET ?
  `).all(...params, limit, offset);
  const posts = rows.map((p) => ({ ...p, jobs: getJobsForPost(p.id, { country, category, q, source }) }));
  return { posts, total };
}
function getJobsForPost(postId, filter = {}) {
  const conds = ["post_id = ?"];
  const params = [postId];
  if (filter.country) { conds.push("country = ?"); params.push(filter.country); }
  if (filter.category) { conds.push("category = ?"); params.push(filter.category); }
  if (filter.source) { conds.push("source = ?"); params.push(filter.source); }
  if (filter.q) { conds.push("(title LIKE ? OR company LIKE ? OR snippet LIKE ?)"); params.push(`%${filter.q}%`, `%${filter.q}%`, `%${filter.q}%`); }
  return db.prepare(`SELECT * FROM jobs WHERE ${conds.join(" AND ")} ORDER BY id ASC`).all(...params);
}
function getPost(id) {
  const p = db.prepare("SELECT * FROM posts WHERE id = ?").get(id);
  if (!p) return null;
  return { ...p, jobs: getJobsForPost(id) };
}

function stats() {
  const total = db.prepare("SELECT COUNT(*) AS c FROM jobs").get().c;
  const queued = db.prepare("SELECT COUNT(*) AS c FROM jobs WHERE posted = 0").get().c;
  const posted = db.prepare("SELECT COUNT(*) AS c FROM jobs WHERE posted = 1").get().c;
  const posts = db.prepare("SELECT COUNT(*) AS c FROM posts").get().c;
  const byCountry = db.prepare("SELECT country, COUNT(*) AS c FROM jobs GROUP BY country").all();
  const lastPost = db.prepare("SELECT created_at FROM posts ORDER BY id DESC LIMIT 1").get();
  return { total, queued, posted, posts, byCountry, lastPostAt: lastPost ? lastPost.created_at : null };
}

// ---- fetch_state (budgets, last runs) ----
function getState(key, fallback = null) {
  const row = db.prepare("SELECT value FROM fetch_state WHERE key = ?").get(key);
  return row ? row.value : fallback;
}
function setState(key, value) {
  db.prepare("INSERT INTO fetch_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, String(value));
}

module.exports = {
  getSetting, setSetting, getSecret, setSecret,
  insertJobs, pickNextJobs, saveSummaries, markPosted, createPost,
  listPosts, getPost, stats, getState, setState,
};
