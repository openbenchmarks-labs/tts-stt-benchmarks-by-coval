// Mirror Coval's public voice benchmark (TTS + STT) into a committed snapshot
// that the /voice page renders. Attributed to Coval — this is THEIR run; we
// pull-and-cache with attribution, never proxy live.
//
// Pull-and-cache: fetch aggregates + leaderboard + providers, DROP the heavy raw
// `series` (~11 MB), keep only `model_stats`, normalize latency units to ms,
// validate, and write data/coval/voice.json. If a fetch/validation fails, we
// leave the existing snapshot untouched (never publish a broken/partial mirror).
//
// Run: node scripts/ingest-coval.mjs   (daily via GitHub Action)
//
// Host note: this is Coval's internal Cloud Run URL today. If they give us a
// canonical host, set COVAL_API_BASE and nothing else changes.

import { promises as fs } from "node:fs";
import path from "node:path";

const API_BASE =
  process.env.COVAL_API_BASE ||
  "https://benchmarks-api-6wxgp27p2a-ue.a.run.app";

// In the mirror repo the Action sets COVAL_OUT_PATH=coval-benchmarks.json (repo
// root); locally it defaults under data/coval/ for the site's fallback seed.
const OUT_PATH = process.env.COVAL_OUT_PATH || "data/coval/coval-benchmarks.json";
const BENCHMARKS = ["TTS", "STT"];
const WINDOWS = ["24h", "7d", "30d"];

// Headline latency metric per benchmark (what the leaderboard ranks by).
const LATENCY_METRIC = { TTS: "TTFA", STT: "TTFS" };
// Latency metric_types Coval reports in SECONDS (TTS TTFA is already ms).
const SECONDS_METRICS = new Set(["TTFS", "TTFT", "AudioToFinal"]);
// metric_types we keep per benchmark (their site headlines these).
const KEEP_METRICS = {
  TTS: new Set(["TTFA", "WER"]),
  STT: new Set(["TTFS", "TTFT", "WER"]),
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJSON(pathname) {
  const res = await fetch(`${API_BASE}${pathname}`, {
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error(`GET ${pathname} -> HTTP ${res.status}`);
  return res.json();
}

function unitFor(metricType) {
  if (metricType === "WER") return "percent";
  if (metricType === "RTF") return "ratio";
  return "ms";
}

function normalize(metricType, value) {
  if (typeof value !== "number") return null;
  return SECONDS_METRICS.has(metricType) ? value * 1000 : value;
}

// Pivot model_stats (one row per provider×model×metric_type) into one row per
// model, with the kept metrics normalized to ms/percent.
function pivotModels(modelStats, benchmark) {
  const keep = KEEP_METRICS[benchmark];
  const byModel = new Map();
  for (const r of modelStats) {
    if (!keep.has(r.metric_type)) continue;
    const key = `${r.provider}/${r.model}`;
    if (!byModel.has(key)) {
      byModel.set(key, { provider: r.provider, model: r.model, metrics: {} });
    }
    byModel.get(key).metrics[r.metric_type] = {
      unit: unitFor(r.metric_type),
      avg: normalize(r.metric_type, r.avg_value),
      p50: normalize(r.metric_type, r.p50),
      p90: normalize(r.metric_type, r.p90),
      p95: normalize(r.metric_type, r.p95),
      p99: normalize(r.metric_type, r.p99),
      min: normalize(r.metric_type, r.min_value),
      max: normalize(r.metric_type, r.max_value),
      samples: r.sample_count ?? null,
    };
  }
  return [...byModel.values()];
}

// The headline `7d` window must be present + valid for every benchmark, or we
// abort (leave the previous snapshot). Other windows (24h/30d) are best-effort.
const REQUIRED_WINDOW = "7d";
function validate(snapshot) {
  for (const b of BENCHMARKS) {
    const rows = snapshot.benchmarks[b]?.windows?.[REQUIRED_WINDOW]?.models;
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new Error(`validation: missing required ${b}/${REQUIRED_WINDOW}`);
    }
    const lat = LATENCY_METRIC[b];
    if (!rows.some((r) => typeof r.metrics?.[lat]?.p50 === "number")) {
      throw new Error(`validation: no ${lat} latency in ${b}/${REQUIRED_WINDOW}`);
    }
  }
}

async function main() {
  const snapshot = {
    source: "Coval",
    source_name: "Coval — voice AI evaluation platform",
    source_url: "https://benchmarks.coval.ai",
    methodology_url: "https://github.com/coval-ai/benchmarks",
    api_base: API_BASE,
    synced_at: new Date().toISOString(),
    latency_metric: LATENCY_METRIC,
    benchmarks: {},
    providers: null,
    provenance: null,
  };

  const unavailable = [];
  for (const b of BENCHMARKS) {
    snapshot.benchmarks[b] = { windows: {}, windows_available: [] };
    for (const w of WINDOWS) {
      try {
        const agg = await getJSON(
          `/v1/results/aggregates?benchmark=${b}&window=${w}`,
        );
        const models = pivotModels(agg.model_stats || [], b);
        const lat = LATENCY_METRIC[b];
        models.sort(
          (a, z) =>
            (a.metrics[lat]?.p50 ?? Infinity) -
            (z.metrics[lat]?.p50 ?? Infinity),
        );
        snapshot.benchmarks[b].windows[w] = {
          models,
          model_count: models.length,
        };
        snapshot.benchmarks[b].windows_available.push(w);
      } catch (err) {
        // One bad window (e.g. STT 30d currently 500s upstream) must not block
        // the whole mirror. Skip it; the headline 7d window is required below.
        unavailable.push(`${b}/${w}: ${err.message}`);
        console.warn(`[ingest-coval] skipping ${b}/${w}: ${err.message}`);
      }
      await sleep(400); // be polite to their rate limiter
    }
  }
  snapshot.unavailable_windows = unavailable;

  try {
    snapshot.providers = await getJSON(`/v1/providers`);
  } catch (err) {
    console.warn("providers fetch failed (non-fatal):", err.message);
  }
  try {
    const runs = await getJSON(`/v1/runs?limit=1`);
    const list = Array.isArray(runs)
      ? runs
      : runs.runs || runs.entries || runs.items || [];
    snapshot.provenance = list[0] || null;
  } catch (err) {
    console.warn("runs fetch failed (non-fatal):", err.message);
  }

  validate(snapshot);

  await fs.mkdir(path.dirname(OUT_PATH), { recursive: true });
  await fs.writeFile(OUT_PATH, JSON.stringify(snapshot, null, 2) + "\n");

  const summary = BENCHMARKS.map(
    (b) => `${b}=${snapshot.benchmarks[b].windows["7d"].model_count}`,
  ).join(" ");
  console.log(
    `[ingest-coval] wrote ${OUT_PATH} (7d model counts: ${summary}) synced ${snapshot.synced_at}`,
  );
}

main().catch((err) => {
  console.error("[ingest-coval] FAILED — snapshot left untouched:", err.message);
  process.exit(1);
});
