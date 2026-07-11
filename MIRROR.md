# TTS / STT benchmarks — by Coval (mirror)

A daily, git-versioned mirror of [Coval](https://benchmarks.coval.ai)'s public
voice-AI benchmark (Text-to-Speech and Speech-to-Text), published for
[Openbenchmarks](https://openbenchmarks.com).

**This is Coval's benchmark.** Coval is a voice-AI evaluation platform; it runs
the tests, owns the methodology, and publishes the results via its API. This
repo simply mirrors those results with attribution so they're git-versioned,
diffable over time, and citable. Coval does not sell TTS/STT models of its own —
it measures the providers as a neutral third party.

- **Live pages:** <https://openbenchmarks.com/text-to-speech-benchmark-by-coval>
  · <https://openbenchmarks.com/speech-to-text-benchmark-by-coval>
- **Coval methodology + runner (source of truth):**
  <https://github.com/coval-ai/benchmarks>
- **Coval's site:** <https://benchmarks.coval.ai>

## What's here

- [`coval-benchmarks.json`](./coval-benchmarks.json) — the current snapshot.
  Per benchmark (`TTS`, `STT`) × window (`24h`, `7d`, `30d`), each model's
  latency (`TTFA` for TTS, `TTFS` for STT — normalized to **ms**) and Word Error
  Rate (`WER`, %), with avg / p50 / p90 / p95 / p99 / min / max / sample count.
  The heavy raw per-run `series` is intentionally dropped — only aggregates are
  mirrored.
- [`ingest-coval.mjs`](./ingest-coval.mjs) — the sync script (pulls Coval's API,
  normalizes units, validates, writes the snapshot).
- [`.github/workflows/coval-sync.yml`](./.github/workflows/coval-sync.yml) — the
  daily GitHub Action that runs the sync and commits any change.

## How it updates

The Action runs daily (06:00 UTC), calls Coval's public API, and commits the
snapshot if it changed. Each commit is a point-in-time record of Coval's
numbers. Coval re-runs roughly every 30 minutes; this mirror refreshes daily.

## Provenance & caveats

- Every snapshot carries `synced_at` and the upstream `provenance` (Coval run id
  + dataset hash) so you can trace it back to a specific Coval run.
- Numbers are point-in-time against Coval's pinned dataset and don't generalize
  indefinitely.
- Coval's `STT & window=30d` endpoint currently returns HTTP 500 upstream; the
  sync skips that one window and records it under `unavailable_windows`.

## License / attribution

Benchmark data © Coval, mirrored with attribution. Methodology and runner are
open-source (Apache-2.0) at <https://github.com/coval-ai/benchmarks>. When
redistributing, credit **Coval** and link back to their benchmark.
