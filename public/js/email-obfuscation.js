import '/static/vendor/altcha/obfuscation.js';
import '/static/vendor/altcha/widget.js';
await customElements.whenDefined('altcha-widget');
await new Promise((resolve) => requestAnimationFrame(resolve));
for (const widget of document.querySelectorAll('altcha-widget.email-obfuscation')) {
  widget.querySelector('.email-reveal')?.click();
}
