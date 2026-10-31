import test from 'node:test';
import assert from 'node:assert/strict';
import { windowsCaptureScript } from '../screenCapture.mjs';

test('la cattura Windows usa il desktop reale e protegge il percorso', () => {
  const script = windowsCaptureScript("C:\\tmp\\o'brien\\frame.png");
  assert.match(script, /CopyFromScreen/);
  assert.match(script, /System\.Windows\.Forms/);
  assert.match(script, /o''brien/);
  assert.match(script, /ImageFormat]::Png/);
  assert.match(script, /SetProcessDPIAware/);
});
