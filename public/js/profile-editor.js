const MAX_ROWS = 25;
const PRONOUN_FIELDS = ['subject', 'object', 'possessive_determiner', 'possessive_pronoun', 'reflexive'];
const PRONOUN_DATA_FIELDS = ['subject', 'object', 'possessiveDeterminer', 'possessivePronoun', 'reflexive'];

function updateCharacterConstraint(field) {
  const illegal = field.value.length > 0 && field.validity.patternMismatch;
  field.toggleAttribute('data-illegal-characters', illegal);
  if (illegal) field.setAttribute('aria-invalid', 'true');
  else field.removeAttribute('aria-invalid');
}

function updateCharacterConstraints(root = document) {
  root.querySelectorAll('[data-character-constraint]').forEach(updateCharacterConstraint);
}

function updateRepeater(repeater) {
  const rows = [...repeater.querySelectorAll('[data-repeater-row]')];
  rows.forEach((row, index) => {
    const heading = row.querySelector('[data-row-heading]');
    if (heading) heading.textContent = `${row.dataset.rowLabel} ${index + 1}`;
    const remove = row.querySelector('[data-remove]');
    if (remove) remove.hidden = rows.length === 1;
  });
  const add = repeater.querySelector('[data-add]');
  if (add) add.disabled = rows.length >= MAX_ROWS;
}

document.querySelectorAll('[data-repeater]').forEach((repeater) => {
  const rows = repeater.querySelector('[data-repeater-rows]');
  const template = repeater.querySelector('template');
  repeater.addEventListener('click', (event) => {
    const add = event.target.closest('[data-add]');
    const remove = event.target.closest('[data-remove]');
    const applyPreset = event.target.closest('[data-apply-pronoun-preset]');
    const flagOption = event.target.closest('[data-flag-option]');
    if (add && rows.children.length < MAX_ROWS) {
      rows.append(template.content.cloneNode(true));
      updateRepeater(repeater);
      rows.lastElementChild.querySelector('input:not([type="hidden"]), summary, button')?.focus();
    }
    if (remove && rows.children.length > 1) {
      remove.closest('[data-repeater-row]').remove();
      updateRepeater(repeater);
    }
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
  updateRepeater(repeater);
});

document.addEventListener('input', (event) => {
  if (event.target.matches('[data-character-constraint]')) updateCharacterConstraint(event.target);
});
updateCharacterConstraints();
