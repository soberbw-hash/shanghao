$ErrorActionPreference = 'Stop'
$env:SHANGHAO_MATRIX_SUITE = 'multimode-20260909'
$env:SHANGHAO_MATRIX_RECORDINGS = '179cb9ad-5f5c-4d0d-8033-2177731d234c,7d096d64-2e3b-4279-8624-21295ad5bcb0,71140c19-40da-4a72-a3df-41e3bc5276ff'
Set-Location -LiteralPath (Join-Path $PSScriptRoot '..')
foreach ($caseMode in @('smoke', 'standard')) {
    $env:SHANGHAO_MATRIX_MODE = $caseMode
    & node --import tsx scripts/verify-asr-matrix.ts --run
    if ($LASTEXITCODE -ne 0) { throw "ASR suite stopped: $caseMode, exit $LASTEXITCODE" }
    $caseState = Join-Path $env:APPDATA "shanghao-desktop\voice-memory\verification\matrix-multimode-20260909-$caseMode\current.json"
    $caseResult = Get-Content -LiteralPath $caseState -Raw | ConvertFrom-Json
    if ($caseResult.phase -ne 'complete') { throw "ASR suite incomplete: $caseMode" }
}
