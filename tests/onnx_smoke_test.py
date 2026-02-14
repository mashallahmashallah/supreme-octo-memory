import numpy as np
import onnx
import onnxruntime as ort

MODEL_PATH = 'public/models/qwen3-tts-12hz-0.6b-base-onnx/speaker_encoder_conv.onnx'


def main() -> None:
    onnx.checker.check_model(MODEL_PATH)
    session = ort.InferenceSession(MODEL_PATH, providers=['CPUExecutionProvider'])
    x = np.random.randn(1, 128, 64).astype(np.float32)
    y = session.run(None, {session.get_inputs()[0].name: x})[0]
    assert y.shape == (1, 512, 60), y.shape
    print('ok', y.shape)


if __name__ == '__main__':
    main()
