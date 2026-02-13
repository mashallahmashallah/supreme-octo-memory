# Mobile In-Browser TTS Lab

Performance-first static web app for evaluating in-browser TTS architecture on mobile Chrome/Safari with background downloads, worker execution, and persisted benchmark history.

## Run locally

```bash
npm ci
npm test
npm run start
```

Open http://127.0.0.1:4173/index.html.

## WebGPU ONNX runtime

The branch now integrates `onnxruntime-web` following the ONNX Runtime WebGPU flow:

- `qwen3-tts-12hz-0.6b-base` is represented by an ONNX graph at `public/models/qwen3-tts-0.6b-onnx/model.onnx`.
- Runtime session creation uses `executionProviders: ['webgpu', 'wasm']`.
- The app warms up the graph during model load and runs an ONNX inference pass during synthesis.

### Model conversion

Use the conversion utility:

```bash
python3 tools/convert_qwen3_tts_to_onnx.py --mode demo
```

For a full checkpoint export path (when model/deps are available locally):

```bash
python3 tools/convert_qwen3_tts_to_onnx.py --mode real --model-id Qwen/Qwen3-TTS-12Hz-0.6B-Base
```

## Current status
- Download worker supports pause/resume/cancel and progress UI.
- Synthesis worker supports cancellation and error-safe UI state transitions.
- Generated audio is persisted locally and can be replayed after refresh.
- CI enforces simulated 3G performance checks and JS-error-free flows.
- Qwen3 0.6B Base ONNX/WebGPU runtime plumbing is integrated for browser execution.

## Backlog tracking
- GitHub Project: https://github.com/users/mashallahmashallah/projects/1
- Milestone-driven issues track remaining work (full checkpoint export, AudioWorklet streaming, Safari device runs, and production model artifacts).

## ASR harness
- Added an in-browser Qwen3-ASR compatibility harness in the UI for VoiceDesign samples.
- Current implementation prioritizes offline reproducibility and benchmark loops while full model-weight runtime integration remains tracked in backlog.
