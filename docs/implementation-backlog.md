# Implementation backlog and current status

## Completed
- Static native-HTML app shell for GitHub Pages-compatible hosting.
- Background download worker with queue/pause/resume/cancel and progress UI.
- Model manifest for self-hosted assets (0.6B + large placeholders).
- Worker-based synthesis simulation with persistent run history in IndexedDB.
- LCP instrumentation shown in UI.
- Performance test harness with simulated 3G profile and LCP/interaction threshold checks.
- GitHub Actions workflows for Pages deploy and performance testing.
- Synthesis cancel flow now uses real worker-side cancellation.
- Download worker now supports checksum verification and resumable progress at shard boundaries.

## In progress / pending
- Replace placeholder model shards with real Qwen3-TTS artifacts and checksums.
- Integrate real WebGPU inference runtime and tokenizer.
- Add true AudioWorklet streaming pipeline from generated PCM frames.
- Add Safari/iOS physical-device benchmark automation capture process.

## GitHub project sync
Backlog is synced to:
- Project: `supreme-octo-memory backlog` (GitHub Projects)
- Milestones:
  - P1 Core Runtime
  - P2 Persistence & Regression
  - P3 PWA & Demo
  - Hardening & Devices
- Open issues tracking remaining items:
  - #3 Replace placeholder model shards with real Qwen3-TTS artifacts + checksums
  - #4 Integrate real WebGPU inference runtime and tokenizer
  - #5 Add true AudioWorklet streaming pipeline from generated PCM
  - #6 Add Safari/iOS physical-device benchmark capture process
  - #7 Implement stronger checksum verification + resumable ranged downloads
