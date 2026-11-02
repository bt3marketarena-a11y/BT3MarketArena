# Genera un indirizzo segreto per il pannello admin e lo salva su Vercel come variabile
# sensibile ADMIN_PATH (solo Production). Il valore non entra nel repository pubblico.
# La CLI di Vercel scrive il banner su stderr: in Windows PowerShell 5.1 con
# ErrorActionPreference=Stop diventerebbe un errore, quindi l'esito si legge da $LASTEXITCODE.
$alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'.ToCharArray()
$bytes = New-Object byte[] 24
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$slug = 'ops-' + (-join ($bytes | ForEach-Object { $alphabet[$_ % $alphabet.Length] }))

$existing = (cmd /c "vercel env ls production 2>nul") | Select-String '\bADMIN_PATH\b'
if ($existing) {
  Write-Host 'ADMIN_PATH esiste già su Vercel: lo sostituisco con un nuovo indirizzo.' -ForegroundColor Yellow
  cmd /c "vercel env rm ADMIN_PATH production --yes >nul 2>nul"
}
$slug | cmd /c "vercel env add ADMIN_PATH production --sensitive >nul 2>nul"
if ($LASTEXITCODE -ne 0) {
  Write-Host "Salvataggio su Vercel non riuscito (codice $LASTEXITCODE). Controlla di essere nella cartella del progetto e di aver fatto 'vercel login'." -ForegroundColor Red
  exit 1
}

Write-Host ''
Write-Host 'Indirizzo segreto del pannello admin (salvalo nei preferiti, non condividerlo):' -ForegroundColor Green
Write-Host "  https://bt3marketarena.xyz/$slug/" -ForegroundColor Cyan
Write-Host ''
Write-Host 'Sarà attivo dopo il prossimo deploy di Production.'
