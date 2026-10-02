param(
  [Parameter(Mandatory=$true)][string]$ImagePath,
  [Parameter(Mandatory=$true)][string]$OutFile,
  [string]$Lang = 'zh-Hans-CN'
)

# NOTE: keep this file pure ASCII.
# Windows PowerShell 5.1 reads .ps1 as ANSI unless a BOM is present, so any
# non-ASCII literal here would be mangled and break parsing.
# Recognized text is data and is written out as UTF-8 JSON instead.

$ErrorActionPreference = 'Stop'

function Await($WinRtTask, $ResultType) {
  $asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
  })[0]
  $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
  $netTask = $asTask.Invoke($null, @($WinRtTask))
  $netTask.Wait(-1) | Out-Null
  $netTask.Result
}

function Write-Result($obj) {
  $json = $obj | ConvertTo-Json -Compress
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($OutFile, $json, $utf8)
}

$result = [ordered]@{ ok = $false; text = ''; engine = ''; error = ''; step = '' }
$stream = $null
$step = 'init'

try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime | Out-Null

  [Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime] | Out-Null
  [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType=WindowsRuntime] | Out-Null
  [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType=WindowsRuntime] | Out-Null
  [Windows.Globalization.Language, Windows.Globalization, ContentType=WindowsRuntime] | Out-Null

  $step = 'create-engine'
  $engine = $null
  try {
    $langObj = New-Object Windows.Globalization.Language $Lang
    $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($langObj)
  } catch { $engine = $null }
  if ($null -eq $engine) {
    $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
  }
  if ($null -eq $engine) { throw 'No OCR engine available (missing language pack).' }

  $result.engine = $engine.RecognizerLanguage.LanguageTag

  $step = 'open-file'
  if (-not (Test-Path -LiteralPath $ImagePath)) { throw "Image not found: $ImagePath" }
  $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($ImagePath)) ([Windows.Storage.StorageFile])

  $step = 'open-stream'
  $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])

  $step = 'decode'
  $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])

  $step = 'recognize'
  $ocr = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])

  $lines = @()
  foreach ($line in $ocr.Lines) { $lines += $line.Text }

  $result.ok = $true
  $result.text = ($lines -join "`n")
  $step = 'done'
} catch {
  $result.step = $step
  $inner = $_.Exception
  $chain = @()
  while ($inner) { $chain += $inner.Message; $inner = $inner.InnerException }
  $result.error = ($chain -join ' <- ')
} finally {
  $result.step = $step
  if ($stream) { try { $stream.Dispose() } catch { } }
}

Write-Result $result
