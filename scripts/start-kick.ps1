# Avvia lo streamer verso Kick. La stream key viene chiesta nascosta (asterischi),
# resta solo in questa sessione e non finisce nella cronologia di PowerShell.
param(
  [string]$IngestUrl = 'rtmps://fa723fc1b171.global-contribute.live-video.net:443/app',
  # Server URL di pump.fun (WHIP o RTMP): se indicato, la domanda sul server viene saltata.
  [string]$PumpServer = ''
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
Remove-Item Env:\STREAM_RTMP_URL_SECONDARY, Env:\STREAM_WHIP_URL, Env:\STREAM_WHIP_TOKEN -ErrorAction SilentlyContinue

# Seconda destinazione facoltativa (pump.fun): stesso video del gioco, senza webcam.
# pump.fun usa WHIP (https://...whip.livekit.cloud/...): un FFmpeg separato, se cade Kick continua.
# Un server rtmp:// passa invece dal tee del principale (onfail=ignore).
Write-Host ''
if ($PumpServer) {
  $server = $PumpServer.Trim()
  Write-Host 'Seconda destinazione: pump.fun.'
} else {
  Write-Host 'Trasmettere anche su pump.fun? Incolla il Server URL di pump.fun, oppure premi Invio per saltare.'
  $server = (Read-Host 'Server URL pump.fun').Trim()
}
if ($server) {
  if ($server -notmatch '^(rtmps?|https)://') { throw 'Il Server URL deve iniziare con https://, rtmp:// o rtmps://' }
  $securePump = Read-Host -AsSecureString 'Stream key pump.fun'
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePump)
  try {
    $pumpKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  }
  if (-not $pumpKey.Trim()) { throw 'Nessuna stream key pump.fun inserita.' }
  if ($server -match '^https://') {
    $env:STREAM_WHIP_URL = $server
    $env:STREAM_WHIP_TOKEN = $pumpKey.Trim()
  } else {
    $env:STREAM_RTMP_URL_SECONDARY = "$($server.TrimEnd('/'))/$($pumpKey.Trim())"
  }
  Remove-Variable pumpKey, securePump
  Write-Host 'Doppia diretta attiva: Kick + pump.fun.' -ForegroundColor Green
}
Remove-Variable server
Write-Host 'Avvio dello streamer: il gioco parte in background, la diretta inizia tra circa 1 minuto.' -ForegroundColor Green
node scripts/stream-canvas-pipe.mjs
