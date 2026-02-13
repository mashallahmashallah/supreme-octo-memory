# Mobile In-Browser TTS Lab

Performance-first static web app for evaluating in-browser TTS architecture on mobile Chrome/Safari with background downloads, worker execution, and persisted benchmark history.

## Run locally

```bash
npm ci
npm test
npm run start
```

Open http://127.0.0.1:4173/index.html.

## Current status
- Download worker supports pause/resume/cancel, shard-level resumable progress, and checksum verification.
- Synthesis worker supports cancellation and error-safe UI state transitions.
- CI enforces simulated 3G performance checks and JS-error-free flows.
- Model artifacts are still placeholders under `public/models` in this iteration.

## Backlog tracking
- GitHub Project: https://github.com/users/mashallahmashallah/projects/1
- Milestone-driven issues track remaining work (WebGPU runtime, AudioWorklet streaming, Safari device runs, real model artifacts).
