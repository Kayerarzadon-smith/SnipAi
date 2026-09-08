#!/usr/bin/env python3
"""Transcribe one short spoken note and print it.

    python3 tools/transcribe_note.py <audio-file>

Used by the voice box in the app: you describe an edit out loud instead of
typing it. Deliberately small and quiet -- prints the text and nothing else,
so the caller can use stdout directly.

Runs on the same local faster-whisper as the rest of the pipeline. The audio
never leaves this machine.
"""
import os, subprocess, sys, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def ffmpeg_bin():
    venv = os.path.join(ROOT, ".venv", "bin", "ffmpeg")
    return venv if os.path.exists(venv) else "ffmpeg"


def main():
    if len(sys.argv) < 2:
        print("usage: transcribe_note.py <audio>", file=sys.stderr)
        return 2
    src = sys.argv[1]
    if not os.path.exists(src):
        print(f"no such file: {src}", file=sys.stderr)
        return 1

    wav = tempfile.mktemp(suffix=".wav")
    r = subprocess.run(
        [ffmpeg_bin(), "-y", "-i", src, "-vn", "-ac", "1", "-ar", "16000", wav],
        capture_output=True, stdin=subprocess.DEVNULL,
    )
    if r.returncode != 0 or not os.path.exists(wav):
        print("could not decode the recording", file=sys.stderr)
        return 1

    try:
        from faster_whisper import WhisperModel
        threads = max(1, (os.cpu_count() or 4) - 2)
        # base.en is plenty for a one-sentence instruction and starts fast
        model = WhisperModel("base.en", device="cpu", compute_type="int8",
                             cpu_threads=int(os.environ.get("SNIPAI_THREADS", threads)))
        segments, _ = model.transcribe(wav, vad_filter=True,
                                       condition_on_previous_text=False)
        print(" ".join(s.text.strip() for s in segments).strip())
    finally:
        if os.path.exists(wav):
            os.remove(wav)
    return 0


if __name__ == "__main__":
    sys.exit(main())
