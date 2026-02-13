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
- Manifest now includes an ONNX-converted artifact from Qwen3-TTS-12Hz-0.6B-Base (speaker encoder first Conv1D block).

## Backlog tracking
- GitHub Project: https://github.com/users/mashallahmashallah/projects/1
- Milestone-driven issues track remaining work (WebGPU runtime, AudioWorklet streaming, Safari device runs, and real model artifacts).


## ASR harness
- Added an in-browser Qwen3-ASR compatibility harness in the UI for VoiceDesign samples.
- Current implementation prioritizes offline reproducibility and benchmark loops while full model-weight runtime integration remains tracked in backlog.


## ONNX conversion
- Added `scripts/convert_qwen3_tts_to_onnx.py` to convert Qwen3-TTS safetensors weights into a compatible ONNX graph for the speaker encoder's first Conv1D stage.
- Generated ONNX artifact: `public/models/qwen3-tts-12hz-0.6b-base-onnx/speaker_encoder_conv.onnx`.
- Verified with `onnx.checker` and `onnxruntime` inference on random input.
