# Implementation backlog and current status

## Completed
- Static native-HTML app shell for GitHub Pages-compatible hosting.
- Background download worker with queue/pause/resume/cancel and progress UI.
- Worker-based synthesis simulation with persistent run history in IndexedDB.
- LCP instrumentation shown in UI.
- Performance test harness with simulated 3G profile and LCP/interaction threshold checks.
- GitHub Actions workflows for Pages deploy and performance testing.
- Synthesis cancel flow now uses real worker-side cancellation.
- Generated audio is persisted to local history and playable after refresh.

## In progress / pending
- **Highest priority (in progress):** Persist generated audio and provide playback controls that survive refresh (#9).
- Replace placeholder model shards with real Qwen3-TTS artifacts and checksums (#3).
- Integrate real WebGPU inference runtime and tokenizer (#4).
- Add true AudioWorklet streaming pipeline from generated PCM frames (#5).
- Add Safari/iOS physical-device benchmark automation capture process (#6).
- Add stronger checksum/hash verification and resumable ranged downloads (#7).

## GitHub project sync
Backlog is synced to:
- Project: `supreme-octo-memory backlog` (GitHub Projects)
- URL: https://github.com/users/mashallahmashallah/projects/1
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
  - #9 P0: Persist generated audio locally and support replay after refresh
