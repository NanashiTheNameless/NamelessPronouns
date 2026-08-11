const THEME_KEY = 'np-accessibility-theme';
const FONT_KEY = 'np-accessibility-font';
const COLORS_KEY = 'np-accessibility-colors';
const FAMILY_KEY = 'np-accessibility-font-family';
const THEMES = ['default', 'light', 'contrast', 'contrast-light', 'custom'];
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
  const theme = THEMES.includes(parsed.theme) ? parsed.theme : 'default';
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
  write(FONT_KEY, font);
  write(COLORS_KEY, Object.keys(colors).length ? JSON.stringify(colors) : null);
  write(FAMILY_KEY, family || null);
  applyAll();
  return {
    ok: true,
    dropped,
    message: dropped.length
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
  const sync = () => {
    check('accessibility_theme', choice(THEME_KEY, THEMES));
    check('accessibility_font', choice(FONT_KEY, FONTS));
    const colors = storedColors();
    for (const key of COLOR_KEYS) {
      const field = form.querySelector(`[name="accessibility_color_${key}"]`);
      if (field) field.value = colors[key] || '';
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
    const field = event.target;
    if (field.name === 'accessibility_theme' && THEMES.includes(field.value)) write(THEME_KEY, field.value);
    if (field.name === 'accessibility_font' && FONTS.includes(field.value)) write(FONT_KEY, field.value);
    applyAll();
    sync();
  });
  form.addEventListener('input', (event) => {
    const field = event.target;
    const colorKey = /^accessibility_color_(\w+)$/.exec(field.name || '')?.[1];
    if (colorKey && COLOR_KEYS.includes(colorKey)) {
      const colors = storedColors();
      const value = field.value.trim();
      if (value === '') delete colors[colorKey];
      else if (HEX.test(value)) colors[colorKey] = value.toLowerCase();
      else return say(status, `${field.dataset.colorLabel || 'That color'} needs an HTML color code such as #1a2b3c.`);
      write(COLORS_KEY, Object.keys(colors).length ? JSON.stringify(colors) : null);
      say(status, '');
      applyAll();
      if (transfer) transfer.value = JSON.stringify(exportSettings(), null, 2);
      return reportContrast();
    }
    if (field.name === 'accessibility_font_family') {
      const family = validFamily(field.value);
      if (field.value.trim() !== '' && !family) {
        return say(status, 'A font family may contain only letters, numbers, spaces, commas, quotes, and hyphens.');
      }
      write(FAMILY_KEY, family || null);
      say(status, '');
      applyAll();
      if (transfer) transfer.value = JSON.stringify(exportSettings(), null, 2);
    }
    return undefined;
  });
  dialog.querySelector('[data-accessibility-copy]')?.addEventListener('click', async () => {
    if (transfer) transfer.value = JSON.stringify(exportSettings(), null, 2);
    try {
      await navigator.clipboard.writeText(transfer.value);
      say(status, 'Settings copied to your clipboard.');
    } catch {
      transfer?.select();
      say(status, 'Copying was blocked, so the settings are selected for you to copy.');
    }
  });
  dialog.querySelector('[data-accessibility-import]')?.addEventListener('click', () => {
    const result = importSettings(transfer ? transfer.value : '');
    say(status, result.message);
    sync();
  });
  dialog.querySelector('[data-accessibility-reset]')?.addEventListener('click', () => {
    write(THEME_KEY, null);
    write(FONT_KEY, null);
    write(COLORS_KEY, null);
    write(FAMILY_KEY, null);
    applyAll();
    say(status, 'Everything is back to the site defaults.');
    sync();
  });
  dialog.querySelector('[data-accessibility-close]')?.addEventListener('click', () => dialog.close());
  sync();
}

window.npAccessibility = { exportSettings, importSettings, contrastRatio, applyAll };
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wirePanel);
else wirePanel();
