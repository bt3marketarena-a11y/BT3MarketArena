# Genera un indirizzo segreto per il pannello admin e lo salva su Vercel come variabile
# sensibile ADMIN_PATH (solo Production). Il valore non entra nel repository pubblico.
$ErrorActionPreference = 'Stop'
$alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'.ToCharArray()
$bytes = New-Object byte[] 24
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$slug = 'ops-' + (-join ($bytes | ForEach-Object { $alphabet[$_ % $alphabet.Length] }))

$existing = vercel env ls production 2>$null | Select-String '\bADMIN_PATH\b'
if ($existing) {
  Write-Host 'ADMIN_PATH esiste già su Vercel: lo sostituisco con un nuovo indirizzo.' -ForegroundColor Yellow
  vercel env rm ADMIN_PATH production --yes | Out-Null
}
$slug | vercel env add ADMIN_PATH production --sensitive | Out-Null

Write-Host ''
Write-Host 'Indirizzo segreto del pannello admin (salvalo nei preferiti, non condividerlo):' -ForegroundColor Green
Write-Host "  https://bt3marketarena.xyz/$slug/" -ForegroundColor Cyan
Write-Host ''
Write-Host 'Sarà attivo dopo il prossimo deploy di Production.'
