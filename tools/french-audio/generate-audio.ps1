<#
Generate French MP3s from the canonical audio manifest.

By default this plans and generates only missing v2 files. v1 is deliberately
left alone unless it is selected with -Version v1/-Version all or -AudioKey.
Use -PlanOnly before a batch to inspect the exact source-text-to-file mapping.
#>
param(
  [string]$ModelPath,
  [string]$ConfigPath,
  [string]$PiperPath,
  [string]$PythonPath,
  [string]$FfmpegPath,
  [ValidateSet('v1', 'v2', 'all')]
  [string]$Version = 'v2',
  [string[]]$AudioKey,
  [string]$PlanPath,
  [switch]$PlanOnly,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = $utf8NoBom
[Console]::OutputEncoding = $utf8NoBom
$OutputEncoding = $utf8NoBom

$repoRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$dataRoot = Join-Path $repoRoot 'cloudfunctions\quickstartFunctions\data'
$manifestPath = Join-Path $dataRoot 'french-audio-manifest.json'
if (-not $PlanPath) { $PlanPath = Join-Path $repoRoot 'output\french-audio\audio-generation-plan.json' }
if (-not $ModelPath) { $ModelPath = Join-Path $repoRoot 'tmp\french-audio-models\fr_FR-siwis-medium.onnx' }
if (-not $ConfigPath) { $ConfigPath = Join-Path $repoRoot 'tmp\french-audio-models\fr_FR-siwis-medium.onnx.json' }

function Read-Json([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { throw "Required data file was not found: $Path" }
  return Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
}

function Get-TextSha256([string]$Text) {
  $normalized = $Text.Normalize([Text.NormalizationForm]::FormC).Trim()
  $algorithm = [Security.Cryptography.SHA256]::Create()
  try {
    $hash = $algorithm.ComputeHash($utf8NoBom.GetBytes($normalized))
    return ([BitConverter]::ToString($hash)).Replace('-', '').ToLowerInvariant()
  } finally {
    $algorithm.Dispose()
  }
}

function Add-Source([hashtable]$Index, [object]$Item, [string]$Type, [string]$SourceFile, [string]$Text) {
  $key = [string]$Item.audioKey
  if ([string]::IsNullOrWhiteSpace($key)) { $key = [string]$Item.id }
  if ([string]::IsNullOrWhiteSpace($key) -or [string]::IsNullOrWhiteSpace($Text)) {
    throw "Unresolved $Type source in $SourceFile. Each item needs audioKey/id and non-empty text."
  }
  if ($Index.ContainsKey($key)) { throw "Duplicate audio source key '$key' in $SourceFile and $($Index[$key].sourceFile)." }
  $expectedText = $Text.Normalize([Text.NormalizationForm]::FormC).Trim()
  $Index[$key] = [pscustomobject]@{
    contentType = $Type
    sourceFile = $SourceFile
    sourceId = [string]$Item.id
    expectedText = $expectedText
    sourceTextSha256 = Get-TextSha256 $expectedText
    audioRef = if ($null -ne $Item.audioRef) { [string]$Item.audioRef } else { $null }
  }
}

function Resolve-Program([string]$Requested, [string]$FallbackPath, [string]$CommandName, [string]$Label) {
  if ($Requested) {
    if (-not (Test-Path -LiteralPath $Requested)) { throw "$Label was not found: $Requested" }
    return (Resolve-Path -LiteralPath $Requested).Path
  }
  if (Test-Path -LiteralPath $FallbackPath) { return (Resolve-Path -LiteralPath $FallbackPath).Path }
  $command = Get-Command $CommandName -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  throw "$Label was not found. Provide an explicit path or install it on PATH."
}

function Write-Plan([object[]]$Entries, [string]$State) {
  $directory = Split-Path -Parent $PlanPath
  if ($directory) { New-Item -ItemType Directory -Force $directory | Out-Null }
  $document = [ordered]@{
    schemaVersion = 1
    createdAtUtc = [DateTime]::UtcNow.ToString('o')
    state = $State
    manifestPath = $manifestPath
    selection = [ordered]@{
      version = $Version
      audioKeys = if ($AudioKey) { @($AudioKey) } else { @() }
      force = [bool]$Force
    }
    entries = $Entries
  }
  [System.IO.File]::WriteAllText($PlanPath, (($document | ConvertTo-Json -Depth 8) + [Environment]::NewLine), $utf8NoBom)
}

function Convert-ToMp3([string]$WavPath, [string]$Mp3Path, [string]$Ffmpeg) {
  & $Ffmpeg -hide_banner -loglevel error -y -i $WavPath -codec:a libmp3lame -b:a 64k $Mp3Path
  if ($LASTEXITCODE -ne 0) { throw "ffmpeg MP3 conversion failed: $Mp3Path" }
  Remove-Item -LiteralPath $WavPath -Force
}

function Test-Mp3([string]$Mp3Path, [string]$Ffmpeg) {
  if (-not (Test-Path -LiteralPath $Mp3Path)) { throw "Expected MP3 was not written: $Mp3Path" }
  # ffmpeg decodes the whole stream; its input banner is also the portable
  # duration source, so this does not depend on ffprobe being installed.
  $decodeOutput = (& $Ffmpeg -hide_banner -i $Mp3Path -f null - 2>&1 | Out-String)
  if ($LASTEXITCODE -ne 0) { throw "ffmpeg decode failed: $Mp3Path`n$decodeOutput" }
  $match = [regex]::Match($decodeOutput, 'Duration:\s*(?<duration>\d{2}:\d{2}:\d{2}(?:\.\d+)?)')
  if (-not $match.Success) { throw "ffmpeg did not report a duration for: $Mp3Path" }
  $duration = [TimeSpan]::Parse($match.Groups['duration'].Value, [Globalization.CultureInfo]::InvariantCulture)
  if ($duration.TotalSeconds -le 0) { throw "MP3 duration must be greater than zero: $Mp3Path" }
  return [pscustomobject]@{ decoded = $true; durationSeconds = [Math]::Round($duration.TotalSeconds, 3) }
}

$manifest = Read-Json $manifestPath
if ($null -eq $manifest.items -or $manifest.items.Count -eq 0) { throw 'Manifest has no audio items.' }

$sources = @{}
foreach ($file in @('french-a1-words.json', 'french-a2-words.json')) {
  foreach ($item in (Read-Json (Join-Path $dataRoot $file)).items) {
    $spoken = if ($item.partOfSpeech -eq 'noun') {
      if ($item.displayForm) { [string]$item.displayForm } else { [string]$item.display }
    } else { [string]$item.text }
    Add-Source $sources $item 'word' $file $spoken
  }
}
foreach ($spec in @(
  @{ file = 'french-a1-sentences.json'; type = 'sentence' },
  @{ file = 'french-a1-a2-expressions.json'; type = 'expression' },
  @{ file = 'french-a1-a2-readings.json'; type = 'reading' },
  @{ file = 'french-a1-a2-shadowing.json'; type = 'shadowing' }
)) {
  foreach ($item in (Read-Json (Join-Path $dataRoot $spec.file)).items) {
    Add-Source $sources $item $spec.type $spec.file ([string]$item.text)
  }
}

$allPaths = @{}
$allKeys = @{}
$entries = @()
foreach ($item in $manifest.items) {
  $key = [string]$item.audioKey
  $localPath = [string]$item.localPath
  if ([string]::IsNullOrWhiteSpace($key) -or [string]::IsNullOrWhiteSpace($localPath)) { throw 'Manifest item is missing audioKey or localPath.' }
  if ($allKeys.ContainsKey($key)) { throw "Duplicate manifest audioKey '$key'." }
  if ($allPaths.ContainsKey($localPath)) { throw "Duplicate manifest localPath '$localPath' for '$key' and '$($allPaths[$localPath])'." }
  $allKeys[$key] = $true; $allPaths[$localPath] = $key
  if (-not $sources.ContainsKey($key)) { throw "Unresolved manifest audioKey '$key'." }
  $source = $sources[$key]
  if ($source.contentType -ne [string]$item.contentType) { throw "Content type mismatch for '$key': manifest=$($item.contentType), source=$($source.contentType)." }
  if ($source.audioRef -and $source.audioRef -ne [string]$item.cloudPath) { throw "Cloud path mismatch for '$key': manifest=$($item.cloudPath), source=$($source.audioRef)." }
  if ($source.sourceTextSha256 -ne [string]$item.sourceTextSha256) { throw "Spoken-text hash mismatch for '$key'; rebuild the manifest before generating audio." }
  $versionMatch = [regex]::Match([string]$item.cloudPath, '^french-audio/(?<version>v[12])/')
  if (-not $versionMatch.Success) { throw "Manifest cloudPath is not a v1/v2 French audio path: $($item.cloudPath)" }
  $itemVersion = $versionMatch.Groups['version'].Value
  $isSelected = if ($AudioKey) { $AudioKey -contains $key } else { $Version -eq 'all' -or $itemVersion -eq $Version }
  if ($isSelected) {
    $absoluteLocalPath = Join-Path $repoRoot $localPath
    $exists = Test-Path -LiteralPath $absoluteLocalPath
    $entries += [pscustomobject]@{
      audioKey = $key; contentType = [string]$item.contentType; version = $itemVersion
      cloudPath = [string]$item.cloudPath; localPath = $localPath
      sourceFile = $source.sourceFile; sourceId = $source.sourceId; expectedText = $source.expectedText
      sourceTextSha256 = $source.sourceTextSha256
      existsBefore = [bool]$exists; action = if ($Force -or -not $exists) { 'generate' } else { 'verify-existing' }
      verification = $null
    }
  }
}
if ($AudioKey) {
  $missingKeys = @($AudioKey | Where-Object { -not $allKeys.ContainsKey($_) })
  if ($missingKeys.Count) { throw "Unknown -AudioKey value(s): $($missingKeys -join ', ')" }
}
if ($entries.Count -eq 0) { throw 'No manifest entries matched the selection.' }
$duplicateTexts = @($entries | Group-Object { "$($_.contentType)`0$($_.expectedText)" } | Where-Object Count -gt 1)
if ($duplicateTexts.Count) { throw "Duplicate content-type/text pair in selected plan: $((@($duplicateTexts | ForEach-Object Name) -join ' | '))" }
Write-Plan $entries 'planned'
Write-Output "Wrote inspectable expected-text plan: $PlanPath ($($entries.Count) entries)."
if ($PlanOnly) { Write-Output 'Plan only; no audio was generated or verified.'; exit 0 }

$ffmpeg = Resolve-Program $FfmpegPath (Join-Path $repoRoot 'tmp\french-audio-bin\ffmpeg.exe') 'ffmpeg' 'Ffmpeg Path'
$needsGeneration = @($entries | Where-Object action -eq 'generate')
$piper = $null
if ($needsGeneration.Count) {
  if (-not (Test-Path -LiteralPath $ModelPath) -or -not (Test-Path -LiteralPath $ConfigPath)) { throw "Piper model files were not found: $ModelPath and $ConfigPath" }
  $piper = Resolve-Program $PiperPath (Join-Path $repoRoot 'tmp\french-audio-venv\Scripts\piper.exe') 'piper' 'Piper Path'
}
$usedBatchGenerator = $false
if ($needsGeneration.Count) {
  if (-not $PythonPath) { $PythonPath = Join-Path $repoRoot 'tmp\french-audio-venv\Scripts\python.exe' }
  $batchScript = Join-Path $PSScriptRoot 'generate-wav-batch.py'
  if ((Test-Path -LiteralPath $PythonPath) -and (Test-Path -LiteralPath $batchScript)) {
    & $PythonPath -c 'import piper' 2>$null
    if ($LASTEXITCODE -eq 0) {
      & $PythonPath $batchScript --plan $PlanPath --root $repoRoot --model $ModelPath --config $ConfigPath
      if ($LASTEXITCODE -ne 0) { throw 'Piper batch WAV generation failed.' }
      $usedBatchGenerator = $true
    }
  }
}
foreach ($entry in $entries) {
  $absoluteLocalPath = Join-Path $repoRoot $entry.localPath
  if ($entry.action -eq 'generate') {
    New-Item -ItemType Directory -Force (Split-Path -Parent $absoluteLocalPath) | Out-Null
    $wavPath = [IO.Path]::ChangeExtension($absoluteLocalPath, '.wav')
    if (-not $usedBatchGenerator) {
      # Pass one explicit Unicode argument. Piping text through a native process
      # made earlier Windows runs harder to audit and can corrupt edge-case input.
      $expectedText = [string]$entry.expectedText
      & $piper --model $ModelPath --config $ConfigPath --output_file $wavPath -- $expectedText
      if ($LASTEXITCODE -ne 0) { throw "Piper failed for $($entry.audioKey)" }
    }
    if (-not (Test-Path -LiteralPath $wavPath)) { throw "Piper WAV output is missing for $($entry.audioKey)" }
    Convert-ToMp3 $wavPath $absoluteLocalPath $ffmpeg
  }
  $entry.verification = Test-Mp3 $absoluteLocalPath $ffmpeg
}
Write-Plan $entries 'verified'
$metadataScript = Join-Path $PSScriptRoot 'sync-manifest-metadata.js'
& node $metadataScript --version all
if ($LASTEXITCODE -ne 0) { throw 'Failed to synchronize French audio byte/hash metadata.' }
Write-Output "French audio generation and ffmpeg verification completed: $($entries.Count) item(s). Review every pronunciation against $PlanPath before upload."
