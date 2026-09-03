import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import ejs from 'ejs';
import path from 'node:path';
import { ChromiumMissing, dumpHarness } from './helpers/chromium.js';
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
      stdout = (await dumpHarness(['--virtual-time-budget=6000', '--dump-dom', `http://127.0.0.1:${server.address().port}/`])).html;
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
    assert.equal(result.decade.message, 'A decade fits neatly into six hex digits.');
    assert.equal(result.decade.inlineBg, '#decade', 'the valid hex color still applies');
    assert.equal(result.defaceQuip, 'No faces were harmed in the selection of this color.');
    assert.match(result.rejectedFamily.message, /only letters, numbers, spaces, commas, quotes, and hyphens/);
    assert.equal(result.rejectedFamily.inlineFont, 'Georgia, serif, "0xProto", monospace', 'a url() font name is refused');
    assert.match(result.imported.message, /Settings applied\. Ignored what could not be read: colors that are not #rrggbb or #rrggbbaa\./);
    assert.equal(result.imported.inlineBg, '#204020', 'imported colors apply');
    assert.equal(result.imported.inlineAccent, '', 'an imported color that is not a hex code is dropped');
    assert.equal(result.imported.inlineFont, 'Verdana, sans-serif, "0xProto", monospace');
    assert.deepEqual(JSON.parse(result.imported.stored), { bg: '#204020', text: '#ffffff' });
    assert.match(result.badImport.message, /not valid settings text/);
    assert.deepEqual(
      { theme: result.pasted.theme, stored: result.pasted.stored },
      { theme: 'light', stored: 'light' },
      'settings pasted into the box are the ones applied, even after the field fires change on blur',
    );
    assert.match(result.pasted.message, /Settings applied\./);
    assert.equal(result.badImport.inlineBg, '#204020', 'a failed import changes nothing');
    assert.deepEqual(result.timeMachine, {
      message: '1998 theme unlocked.', theme: null, unlocked: 'unlocked', revealed: true,
    });
    assert.deepEqual(result.sizePreset, {
      size: 'larger', stored: 'larger', rootFontSize: '20px', scaleHidden: true,
    }, 'a preset text size scales the root font size and hides the percentage field');
    assert.match(result.rejectedScale.message, /whole percentage between 75 and 200/);
    assert.equal(result.rejectedScale.inlineSize, '', 'an out of range percentage never reaches the page');
    assert.deepEqual(result.sizeCustom, {
      shown: true,
      size: 'custom',
      inlineSize: '175%',
      rootFontSize: '28px',
      stored: '175',
      exported: result.sizeCustom.exported,
    }, 'the arbitrary text size applies as an inline root font size');
    const sizeExport = JSON.parse(result.sizeCustom.exported);
    assert.equal(sizeExport.size, 'custom');
    assert.equal(sizeExport.fontScale, 175, 'the text size travels with the exported settings');
    const exported = JSON.parse(result.custom.exported);
    assert.equal(exported.version, 1);
    assert.equal(exported.theme, 'custom');
    assert.equal(exported.fontFamily, 'Georgia, serif');
    assert.deepEqual(exported.colors, { bg: '#102030', text: '#f0f4ff' }, 'export carries exactly what was set');
    assert.deepEqual(result.reset, {
      theme: null, font: null, stored: [null, null], checked: 'default',
      inlineBg: '', inlineFont: '', storedColors: null, storedFamily: null,
      colorsHidden: true,
      size: null, storedSize: null, storedScale: null, inlineSize: '', rootFontSize: '16px',
    }, 'reset clears the attributes, the inline colors, and everything stored, and hides the color fields');
    assert.equal(result.doubleReset, 'Still default. NamelessNanashi would be proud.');
    assert.match(result.colorQuip, /Coffee detected/);
    assert.equal(result.orderedColorQuip, 'Everything appears to be in order.');
    assert.equal(result.luckyColorQuip, 'Seven. Naturally.');
    assert.equal(result.alphabeticalColorQuip, 'Alphabetical, hexadecimal, and suspiciously organized.');
    assert.equal(result.monochromeQuip, 'You have chosen sides.');
    assert.equal(result.stealthQuip, 'Stealth mode enabled. Readability was not invited.');
    assert.match(result.fontQuip, /helps some dyslexic readers/);
    assert.equal(result.timesQuip, 'The Times are new. The Roman is unchanged.');
    assert.equal(result.defaultFontQuip, 'You came all this way to choose the default. Respect.');
    assert.equal(result.papyrusQuip, 'The ancient records warned us.');
    assert.deepEqual(result.konami, { initiallyHidden: true, unlocked: true, stored: 'unlocked' });
    assert.deepEqual(result.condiments, {
      initiallyHidden: true,
      unlocked: true,
      stored: 'unlocked',
      message: 'Ketchup and Mustard theme unlocked. It is a hot dog. We are all very sorry.',
    }, 'typing ketchup reveals the condiment theme and remembers it');
    assert.deepEqual(result.condimentToast, {
      message: 'Ketchup and Mustard theme unlocked. It is a hot dog. We are all very sorry.',
      visible: true,
      topLayer: true,
    });
    assert.equal(result.condimentEncore, 'The condiments are already out.');
    assert.deepEqual(result.condimentTheme, {
      theme: 'ketchup',
      background: 'rgb(255, 212, 0)',
      color: 'rgb(58, 2, 0)',
      striped: true,
    }, 'the condiment theme paints mustard behind ketchup-dark text, with stripes');
    assert.deepEqual(result.konamiToast, {
      message: 'Achievement already achieved.',
      visible: true,
      topLayer: true,
    });
    assert.equal(result.konamiEncore, 'Achievement already achieved.');
    assert.deepEqual(result.konamiEncoreToast, {
      message: 'Achievement already achieved.', visible: true, topLayer: true,
    });
    assert.equal(result.retroTheme, '1998', 'the unlocked theme can be selected and applied');
    assert.equal(result.shortcutsOpened, true, 'Shift+? opens the keyboard shortcuts panel');
    assert.equal(result.shortcutInception, 'You are already here.');
    assert.deepEqual(result.ownerBusinessCard, { role: 'Owner', status: 'probably debugging', pronouns: 'they/them' });
    assert.equal(result.ownerBusinessCardText, '[Owner probably debugging]');
    assert.equal(result.ownerFix, 'Have you tried turning it off and on again?');
    assert.equal(result.ownerHelp, 'Shift+? was right there.');
    assert.equal(result.backupBackup, 'Backup of backup complete.');
    assert.match(result.ownerSequence, /Owner located.*3-5 business eternities/);
    assert.equal(result.ownerSequenceToast.visible, true);
    assert.equal(result.ownerSequenceToast.topLayer, true);
    assert.deepEqual(result.whoamiToast, {
      message: 'An easter egg collector, Apparently.', visible: true, topLayer: true,
    });
    assert.deepEqual(result.helpToast, {
      message: 'Shift+? was right there.', visible: true, topLayer: true,
    });
    assert.equal(result.footerPersistence, 'Still Operated by NamelessNanashi.');
    assert.deepEqual(result.footerPersistenceToast, {
      message: 'NamelessNanashi keeps working on this site.', visible: true, topLayer: true,
    });
    assert.equal(result.ownerHeadingEncore, 'Yes, this is the Owner.');
    assert.deepEqual(result.ownerHeadingToast, {
      message: 'Yes, this is still the Owner.', visible: true, topLayer: true,
    });
    assert.deepEqual(result.offlineToast, {
      message: 'NamelessNanashi cannot fix your Wi-Fi.', visible: true, topLayer: true,
    });
    assert.deepEqual(result.onlineToast, {
      message: 'Connection restored. NamelessNanashi accepts the credit.', visible: true, topLayer: true,
    });
    assert.equal(result.ownerBadgeEncore, 'still wrote this bit');
    assert.equal(result.fortyTwo, 'You have the answer. The question remains unavailable.');
    assert.deepEqual(result.fortyTwoToast, {
      message: 'You have the answer. The question remains unavailable.', visible: true, topLayer: true,
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
test('the footer offers the panel and the head applies it early', async () => {
  const footer = await readFile(new URL('../views/partials/site-footer.ejs', import.meta.url), 'utf8');
  const head = await readFile(new URL('../views/partials/head.ejs', import.meta.url), 'utf8');
  assert.match(footer, /<button type="button"[^>]*data-accessibility-open hidden>Accessibility<\/button>/);
  assert.match(footer, /<dialog class="accessibility-panel" aria-labelledby="accessibility-h" data-accessibility-panel>/);
  assert.match(footer, /class="easter-status" role="status" aria-live="polite" popover="manual" data-easter-status/);
  assert.match(footer, /kept in this browser only/);
  for (const value of ['default', 'light', 'contrast', 'contrast-light', '1998']) {
    assert.match(footer, new RegExp(`name="accessibility_theme" value="${value}"`));
  }
  for (const value of ['default', 'sans', 'serif', 'mono']) {
    assert.match(footer, new RegExp(`name="accessibility_font" value="${value}"`));
  }
  assert.match(head, /<script src="\/static\/js\/accessibility\.js"><\/script>/);
  assert.match(footer, /data-konami-theme hidden[^>]*><input[^>]+value="1998"/);
  assert.match(footer, /data-shortcuts-panel/);
  assert.match(footer, /<span data-owner-prefix>Operated by<\/span> <span class="owner-signature" data-owner-signature>NamelessNanashi<\/span>/);
  assert.doesNotMatch(footer, /<a[^>]+data-owner-signature/, 'the signature never navigates');
  assert.doesNotMatch(footer, /<button[^>]+data-owner-signature/, 'a button would render inline-block, so it would wrap and highlight unlike the words around it');
  assert.match(footer, /<kbd>Shift<\/kbd> \+ <kbd>\?<\/kbd>/);
  for (const shortcut of ['Tab', 'Enter', 'Space', 'Arrow keys', 'Escape']) {
    assert.match(footer, new RegExp(`<kbd>${shortcut}<\\/kbd>`));
  }
  assert.match(footer, /<noscript><p[^>]*>No script\? No problem\. You are still a person\.<\/p><\/noscript>/);
  assert.match(head, /<!-- You found the source\. It uses it\/its\. -->/);
  assert.match(head, /<!-- Signed, reluctantly, by NamelessNanashi\. -->/);
  assert.ok(head.indexOf('accessibility.js') > head.indexOf('main.css'), 'the stylesheet loads first');
});

test('the accessibility script contains the local-only keyboard and input eggs', async () => {
  const script = await readFile(new URL('../public/js/accessibility.js', import.meta.url), 'utf8');
  assert.match(script, /ArrowUp.*ArrowUp.*ArrowDown.*ArrowDown.*ArrowLeft.*ArrowRight.*ArrowLeft.*ArrowRight.*'b'.*'a'/s);
  assert.match(script, /np-accessibility-konami/);
  for (const code of ['#c0ffee', '#bada55', '#0ff1ce', '#facade', '#deface', '#123456', '#777777', '#abcdef']) assert.match(script, new RegExp(code));
  assert.match(script, /Bold choice\. Genuinely: it helps some dyslexic readers\./);
  assert.match(script, /You have chosen sides\./);
  assert.match(script, /Stealth mode enabled\. Readability was not invited\./);
  assert.match(script, /You came all this way to choose the default\. Respect\./);
  assert.match(script, /Achievement already achieved\./);
  assert.match(script, /You are already here\./);
  assert.match(script, /A decade fits neatly into six hex digits\./);
  assert.match(script, /Still default\. NamelessNanashi would be proud\./);
  assert.match(script, /window\.NamelessNanashi = Object\.freeze/);
  assert.match(script, /Owner located\. Please allow 3-5 business eternities/);
  assert.match(script, /Still Operated by/);
  assert.match(script, /NamelessNanashi keeps working on this site\./);
  assert.match(script, /Yes, this is the Owner\./);
  assert.match(script, /still wrote this bit/);
  assert.match(script, /Preserved by NamelessNanashi/);
  assert.match(script, /Achievement Get: Read the console!/);
  assert.match(script, /The Times are new\. The Roman is unchanged\./);
  assert.match(script, /The ancient records warned us\./);
  assert.match(script, /Backup of backup complete\./);
  assert.match(script, /1998 theme unlocked\./);
  assert.match(script, /You have the answer\. The question remains unavailable\./);
  assert.match(script, /An easter egg collector, Apparently\./);
  assert.match(script, /Shift\+\? was right there\./);
  assert.match(script, /NamelessNanashi cannot fix your Wi-Fi\./);
  assert.match(script, /Connection restored\. NamelessNanashi accepts the credit\./);
  assert.match(script, /Have you tried turning it off and on again\?/);
  assert.match(script, /You have seen all our possible selves\./);
  assert.match(script, /The missing page was safely returned\. Repeatedly\./);
  assert.match(script, /You two have met before\./);
  assert.match(script, /Identity check inconclusive\./);
  assert.match(script, /Full keyboard lap completed\./);
  assert.match(script, /This message appears approximately once every four years\./);
  assert.match(script, /Epoch says happy birthday\./);
  assert.match(script, /Keyboard lap completed in reverse\./);
  assert.match(script, /Still going\./);
  assert.match(script, /Correct\. You found the subject\./);
  assert.match(script, /Nothing happens\. Documented\./);
  assert.match(script, /It is a hot dog\. We are all very sorry\./);
  assert.match(script, /The condiments are already out\./);
  assert.match(script, /Condiments are a choice, and you have made one\./);
  assert.match(script, /Approximately 3\.14 people are reading this\./);
  assert.match(script, /Everything here is true, except False\./);
  assert.match(script, /Not found, but properly steeped\./);
  assert.match(script, /#dec0de/);
  assert.match(script, /We cannot read that either\./);
  assert.match(script, /There is a documentary about this\./);
  assert.match(script, /Go to sleep\. The profile will still be here tomorrow\./);
  assert.match(script, /Transgender Day of Visibility\. You are seen, and you are welcome here\./);
  assert.match(script, /Transgender Day of Remembrance\. We remember the names, and the people who chose them\./);
  assert.match(script, /pronouns: 'they\/them'/);
  assert.match(script, /help\(\) \{ return 'Shift\+\? was right there\.'; \}/);
});
test('the panel offers arbitrary colors, an arbitrary font, and settings transfer', async () => {
  const footer = await readFile(new URL('../views/partials/site-footer.ejs', import.meta.url), 'utf8');
  assert.match(footer, /name="accessibility_theme" value="custom"/);
  assert.match(footer, /data-condiment-theme hidden><input type="radio" name="accessibility_theme" value="ketchup"/,
    'the condiment theme stays hidden until it is unlocked');
  assert.match(footer, /name="accessibility_font" value="custom"/);
  for (const key of ['bg', 'surface', 'text', 'muted', 'border', 'accent', 'accentText', 'link', 'focus', 'placeholder']) {
    const field = new RegExp(`name="accessibility_color_${key}"[^>]*`).exec(footer);
    assert.ok(field, `${key} has its own color field`);
    assert.match(field[0], /pattern="#\(\[0-9A-Fa-f\]\{6\}\|\[0-9A-Fa-f\]\{8\}\)"/, `${key} accepts only an HTML color code, with or without transparency`);
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
test('the newest client-side eggs are wired into the shipped script', async () => {
  const script = await readFile(new URL('../public/js/accessibility.js', import.meta.url), 'utf8');
  assert.match(script, /const HEX = \/\^#\(\?:\[0-9a-f\]\{6\}\|\[0-9a-f\]\{8\}\)\$\/i;/,
    'six and eight digit HTML color codes are both valid');
  for (const [color, quip] of [
    ['#0ddba1', 'Oddball. Fits right in.'],
    ['#accede', 'We accede.'],
    ['#efface', 'Effaced. Still visible.'],
    ['#decaf0', 'Decaffeinated. Somehow still awake.'],
    ['#deadbeef', 'A classic. Now with transparency.'],
    ['#cafebabe', 'Java called. It wants its constant back.'],
    ['#feedface', 'Fed.'],
    ['#8badf00d', 'Crash report filed.'],
  ]) {
    assert.ok(script.includes(`'${color}': '${quip}'`), `${color} has its quip`);
    assert.match(color, /^#([0-9a-f]{6}|[0-9a-f]{8})$/, `${color} is a valid HTML color code`);
  }
  for (const font of ['impact', 'arial', "'courier new'", 'font', 'cursive']) {
    assert.ok(script.includes(`${font}: '`), `${font} has its quip`);
  }
  for (const [size, quip] of [[404, 'Not found, but very large.'], [42, 'The answer, rendered small.'], [1998, 'The nineties were not that big.']]) {
    assert.ok(script.includes(`${size}: '${quip}'`), `${size} percent is answered`);
  }
  for (const clock of ['13:37', '04:04', '11:11']) {
    assert.ok(script.includes(`'${clock}'`), `${clock} is answered`);
  }
  for (const [sequence, quip] of [
    ['they', 'Singular. In English since the 1300s.'],
    ['ls', 'You are looking at it.'],
    ['vim', 'Nothing is trapping you. Escape, then :q, also works.'],
    ['git blame', 'NamelessNanashi. Every line.'],
    ['sudo', 'Still not a shell.'],
    ['coffee', 'Wrong appliance.'],
    ['undo', 'Ctrl+Z was right there.'],
    ['konami', 'Close. Use the arrows.'],
  ]) {
    assert.ok(script.includes(`[...'${sequence}'], run: () => announce('${quip}')`), `typing ${sequence} answers`);
  }
  assert.ok(script.includes("[...'pwd'], run: () => announce(location.pathname)"), 'pwd prints the path of the page');
  assert.match(script, /keys: \[\.\.\.arrows, 'a', 'b'\],\n\s*run: \(\) => announce\('Almost\. Order matters\.'\)/,
    'the Konami code in the wrong order says so');
  assert.match(script, /Plus addressing\. A person of taste\./);
  assert.match(script, /You did not read it\. It is short, so try\./);
  assert.match(script, /You read it\. Genuinely rare\./);
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
  for (const theme of ['light', 'contrast', 'contrast-light', '1998', 'ketchup']) {
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
