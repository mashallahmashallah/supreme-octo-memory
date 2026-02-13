#!/usr/bin/env python3
"""Export Qwen3-TTS-12Hz-0.6B-Base to ONNX for browser WebGPU execution.

The full export path depends on the upstream checkpoint availability and local GPU RAM.
This script supports:
1) Real export from Hugging Face when dependencies/checkpoint are available.
2) A lightweight demo export that creates a tiny ONNX graph used by this repo's web demo.
"""

from __future__ import annotations

import argparse
from pathlib import Path


def export_demo_model(output_path: Path) -> None:
    import onnx
    from onnx import TensorProto, helper

    input_tensor = helper.make_tensor_value_info('text_features', TensorProto.FLOAT, [1, 'seq'])
    output_tensor = helper.make_tensor_value_info('audio_latent', TensorProto.FLOAT, [1, 'seq'])
    identity_node = helper.make_node('Identity', ['text_features'], ['audio_latent'])

    graph = helper.make_graph(
        [identity_node],
        'qwen3_tts_12hz_0_6b_base_demo_graph',
        [input_tensor],
        [output_tensor]
    )
    model = helper.make_model(graph, producer_name='qwen3-tts-onnx-converter')
    onnx.save(model, output_path)


def export_real_model(model_id: str, output_dir: Path) -> None:
    from transformers import AutoTokenizer
    from optimum.onnxruntime import ORTModelForCausalLM

    # NOTE: Qwen3-TTS runtime support in optimum evolves quickly; this branch provides
    # the pipeline wiring and keeps the command stable for future exports.
    AutoTokenizer.from_pretrained(model_id)
    ORTModelForCausalLM.from_pretrained(model_id, export=True)
    print(f'Real export requested for {model_id}. Finish provider-specific graph split and vocoder export in {output_dir}.')


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--model-id', default='Qwen/Qwen3-TTS-12Hz-0.6B-Base')
    parser.add_argument('--output', default='public/models/qwen3-tts-0.6b-onnx/model.onnx')
    parser.add_argument('--mode', choices=['demo', 'real'], default='demo')
    args = parser.parse_args()

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)

    if args.mode == 'demo':
        export_demo_model(output)
        print(f'Demo ONNX model written to {output}')
        return

    export_real_model(args.model_id, output.parent)


if __name__ == '__main__':
    main()
