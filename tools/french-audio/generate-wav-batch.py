"""Generate WAV files from an inspected French audio plan with one Piper model load."""

import argparse
import json
import wave
from pathlib import Path

from piper.voice import PiperVoice


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--plan", required=True)
    parser.add_argument("--root", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--config", required=True)
    args = parser.parse_args()

    plan = json.loads(Path(args.plan).read_text(encoding="utf-8"))
    entries = [entry for entry in plan.get("entries", []) if entry.get("action") == "generate"]
    voice = PiperVoice.load(args.model, config_path=args.config)
    root = Path(args.root)
    for index, entry in enumerate(entries, start=1):
        expected_text = str(entry.get("expectedText", "")).strip()
        if not expected_text:
            raise ValueError(f"Empty expectedText for {entry.get('audioKey')}")
        wav_path = (root / entry["localPath"]).with_suffix(".wav")
        wav_path.parent.mkdir(parents=True, exist_ok=True)
        with wave.open(str(wav_path), "wb") as wav_file:
            voice.synthesize_wav(expected_text, wav_file)
        if index % 25 == 0 or index == len(entries):
            print(f"Piper WAV batch: {index}/{len(entries)}")


if __name__ == "__main__":
    main()
