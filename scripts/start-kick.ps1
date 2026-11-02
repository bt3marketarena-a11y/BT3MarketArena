# Avvia lo streamer verso Kick. La stream key viene chiesta nascosta (asterischi),
# resta solo in questa sessione e non finisce nella cronologia di PowerShell.
param(
  [string]$IngestUrl = 'rtmps://fa723fc1b171.global-contribute.live-video.net:443/app'
)
$ErrorActionPreference = 'Stop'
Clear-Host
Write-Host 'BT3 Market Arena -> Kick' -ForegroundColor Green
Write-Host 'Incolla la stream key di Kick (Dashboard > URL e chiave stream) e premi Invio.'
$secure = Read-Host -AsSecureString 'Stream key'
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $key = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
}
if (-not $key.Trim()) { throw 'Nessuna stream key inserita.' }
$env:STREAM_RTMP_URL = "$($IngestUrl.TrimEnd('/'))/$($key.Trim())"
Remove-Variable key, secure
Remove-Item Env:\STREAM_RTMP_URL_SECONDARY -ErrorAction SilentlyContinue
Write-Host 'Avvio dello streamer: il gioco parte in background, la diretta inizia tra circa 1 minuto.' -ForegroundColor Green
node scripts/stream-canvas-pipe.mjs
