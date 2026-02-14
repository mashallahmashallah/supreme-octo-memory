#!/usr/bin/env python3
"""Convert a supported Qwen3-TTS safetensors subset into ONNX.

This currently exports the first speaker-encoder Conv1D stage as a verified ONNX graph.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import torch
import onnx
from onnx import TensorProto, helper, numpy_helper
from safetensors import safe_open


def build_speaker_encoder_conv_onnx(safetensors_path: Path, output_path: Path) -> None:
    weight_key = "speaker_encoder.blocks.0.conv.weight"
    bias_key = "speaker_encoder.blocks.0.conv.bias"

    with safe_open(str(safetensors_path), framework="pt") as handle:
        weight = handle.get_tensor(weight_key).to(torch_dtype_to_float32_numpy()).cpu().numpy()
        bias = handle.get_tensor(bias_key).to(torch_dtype_to_float32_numpy()).cpu().numpy()

    out_channels, in_channels, kernel_size = weight.shape

    input_info = helper.make_tensor_value_info("audio_features", TensorProto.FLOAT, ["batch", in_channels, "frames"])
    output_info = helper.make_tensor_value_info("conv_out", TensorProto.FLOAT, ["batch", out_channels, "out_frames"])

    weight_init = numpy_helper.from_array(weight, name="conv_weight")
    bias_init = numpy_helper.from_array(bias, name="conv_bias")

    conv_node = helper.make_node(
        "Conv",
        inputs=["audio_features", "conv_weight", "conv_bias"],
        outputs=["conv_out"],
        kernel_shape=[int(kernel_size)],
        strides=[1],
        pads=[0, 0],
        dilations=[1],
        group=1,
    )

    graph = helper.make_graph(
        [conv_node],
        "qwen3_tts_12hz_0_6b_base_speaker_encoder_conv",
        [input_info],
        [output_info],
        initializer=[weight_init, bias_init],
    )

    model = helper.make_model(
        graph,
        producer_name="supreme-octo-memory",
        opset_imports=[helper.make_operatorsetid("", 17)],
    )
    model.ir_version = 10
    model.doc_string = (
        "Derived from Qwen3-TTS-12Hz-0.6B-Base safetensors. "
        "Exports speaker_encoder.blocks.0.conv as ONNX Conv1D."
    )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    onnx.save(model, str(output_path))


def torch_dtype_to_float32_numpy():
    return torch.float32


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--safetensors", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    build_speaker_encoder_conv_onnx(args.safetensors, args.out)
    print(f"Wrote ONNX model to {args.out}")
