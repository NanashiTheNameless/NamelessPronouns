function applyFieldMessage(field) {
  const message = field.dataset.invalidMessage;
  if (!message) return;
  field.setCustomValidity('');
  const mismatched = field.validity.patternMismatch
    || field.validity.typeMismatch
    || field.validity.tooShort
    || field.validity.stepMismatch;
  if (mismatched) field.setCustomValidity(message);
}

function applyFieldMessages(root = document) {
  root.querySelectorAll('[data-invalid-message]').forEach(applyFieldMessage);
}

document.addEventListener('input', (event) => {
  if (event.target.matches?.('[data-invalid-message]')) applyFieldMessage(event.target);
});
applyFieldMessages();
