const THEME_KEY = 'np-accessibility-theme';
const FONT_KEY = 'np-accessibility-font';
const COLORS_KEY = 'np-accessibility-colors';
const FAMILY_KEY = 'np-accessibility-font-family';
const SIZE_KEY = 'np-accessibility-size';
const SCALE_KEY = 'np-accessibility-size-scale';
const KONAMI_KEY = 'np-accessibility-konami';
const CONDIMENT_KEY = 'np-accessibility-condiments';
const THEMES = ['default', 'light', 'contrast', 'contrast-light', '1998', 'ketchup', 'custom'];
const FONTS = ['default', 'sans', 'serif', 'mono', 'custom'];
const SIZES = ['default', 'large', 'larger', 'largest', 'custom'];
const SCALE_MIN = 75;
const SCALE_MAX = 200;
const HEX = /^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i;
const FAMILY = /^[A-Za-z0-9 ,'"-]{1,120}$/;
const COLORS = Object.freeze({
  bg: '--bg',
  surface: '--surface-strong',
  text: '--text',
  muted: '--muted',
  border: '--border',
  accent: '--accent',
  accentText: '--on-accent',
  link: '--link',
  focus: '--focus',
  placeholder: '--placeholder',
});
const COLOR_KEYS = Object.keys(COLORS);

console.info('NamelessPronouns, Achievement Get: Read the console!');
window.NamelessNanashi = Object.freeze({
  role: 'Owner',
  status: 'probably debugging',
  pronouns: 'they/them',
  fix() { return 'Have you tried turning it off and on again?'; },
  help() { return 'Shift+? was right there.'; },
  toString() { return '[Owner probably debugging]'; },
});

function readRaw(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    if (value === null || value === '' || value === 'default') localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {}
}

function readSession(key) {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeSession(key, value) {
  try {
    if (value === null || value === '') sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {}
}

function read404Returns() {
  try {
    const state = JSON.parse(readRaw('np-easter-404-returns') || 'null');
    const updatedAt = Number(state?.updatedAt);
    if (!state || !Number.isInteger(state.count) || !Number.isFinite(updatedAt)
      || updatedAt > Date.now() || Date.now() - updatedAt > 60 * 60 * 1000) return 0;
    return Math.max(0, Math.min(3, state.count));
  } catch {
    return 0;
  }
}

let easterToastTimer;
function announceEaster(message) {
  const easterStatus = document.querySelector('[data-easter-status]');
  if (!easterStatus) return;
  clearTimeout(easterToastTimer);
  easterStatus.textContent = message;
  easterStatus.classList.add('is-visible');
  if (typeof easterStatus.showPopover === 'function' && !easterStatus.matches(':popover-open')) {
    easterStatus.showPopover();
  }
  easterToastTimer = setTimeout(() => {
    if (typeof easterStatus.hidePopover === 'function' && easterStatus.matches(':popover-open')) {
      easterStatus.hidePopover();
    }
    easterStatus.classList.remove('is-visible');
    easterStatus.textContent = '';
  }, 4000);
}

function choice(key, allowed) {
  const value = readRaw(key);
  return allowed.includes(value) ? value : 'default';
}

function validColors(input) {
  if (!input || typeof input !== 'object') return {};
  const colors = {};
  for (const key of COLOR_KEYS) {
    const value = input[key];
    if (typeof value === 'string' && HEX.test(value.trim())) colors[key] = value.trim().toLowerCase();
  }
  return colors;
}

function validFamily(input) {
  const value = typeof input === 'string' ? input.trim() : '';
  return FAMILY.test(value) ? value : '';
}

function validScale(input) {
  const value = Number(String(input ?? '').trim());
  if (!Number.isFinite(value) || !Number.isInteger(value)) return 0;
  return value >= SCALE_MIN && value <= SCALE_MAX ? value : 0;
}

function storedColors() {
  try {
    return validColors(JSON.parse(readRaw(COLORS_KEY) || '{}'));
  } catch {
    return {};
  }
}

function pickerHex(hex) {
  return hex.slice(0, 7);
}

function relativeLuminance(hex) {
  const channels = [1, 3, 5]
    .map((index) => parseInt(hex.slice(index, index + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(first, second) {
  if (!HEX.test(first) || !HEX.test(second)) return null;
  const [a, b] = [relativeLuminance(first), relativeLuminance(second)];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function applyCustom(colors, family, scale) {
  const root = document.documentElement;
  for (const [key, property] of Object.entries(COLORS)) {
    if (colors[key]) root.style.setProperty(property, colors[key]);
    else root.style.removeProperty(property);
  }
  if (colors.bg) root.style.colorScheme = relativeLuminance(colors.bg) > 0.35 ? 'light' : 'dark';
  else root.style.removeProperty('color-scheme');
  if (family) root.style.setProperty('--font-body', `${family}, "0xProto", monospace`);
  else root.style.removeProperty('--font-body');
  if (scale) root.style.fontSize = `${scale}%`;
  else root.style.removeProperty('font-size');
}

function applyAll() {
  const root = document.documentElement;
  const theme = choice(THEME_KEY, THEMES);
  const font = choice(FONT_KEY, FONTS);
  const size = choice(SIZE_KEY, SIZES);
  if (theme === 'default') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
  if (font === 'default') root.removeAttribute('data-font');
  else root.setAttribute('data-font', font);
  if (size === 'default') root.removeAttribute('data-size');
  else root.setAttribute('data-size', size);
  applyCustom(
    theme === 'custom' ? storedColors() : {},
    font === 'custom' ? validFamily(readRaw(FAMILY_KEY)) : '',
    size === 'custom' ? validScale(readRaw(SCALE_KEY)) : 0,
  );
  return { theme, font, size };
}

applyAll();

function exportSettings() {
  return {
    version: 1,
    theme: choice(THEME_KEY, THEMES),
    font: choice(FONT_KEY, FONTS),
    size: choice(SIZE_KEY, SIZES),
    colors: storedColors(),
    fontFamily: validFamily(readRaw(FAMILY_KEY)),
    fontScale: validScale(readRaw(SCALE_KEY)),
  };
}

function importSettings(text) {
  let parsed;
  try {
    const trimmed = String(text).trim();
    const source = /^"version"\s*:\s*(?:1998|57)\s*,?$/.test(trimmed)
      ? `{${trimmed.replace(/,\s*$/, '')}}`
      : trimmed;
    parsed = JSON.parse(source);
  } catch {
    return { ok: false, message: 'That is not valid settings text. Copy the whole block, including the braces.' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, message: 'Settings text must be a single block of settings.' };
  }
  const from1998 = Number(parsed.version) === 1998;
  const fromCondiments = Number(parsed.version) === 57;
  const theme = THEMES.includes(parsed.theme) ? parsed.theme : 'default';
  const font = FONTS.includes(parsed.font) ? parsed.font : 'default';
  const size = SIZES.includes(parsed.size) ? parsed.size : 'default';
  const colors = validColors(parsed.colors);
  const family = validFamily(parsed.fontFamily);
  const scale = validScale(parsed.fontScale);
  const dropped = [];
  if (parsed.theme && !THEMES.includes(parsed.theme)) dropped.push('theme');
  if (parsed.font && !FONTS.includes(parsed.font)) dropped.push('font');
  if (parsed.size && !SIZES.includes(parsed.size)) dropped.push('text size');
  if (parsed.colors && Object.keys(validColors(parsed.colors)).length < Object.keys(parsed.colors).length) {
    dropped.push('colors that are not #rrggbb or #rrggbbaa');
  }
  if (parsed.fontFamily && !family) dropped.push('font family');
  if (parsed.fontScale && !scale) dropped.push('text size percentage');
  write(THEME_KEY, theme);
  if (from1998) write(KONAMI_KEY, 'unlocked');
  if (fromCondiments) write(CONDIMENT_KEY, 'unlocked');
  write(FONT_KEY, font);
  write(SIZE_KEY, size);
  write(COLORS_KEY, Object.keys(colors).length ? JSON.stringify(colors) : null);
  write(FAMILY_KEY, family || null);
  write(SCALE_KEY, scale ? String(scale) : null);
  applyAll();
  return {
    ok: true,
    unlocked1998: from1998,
    unlockedCondiments: fromCondiments,
    dropped,
    message: from1998
      ? '1998 theme unlocked.'
      : fromCondiments
      ? 'Ketchup and Mustard theme unlocked. Condiments are a choice, and you have made one.'
      : dropped.length
      ? `Settings applied. Ignored what could not be read: ${dropped.join(', ')}.`
      : 'Settings applied.',
  };
}

function wirePanel() {
  const dialog = document.querySelector('[data-accessibility-panel]');
  const open = document.querySelector('[data-accessibility-open]');
  if (!dialog || !open || typeof dialog.showModal !== 'function') return;
  const form = dialog.querySelector('form');
  const transfer = dialog.querySelector('[data-accessibility-transfer]');
  const status = dialog.querySelector('[data-accessibility-status]');
  const warning = dialog.querySelector('[data-accessibility-contrast]');
  const konamiTheme = dialog.querySelector('[data-konami-theme]');
  const condimentTheme = dialog.querySelector('[data-condiment-theme]');
  let resetCount = 0;
  let copyCount = 0;
  if (konamiTheme && readRaw(KONAMI_KEY) === 'unlocked') konamiTheme.hidden = false;
  if (condimentTheme && readRaw(CONDIMENT_KEY) === 'unlocked') condimentTheme.hidden = false;
  const check = (name, value) => {
    const radio = form.querySelector(`input[name="${name}"][value="${value}"]`);
    if (radio) radio.checked = true;
  };
  const say = (element, message) => {
    if (element) element.textContent = message;
  };
  const reportContrast = () => {
    const colors = storedColors();
    if (choice(THEME_KEY, THEMES) !== 'custom' || !colors.text || !colors.bg) return say(warning, '');
    const ratio = contrastRatio(colors.text, colors.bg);
    if (ratio >= 4.5) return say(warning, `Your text and background contrast is ${ratio.toFixed(1)} to 1, which meets the 4.5 to 1 guideline.`);
    return say(warning, `Your text and background contrast is only ${ratio.toFixed(1)} to 1. The guideline is 4.5 to 1, so this may be hard to read.`);
  };
  const showSections = () => {
    const theme = choice(THEME_KEY, THEMES);
    const font = choice(FONT_KEY, FONTS);
    const size = choice(SIZE_KEY, SIZES);
    dialog.querySelectorAll('[data-accessibility-colors]').forEach((node) => { node.hidden = theme !== 'custom'; });
    dialog.querySelectorAll('[data-accessibility-family]').forEach((node) => { node.hidden = font !== 'custom'; });
    dialog.querySelectorAll('[data-accessibility-scale]').forEach((node) => { node.hidden = size !== 'custom'; });
  };
  const syncPicker = (key, value) => {
    const picker = form.querySelector(`[data-color-picker="${key}"]`);
    if (!picker) return;
    if (value && HEX.test(value)) {
      picker.value = pickerHex(value);
      return;
    }
    const active = getComputedStyle(document.documentElement).getPropertyValue(COLORS[key]).trim();
    picker.value = HEX.test(active) ? pickerHex(active) : '#000000';
  };
  const sync = () => {
    if (konamiTheme && readRaw(KONAMI_KEY) === 'unlocked') konamiTheme.hidden = false;
    if (condimentTheme && readRaw(CONDIMENT_KEY) === 'unlocked') condimentTheme.hidden = false;
    check('accessibility_theme', choice(THEME_KEY, THEMES));
    check('accessibility_font', choice(FONT_KEY, FONTS));
    check('accessibility_size', choice(SIZE_KEY, SIZES));
    const colors = storedColors();
    for (const key of COLOR_KEYS) {
      const field = form.querySelector(`[name="accessibility_color_${key}"]`);
      if (field) field.value = colors[key] || '';
      syncPicker(key, colors[key]);
    }
    const family = form.querySelector('[name="accessibility_font_family"]');
    if (family) family.value = validFamily(readRaw(FAMILY_KEY));
    const scale = form.querySelector('[name="accessibility_font_scale"]');
    if (scale) scale.value = validScale(readRaw(SCALE_KEY)) || '';
    if (transfer) transfer.value = JSON.stringify(exportSettings(), null, 2);
    showSections();
    reportContrast();
  };
  open.hidden = false;
  open.addEventListener('click', () => {
    sync();
    dialog.showModal();
  });
  form.addEventListener('change', (event) => {
    const field = event.target;
    if (field === transfer) return;
    resetCount = 0;
    copyCount = 0;
    if (field.name === 'accessibility_theme' && THEMES.includes(field.value)) {
      write(THEME_KEY, field.value);
      if (['default', 'light', 'contrast', 'contrast-light'].includes(field.value)) {
        const visited = new Set((readSession('np-easter-theme-tour') || '').split(',').filter(Boolean));
        visited.add(field.value);
        writeSession('np-easter-theme-tour', [...visited].join(','));
        if (visited.size === 4 && readSession('np-easter-theme-tour-complete') !== 'yes') {
          writeSession('np-easter-theme-tour-complete', 'yes');
          announceEaster('You have seen all our possible selves.');
        }
      }
    }
    if (field.name === 'accessibility_font' && FONTS.includes(field.value)) write(FONT_KEY, field.value);
    if (field.name === 'accessibility_size' && SIZES.includes(field.value)) write(SIZE_KEY, field.value);
    applyAll();
    sync();
  });
  form.addEventListener('input', (event) => {
    resetCount = 0;
    copyCount = 0;
    const field = event.target;
    const pickedKey = field.dataset?.colorPicker;
    if (pickedKey && COLOR_KEYS.includes(pickedKey)) {
      const target = form.querySelector(`[name="accessibility_color_${pickedKey}"]`);
      if (target) {
        target.value = field.value.toLowerCase();
        target.dispatchEvent(new Event('input', { bubbles: true }));
      }
      return;
    }
    const colorKey = /^accessibility_color_(\w+)$/.exec(field.name || '')?.[1];
    if (colorKey && COLOR_KEYS.includes(colorKey)) {
      const colors = storedColors();
      const value = field.value.trim();
      if (value === '') delete colors[colorKey];
      else if (HEX.test(value)) colors[colorKey] = value.toLowerCase();
      else return say(status, `${field.dataset.colorLabel || 'That color'} needs an HTML color code such as #1a2b3c, or #1a2b3ccc with transparency.`);
      write(COLORS_KEY, Object.keys(colors).length ? JSON.stringify(colors) : null);
      const quips = {
        '#c0ffee': 'Coffee detected. No beans were harmed.',
        '#bada55': 'That color has excellent credentials.',
        '#0ff1ce': 'Office hours are over.',
        '#facade': 'The facade is holding up.',
        '#decade': 'A decade fits neatly into six hex digits.',
        '#deface': 'No faces were harmed in the selection of this color.',
        '#123456': 'Everything appears to be in order.',
        '#777777': 'Seven. Naturally.',
        '#abcdef': 'Alphabetical, hexadecimal, and suspiciously organized.',
        '#dec0de': 'Decoded.',
        '#0ddba1': 'Oddball. Fits right in.',
        '#accede': 'We accede.',
        '#efface': 'Effaced. Still visible.',
        '#decaf0': 'Decaffeinated. Somehow still awake.',
        '#deadbeef': 'A classic. Now with transparency.',
        '#cafebabe': 'Java called. It wants its constant back.',
        '#feedface': 'Fed.',
        '#8badf00d': 'Crash report filed.',
      };
      const paired = colors.bg && colors.text;
      const paletteQuip = paired && colors.bg === colors.text
        ? 'Stealth mode enabled. Readability was not invited.'
        : paired && new Set([colors.bg, colors.text]).size === 2
          && [colors.bg, colors.text].every((color) => ['#000000', '#ffffff'].includes(color))
          ? 'You have chosen sides.'
          : '';
      say(status, paletteQuip || quips[value.toLowerCase()] || '');
      applyAll();
      syncPicker(colorKey, colors[colorKey]);
      if (transfer) transfer.value = JSON.stringify(exportSettings(), null, 2);
      return reportContrast();
    }
    if (field.name === 'accessibility_font_family') {
      const family = validFamily(field.value);
      if (field.value.trim() !== '' && !family) {
        return say(status, 'A font family may contain only letters, numbers, spaces, commas, quotes, and hyphens.');
      }
      write(FAMILY_KEY, family || null);
      const fontQuips = {
        'comic sans ms': 'Bold choice. Genuinely: it helps some dyslexic readers.',
        '0xproto': 'You came all this way to choose the default. Respect.',
        'times new roman': 'The Times are new. The Roman is unchanged.',
        papyrus: 'The ancient records warned us.',
        wingdings: 'We cannot read that either.',
        helvetica: 'There is a documentary about this.',
        impact: 'Everything becomes a meme eventually.',
        arial: 'Helvetica is right there.',
        'courier new': 'Monospaced and unbothered.',
        font: 'Recursive.',
        cursive: 'A web-safe risk.',
      };
      say(status, fontQuips[family.toLowerCase()] || '');
      applyAll();
      if (transfer) transfer.value = JSON.stringify(exportSettings(), null, 2);
    }
    if (field.name === 'accessibility_font_scale') {
      const scale = validScale(field.value);
      if (field.value.trim() !== '' && !scale) {
        const refused = {
          404: 'Not found, but very large.',
          42: 'The answer, rendered small.',
          1998: 'The nineties were not that big.',
        }[field.value.trim()];
        const limits = `A text size must be a whole percentage between ${SCALE_MIN} and ${SCALE_MAX}.`;
        return say(status, refused ? `${refused} ${limits}` : limits);
      }
      write(SCALE_KEY, scale ? String(scale) : null);
      say(status, scale === 100 ? 'That is the size we started with.' : '');
      applyAll();
      if (transfer) transfer.value = JSON.stringify(exportSettings(), null, 2);
    }
    return undefined;
  });
  dialog.querySelector('[data-accessibility-copy]')?.addEventListener('click', async () => {
    copyCount += 1;
    if (transfer) transfer.value = JSON.stringify(exportSettings(), null, 2);
    say(status, copyCount >= 3 ? 'Backup of backup complete.' : 'Copying settings...');
    try {
      await navigator.clipboard.writeText(transfer.value);
      say(status, copyCount >= 3 ? 'Backup of backup complete.' : 'Settings copied to your clipboard.');
    } catch {
      transfer?.select();
      say(status, copyCount >= 3 ? 'Backup of backup complete.' : 'Copying was blocked, so the settings are selected for you to copy.');
    }
  });
  dialog.querySelector('[data-accessibility-import]')?.addEventListener('click', () => {
    resetCount = 0;
    copyCount = 0;
    const result = importSettings(transfer ? transfer.value : '');
    say(status, result.message);
    sync();
    if (result.unlocked1998 && konamiTheme) konamiTheme.hidden = false;
    if (result.unlockedCondiments && condimentTheme) condimentTheme.hidden = false;
  });
  dialog.querySelector('[data-accessibility-reset]')?.addEventListener('click', () => {
    copyCount = 0;
    resetCount += 1;
    write(THEME_KEY, null);
    write(FONT_KEY, null);
    write(SIZE_KEY, null);
    write(COLORS_KEY, null);
    write(FAMILY_KEY, null);
    write(SCALE_KEY, null);
    applyAll();
    say(status, resetCount > 1 ? 'Still default. NamelessNanashi would be proud.' : 'Everything is back to the site defaults.');
    sync();
  });
  dialog.querySelector('[data-accessibility-close]')?.addEventListener('click', () => dialog.close());
  sync();
}

function wireKeyboardEggs() {
  const shortcuts = document.querySelector('[data-shortcuts-panel]');
  const accessibility = document.querySelector('[data-accessibility-panel]');
  const konamiTheme = document.querySelector('[data-konami-theme]');
  const condimentTheme = document.querySelector('[data-condiment-theme]');
  const status = document.querySelector('[data-accessibility-status]');
  const ownerSignature = document.querySelector('[data-owner-signature]');
  const ownerHeading = document.querySelector('[data-owner-heading]');
  const ownerBadge = document.querySelector('[data-owner-badge]');
  const shortcutsHeading = shortcuts?.querySelector('h2');
  const arrows = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight'];
  let headingTimer;
  let ownerTimer;
  const announce = announceEaster;
  const unlockTheme = (storageKey, element, unlockedMessage, encoreMessage) => {
    const already = readRaw(storageKey) === 'unlocked';
    write(storageKey, 'unlocked');
    if (element) element.hidden = false;
    const message = already ? encoreMessage : unlockedMessage;
    if (status) status.textContent = message;
    announce(message);
    if (accessibility?.open) element?.querySelector('input')?.focus();
  };
  const sequences = [
    { keys: [...'nanashi'], run: () => announce('Owner located. Please allow 3-5 business eternities for a response.') },
    { keys: ['4', '2'], run: () => announce('You have the answer. The question remains unavailable.') },
    { keys: [...'whoami'], run: () => announce('An easter egg collector, Apparently.') },
    { keys: [...'help'], run: () => announce('Shift+? was right there.') },
    { keys: [...'pronouns'], run: () => announce('Correct. You found the subject.') },
    { keys: [...'xyzzy'], run: () => announce('Nothing happens. Documented.') },
    { keys: [...'they'], run: () => announce('Singular. In English since the 1300s.') },
    { keys: [...'ls'], run: () => announce('You are looking at it.') },
    { keys: [...'pwd'], run: () => announce(location.pathname) },
    { keys: [...'vim'], run: () => announce('Nothing is trapping you. Escape, then :q, also works.') },
    { keys: [...'git blame'], run: () => announce('NamelessNanashi. Every line.') },
    { keys: [...'sudo'], run: () => announce('Still not a shell.') },
    { keys: [...'tea'], run: () => announce('Steeping. Come back to /teapot in four minutes and eighteen seconds.') },
    { keys: [...'coffee'], run: () => announce('Wrong appliance.') },
    { keys: [...'undo'], run: () => announce('Ctrl+Z was right there.') },
    { keys: [...'konami'], run: () => announce('Close. Use the arrows.') },
    {
      keys: [...arrows, 'a', 'b'],
      run: () => announce('Almost. Order matters.'),
    },
    {
      keys: [...'ketchup'],
      run: () => unlockTheme(
        CONDIMENT_KEY,
        condimentTheme,
        'Ketchup and Mustard theme unlocked. It is a hot dog. We are all very sorry.',
        'The condiments are already out.',
      ),
    },
    {
      keys: [...arrows, 'b', 'a'],
      run: () => unlockTheme(
        KONAMI_KEY,
        konamiTheme,
        '1998 theme unlocked. Some things do improve with age. Preserved by NamelessNanashi.',
        'Achievement already achieved.',
      ),
    },
  ];
  const positions = sequences.map(() => 0);
  const ownerPrefix = document.querySelector('[data-owner-prefix]');
  let signatureClicks = 0;
  ownerSignature?.addEventListener('click', (event) => {
    event.preventDefault();
    signatureClicks += 1;
    if (signatureClicks < 7) return;
    signatureClicks = 0;
    if (ownerPrefix) ownerPrefix.textContent = 'Still Operated by';
    announce('NamelessNanashi keeps working on this site.');
    clearTimeout(ownerTimer);
    ownerTimer = setTimeout(() => {
      if (ownerPrefix) ownerPrefix.textContent = 'Operated by';
    }, 1500);
  });
  let headingClicks = 0;
  ownerHeading?.addEventListener('click', () => {
    headingClicks += 1;
    if (headingClicks < 7) return;
    headingClicks = 0;
    const original = ownerHeading.textContent;
    ownerHeading.textContent = 'Yes, this is the Owner.';
    announce('Yes, this is still the Owner.');
    setTimeout(() => { ownerHeading.textContent = original; }, 1500);
  });
  let badgeVisits = 0;
  const visitOwnerBadge = () => {
    badgeVisits += 1;
    if (badgeVisits >= 5) {
      const tooltip = ownerBadge?.nextElementSibling;
      if (tooltip) tooltip.textContent = 'still wrote this bit';
    }
  };
  ownerBadge?.addEventListener('mouseenter', visitOwnerBadge);
  ownerBadge?.addEventListener('focus', visitOwnerBadge);
  window.addEventListener('offline', () => announce('NamelessNanashi cannot fix your Wi-Fi.'));
  window.addEventListener('online', () => announce('Connection restored. NamelessNanashi accepts the credit.'));
  shortcuts?.querySelector('[data-shortcuts-close]')?.addEventListener('click', () => shortcuts.close());
  document.addEventListener('keydown', (event) => {
    const editable = event.target instanceof HTMLElement
      && (event.target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName));
    if (!editable && event.shiftKey && event.key === '?' && shortcuts && typeof shortcuts.showModal === 'function') {
      event.preventDefault();
      if (shortcuts.open && shortcutsHeading) {
        shortcutsHeading.textContent = 'You are already here.';
        clearTimeout(headingTimer);
        headingTimer = setTimeout(() => { shortcutsHeading.textContent = 'Keyboard shortcuts'; }, 1500);
      } else if (!document.querySelector('dialog[open]')) shortcuts.showModal();
      return;
    }
    if (editable || event.repeat) return;
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    sequences.forEach((entry, index) => {
      positions[index] = key === entry.keys[positions[index]]
        ? positions[index] + 1
        : (key === entry.keys[0] ? 1 : 0);
      if (positions[index] !== entry.keys.length) return;
      positions[index] = 0;
      entry.run();
    });
  });
}

function wirePageEggs() {
  const seasonal = document.querySelector('[data-seasonal-easter]');
  if (seasonal) {
    const today = new Date();
    if (today.getMonth() === 1 && today.getDate() === 29) {
      seasonal.textContent = 'This message appears approximately once every four years.';
      seasonal.hidden = false;
    } else if (today.getMonth() === 2 && today.getDate() === 14) {
      seasonal.textContent = 'Approximately 3.14 people are reading this.';
      seasonal.hidden = false;
    } else if (today.getMonth() === 3 && today.getDate() === 1) {
      seasonal.textContent = 'Everything here is true, except False.';
      seasonal.hidden = false;
    } else if (today.getMonth() === 0 && today.getDate() === 1) {
      seasonal.textContent = 'Epoch says happy birthday.';
      seasonal.hidden = false;
    } else if (today.getMonth() === 2 && today.getDate() === 31) {
      seasonal.textContent = 'Transgender Day of Visibility. You are seen, and you are welcome here.';
      seasonal.hidden = false;
    } else if (today.getMonth() === 10 && today.getDate() === 20) {
      seasonal.textContent = 'Transgender Day of Remembrance. We remember the names, and the people who chose them.';
      seasonal.hidden = false;
    }
  }

  const now = new Date();
  const hour = now.getHours();
  if (hour >= 2 && hour < 4 && readSession('np-easter-late-night') !== 'yes') {
    writeSession('np-easter-late-night', 'yes');
    announceEaster('Go to sleep. The profile will still be here tomorrow.');
  }

  const clockEggs = {
    '13:37': 'Leet o\'clock.',
    '04:04': 'Time not found.',
    '11:11': 'Make a wish. Or do not.',
  };
  const clock = `${String(hour).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  if (clockEggs[clock] && readSession(`np-easter-clock:${clock}`) !== 'yes') {
    writeSession(`np-easter-clock:${clock}`, 'yes');
    announceEaster(clockEggs[clock]);
  }

  let plusAnnounced = readSession('np-easter-plus-address') === 'yes';
  document.addEventListener('input', (event) => {
    const field = event.target;
    if (plusAnnounced || !(field instanceof HTMLInputElement) || field.type !== 'email') return;
    if (!/^[^@\s]+\+[^@\s]*@[^@\s]+\.[^@\s]+$/.test(field.value.trim())) return;
    plusAnnounced = true;
    writeSession('np-easter-plus-address', 'yes');
    announceEaster('Plus addressing. A person of taste.');
  });

  const consentForm = document.querySelector('form[action="/consent"]');
  if (consentForm) {
    const openedAt = Date.now();
    const consentNote = document.createElement('p');
    consentNote.className = 'fineprint';
    consentNote.hidden = true;
    consentForm.append(consentNote);
    consentForm.addEventListener('change', () => {
      const boxes = [...consentForm.querySelectorAll('input[type="checkbox"]')];
      if (consentNote.hidden === false || !boxes.length || !boxes.every((box) => box.checked)) return;
      if (Date.now() - openedAt >= 2000) return;
      consentNote.textContent = 'You did not read it. It is short, so try.';
      consentNote.hidden = false;
    });
  }

  const legalDocument = document.querySelector('.legal-document');
  if (legalDocument) {
    const key = `np-easter-policy-read:${location.pathname}`;
    const checkRead = () => {
      const bottom = legalDocument.getBoundingClientRect().bottom;
      if (bottom - window.innerHeight > 4 || readSession(key) === 'yes') return;
      writeSession(key, 'yes');
      window.removeEventListener('scroll', checkRead);
      announceEaster('You read it. Genuinely rare.');
    };
    window.addEventListener('scroll', checkRead, { passive: true });
  }

  document.querySelector('[data-404-return]')?.addEventListener('click', () => {
    write('np-easter-404-returns', JSON.stringify({ count: Math.min(3, read404Returns() + 1), updatedAt: Date.now() }));
  });
  if (location.pathname === '/' && read404Returns() >= 3) {
    write('np-easter-404-returns', null);
    announceEaster('The missing page was safely returned. Repeatedly.');
  }

  const profile = document.querySelector('[data-profile-page]');
  if (profile) {
    const username = profile.dataset.profileUsername || '';
    const key = `np-easter-profile-visits:${username}`;
    const visits = Number(readSession(key) || 0) + 1;
    writeSession(key, String(visits));
    if (visits === 7) announceEaster('You two have met before.');
    if (username === 'infinity') setTimeout(() => announceEaster('Still going.'), 60 * 1000);
  }

  const avatar = document.querySelector('[data-profile-avatar]');
  let avatarVisits = 0;
  avatar?.addEventListener('click', () => {
    avatarVisits += 1;
    if (avatarVisits < 7) return;
    avatarVisits = 0;
    avatar.classList.add('is-mirrored');
    announceEaster('Identity check inconclusive.');
    setTimeout(() => avatar.classList.remove('is-mirrored'), 1500);
  });

  const focusable = () => [...document.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])')]
    .filter((element) => !element.hidden && element.getClientRects().length > 0);
  const keyboardVisited = { forward: new Set(), reverse: new Set() };
  const lapStart = { forward: null, reverse: null };
  let tabDirection = null;
  document.addEventListener('keydown', (event) => {
    tabDirection = event.key === 'Tab' ? (event.shiftKey ? 'reverse' : 'forward') : null;
  });
  document.addEventListener('focusin', (event) => {
    if (!tabDirection) return;
    const direction = tabDirection;
    tabDirection = null;
    const current = focusable();
    if (!current.includes(event.target)) return;
    if (!lapStart[direction]) lapStart[direction] = event.target;
    keyboardVisited[direction].add(event.target);
    const storageKey = direction === 'reverse' ? 'np-easter-keyboard-lap-reverse' : 'np-easter-keyboard-lap';
    if (event.target === lapStart[direction] && keyboardVisited[direction].size >= current.length && readSession(storageKey) !== 'yes') {
      writeSession(storageKey, 'yes');
      announceEaster(direction === 'reverse' ? 'Keyboard lap completed in reverse.' : 'Full keyboard lap completed.');
    }
  });

  const checkErrorDimensions = () => {
    if (window.innerWidth === 404 && window.innerHeight === 418 && readSession('np-easter-error-dimensions') !== 'yes') {
      writeSession('np-easter-error-dimensions', 'yes');
      announceEaster('Not found, but properly steeped.');
    }
  };
  window.addEventListener('resize', checkErrorDimensions);
  checkErrorDimensions();
}

window.npAccessibility = { exportSettings, importSettings, contrastRatio, applyAll, announceEaster };
function wire() {
  wirePanel();
  wireKeyboardEggs();
  wirePageEggs();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
else wire();
