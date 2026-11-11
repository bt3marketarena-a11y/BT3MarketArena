# Avvia lo streamer verso Kick (e facoltativamente pump.fun). Le stream key vengono chieste
# nascoste (asterischi) e non finiscono nella cronologia di PowerShell.
#
# -SaveKeys     salva le chiavi cifrate con DPAPI di Windows: solo questo utente, su questo
#               PC, può decifrarle. Il file non è nel repository.
# -UseSavedKeys riparte senza domande usando le chiavi salvate (es. dopo un riavvio del PC).
# -ForgetKeys   cancella le chiavi salvate ed esce.
#
# Se lo streamer si chiude per un errore, riparte da solo dopo 15 secondi con le stesse
# chiavi, che restano solo nella memoria di questa finestra. Ctrl+C lo ferma davvero.
param(
  [string]$IngestUrl = 'rtmps://fa723fc1b171.global-contribute.live-video.net:443/app',
  # Server URL di pump.fun (WHIP o RTMP): se indicato, la domanda sul server viene saltata.
  [string]$PumpServer = '',
  [switch]$SaveKeys,
  [switch]$UseSavedKeys,
  [switch]$ForgetKeys
)
$ErrorActionPreference = 'Stop'
$keyFile = Join-Path $env:LOCALAPPDATA 'BT3MarketArena\stream-keys.xml'

function ConvertTo-Plain([Security.SecureString]$secure) {
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

if ($ForgetKeys) {
  Remove-Item $keyFile -ErrorAction SilentlyContinue
  Write-Host 'Chiavi salvate cancellate.' -ForegroundColor Green
  return
}

Clear-Host
Write-Host 'BT3 Market Arena -> Kick' -ForegroundColor Green
if ($UseSavedKeys) {
  if (-not (Test-Path $keyFile)) { throw 'Nessuna chiave salvata: avvia una volta con -SaveKeys.' }
  # Export-Clixml cifra le SecureString con DPAPI legata a questo utente Windows.
  $saved = Import-Clixml $keyFile
  $kickSecure = $saved.Kick
  $server = [string]$saved.PumpServer
  $pumpSecure = $saved.Pump
  Write-Host 'Chiavi salvate caricate.'
} else {
  Write-Host 'Incolla la stream key di Kick (Dashboard > URL e chiave stream) e premi Invio.'
  $kickSecure = Read-Host -AsSecureString 'Stream key'
  # Seconda destinazione facoltativa (pump.fun): stesso video del gioco, senza webcam.
  Write-Host ''
  if ($PumpServer) {
    $server = $PumpServer.Trim()
    Write-Host 'Seconda destinazione: pump.fun.'
  } else {
    Write-Host 'Trasmettere anche su pump.fun? Incolla il Server URL di pump.fun, oppure premi Invio per saltare.'
    $server = (Read-Host 'Server URL pump.fun').Trim()
  }
  $pumpSecure = $null
  if ($server) { $pumpSecure = Read-Host -AsSecureString 'Stream key pump.fun' }
  if ($SaveKeys) {
    New-Item -ItemType Directory -Force (Split-Path $keyFile) | Out-Null
    [pscustomobject]@{ Kick = $kickSecure; PumpServer = $server; Pump = $pumpSecure } | Export-Clixml $keyFile
    Write-Host "Chiavi salvate cifrate per questo utente Windows in $keyFile" -ForegroundColor Green
  }
}

$key = (ConvertTo-Plain $kickSecure).Trim()
if (-not $key) { throw 'Nessuna stream key di Kick.' }
$env:STREAM_RTMP_URL = "$($IngestUrl.TrimEnd('/'))/$key"
Remove-Variable key
Remove-Item Env:\STREAM_RTMP_URL_SECONDARY, Env:\STREAM_WHIP_URL, Env:\STREAM_WHIP_TOKEN -ErrorAction SilentlyContinue

# pump.fun usa WHIP (https://...whip.livekit.cloud/...): un FFmpeg separato, se cade Kick continua.
# Un server rtmp:// passa invece dal tee del principale (onfail=ignore).
if ($server) {
  if ($server -notmatch '^(rtmps?|https)://') { throw 'Il Server URL deve iniziare con https://, rtmp:// o rtmps://' }
  if (-not $pumpSecure) { throw 'Manca la stream key di pump.fun.' }
  $pumpKey = (ConvertTo-Plain $pumpSecure).Trim()
  if (-not $pumpKey) { throw 'Nessuna stream key pump.fun inserita.' }
  if ($server -match '^https://') {
    $env:STREAM_WHIP_URL = $server
    $env:STREAM_WHIP_TOKEN = $pumpKey
  } else {
    $env:STREAM_RTMP_URL_SECONDARY = "$($server.TrimEnd('/'))/$pumpKey"
  }
  Remove-Variable pumpKey
  Write-Host 'Doppia diretta attiva: Kick + pump.fun.' -ForegroundColor Green
}
Remove-Variable server, kickSecure, pumpSecure -ErrorAction SilentlyContinue

Write-Host 'Avvio dello streamer: il gioco parte in background, la diretta inizia tra circa 1 minuto.' -ForegroundColor Green
while ($true) {
  node scripts/stream-canvas-pipe.mjs
  Write-Host "Streamer chiuso (codice $LASTEXITCODE): riparto tra 15 secondi. Ctrl+C per fermarlo." -ForegroundColor Yellow
  Start-Sleep -Seconds 15
}
