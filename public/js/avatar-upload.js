(() => {
  const form = document.querySelector('#avatar-form');
  if (!form) return;
  const fileInput = document.querySelector('#avatar-file');
  const output = document.querySelector('#avatar-data-uri');
  const preview = document.querySelector('#avatar-preview');
  const size = document.querySelector('#avatar-size');
  const error = document.querySelector('#avatar-error');
  const stripSvg = document.querySelector('#avatar-strip-svg');
  const save = document.querySelector('#avatar-save');
  const maxBytes = Number(form.dataset.maxBytes);
  let processed = form.dataset.currentSource === 'data' ? preview.src : '';
  let pendingSvg = null;
  function showError(message) {
    error.textContent = message;
    error.hidden = !message;
  }
  function encodedBytes(uri) {
    return new TextEncoder().encode(uri).length;
  }
  async function sanitizeSvg(file) {
    const allowedElements = new Set(['svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon']);
    const allowedAttributes = new Set([
      'xmlns', 'viewBox', 'width', 'height', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry',
      'd', 'points', 'fill', 'fill-rule', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin',
      'opacity', 'fill-opacity', 'stroke-opacity', 'transform',
    ]);
    const documentNode = new DOMParser().parseFromString(await file.text(), 'image/svg+xml');
    if (documentNode.querySelector('parsererror') || documentNode.documentElement.localName !== 'svg') {
      throw new Error('The SVG is not valid XML.');
    }
    const warnings = new Set();
    for (const element of documentNode.querySelectorAll('*')) {
      if (!allowedElements.has(element.localName)) {
        warnings.add(`element <${element.localName}>`);
        element.remove();
        continue;
      }
      for (const attribute of [...element.attributes]) {
        if (!allowedAttributes.has(attribute.name) || /[<>&`]|url\s*\(/i.test(attribute.value)) {
          warnings.add(`attribute ${attribute.name}`);
          element.removeAttribute(attribute.name);
          continue;
        }
        if (attribute.name === 'xmlns' && attribute.value !== 'http://www.w3.org/2000/svg') {
          warnings.add('invalid SVG namespace');
          element.removeAttribute(attribute.name);
        }
      }
      for (const child of [...element.childNodes]) {
        if (child.nodeType !== Node.ELEMENT_NODE && !(child.nodeType === Node.TEXT_NODE && !child.textContent.trim())) {
          warnings.add('text, comment, or processing-instruction content');
          child.remove();
        }
      }
    }
    documentNode.documentElement.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    const xml = new XMLSerializer().serializeToString(documentNode.documentElement);
    const bytes = new TextEncoder().encode(xml);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return { uri: `data:image/svg+xml;base64,${btoa(binary)}`, warnings: [...warnings] };
  }
  function acceptProcessed(uri) {
    processed = uri;
    output.value = uri;
    preview.src = uri;
    document.querySelector('input[name="avatar_source"][value="data"]').checked = true;
    size.textContent = `Final encoded size: ${encodedBytes(uri).toLocaleString()} bytes (maximum ${maxBytes.toLocaleString()}).`;
  }
  stripSvg.addEventListener('click', () => {
    if (!pendingSvg) return;
    acceptProcessed(pendingSvg);
    pendingSvg = null;
    stripSvg.hidden = true;
    showError('');
  });
  async function loadImage(file) {
    if ('createImageBitmap' in window) return createImageBitmap(file);
    const uri = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = uri;
    });
  }
  function renderSquare(image) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const context = canvas.getContext('2d', { alpha: true });
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    const width = image.width || image.naturalWidth;
    const height = image.height || image.naturalHeight;
    const side = Math.min(width, height);
    context.drawImage(image, (width - side) / 2, (height - side) / 2, side, side, 0, 0, 256, 256);
    return canvas;
  }
  function compress(canvas) {
    for (const type of ['image/webp', 'image/jpeg']) {
      for (const quality of [0.86, 0.74, 0.62, 0.5, 0.38]) {
        const uri = canvas.toDataURL(type, quality);
        if (uri.startsWith(`data:${type}`) && encodedBytes(uri) <= maxBytes) return uri;
      }
    }
    return null;
  }
  fileInput.addEventListener('change', async () => {
    showError('');
    pendingSvg = null;
    stripSvg.hidden = true;
    const file = fileInput.files?.[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'].includes(file.type)) return showError('Choose a PNG, JPEG, WebP, or SVG image.');
    if (file.size > 10 * 1024 * 1024) return showError('The source image is too large to process safely in the browser.');
    save.disabled = true;
    size.textContent = 'Resizing and compressing locally...';
    try {
      let uri;
      if (file.type === 'image/svg+xml') {
        size.textContent = 'Sanitizing SVG locally...';
        const sanitized = await sanitizeSvg(file);
        uri = sanitized.uri;
        if (encodedBytes(uri) > maxBytes) throw new Error('The sanitized SVG exceeds the storage limit.');
        if (sanitized.warnings.length) {
          processed = '';
          output.value = '';
          pendingSvg = uri;
          size.textContent = 'Preview refused: this SVG contains content that is not allowed for profile icons.';
          showError(`Warning: ${sanitized.warnings.join(', ')} will be removed. The file will not be previewed or saved. Choose “Strip disallowed SVG content” to continue with the sanitized version.`);
          stripSvg.hidden = false;
          return;
        }
      } else {
        const image = await loadImage(file);
        uri = compress(renderSquare(image));
        image.close?.();
        if (!uri) throw new Error('The image could not be compressed below the storage limit.');
      }
      acceptProcessed(uri);
    } catch (err) {
      processed = '';
      output.value = '';
      size.textContent = 'No uploaded image is ready to save.';
      showError(err?.message || 'The image could not be processed.');
    } finally {
      save.disabled = false;
    }
  });
  form.querySelectorAll('input[name="avatar_source"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      if (radio.value === 'inherit' && form.dataset.inherit) preview.src = form.dataset.inherit;
      if (radio.value === 'identicon') preview.src = form.dataset.identicon;
      if (radio.value === 'gravatar') preview.src = form.dataset.gravatar;
      if (radio.value === 'data' && processed) preview.src = processed;
    });
  });
  form.addEventListener('submit', (event) => {
    const source = form.querySelector('input[name="avatar_source"]:checked')?.value;
    if (source === 'data') {
      if (!processed) {
        event.preventDefault();
        showError('Choose and process an image before saving the uploaded-image source.');
        return;
      }
      output.value = processed;
    } else {
      output.value = '';
    }
  });
})();
