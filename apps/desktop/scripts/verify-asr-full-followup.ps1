$ErrorActionPreference = 'Stop'
$env:SHANGHAO_MATRIX_SUITE = 'full-followup-20260910'
$env:SHANGHAO_MATRIX_MODE = 'long'
$env:SHANGHAO_MATRIX_RECORDINGS = '7d096d64-2e3b-4279-8624-21295ad5bcb0,71140c19-40da-4a72-a3df-41e3bc5276ff'
Set-Location -LiteralPath (Join-Path $PSScriptRoot '..')
& node --import tsx scripts/verify-asr-matrix.ts --run
if ($LASTEXITCODE -ne 0) { throw "Full ASR follow-up stopped: exit $LASTEXITCODE" }
