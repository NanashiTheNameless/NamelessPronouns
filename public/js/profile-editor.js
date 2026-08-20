const MAX_ROWS = 25;
const PRONOUN_FIELDS = ['subject', 'object', 'possessive_determiner', 'possessive_pronoun', 'reflexive'];
const PRONOUN_DATA_FIELDS = ['subject', 'object', 'possessiveDeterminer', 'possessivePronoun', 'reflexive'];

const INVISIBLE = /[\p{C}\p{M}\p{Z}]/u;
const PATTERN_CLASS = /^(\[(?:[^\]\\]|\\.)+\])[*+]$/;

function compile(source) {
  try {
    return new RegExp(source, 'u');
  } catch {
    try {
      return new RegExp(source);
    } catch {
      return null;
    }
  }
}

function allowedCharacter(field) {
  if (field.dataset.characterSet) return compile(field.dataset.characterSet);
  const pattern = PATTERN_CLASS.exec(field.getAttribute('pattern') || '');
  return pattern ? compile(pattern[1]) : null;
}

function illegalCharacters(field) {
  const allowed = allowedCharacter(field);
  if (!allowed) return [];
  const found = [];
  for (const character of field.value) {
    if (allowed.test(character) || found.includes(character)) continue;
    found.push(character);
  }
  return found;
}

function characterLabel(character) {
  const hex = character.codePointAt(0).toString(16).toUpperCase().padStart(4, '0');
  return INVISIBLE.test(character) ? `U+${hex}` : `"${character}" (U+${hex})`;
}

function characterList(found) {
  const shown = found.slice(0, 8).map(characterLabel).join(', ');
  const overflow = found.length > 8 ? `, and ${found.length - 8} more` : '';
  return `Remove ${found.length === 1 ? 'this character' : 'these characters'}: ${shown}${overflow}`;
}

function constraintMessage(field) {
  if (field.value.length === 0) return '';
  const hint = field.dataset.characterHint || '';
  const found = illegalCharacters(field);
  if (found.length > 0) return hint ? `${hint} ${characterList(found)}.` : `${characterList(found)}.`;
  if (field.validity.patternMismatch) return hint;
  return '';
}

function updateCharacterConstraint(field) {
  const message = constraintMessage(field);
  field.setCustomValidity(message);
  field.toggleAttribute('data-illegal-characters', message !== '');
  if (message) field.setAttribute('aria-invalid', 'true');
  else field.removeAttribute('aria-invalid');
  const report = field.closest('.prose-field')?.querySelector('[data-character-report]');
  if (report) report.textContent = message;
}

function updateCharacterConstraints(root = document) {
  root.querySelectorAll('[data-character-constraint]').forEach(updateCharacterConstraint);
}

function ownRepeater(node) {
  return node.closest('[data-repeater]');
}

function ownElement(repeater, row, selector) {
  for (const element of row.querySelectorAll(selector)) {
    if (ownRepeater(element) === repeater) return element;
  }
  return null;
}

function ownElements(repeater, row, selector) {
  return [...row.querySelectorAll(selector)].filter((element) => ownRepeater(element) === repeater);
}

function renumberWordGroups() {
  document.querySelectorAll('[data-word-group]').forEach((group, index) => {
    group.querySelectorAll('input[name^="word_value_"]').forEach((input) => {
      input.name = `word_value_${index}`;
    });
    group.querySelectorAll('select[name^="word_opinion_"]').forEach((select) => {
      select.name = `word_opinion_${index}`;
    });
  });
}

function rowsContainer(repeater) {
  return [...repeater.querySelectorAll('[data-repeater-rows]')]
    .find((rows) => ownRepeater(rows) === repeater);
}

function updateRepeater(repeater) {
  const container = rowsContainer(repeater);
  const rows = container ? [...container.children] : [];
  rows.forEach((row, index) => {
    const heading = ownElement(repeater, row, '[data-row-heading]');
    if (heading) heading.textContent = `${row.dataset.rowLabel} ${index + 1}`;
    const remove = ownElement(repeater, row, '[data-remove]');
    if (remove) remove.hidden = rows.length === 1;
    ownElements(repeater, row, '[data-move]').forEach((button) => {
      const up = button.dataset.move === 'up';
      button.hidden = rows.length === 1;
      button.disabled = up ? index === 0 : index === rows.length - 1;
      button.setAttribute('aria-label', `Move ${row.dataset.rowLabel} ${index + 1} ${up ? 'up' : 'down'}`);
    });
  });
  const add = ownElement(repeater, repeater, '[data-add]');
  if (add) add.disabled = rows.length >= MAX_ROWS;
}

function updateRepeaters(root = document) {
  root.querySelectorAll('[data-repeater]').forEach(updateRepeater);
}

function ownTemplate(repeater) {
  return ownElement(repeater, repeater, 'template');
}

function announceOrder(message) {
  const status = document.querySelector('[data-repeater-status]');
  if (status) status.textContent = message;
}

function moveRow(button) {
  const repeater = ownRepeater(button);
  const rows = repeater && rowsContainer(repeater);
  const row = button.closest('[data-repeater-row]');
  if (!rows || !row || row.parentElement !== rows) return;
  const siblings = [...rows.children];
  const from = siblings.indexOf(row);
  const to = from + (button.dataset.move === 'up' ? -1 : 1);
  if (to < 0 || to >= siblings.length) return;
  if (to < from) rows.insertBefore(row, siblings[to]);
  else rows.insertBefore(siblings[to], row);
  renumberWordGroups();
  updateRepeater(repeater);
  row.querySelectorAll('[data-repeater]').forEach(updateRepeater);
  announceOrder(`${row.dataset.rowLabel} moved to position ${to + 1} of ${siblings.length}.`);
  if (!button.disabled) button.focus();
  else ownElements(repeater, row, '[data-move]').find((other) => other !== button && !other.disabled)?.focus();
}

document.addEventListener('click', (event) => {
  const add = event.target.closest('[data-add]');
  const remove = event.target.closest('[data-remove]');
  const move = event.target.closest('[data-move]');
  const applyPreset = event.target.closest('[data-apply-pronoun-preset]');
  const flagOption = event.target.closest('[data-flag-option]');
  if (add) {
    const repeater = ownRepeater(add);
    const rows = rowsContainer(repeater);
    const template = ownTemplate(repeater);
    if (repeater && rows && template && rows.children.length < MAX_ROWS) {
      rows.append(template.content.cloneNode(true));
      const row = rows.lastElementChild;
      renumberWordGroups();
      updateRepeater(repeater);
      row.querySelectorAll('[data-repeater]').forEach(updateRepeater);
      updateCharacterConstraints(row);
      row.querySelector('input:not([type="hidden"]), select, summary, button')?.focus();
    }
  }
  if (remove) {
    const repeater = ownRepeater(remove);
    const rows = rowsContainer(repeater);
    if (repeater && rows && rows.children.length > 1) {
      remove.closest('[data-repeater-row]').remove();
      renumberWordGroups();
      updateRepeater(repeater);
    }
  }
  if (move) moveRow(move);
  if (applyPreset) {
    const row = applyPreset.closest('[data-repeater-row]');
    const option = row.querySelector('[data-pronoun-preset]').selectedOptions[0];
    if (option?.value) {
      PRONOUN_FIELDS.forEach((name, index) => {
        const field = row.querySelector(`[name="${name}"]`);
        field.value = option.dataset[PRONOUN_DATA_FIELDS[index]];
        updateCharacterConstraint(field);
      });
      row.querySelector('[name="subject"]').focus();
    }
  }
  if (flagOption) {
    const picker = flagOption.closest('[data-flag-picker]');
    const image = picker.querySelector('[data-flag-selected-image]');
    picker.querySelector('[name="profile_flag"]').value = flagOption.dataset.flagKey;
    picker.querySelector('[data-flag-selected-label]').textContent = flagOption.dataset.flagLabel;
    if (flagOption.dataset.flagImage) image.src = flagOption.dataset.flagImage;
    else image.removeAttribute('src');
    image.hidden = !flagOption.dataset.flagImage;
    picker.querySelectorAll('[data-flag-option]').forEach((option) => {
      option.setAttribute('aria-selected', String(option === flagOption));
    });
    picker.querySelector('details').open = false;
    picker.querySelector('summary').focus();
  }
});

const PLACEHOLDER_PROSE = /lorem\s+ipsum/i;
let placeholderAnnounced = false;
document.addEventListener('input', (event) => {
  if (event.target.matches('[data-character-constraint]')) updateCharacterConstraint(event.target);
  if (!placeholderAnnounced && event.target.matches('textarea') && PLACEHOLDER_PROSE.test(event.target.value)) {
    placeholderAnnounced = true;
    window.npAccessibility?.announceEaster?.('Placeholder detected. You are allowed to be real.');
  }
});
renumberWordGroups();
updateRepeaters();
updateCharacterConstraints();
