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
    if (manifest.version !== 3) throw new Error('Password wordlist index version is unsupported.');
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password)));
    const first = uint64(digest, 0);
    const second = uint64(digest, 8);
    const third = uint64(digest, 16);
    const bytes = new Uint8Array(buffer);
    for (const list of manifest.lists) {
      const modulus = BigInt(list.bitCount);
      let bit = first % modulus;
      let step = (second % (modulus - 1n)) + 1n;
      const stepDelta = (third % (modulus - 1n)) + 1n;
      let present = true;
      for (let i = 0; i < manifest.hashCount; i += 1) {
        const at = Number(bit);
        if (!(bytes[list.offset + (at >> 3)] & (1 << (at & 7)))) { present = false; break; }
        bit = (bit + step) % modulus;
        step = (step + stepDelta) % modulus;
      }
      if (present) return list;
    }
    return null;
  }
  const QUIPS = {
    'Password@123': ' Bold, classic, and already in every list.',
    'g00dPa$$w0rD': ' Leetspeak fools no one. Also in the list.',
  };
  function falseMatchOdds(list) {
    const rate = Number(list.falsePositiveRate);
    if (!Number.isFinite(rate) || rate <= 0) return '';
    return ` This check can misfire: about 1 in ${Math.round(1 / rate).toLocaleString('en-US')} unrelated passwords are reported by mistake.`;
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
          const text = `That password was found in a common password wordlist ${source.name}. Choose another password.${falseMatchOdds(source)}${QUIPS[input.value] || ''}`;
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
