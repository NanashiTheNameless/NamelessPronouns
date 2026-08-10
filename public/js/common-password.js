(() => {
  const forms = document.querySelectorAll('form[data-common-password-check]');
  if (!forms.length || !crypto?.subtle) return;
  let indexPromise;
  async function loadIndex() {
    if (!indexPromise) indexPromise = Promise.all([
      fetch('/static/password-wordlists/manifest.json').then((response) => {
        if (!response.ok) throw new Error('Password wordlist manifest unavailable.');
        return response.json();
      }),
      fetch('/static/password-wordlists/index.bin').then((response) => {
        if (!response.ok) throw new Error('Password wordlist index unavailable.');
        return response.arrayBuffer();
      }),
    ]);
    return indexPromise;
  }
  function uint64(bytes, offset) {
    return new DataView(bytes.buffer, bytes.byteOffset + offset, 8).getBigUint64(0, false);
  }
  async function sourceFor(password) {
    const [manifest, buffer] = await loadIndex();
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password)));
    const h1 = uint64(digest, 0);
    const h2 = uint64(digest, 8) | 1n;
    const bytes = new Uint8Array(buffer);
    for (const list of manifest.lists) {
      const modulus = BigInt(list.bitCount);
      let present = true;
      for (let i = 0; i < manifest.hashCount; i += 1) {
        const bit = Number((h1 + BigInt(i) * h2) % modulus);
        if (!(bytes[list.offset + (bit >> 3)] & (1 << (bit & 7)))) { present = false; break; }
      }
      if (present) return list.name;
    }
    return null;
  }
  for (const form of forms) {
    const input = form.querySelector('input[name="password"]');
    const message = form.querySelector('[data-common-password-message]');
    if (!input || !message) continue;
    form.addEventListener('submit', async (event) => {
      if (form.dataset.commonPasswordApproved === input.value) return;
      event.preventDefault();
      input.setCustomValidity('');
      message.textContent = 'Checking the local common-password wordlists...';
      try {
        const source = await sourceFor(input.value);
        if (source) {
          const text = `That password was found in a common password wordlist ${source}. Choose another password.`;
          message.textContent = text;
          input.setAttribute('aria-invalid', 'true');
          input.focus();
          return;
        }
        message.textContent = '';
        input.removeAttribute('aria-invalid');
        form.dataset.commonPasswordApproved = input.value;
        form.requestSubmit(event.submitter || undefined);
      } catch {
        const text = 'The common-password check could not run. Reload the page and try again.';
        message.textContent = text;
        input.setAttribute('aria-invalid', 'true');
        input.focus();
      }
    });
    input.addEventListener('input', () => {
      input.setCustomValidity('');
      input.removeAttribute('aria-invalid');
      delete form.dataset.commonPasswordApproved;
      message.textContent = '';
    });
  }
})();
