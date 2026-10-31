import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export function windowsCaptureScript(filePath) {
  const literal = filePath.replaceAll("'", "''");
  return `
Add-Type -AssemblyName System.Windows.Forms,System.Drawing;
Add-Type -Namespace BT3 -Name NativeMethods -MemberDefinition '[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool SetProcessDPIAware();';
[void][BT3.NativeMethods]::SetProcessDPIAware();
$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds;
$bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height;
$graphics = [System.Drawing.Graphics]::FromImage($bitmap);
try {
  $graphics.CopyFromScreen($bounds.Left, $bounds.Top, 0, 0, $bounds.Size);
  $bitmap.Save('${literal}', [System.Drawing.Imaging.ImageFormat]::Png);
} finally {
  $graphics.Dispose();
  $bitmap.Dispose();
}`;
}

export async function capturePrimaryScreen(filePath) {
  await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', windowsCaptureScript(filePath)], {
    timeout: 10_000,
    windowsHide: true,
  });
  return readFile(filePath);
}

export function captureGameFrame(page, filePath, platform = process.platform) {
  return platform === 'win32' ? capturePrimaryScreen(filePath) : page.screenshot();
}
