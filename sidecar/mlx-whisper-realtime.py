#!/usr/bin/env python3
"""
MLX Whisper Real-Time Transcription Server for nChar Minutes
============================================================

WebSocket server that wraps mlx-whisper for real-time transcription.
Speaks Deepgram-compatible JSON protocol so it works with nChar's
existing transcription pipeline without Rust adapter changes.

Usage:
    python3 sidecar/mlx-whisper-realtime.py [--port 8888] [--model mlx-community/whisper-large-v3-turbo]

Protocol:
    - Accepts binary WebSocket frames (16-bit PCM, 16kHz mono)
    - Returns Deepgram-format JSON with type "Results"
    - Supports KeepAlive and Finalize control messages

Requires: pip install mlx-whisper websockets numpy
"""

import argparse
import asyncio
import io
import json
import struct
import sys
import time
import uuid
from pathlib import Path

import numpy as np

try:
    import mlx_whisper
except ImportError:
    print(
        "Error: mlx-whisper not installed. Run: pip install mlx-whisper",
        file=sys.stderr,
    )
    sys.exit(1)

try:
    import websockets
except ImportError:
    print(
        "Error: websockets not installed. Run: pip install websockets", file=sys.stderr
    )
    sys.exit(1)


SAMPLE_RATE = 16000
CHUNK_DURATION_SECS = 3.0
MIN_AUDIO_SECS = 0.5


def pcm16_to_float32(pcm_bytes: bytes) -> np.ndarray:
    samples = np.frombuffer(pcm_bytes, dtype=np.int16)
    return samples.astype(np.float32) / 32768.0


def make_deepgram_response(
    text: str,
    words: list,
    start: float,
    duration: float,
    is_final: bool = True,
    speech_final: bool = False,
    from_finalize: bool = False,
) -> dict:
    return {
        "type": "Results",
        "start": start,
        "duration": duration,
        "is_final": is_final,
        "speech_final": speech_final,
        "from_finalize": from_finalize,
        "channel": {
            "alternatives": [
                {
                    "transcript": text,
                    "words": words,
                    "confidence": 0.95,
                    "languages": ["en"],
                }
            ]
        },
        "metadata": {
            "request_id": str(uuid.uuid4()),
            "model_uuid": str(uuid.uuid4()),
            "model_info": {
                "name": "mlx-whisper",
                "version": "1.0",
                "arch": "whisper",
            },
            "extra": {
                "started_unix_millis": int(time.time() * 1000),
            },
        },
        "channel_index": [0, 1],
    }


def transcribe_audio(audio: np.ndarray, model: str) -> dict:
    if len(audio) < int(SAMPLE_RATE * MIN_AUDIO_SECS):
        return {"text": "", "segments": []}

    result = mlx_whisper.transcribe(
        audio,
        path_or_hf_repo=model,
        word_timestamps=True,
        fp16=False,
    )
    return result


def extract_words(result: dict) -> list:
    words = []
    for segment in result.get("segments", []):
        for w in segment.get("words", []):
            words.append(
                {
                    "word": w.get("word", "").strip(),
                    "start": w.get("start", 0.0),
                    "end": w.get("end", 0.0),
                    "confidence": w.get("probability", 0.95),
                    "speaker": 0,
                    "punctuated_word": w.get("word", "").strip(),
                }
            )
    return words


async def handle_connection(websocket, model: str):
    audio_buffer = bytearray()
    total_audio_secs = 0.0
    request_id = str(uuid.uuid4())

    print(f"[{request_id[:8]}] Client connected", file=sys.stderr)

    # Send initial metadata
    metadata = {
        "type": "Metadata",
        "request_id": request_id,
        "created": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "duration": 0.0,
        "channels": 1,
    }

    try:
        async for message in websocket:
            if isinstance(message, str):
                # Control message
                try:
                    ctrl = json.loads(message)
                except json.JSONDecodeError:
                    continue

                msg_type = ctrl.get("type", "")

                if msg_type == "KeepAlive":
                    continue

                if msg_type in ("Finalize", "CloseStream"):
                    # Transcribe remaining audio
                    if len(audio_buffer) > 0:
                        audio = pcm16_to_float32(bytes(audio_buffer))
                        result = transcribe_audio(audio, model)
                        text = result.get("text", "").strip()
                        if text:
                            words = extract_words(result)
                            duration = len(audio) / SAMPLE_RATE
                            response = make_deepgram_response(
                                text=text,
                                words=words,
                                start=total_audio_secs,
                                duration=duration,
                                is_final=True,
                                speech_final=True,
                                from_finalize=True,
                            )
                            await websocket.send(json.dumps(response))
                        audio_buffer.clear()
                    continue

            elif isinstance(message, bytes):
                audio_buffer.extend(message)

                chunk_bytes = int(
                    SAMPLE_RATE * CHUNK_DURATION_SECS * 2
                )  # 16-bit = 2 bytes/sample
                if len(audio_buffer) >= chunk_bytes:
                    chunk = bytes(audio_buffer[:chunk_bytes])
                    audio_buffer = bytearray(audio_buffer[chunk_bytes:])

                    audio = pcm16_to_float32(chunk)
                    result = transcribe_audio(audio, model)
                    text = result.get("text", "").strip()

                    if text:
                        words = extract_words(result)
                        duration = len(audio) / SAMPLE_RATE
                        response = make_deepgram_response(
                            text=text,
                            words=words,
                            start=total_audio_secs,
                            duration=duration,
                            is_final=True,
                            speech_final=False,
                        )
                        await websocket.send(json.dumps(response))

                    total_audio_secs += CHUNK_DURATION_SECS

    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        print(
            f"[{request_id[:8]}] Client disconnected ({total_audio_secs:.1f}s audio)",
            file=sys.stderr,
        )


async def main(port: int, model: str):
    print(f"MLX Whisper Realtime Server", file=sys.stderr)
    print(f"  Port:  {port}", file=sys.stderr)
    print(f"  Model: {model}", file=sys.stderr)
    print(f"  WebSocket: ws://127.0.0.1:{port}/v1/listen", file=sys.stderr)
    print(f"  Protocol: Deepgram-compatible", file=sys.stderr)
    print(f"  Chunk size: {CHUNK_DURATION_SECS}s", file=sys.stderr)
    print(file=sys.stderr)

    # Pre-load model on first trivial transcription
    print("Loading model...", file=sys.stderr)
    dummy = np.zeros(int(SAMPLE_RATE * 0.5), dtype=np.float32)
    mlx_whisper.transcribe(dummy, path_or_hf_repo=model, fp16=False)
    print("Model loaded.", file=sys.stderr)

    async def handler(websocket):
        # Accept connections on any path (the adapter appends /v1/listen)
        await handle_connection(websocket, model)

    async with websockets.serve(handler, "127.0.0.1", port):
        await asyncio.Future()  # run forever


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="MLX Whisper Realtime Server")
    parser.add_argument(
        "--port", type=int, default=8888, help="WebSocket port (default: 8888)"
    )
    parser.add_argument(
        "--model",
        type=str,
        default="mlx-community/whisper-large-v3-turbo",
        help="MLX Whisper model (default: mlx-community/whisper-large-v3-turbo)",
    )
    args = parser.parse_args()

    try:
        asyncio.run(main(args.port, args.model))
    except KeyboardInterrupt:
        print("\nShutting down.", file=sys.stderr)
