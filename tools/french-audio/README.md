# French audio pipeline

These are build-time helpers. The mini-program ships MP3 files only; Piper and FFmpeg are not bundled with it. The canonical inventory is `cloudfunctions/quickstartFunctions/data/french-audio-manifest.json`: all 572 File IDs are currently populated (90 v1 and 482 v2).

## Generate safely

The generator resolves every manifest item back to its content source before doing anything. It supports words, legacy sentences, expressions, readings, and shadowing. For each selected entry it writes an inspectable plan with `audioKey`, source file/id, expected French text, `localPath`, and verification result. It refuses unresolved keys, duplicate manifest paths/keys, and duplicate selected content-type/text pairs.

Start with a plan-only run; it does not generate, modify content, or upload anything:

```powershell
powershell -ExecutionPolicy Bypass -File tools/french-audio/generate-audio.ps1 -PlanOnly
```

The default selection is v2, so the original v1 audio is not touched. The plan is written to `output/french-audio/audio-generation-plan.json`; inspect the expected text before generating. The script uses the workspace runtime when present (`tmp/french-audio-venv`, `tmp/french-audio-bin/ffmpeg.exe`, and `tmp/french-audio-models`), or accepts explicit `-PythonPath`, `-PiperPath`, `-FfmpegPath`, `-ModelPath`, and `-ConfigPath` paths. When Python can import `piper`, it invokes the bundled `generate-wav-batch.py` helper for the selected plan; otherwise it falls back to the Piper executable.

```powershell
# Generate only v2 paths that are missing locally, then decode every selected MP3
# with FFmpeg and require its reported duration to be greater than zero.
powershell -ExecutionPolicy Bypass -File tools/french-audio/generate-audio.ps1

# Explicitly inspect or regenerate a narrow selection. -Force overwrites only
# the entries selected by -Version or -AudioKey.
powershell -ExecutionPolicy Bypass -File tools/french-audio/generate-audio.ps1 -AudioKey a1-exp-ca-va -Force
powershell -ExecutionPolicy Bypass -File tools/french-audio/generate-audio.ps1 -Version v1 -PlanOnly
```

`-Version all` is explicit and includes v1; do not use it casually. A normal rerun keeps an existing selected MP3, but still FFmpeg-decodes it and confirms a positive duration. A corrected v1 MP3 remains local until a person manually overwrites the matching CloudBase object. Generation produces no CloudBase changes and never deploys.

## Human pronunciation gate

Before upload, listen to every generated file while reading its `expectedText` in `audio-generation-plan.json`. Check French liaison/elision, articles for nouns, names, numbers, sentence pacing, and that the spoken text is exactly the planned text. Mark the reviewed batch and retain the plan with the MP3s. FFmpeg validation proves a decodable non-empty audio stream; it does not approve pronunciation.

## Upload a new batch and fill IDs

The v2 batch has already been uploaded and filled. For a future replacement or new batch, review it first and manually upload the relevant folders to matching CloudBase paths:

```text
output/french-audio/v2/words        -> french-audio/v2/words
output/french-audio/v2/expressions  -> french-audio/v2/expressions
output/french-audio/v2/readings     -> french-audio/v2/readings
output/french-audio/v2/shadowing    -> french-audio/v2/shadowing
```

Save the CloudBase upload result as a UTF-8 text file containing exactly the uploaded v2 `french-audio/...mp3` paths, one per line (full `cloud://` File IDs also work). Do not include v1 paths, folders, or unreviewed files. First inspect the intended set:

```powershell
node tools/french-audio/set-file-prefix.js cloud://YOUR-ENV.YOUR-BUCKET/french-audio/v2/words/a1-daily-maison.mp3 --version v2 --dry-run
```

Then require the evidence list before changing the manifest:

```powershell
node tools/french-audio/set-file-prefix.js cloud://YOUR-ENV.YOUR-BUCKET/french-audio/v2/words/a1-daily-maison.mp3 --version v2 --uploaded-list output/french-audio/v2-uploaded-paths.txt
node tools/french-audio/validate-content.js --strict-audio --strict-cloud
```

The ID script accepts only exact manifest paths, fills only entries whose `fileId` is `null`, preserves all non-null IDs (including the reviewed 90 v1 IDs), and refuses a write unless the supplied upload evidence exactly equals the intended null-ID target set. It never uploads, deploys, or overwrites an existing ID.

After a generation/verification run, `sync-manifest-metadata.js` is called automatically to refresh local byte counts and SHA-256 values without changing any File ID. It can also be audited independently with `node tools/french-audio/sync-manifest-metadata.js --version all --dry-run`. v2 upload, uploaded-path evidence, and File ID filling remain manual; these helpers do not upload or deploy.

## Voice attribution

The build-time voice is Piper `fr_FR-siwis-medium` (SIWIS French, 22.05 kHz). See [ATTRIBUTION.md](ATTRIBUTION.md) for model, dataset, and reuse information. Keep that attribution with redistributed audio and complete the human pronunciation gate before publishing.
