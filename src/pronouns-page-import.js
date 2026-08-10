import { pronounPresetForms } from './pronoun-presets.js';
import { DEFAULT_OPINION, importedOpinion } from './opinions.js';
const MAX_ITEMS = 25;
export const PRONOUNS_PAGE_FLAG_OPTIONS = [
  '-Drag', '-de-Gay', '-en-Genderdoe', '-pl-Dukaizmy', '-pl-Gay', '-pl-Rodzaj neutralny', '-pl-Rodzaj nijaki',
  'Abroromantic', 'Abrosexual', 'Achillean', 'Agender', 'Alloromantic Asexual', 'Ambiamorous', 'Ambiamorous_',
  'Anarcha-Queer', 'Androgyne', 'Androsexual', 'Aporagender', 'Archaeopronouns', 'Aroace', 'Aromantic Allosexual',
  'Aromantic', 'Asexual', 'Autigender', 'Bear', 'Bicurious', 'Bigender', 'Bigender_', 'Biromantic', 'Bisexual',
  'Butch', 'Ceteroromantic', 'Ceterosexual', 'Cis Ally', 'Demiboy', 'Demigender', 'Demigirl', 'Demiromantic',
  'Demisexual', 'Diamoric', 'Enbian', "Fa'afafine", 'Femme', 'Gay', 'Gay_', 'Gender Questioning', 'Genderfae',
  'Genderfaun', 'Genderfluid', 'Genderflux', 'Genderqueer', 'Greyaromantic', 'Greyasexual', 'Gynesexual',
  'Heteroflexible', 'Heteroromantic', 'Heterosexual', 'Hijra', 'Homoflexible', 'Homoromantic', 'Intersex', 'LGBTQ',
  'Leather Pride', 'Lesbian', 'Lesbian_', 'Lesbian__', 'Lesbian___', 'Lesbiromantic', 'Maverique', 'Monoamorous',
  'Monogamous', 'Muxe', 'Nebularomantic', 'Neopronouns', 'Neopronouns_', 'Neutrois', 'Nonbinary', 'Omniromantic',
  'Omnisexual', 'Oriented Aroace', 'Pangender', 'Panromantic', 'Pansexual', 'Polyamorous', 'Polyamorous_',
  'Polyamorous__', 'Polyamorous___', 'Polyamorous____', 'Polyromantic', 'Polysexual', 'Pomoromantic', 'Pomosexual',
  'Progress Pride', 'Progress Pride_', 'Queer', 'Queer_', 'Queerian', 'Queerplatonic', 'Quoiromantic', 'Sapphic',
  'Sapphic_', 'Sexuality Questioning', 'Straight Ally', 'Toric', 'Transfeminine', 'Transgender', 'Transmasculine',
  'Transneutral', 'Trigender', 'Trixic', 'Two Spirit', 'Two Spirit_', 'Unlabeled', 'Xenogender',
];
const PRONOUNS_PAGE_FLAG_KEYS = new Set(PRONOUNS_PAGE_FLAG_OPTIONS);
function boundedText(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function localeFromHost(hostname) {
  const match = /^([a-z]{2,3}(?:-[a-z0-9]+)?)\.pronouns\.page$/i.exec(hostname);
  return match?.[1] || 'en';
}

export function parsePronounsPageReference(input) {
  const raw = String(input || '').trim();
  if (!raw) throw new Error('Enter a Pronouns.page username or profile URL.');
  let username = raw.replace(/^@/, '');
  let locale = 'en';
  const localPath = /^\/?u\/([^/?#]+)\/?$/i.exec(raw);
  if (localPath) username = localPath[1].replace(/^@/, '');
  const schemeLessUrl = /^(?:[a-z]{2,3}(?:-[a-z0-9]+)?\.)?pronouns\.page\//i.test(raw);
  if (/^https?:\/\//i.test(raw) || schemeLessUrl) {
    let url;
    try {
      url = new URL(schemeLessUrl ? `https://${raw}` : raw);
    } catch {
      throw new Error('Enter a valid Pronouns.page profile URL.');
    }
    if (url.protocol !== 'https:' || !/(^|\.)pronouns\.page$/i.test(url.hostname)) {
      throw new Error('Only HTTPS Pronouns.page profile URLs can be imported.');
    }
    locale = localeFromHost(url.hostname);
    const segments = url.pathname.split('/').filter(Boolean);
    const pathUsername = segments.find((segment) => segment.startsWith('@'))
      || (segments[0]?.toLowerCase() === 'u' ? segments[1] : segments[0]);
    username = (pathUsername || '').replace(/^@/, '');
  }
  if (!/^[\p{L}\p{N}_.-]{1,64}$/u.test(username)) throw new Error('That Pronouns.page username is not valid.');
  return { username, locale };
}

function pronounSet(value) {
  const compatibleValue = boundedText(value, 240).replaceAll(/\u00e6/gi, 'ae');
  const normalized = compatibleValue.toLowerCase();
  const known = pronounPresetForms(normalized);
  const parts = known || compatibleValue.split('/').map((part) => part.trim());
  if (parts.length !== 5 || parts.some((part) => !part || part.length > 40)) return null;
  return {
    subject: parts[0],
    object: parts[1],
    possessiveDeterminer: parts[2],
    possessivePronoun: parts[3],
    reflexive: parts[4],
  };
}

function specialPronounPreference(value) {
  const normalized = boundedText(value, 240).toLowerCase();
  if (normalized === 'any' || normalized.startsWith('any:')) return 'any_pronouns';
  if (normalized === 'ask' || normalized === 'ask-me') return 'ask_me';
  if (['avoiding', 'no-pronouns', 'null', 'pronounless', 'nullpronominal'].includes(normalized)) return 'no_pronouns';
  if (normalized === 'mirror' || normalized === 'mirrorpronominal') return 'mirror_pronouns';
  if (normalized.startsWith(':')) return 'use_name';
  return null;
}

function linkRow(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return null;
    return { label: url.hostname.replace(/^www\./, '').replaceAll('.', ' ').slice(0, 80), url: url.href.slice(0, 2048) };
  } catch {
    return null;
  }
}

export function flagLabel(key) {
  return boundedText(key, 80).replace(/^-[a-z]{2,3}-/i, '').replace(/_+$/, '');
}

export function pronounsPageFlagUrl(key) {
  return `/static/flags/${encodeURIComponent(key).replaceAll("'", '%27')}.png`;
}

function entryValue(entry) {
  return typeof entry === 'string' ? entry : entry?.value;
}

function entryOpinion(entry) {
  return typeof entry === 'string' ? importedOpinion(null) : importedOpinion(entry?.opinion);
}

function wordGroup(group) {
  const heading = boundedText(group?.header ?? group?.heading, 80);
  const words = (Array.isArray(group?.values) ? group.values : [])
    .slice(0, MAX_ITEMS)
    .map((entry) => ({ value: boundedText(entryValue(entry), 80), opinion: entryOpinion(entry) }))
    .filter((word) => word.value);
  if (!heading || !words.length) return null;
  return { heading, words };
}

export function mapPronounsPageProfile(payload, { locale = 'en', current }) {
  const profiles = Array.isArray(payload?.profiles)
    ? payload.profiles
    : Object.entries(payload?.profiles || {}).map(([profileLocale, profile]) => ({ ...profile, locale: profileLocale }));
  const profile = profiles.find((entry) => entry?.locale === locale)
    || profiles.find((entry) => entry?.locale === 'en')
    || profiles[0];
  if (!profile || profile.access === false) throw new Error('That Pronouns.page profile is unavailable or private.');
  const importedPronouns = (Array.isArray(profile.pronouns) ? profile.pronouns : []).slice(0, MAX_ITEMS);
  const seenPreferences = new Set();
  const pronounPreferences = [];
  for (const entry of importedPronouns) {
    const key = specialPronounPreference(entryValue(entry));
    if (!key || seenPreferences.has(key)) continue;
    seenPreferences.add(key);
    pronounPreferences.push({ key, opinion: entryOpinion(entry) });
  }
  const pronounResults = importedPronouns
    .filter((entry) => !specialPronounPreference(entryValue(entry)))
    .map((entry) => {
      const forms = pronounSet(entryValue(entry));
      return forms ? { ...forms, opinion: entryOpinion(entry) } : null;
    });
  const pronouns = pronounResults.filter(Boolean);
  const links = (Array.isArray(profile.links) ? profile.links : [])
    .slice(0, MAX_ITEMS)
    .map(linkRow)
    .filter(Boolean);
  const importedFlagKeys = (Array.isArray(profile.flags) ? profile.flags : [])
    .slice(0, MAX_ITEMS)
    .map((key) => boundedText(key, 80))
    .filter((key) => /^[A-Za-z0-9 _'-]{1,80}$/.test(key));
  const flags = importedFlagKeys
    .filter((key) => PRONOUNS_PAGE_FLAG_KEYS.has(key))
    .map((key) => ({ key, opinion: importedOpinion(null) }));
  const names = (Array.isArray(profile.names) ? profile.names : [])
    .slice(0, MAX_ITEMS)
    .map((entry) => ({ value: boundedText(entryValue(entry), 80), opinion: entryOpinion(entry) }))
    .filter((entry) => entry.value);
  const importedWords = (Array.isArray(profile.words) ? profile.words : []).slice(0, MAX_ITEMS);
  const words = importedWords.map(wordGroup).filter(Boolean);
  return {
    values: {
      ...current,
      description: boundedText(profile.description, 200),
      names: names.length ? names : [emptyName()],
      pronouns: pronouns.length ? pronouns : [emptyPronoun()],
      pronounPreferences,
      words: words.length ? words : [emptyWordGroup()],
      links: links.length ? links : [emptyLink()],
      flags: flags.length ? flags : [emptyFlag()],
    },
    skippedPronouns: pronounResults.filter((entry) => !entry).length,
    skippedCustomFlags: Array.isArray(profile.customFlags) ? profile.customFlags.length : 0,
    skippedFlags: importedFlagKeys.length - flags.length,
    skippedWordGroups: importedWords.length - words.length,
    locale: profile.locale || locale,
  };
}

export async function fetchPronounsPageProfile(reference, fetchImpl = fetch) {
  const { username, locale } = parsePronounsPageReference(reference);
  const endpoint = `https://en.pronouns.page/api/public/v3/profile/get/${encodeURIComponent(username)}?locale=${encodeURIComponent(locale)}`;
  let response;
  try {
    response = await fetchImpl(endpoint, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(10000) });
  } catch {
    throw new Error('Pronouns.page could not be reached. Try again later.');
  }
  if (response.status === 404) throw new Error('That Pronouns.page profile was not found.');
  if (!response.ok) throw new Error('Pronouns.page could not provide that profile.');
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > 1024 * 1024) throw new Error('The Pronouns.page profile is too large to import.');
  let payload;
  try {
    payload = JSON.parse((await response.text()).slice(0, 1024 * 1024 + 1));
  } catch {
    throw new Error('Pronouns.page returned an invalid profile.');
  }
  return { payload, locale };
}

export function emptyPronoun() {
  return { subject: '', object: '', possessiveDeterminer: '', possessivePronoun: '', reflexive: '', opinion: DEFAULT_OPINION };
}

export function emptyLink() {
  return { label: '', url: '' };
}

export function emptyName() {
  return { value: '', opinion: DEFAULT_OPINION };
}

export function emptyFlag() {
  return { key: '', opinion: DEFAULT_OPINION };
}

export function emptyWord() {
  return { value: '', opinion: DEFAULT_OPINION };
}

export function emptyWordGroup() {
  return { heading: '', words: [emptyWord()] };
}
