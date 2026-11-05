(function () {
  var forms = document.querySelectorAll('form[data-x-request]');
  forms.forEach(function (form) {
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      if (!form.reportValidity()) return;
      var title = form.closest('section').querySelector('h2');
      var lines = [title ? title.textContent.trim() : 'Request'];
      form.querySelectorAll('input, textarea, select').forEach(function (el) {
        var v = (el.value || '').trim();
        if (v) lines.push(el.name + ': ' + v);
      });
      var text = lines.join('\n');
      var status = form.parentNode.querySelector('[data-x-status]');
      var done = function (ok) {
        if (status) {
          status.textContent = ok
            ? 'Copied. Paste it in a direct message to @S1R1US_AI on X (opened in a new tab).'
            : 'Copy did not work. Select your answers above and send them by direct message to @S1R1US_AI on X.';
        }
        window.open('https://x.com/S1R1US_AI', '_blank', 'noopener');
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
      } else {
        done(false);
      }
    });
  });
})();
