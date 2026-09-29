"use strict";
// 30-minute publisher: takes the 5 newest unposted jobs (country-balanced),
// asks the gateway for bilingual summaries, saves the post.
// Dedup is structural: UNIQUE(source,source_id) + UNIQUE(apply_url) + posted flag —
// a job can never appear in two posts.
const store = require("./store");
const gw = require("./gateway");

function gatewayCfg() {
  return {
    baseUrl: store.getSetting("gateway_base", gw.DEFAULT_BASE_URL),
    model: store.getSetting("gateway_model", gw.DEFAULT_MODEL),
    apiKey: store.getSecret("gateway_key"),
  };
}

async function runPublishCycle({ manual = false } = {}) {
  const cfg = gatewayCfg();
  const jobs = store.pickNextJobs(5);
  if (jobs.length === 0) {
    return { ok: false, reason: "empty_queue", message: "တင်စရာ job အသစ် မရှိသေးပါ — fetch ကို စောင့်နေပါတယ်။" };
  }
  const summaries = await gw.summarizeJobs(cfg, jobs);
  store.saveSummaries(summaries);
  const postId = store.createPost(jobs.map((j) => j.id));
  store.markPosted(jobs.map((j) => j.id), postId);
  console.log(`[publisher] post #${postId}: ${jobs.length} jobs (${jobs.map((j) => j.country).join(",")})${manual ? " (manual)" : ""}`);
  return { ok: true, postId, count: jobs.length, countries: jobs.map((j) => j.country) };
}

module.exports = { runPublishCycle, gatewayCfg };
