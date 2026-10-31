import test from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { hasColorfulGameFrame } from '../menuDriver.mjs';

function frame() {
  const png = new PNG({ width: 1920, height: 1080 });
  png.data.fill(0);
  for (let index = 3; index < png.data.length; index += 4) png.data[index] = 255;
  return png;
}

function rect(png, x0, y0, x1, y1, color) {
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const offset = (y * png.width + x) * 4;
      png.data[offset] = color[0];
      png.data[offset + 1] = color[1];
      png.data[offset + 2] = color[2];
    }
  }
}

test('il download nero con HUD colorato non è considerato un frame 3D', () => {
  const png = frame();
  rect(png, 690, 825, 1880, 845, [53, 242, 160]);
  rect(png, 1285, 825, 1880, 845, [255, 70, 100]);
  rect(png, 38, 570, 635, 860, [20, 120, 80]);
  rect(png, 450, 530, 1470, 550, [255, 255, 255]);
  assert.equal(hasColorfulGameFrame(png), false);
});

test('un arena colorata nella zona centrale è considerata un frame 3D', () => {
  const png = frame();
  rect(png, 700, 200, 1220, 650, [180, 95, 35]);
  assert.equal(hasColorfulGameFrame(png), true);
});
