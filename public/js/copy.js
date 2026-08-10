(function () {
  'use strict';
  document.querySelectorAll('button.copy[data-copy]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var text = btn.getAttribute('data-copy');
      if (navigator.clipboard) navigator.clipboard.writeText(text).catch(function () {});
      var prev = btn.textContent;
      btn.textContent = 'Copied';
      setTimeout(function () { btn.textContent = prev; }, 1200);
    });
  });
})();
