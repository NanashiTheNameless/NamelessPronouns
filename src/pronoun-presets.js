export const PRONOUN_PRESETS = Object.freeze([
  preset('he/him', 'he/him', ['he', 'him', 'his', 'his', 'himself'], ['he']),
  preset('she/her', 'she/her', ['she', 'her', 'her', 'hers', 'herself'], ['she']),
  preset('they/them', 'they/them (themselves)', ['they', 'them', 'their', 'theirs', 'themselves'], ['they']),
  preset('they/them/themself', 'they/them (themself)', ['they', 'them', 'their', 'theirs', 'themself']),
  preset('it/its', 'it/its', ['it', 'it', 'its', 'its', 'itself'], ['it', 'it/it']),
  preset('xe/xem', 'xe/xem', ['xe', 'xem', 'xyr', 'xyrs', 'xemself'], ['xe']),
  preset('ze/hir', 'ze/hir', ['ze', 'hir', 'hir', 'hirs', 'hirself'], ['ze']),
  preset('ze/zir', 'ze/zir', ['ze', 'zir', 'zir', 'zirs', 'zirself']),
  preset('fae/faer', 'fae/faer', ['fae', 'faer', 'faer', 'faers', 'faerself'], ['fae']),
  preset('ey/em', 'ey/em', ['ey', 'em', 'eir', 'eirs', 'emself'], ['ey']),
  preset("one/one's", "one/one's", ['one', 'one', "one's", "one's", 'oneself'], ['one']),
  preset('ae/aer', 'ae/aer', ['ae', 'aer', 'aer', 'aers', 'aerself'], ['ae']),
  preset('co/cos', 'co/cos', ['co', 'co', 'cos', "co's", 'coself'], ['co']),
  preset('e/em/eir', 'e/em/eir', ['e', 'em', 'eir', 'eirs', 'emself'], ['e']),
  preset('e/em/es', 'e/em/es', ['e', 'em', 'es', 'es', 'emself']),
  preset('hu/hum', 'hu/hum', ['hu', 'hum', 'hus', 'hus', 'huself'], ['hu']),
  preset('ne/nem', 'ne/nem', ['ne', 'nem', 'nir', 'nirs', 'nemself'], ['ne']),
  preset('ne/nir', 'ne/nir', ['ne', 'nir', 'nir', 'nirs', 'nirself']),
  preset('per/per', 'per/per', ['per', 'per', 'per', 'pers', 'perself'], ['per']),
  preset('s/he/hir', 's/he/hir', ['s/he', 'hir', 'hir', 'hirs', 'hirself'], ['s/he']),
  preset('thon/thons', 'thon/thons', ['thon', 'thon', 'thons', "thon's", 'thonself'], ['thon']),
  preset('ve/ver', 've/ver', ['ve', 'ver', 'vis', 'vis', 'verself'], ['ve']),
  preset('vi/vir', 'vi/vir', ['vi', 'vir', 'vis', 'virs', 'virself'], ['vi']),
  preset('vi/vim', 'vi/vim', ['vi', 'vim', 'vis', 'vims', 'vimself']),
  preset('zhe/zher', 'zhe/zher', ['zhe', 'zher', 'zher', 'zhers', 'zherself'], ['zhe']),
  preset('ki/kin', 'ki/kin', ['ki', 'kin', 'kins', 'kins', 'kinself'], ['ki']),
]);

function preset(key, label, forms, aliases = []) {
  return Object.freeze({ key, label, forms: Object.freeze(forms), aliases: Object.freeze([key, ...aliases]) });
}

const PRESETS_BY_ALIAS = new Map(PRONOUN_PRESETS.flatMap((entry) => entry.aliases.map((alias) => [alias.toLowerCase(), entry.forms])));

export function pronounPresetForms(value) {
  const normalized = String(value || '').trim().toLowerCase().replaceAll('\u00e6', 'ae');
  return PRESETS_BY_ALIAS.get(normalized) || null;
}
