import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
function paletteOf(css, selector) {
  const block = new RegExp(`${selector.replace(/[[\]"]/g, (c) => `\\${c}`)} \\{(.*?)\\n\\}`, 's').exec(css);
  assert.ok(block, `${selector} exists`);
  return Object.fromEntries([...block[1].matchAll(/(--[a-z-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}
function luminance(color) {
  const hex = color.replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(hex)) return null;
  const channels = [0, 2, 4]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}
function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)];
  if (x === null || y === null) return null;
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
const PAIRS = [
  ['--text', '--bg', 4.5],
  ['--text', '--surface-strong', 4.5],
  ['--muted', '--surface-strong', 4.5],
  ['--placeholder', '--surface-strong', 4.5],
  ['--on-accent', '--accent', 4.5],
  ['--on-accent', '--accent-hover', 4.5],
  ['--accent', '--bg', 4.5],
  ['--link', '--surface-strong', 4.5],
  ['--danger', '--danger-soft', 4.5],
  ['--success', '--success-soft', 4.5],
  ['--border', '--surface-strong', 3],
  ['--focus', '--bg', 3],
];
test('the themes offered in the accessibility panel all meet WCAG contrast', async () => {
  const css = await readFile(new URL('../public/css/main.css', import.meta.url), 'utf8');
  const base = paletteOf(css, ':root');
  for (const theme of ['light', 'contrast', 'contrast-light', '1998', 'ketchup']) {
    const palette = { ...base, ...paletteOf(css, `:root[data-theme="${theme}"]`) };
    for (const [foreground, background, needed] of PAIRS) {
      const ratio = contrast(palette[foreground], palette[background]);
      assert.ok(ratio !== null, `${theme}: ${foreground} and ${background} are plain hex colors`);
      assert.ok(
        ratio >= needed,
        `${theme}: ${foreground} on ${background} is ${ratio.toFixed(2)}:1, needs ${needed}:1`,
      );
    }
  }
});
test('the high-contrast themes clear the stricter AAA bar for body text', async () => {
  const css = await readFile(new URL('../public/css/main.css', import.meta.url), 'utf8');
  const base = paletteOf(css, ':root');
  for (const theme of ['contrast', 'contrast-light']) {
    const palette = { ...base, ...paletteOf(css, `:root[data-theme="${theme}"]`) };
    assert.ok(contrast(palette['--text'], palette['--bg']) >= 7, `${theme} body text reaches 7:1`);
  }
});
