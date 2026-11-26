/* "Apply" buttons.
 *
 * Any element with data-apply sends the student straight to Unicaf's application form through
 * FSF's tracking link, so Unicaf credits FSF. No details are collected on FSF's side first.
 * Each click is counted (no personal details: just the page and, if any, the course) in FSF's
 * Google Sheet as type "apply_click", which the sheet's script files in an "Apply clicks" tab.
 *
 * To change the tracking link, edit APPLY_LINK below — it is the only place it lives.
 */
(function () {
  const APPLY_LINK = 'https://link.unicaf.org/fsfwa';
  const SHEET = 'https://script.google.com/macros/s/AKfycbxrtbl-E2Rv7o9htQPBmwVX5n3tqvkfEoLr5PPU3yhsClYQeSZq_7_OOcGBT4_51nipuw/exec';

  function count(course) {
    try {
      const page = (document.title.split('—')[0].trim() || location.pathname);
      navigator.sendBeacon(SHEET, new URLSearchParams({ type: 'apply_click', page, course: course || '' }));
    } catch (e) {}
  }

  function go(course) { count(course); window.location.href = APPLY_LINK; }

  document.querySelectorAll('[data-apply]').forEach(el => {
    el.hidden = false;
    if (el.tagName === 'A') el.href = APPLY_LINK;
    el.addEventListener('click', e => {
      e.preventDefault();
      const parent = el.closest('dialog');
      if (parent) parent.close();
      go(el.dataset.applyCourse || '');
    });
  });
  window.FSFApply = { open: go };
})();
