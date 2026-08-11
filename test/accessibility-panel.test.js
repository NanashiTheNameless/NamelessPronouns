import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import ejs from 'ejs';
import path from 'node:path';
import { ChromiumMissing, dumpDom } from './helpers/chromium.js';
const root = fileURLToPath(new URL('..', import.meta.url));
test('accessibility settings apply before paint, persist locally, and reset', async (t) => {
  const footer = await ejs.renderFile(path.join(root, 'views/partials/site-footer.ejs'), {}, { async: true });
  const harness = readFileSync(path.join(root, 'test/fixtures/accessibility-harness.html'), 'utf8')
    .replace('<footer-slot></footer-slot>', footer);
  const csp = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self'; img-src 'self' data:; font-src 'self'";
  const server = createServer((req, res) => {
    res.setHeader('Content-Security-Policy', csp);
    if (req.url === '/') return res.end(harness);
    const files = {
      '/static/css/main.css': 'public/css/main.css',
      '/static/js/accessibility.js': 'public/js/accessibility.js',
    };
    const file = files[req.url];
    if (!file) return res.writeHead(404).end();
    if (file.endsWith('.js')) res.setHeader('content-type', 'text/javascript');
    if (file.endsWith('.css')) res.setHeader('content-type', 'text/css');
    res.end(readFileSync(path.join(root, file)));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    let stdout;
    try {
      stdout = await dumpDom(['--virtual-time-budget=4000', '--dump-dom', `http://127.0.0.1:${server.address().port}/`]);
    } catch (error) {
      if (error instanceof ChromiumMissing) return t.skip('Chromium is not installed');
      throw error;
    }
    const encoded = /<output id="browser-result">([^<]+)<\/output>/.exec(stdout)?.[1];
    assert.ok(encoded && encoded !== 'pending', 'the harness reported its settings');
    const result = JSON.parse(encoded.replaceAll('&quot;', '"').replaceAll('&amp;', '&'));
    assert.deepEqual(result.early, { theme: 'contrast', font: 'serif', beforeBody: true },
      'stored settings are applied while the head parses, so there is no flash of the default theme');
    assert.match(result.seededFont, /serif/i, 'the stored font override reaches the page');
    assert.equal(result.buttonHidden, false, 'the footer button appears once its script runs');
    assert.equal(result.openedState, true, 'the button opens the panel');
    assert.equal(result.closedState, false, 'Done closes the panel');
    assert.equal(result.openedWithStoredChecked, 'contrast', 'the panel opens showing the stored choice');
    assert.equal(result.light.theme, 'light');
    assert.equal(result.light.font, 'sans');
    assert.deepEqual(result.light.stored, ['light', 'sans'], 'choices are stored client side');
    assert.equal(result.light.background.startsWith('rgb'), true);
    assert.notEqual(result.light.background, result.light.color, 'the light theme still paints text against a background');
    assert.equal(result.light.colorsHidden, true, 'a preset theme hides the custom color fields');
    assert.deepEqual(result.contrastDark, { theme: 'contrast', accent: '#ffd400', colorsHidden: true });
    assert.deepEqual(result.contrastLight, { theme: 'contrast-light', accent: '#00007a', colorsHidden: true });
    assert.deepEqual(result.sectionsShown, { colors: true, family: true },
      'choosing the arbitrary options reveals their fields');
    assert.equal(result.custom.inlineBg, '#102030');
    assert.equal(result.custom.inlineText, '#f0f4ff');
    assert.equal(result.custom.inlineFont, 'Georgia, serif, "0xProto", monospace');
    assert.equal(result.custom.colorScheme, 'dark', 'a dark custom background keeps form controls dark');
    assert.equal(result.custom.background, 'rgb(16, 32, 48)', 'the custom color actually paints the page');
    assert.match(result.custom.fontFamily, /Georgia/);
    assert.match(result.custom.contrastNote, /1[45]\.\d to 1, which meets the 4\.5 to 1 guideline/);
    assert.equal(result.picked.inlineAccent, '#3311aa', 'the color picker writes straight through to the page');
    assert.equal(result.picked.textField, '#3311aa', 'and fills the hex field beside it');
    assert.equal(result.picked.pickerAfterTyping, '#204020', 'typing a hex code moves the picker swatch too');
    assert.match(result.rejected.message, /needs an HTML color code such as #1a2b3c/);
    assert.equal(result.rejected.inlineBg, '#102030', 'a malformed color never reaches the page');
    assert.match(result.rejectedFamily.message, /only letters, numbers, spaces, commas, quotes, and hyphens/);
    assert.equal(result.rejectedFamily.inlineFont, 'Georgia, serif, "0xProto", monospace', 'a url() font name is refused');
    assert.match(result.imported.message, /Settings applied\. Ignored what could not be read: colors that are not #rrggbb\./);
    assert.equal(result.imported.inlineBg, '#204020', 'imported colors apply');
    assert.equal(result.imported.inlineAccent, '', 'an imported color that is not a hex code is dropped');
    assert.equal(result.imported.inlineFont, 'Verdana, sans-serif, "0xProto", monospace');
    assert.deepEqual(JSON.parse(result.imported.stored), { bg: '#204020', text: '#ffffff' });
    assert.match(result.badImport.message, /not valid settings text/);
    assert.equal(result.badImport.inlineBg, '#204020', 'a failed import changes nothing');
    const exported = JSON.parse(result.custom.exported);
    assert.equal(exported.version, 1);
    assert.equal(exported.theme, 'custom');
    assert.equal(exported.fontFamily, 'Georgia, serif');
    assert.deepEqual(exported.colors, { bg: '#102030', text: '#f0f4ff' }, 'export carries exactly what was set');
    assert.deepEqual(result.reset, {
      theme: null, font: null, stored: [null, null], checked: 'default',
      inlineBg: '', inlineFont: '', storedColors: null, storedFamily: null,
      colorsHidden: true,
    }, 'reset clears the attributes, the inline colors, and everything stored, and hides the color fields');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
test('the footer offers the panel and the head applies it early', async () => {
  const footer = await readFile(new URL('../views/partials/site-footer.ejs', import.meta.url), 'utf8');
  const head = await readFile(new URL('../views/partials/head.ejs', import.meta.url), 'utf8');
  assert.match(footer, /<button type="button"[^>]*data-accessibility-open hidden>Accessibility<\/button>/);
  assert.match(footer, /<dialog class="accessibility-panel" aria-labelledby="accessibility-h" data-accessibility-panel>/);
  assert.match(footer, /kept in this browser only/);
  for (const value of ['default', 'light', 'contrast', 'contrast-light']) {
    assert.match(footer, new RegExp(`name="accessibility_theme" value="${value}"`));
  }
  for (const value of ['default', 'sans', 'serif', 'mono']) {
    assert.match(footer, new RegExp(`name="accessibility_font" value="${value}"`));
  }
  assert.match(head, /<script src="\/static\/js\/accessibility\.js"><\/script>/);
  assert.ok(head.indexOf('accessibility.js') > head.indexOf('main.css'), 'the stylesheet loads first');
});
test('the panel offers arbitrary colors, an arbitrary font, and settings transfer', async () => {
  const footer = await readFile(new URL('../views/partials/site-footer.ejs', import.meta.url), 'utf8');
  assert.match(footer, /name="accessibility_theme" value="custom"/);
  assert.match(footer, /name="accessibility_font" value="custom"/);
  for (const key of ['bg', 'surface', 'text', 'muted', 'border', 'accent', 'accentText', 'link', 'focus', 'placeholder']) {
    const field = new RegExp(`name="accessibility_color_${key}"[^>]*`).exec(footer);
    assert.ok(field, `${key} has its own color field`);
    assert.match(field[0], /pattern="#\[0-9A-Fa-f\]\{6\}"/, `${key} accepts only an HTML color code`);
    assert.match(field[0], /placeholder="[^"]+"/, `${key} explains itself`);
  }
  for (const key of ['bg', 'surface', 'text', 'muted', 'border', 'accent', 'accentText', 'link', 'focus', 'placeholder']) {
    const picker = new RegExp(`<input type="color" data-color-picker="${key}" aria-label="[^"]+">`).exec(footer);
    assert.ok(picker, `${key} offers the browser color picker`);
    assert.match(picker[0], /aria-label="Pick the [a-z ]{4,}"/, `${key} names its picker for screen readers`);
  }
  assert.match(footer, /<input id="accessibility-font-family" name="accessibility_font_family"[^>]*maxlength="120"/);
  assert.match(footer, /Only fonts already on your device can be used/);
  assert.match(footer, /<textarea id="accessibility-transfer"[^>]*data-accessibility-transfer/);
  assert.match(footer, /data-accessibility-copy>Copy settings</);
  assert.match(footer, /data-accessibility-import>Apply pasted settings</);
  assert.match(footer, /role="status" aria-live="polite" data-accessibility-status/, 'feedback is announced politely');
  assert.match(footer, /role="status" aria-live="polite" data-accessibility-contrast/, 'the contrast note is announced politely');
});
test('the custom theme derives the rest of its palette from the colors the user gives', async () => {
  const css = await readFile(new URL('../public/css/main.css', import.meta.url), 'utf8');
  const block = /:root\[data-theme="custom"\] \{([^}]*)\}/.exec(css);
  assert.ok(block, 'the custom theme has a block');
  for (const token of ['--surface', '--accent-soft', '--danger', '--danger-soft', '--success', '--success-soft']) {
    assert.match(block[1], new RegExp(`${token}:\\s*var\\(--`), `${token} follows a color the user set`);
  }
  assert.match(block[1], /--shadow:\s*none/, 'a custom background stays flat');
});
test('every theme redefines the whole palette, and fonts stay first-party', async () => {
  const css = await readFile(new URL('../public/css/main.css', import.meta.url), 'utf8');
  const tokens = [...(/:root \{([^}]*)\}/.exec(css)[1]).matchAll(/(--[a-z-]+):/g)].map((match) => match[1]);
  assert.ok(tokens.includes('--font-body') && tokens.includes('--link'), 'the base palette carries the new tokens');
  for (const theme of ['light', 'contrast', 'contrast-light']) {
    const block = new RegExp(`:root\\[data-theme="${theme}"\\] \\{([^}]*)\\}`).exec(css);
    assert.ok(block, `${theme} defines a palette`);
    for (const token of tokens.filter((name) => name !== '--font-body')) {
      assert.match(block[1], new RegExp(`${token}:`), `${theme} redefines ${token}`);
    }
    assert.match(block[1], /color-scheme:/, `${theme} declares its color scheme`);
  }
  for (const font of ['sans', 'serif', 'mono']) {
    const block = new RegExp(`:root\\[data-font="${font}"\\] \\{([^}]*)\\}`).exec(css);
    assert.ok(block, `${font} defines a font stack`);
    assert.doesNotMatch(block[1], /url\(|https?:/, 'font overrides never fetch a remote file');
  }
  assert.doesNotMatch(css, /@import|src:\s*url\(https?:/, 'no stylesheet or font is loaded from another origin');
});

test('links styled as buttons take the button label color, and buttons carry no glow', async () => {
  const css = await readFile(new URL('../public/css/main.css', import.meta.url), 'utf8');
  const genericLinks = css.indexOf('a,\na:visited,\na:hover,\na:active {');
  const linkButtons = css.indexOf('a.button,\na.button:visited,\na.button:active {');
  assert.ok(genericLinks !== -1 && linkButtons !== -1, 'both rules exist');
  assert.ok(linkButtons > genericLinks, 'the button rule wins over the generic link color');
  assert.match(css.slice(linkButtons), /^a\.button,\na\.button:visited,\na\.button:active \{\n  color: var\(--on-accent\);/);
  assert.match(css, /a\.button\.secondary,[\s\S]*?color: var\(--text\);/);
  const primary = /\nbutton,\n\.button \{([^}]*)\}/.exec(css)[1];
  assert.doesNotMatch(primary, /box-shadow/, 'no underglow behind a button');
  assert.doesNotMatch(css, /box-shadow: 0 8px 20px|box-shadow: 0 11px 24px/, 'the old button glows are gone');
  assert.match(css, /a:focus-visible,\nbutton:focus-visible,[\s\S]*?outline: 3px solid var\(--focus\)/, 'focus outlines stay');
  assert.match(css, /\[hidden\] \{\n  display: none !important;\n\}/, 'the hidden attribute beats layout display rules');
});
test('every button of a kind hovers the same simple way', async () => {
  const css = await readFile(new URL('../public/css/main.css', import.meta.url), 'utf8');
  const hoverBlocks = [...css.matchAll(/\n((?:[^\n{}]*:hover[^\n{}]*,?\n?)+)\{([^}]*)\}/g)]
    .map(([, selector, body]) => ({ selector: selector.trim(), body: body.trim() }));
  const buttonHovers = hoverBlocks.filter((rule) => /(^|[\s,])(button|\.button)[.:]/.test(rule.selector)
    || /^button:hover/.test(rule.selector));
  assert.equal(buttonHovers.length, 2, `one hover rule per button kind, saw: ${buttonHovers.map((r) => r.selector).join(' | ')}`);
  const [primary, secondary] = buttonHovers;
  assert.equal(primary.selector, 'button:hover,\n.button:hover,\na.button:hover');
  assert.match(primary.body, /color: var\(--on-accent\);/);
  assert.match(primary.body, /background: var\(--accent-hover\);/);
  assert.match(primary.body, /text-decoration: underline;/);
  assert.equal(secondary.selector, 'button.secondary:hover,\n.button.secondary:hover,\na.button.secondary:hover');
  assert.match(secondary.body, /color: var\(--on-accent\);/);
  assert.match(secondary.body, /background: var\(--accent\);/);
  assert.match(secondary.body, /text-decoration: underline;/);
  for (const rule of hoverBlocks) {
    assert.doesNotMatch(rule.body, /transform|box-shadow|filter|opacity/, `${rule.selector} keeps its hover simple`);
  }
  assert.doesNotMatch(css, /data-theme="[a-z-]+"\] button\.secondary:hover/, 'no theme needs its own hover rule');
  assert.match(css, /:root\[data-theme="custom"\] \{[^}]*--accent-hover: var\(--accent\);/s, 'a custom palette hovers within its own colors');
  for (const surface of ['.choice:hover', '.flag-picker summary:hover', 'button.flag-picker-option:hover']) {
    assert.ok(css.includes(surface), `${surface} has a hover state`);
  }
  assert.match(css, /altcha-widget\.email-obfuscation \.email-reveal:hover,\n\.markdown-help summary:hover \{[^}]*text-decoration-thickness: 0\.16em;/s,
    'link-like buttons share one hover treatment');
});
