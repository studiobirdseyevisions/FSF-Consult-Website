/* "Apply" buttons.
 *
 * Any element with data-apply sends the student straight to Unicaf's application form through
 * FSF's tracking link, so Unicaf credits FSF. No details are collected on FSF's side first.
 *
 * To change the tracking link, edit APPLY_LINK below — it is the only place it lives.
 */
(function () {
  const APPLY_LINK = 'https://link.unicaf.org/fsfwa';

  function go() { window.location.href = APPLY_LINK; }

  document.querySelectorAll('[data-apply]').forEach(el => {
    el.hidden = false;
    if (el.tagName === 'A') el.href = APPLY_LINK;
    el.addEventListener('click', e => {
      e.preventDefault();
      const parent = el.closest('dialog');
      if (parent) parent.close();
      go();
    });
  });
  window.FSFApply = { open: go };
})();
