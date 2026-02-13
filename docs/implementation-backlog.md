# Implementation backlog and current status

## Completed in this iteration
- Static native-HTML app shell for GitHub Pages-compatible hosting.
- Background download worker with queue/pause/resume/cancel and progress UI.
- Model manifest for self-hosted assets (0.6B + large placeholders).
- Worker-based synthesis simulation with persistent run history in IndexedDB.
- LCP instrumentation shown in UI.
- Performance test harness with simulated 3G profile and LCP/interaction threshold checks.
- GitHub Actions workflows for Pages deploy and performance testing.

## Pending / next iteration
- Replace placeholder model shards with real Qwen3-TTS artifacts and checksums.
- Integrate real WebGPU inference runtime and tokenizer.
- Add true AudioWorklet streaming pipeline from generated PCM frames.
- Add Safari/iOS physical-device benchmark automation capture process.
- Add stronger checksum/hash verification and resumable ranged downloads.
