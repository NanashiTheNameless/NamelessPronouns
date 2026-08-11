const THEME_KEY = 'np-accessibility-theme';
const FONT_KEY = 'np-accessibility-font';
const COLORS_KEY = 'np-accessibility-colors';
const FAMILY_KEY = 'np-accessibility-font-family';
const KONAMI_KEY = 'np-accessibility-konami';
const THEMES = ['default', 'light', 'contrast', 'contrast-light', '1998', 'custom'];
const FONTS = ['default', 'sans', 'serif', 'mono', 'custom'];
const HEX = /^#[0-9a-f]{6}$/i;
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

function storedColors() {
  try {
    return validColors(JSON.parse(readRaw(COLORS_KEY) || '{}'));
  } catch {
    return {};
  }
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

function applyCustom(colors, family) {
  const root = document.documentElement;
  for (const [key, property] of Object.entries(COLORS)) {
    if (colors[key]) root.style.setProperty(property, colors[key]);
    else root.style.removeProperty(property);
  }
  if (colors.bg) root.style.colorScheme = relativeLuminance(colors.bg) > 0.35 ? 'light' : 'dark';
  else root.style.removeProperty('color-scheme');
  if (family) root.style.setProperty('--font-body', `${family}, "0xProto", monospace`);
  else root.style.removeProperty('--font-body');
}

function applyAll() {
  const root = document.documentElement;
  const theme = choice(THEME_KEY, THEMES);
  const font = choice(FONT_KEY, FONTS);
  if (theme === 'default') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
  if (font === 'default') root.removeAttribute('data-font');
  else root.setAttribute('data-font', font);
  applyCustom(
    theme === 'custom' ? storedColors() : {},
    font === 'custom' ? validFamily(readRaw(FAMILY_KEY)) : '',
  );
  return { theme, font };
}

applyAll();

function exportSettings() {
  return {
    version: 1,
    theme: choice(THEME_KEY, THEMES),
    font: choice(FONT_KEY, FONTS),
    colors: storedColors(),
    fontFamily: validFamily(readRaw(FAMILY_KEY)),
  };
}

function importSettings(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, message: 'That is not valid settings text. Copy the whole block, including the braces.' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, message: 'Settings text must be a single block of settings.' };
  }
  const from1998 = Number(parsed.version) === 1998;
  const theme = from1998 ? '1998' : (THEMES.includes(parsed.theme) ? parsed.theme : 'default');
  const font = FONTS.includes(parsed.font) ? parsed.font : 'default';
  const colors = validColors(parsed.colors);
  const family = validFamily(parsed.fontFamily);
  const dropped = [];
  if (parsed.theme && !THEMES.includes(parsed.theme)) dropped.push('theme');
  if (parsed.font && !FONTS.includes(parsed.font)) dropped.push('font');
  if (parsed.colors && Object.keys(validColors(parsed.colors)).length < Object.keys(parsed.colors).length) {
    dropped.push('colors that are not #rrggbb');
  }
  if (parsed.fontFamily && !family) dropped.push('font family');
  write(THEME_KEY, theme);
  if (from1998) write(KONAMI_KEY, 'unlocked');
  write(FONT_KEY, font);
  write(COLORS_KEY, Object.keys(colors).length ? JSON.stringify(colors) : null);
  write(FAMILY_KEY, family || null);
  applyAll();
  return {
    ok: true,
    dropped,
    message: from1998
      ? 'Settings recovered from 1998.'
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
  let resetCount = 0;
  let copyCount = 0;
  if (konamiTheme && readRaw(KONAMI_KEY) === 'unlocked') konamiTheme.hidden = false;
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
    dialog.querySelectorAll('[data-accessibility-colors]').forEach((node) => { node.hidden = theme !== 'custom'; });
    dialog.querySelectorAll('[data-accessibility-family]').forEach((node) => { node.hidden = font !== 'custom'; });
  };
  const syncPicker = (key, value) => {
    const picker = form.querySelector(`[data-color-picker="${key}"]`);
    if (!picker) return;
    if (value && HEX.test(value)) {
      picker.value = value;
      return;
    }
    const active = getComputedStyle(document.documentElement).getPropertyValue(COLORS[key]).trim();
    picker.value = HEX.test(active) ? active : '#000000';
  };
  const sync = () => {
    if (konamiTheme && readRaw(KONAMI_KEY) === 'unlocked') konamiTheme.hidden = false;
    check('accessibility_theme', choice(THEME_KEY, THEMES));
    check('accessibility_font', choice(FONT_KEY, FONTS));
    const colors = storedColors();
    for (const key of COLOR_KEYS) {
      const field = form.querySelector(`[name="accessibility_color_${key}"]`);
      if (field) field.value = colors[key] || '';
      syncPicker(key, colors[key]);
    }
    const family = form.querySelector('[name="accessibility_font_family"]');
    if (family) family.value = validFamily(readRaw(FAMILY_KEY));
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
    resetCount = 0;
    copyCount = 0;
    const field = event.target;
    if (field.name === 'accessibility_theme' && THEMES.includes(field.value)) write(THEME_KEY, field.value);
    if (field.name === 'accessibility_font' && FONTS.includes(field.value)) write(FONT_KEY, field.value);
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
      else return say(status, `${field.dataset.colorLabel || 'That color'} needs an HTML color code such as #1a2b3c.`);
      write(COLORS_KEY, Object.keys(colors).length ? JSON.stringify(colors) : null);
      const quips = {
        '#c0ffee': 'Coffee detected. No beans were harmed.',
        '#bada55': 'That color has excellent credentials.',
        '#0ff1ce': 'Office hours are over.',
        '#facade': 'The facade is holding up.',
        '#decade': 'A decade fits neatly into six hex digits.',
        '#deface': 'No faces were harmed in the selection of this color.',
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
      };
      say(status, fontQuips[family.toLowerCase()] || '');
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
  });
  dialog.querySelector('[data-accessibility-reset]')?.addEventListener('click', () => {
    copyCount = 0;
    resetCount += 1;
    write(THEME_KEY, null);
    write(FONT_KEY, null);
    write(COLORS_KEY, null);
    write(FAMILY_KEY, null);
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
  const status = document.querySelector('[data-accessibility-status]');
  const easterStatus = document.querySelector('[data-easter-status]');
  const ownerSignature = document.querySelector('[data-owner-signature]');
  const ownerHeading = document.querySelector('[data-owner-heading]');
  const ownerBadge = document.querySelector('[data-owner-badge]');
  const shortcutsHeading = shortcuts?.querySelector('h2');
  const sequence = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
  let position = 0;
  let nanashiPosition = 0;
  let answerPosition = 0;
  let headingTimer;
  let ownerTimer;
  let toastTimer;
  const nanashiSequence = [...'nanashi'];
  const answerSequence = ['4', '2'];
  const announce = (message) => {
    if (!easterStatus) return;
    clearTimeout(toastTimer);
    easterStatus.textContent = message;
    easterStatus.classList.add('is-visible');
    if (typeof easterStatus.showPopover === 'function' && !easterStatus.matches(':popover-open')) {
      easterStatus.showPopover();
    }
    toastTimer = setTimeout(() => {
      if (typeof easterStatus.hidePopover === 'function' && easterStatus.matches(':popover-open')) {
        easterStatus.hidePopover();
      }
      easterStatus.classList.remove('is-visible');
      easterStatus.textContent = '';
    }, 4000);
  };
  let signatureClicks = 0;
  ownerSignature?.addEventListener('click', (event) => {
    event.preventDefault();
    signatureClicks += 1;
    if (signatureClicks < 7) return;
    signatureClicks = 0;
    ownerSignature.textContent = 'Still NamelessNanashi';
    announce('NamelessNanashi remains operational.');
    clearTimeout(ownerTimer);
    ownerTimer = setTimeout(() => { ownerSignature.textContent = 'NamelessNanashi'; }, 1500);
  });
  let headingClicks = 0;
  ownerHeading?.addEventListener('click', () => {
    headingClicks += 1;
    if (headingClicks < 7) return;
    headingClicks = 0;
    const original = ownerHeading.textContent;
    ownerHeading.textContent = 'Yes, this is the Owner.';
    announce('Yes, this is the Owner.');
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
    nanashiPosition = key === nanashiSequence[nanashiPosition]
      ? nanashiPosition + 1
      : (key === nanashiSequence[0] ? 1 : 0);
    if (nanashiPosition === nanashiSequence.length) {
      nanashiPosition = 0;
      announce('Owner located. Please allow 3-5 business eternities for a response.');
    }
    answerPosition = key === answerSequence[answerPosition]
      ? answerPosition + 1
      : (key === answerSequence[0] ? 1 : 0);
    if (answerPosition === answerSequence.length) {
      answerPosition = 0;
      announce('You have the answer. The question remains unavailable.');
    }
    position = key === sequence[position] ? position + 1 : (key === sequence[0] ? 1 : 0);
    if (position !== sequence.length) return;
    position = 0;
    const alreadyUnlocked = readRaw(KONAMI_KEY) === 'unlocked';
    write(KONAMI_KEY, 'unlocked');
    if (konamiTheme) konamiTheme.hidden = false;
    const message = alreadyUnlocked
      ? 'Achievement already achieved.'
      : '1998 theme unlocked. Some things do improve with age. Preserved by NamelessNanashi.';
    if (status) status.textContent = message;
    announce(message);
    if (accessibility?.open) konamiTheme?.querySelector('input')?.focus();
  });
}

window.npAccessibility = { exportSettings, importSettings, contrastRatio, applyAll };
function wire() {
  wirePanel();
  wireKeyboardEggs();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
else wire();
