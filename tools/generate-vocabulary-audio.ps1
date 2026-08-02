param(
  [string]$ManifestPath = "",
  [string]$OutputDirectory = ""
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot

if (-not $ManifestPath) {
  $ManifestPath = Join-Path $projectRoot "cloudfunctions\quickstartFunctions\data\vocabulary-audio-manifest.json"
}
if (-not $OutputDirectory) {
  $OutputDirectory = Join-Path $projectRoot "output\vocabulary-audio\v1"
}

$resolvedManifest = (Resolve-Path -LiteralPath $ManifestPath).Path
$resolvedOutput = [System.IO.Path]::GetFullPath($OutputDirectory)
if (-not $resolvedOutput.StartsWith([System.IO.Path]::GetFullPath($projectRoot), [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Audio output must stay inside the project workspace."
}

New-Item -ItemType Directory -Path $resolvedOutput -Force | Out-Null
$manifest = Get-Content -LiteralPath $resolvedManifest -Raw -Encoding UTF8 | ConvertFrom-Json

$voice = New-Object -ComObject SAPI.SpVoice
$selectedVoice = $voice.GetVoices() |
  Where-Object { $_.GetDescription() -like "Microsoft Zira*" } |
  Select-Object -First 1
if (-not $selectedVoice) {
  throw "Microsoft Zira English voice is not installed."
}
$voice.Voice = $selectedVoice
$voice.Rate = -1

$format = New-Object -ComObject SAPI.SpAudioFormat
$format.Type = 18

$generated = 0
$skipped = 0
$failed = New-Object System.Collections.Generic.List[object]
$startedAt = Get-Date

for ($index = 0; $index -lt $manifest.items.Count; $index += 1) {
  $item = $manifest.items[$index]
  $targetPath = Join-Path $resolvedOutput $item.fileName
  $existing = Get-Item -LiteralPath $targetPath -ErrorAction SilentlyContinue
  if ($existing -and $existing.Length -gt 44) {
    $skipped += 1
    continue
  }

  $stream = $null
  try {
    $stream = New-Object -ComObject SAPI.SpFileStream
    $stream.Format = $format
    $stream.Open($targetPath, 3, $false)
    $voice.AudioOutputStream = $stream
    [void]$voice.Speak([string]$item.word)
    $stream.Close()
    $stream = $null

    $created = Get-Item -LiteralPath $targetPath
    if ($created.Length -le 44) {
      throw "Generated WAV is empty."
    }
    $generated += 1
  } catch {
    if ($stream) {
      try { $stream.Close() } catch {}
    }
    $failed.Add([PSCustomObject]@{
      key = [string]$item.key
      word = [string]$item.word
      error = $_.Exception.Message
    })
  }

  if ((($index + 1) % 50) -eq 0 -or ($index + 1) -eq $manifest.items.Count) {
    $elapsed = (Get-Date) - $startedAt
    Write-Output ("Audio {0}/{1} generated={2} skipped={3} failed={4} elapsed={5:mm\:ss}" -f (
      $index + 1
    ), $manifest.items.Count, $generated, $skipped, $failed.Count, $elapsed)
  }
}

if ($failed.Count) {
  $failurePath = Join-Path (Split-Path -Parent $resolvedOutput) "generation-failures.json"
  $failed | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $failurePath -Encoding UTF8
  throw "Audio generation failed for $($failed.Count) entries. See $failurePath"
}

$files = Get-ChildItem -LiteralPath $resolvedOutput -File -Filter *.wav
$totalBytes = ($files | Measure-Object -Property Length -Sum).Sum
Write-Output ("Audio generation complete: files={0} bytes={1}" -f $files.Count, $totalBytes)
