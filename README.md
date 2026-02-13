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
- Download worker supports pause/resume/cancel and progress UI.
- Synthesis worker supports cancellation and error-safe UI state transitions.
- Generated audio is persisted locally and can be replayed after refresh.
- CI enforces simulated 3G performance checks and JS-error-free flows.
- Model artifacts are still placeholders under `public/models` in this iteration.

## Backlog tracking
- GitHub Project: https://github.com/users/mashallahmashallah/projects/1
- Milestone-driven issues track remaining work (WebGPU runtime, AudioWorklet streaming, Safari device runs, and real model artifacts).


## ASR harness
- Added an in-browser Qwen3-ASR compatibility harness in the UI for VoiceDesign samples.
- Current implementation prioritizes offline reproducibility and benchmark loops while full model-weight runtime integration remains tracked in backlog.
