const MAX_ROWS = 25;
const PRONOUN_FIELDS = ['subject', 'object', 'possessive_determiner', 'possessive_pronoun', 'reflexive'];
const PRONOUN_DATA_FIELDS = ['subject', 'object', 'possessiveDeterminer', 'possessivePronoun', 'reflexive'];

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
    if (add && rows.children.length < MAX_ROWS) {
      rows.append(template.content.cloneNode(true));
      updateRepeater(repeater);
      rows.lastElementChild.querySelector('input')?.focus();
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
          row.querySelector(`[name="${name}"]`).value = option.dataset[PRONOUN_DATA_FIELDS[index]];
        });
        row.querySelector('[name="subject"]').focus();
      }
    }
  });
  updateRepeater(repeater);
});
