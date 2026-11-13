/* Shared behaviour for every FSF page: language switch, mobile menu, sticky nav, reveal, form sending.
 *
 * Translations live in the HTML:
 *   data-en="..." data-am="..."                     → element text (wrap words in *stars* to make them the lighter <em> style)
 *   data-en-placeholder / data-am-placeholder       → input placeholder
 *   data-en-label / data-am-label                   → aria-label
 */
(function () {
  const html = document.documentElement;
  const KEY = 'fsf-lang';

  const escapeHtml = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const format = s => escapeHtml(s).replace(/\*(.+?)\*/g, '<em>$1</em>');

  function setLanguage(lang) {
    const am = lang === 'am';
    html.lang = am ? 'am' : 'en';
    document.querySelectorAll('[data-en]').forEach(el => {
      el.innerHTML = format(am && el.dataset.am ? el.dataset.am : el.dataset.en);
    });
    document.querySelectorAll('[data-en-placeholder]').forEach(el => {
      el.placeholder = am ? el.dataset.amPlaceholder : el.dataset.enPlaceholder;
    });
    document.querySelectorAll('[data-en-label]').forEach(el => {
      el.setAttribute('aria-label', am ? el.dataset.amLabel : el.dataset.enLabel);
    });
    document.querySelectorAll('.language-toggle').forEach(btn => {
      btn.textContent = am ? 'English' : 'አማርኛ';
      btn.lang = am ? 'en' : 'am';
      btn.setAttribute('aria-label', am ? 'Switch language to English' : 'Switch language to Amharic');
    });
    try { localStorage.setItem(KEY, html.lang); } catch (e) {}
    document.dispatchEvent(new CustomEvent('fsf:lang', { detail: html.lang }));
  }

  window.FSF = {
    /** Pick the English or Amharic string for the current language. */
    t: (en, am) => (html.lang === 'am' ? am : en),
    setLanguage,
    /**
     * Send a form to FSF's Google Sheet.
     * Google Apps Script doesn't allow the browser to read its reply, so a "sent" here means the
     * message left the device — not that the sheet confirmed it. Offline is caught up front.
     */
    async send(endpoint, payload) {
      if (!navigator.onLine) throw new Error('offline');
      await fetch(endpoint, { method: 'POST', mode: 'no-cors', body: payload });
    }
  };

  // Restore the visitor's language from their last visit.
  let saved = 'en';
  try { saved = localStorage.getItem(KEY) || 'en'; } catch (e) {}
  if (saved === 'am') setLanguage('am');

  document.querySelectorAll('.language-toggle').forEach(btn =>
    btn.addEventListener('click', () => setLanguage(html.lang === 'am' ? 'en' : 'am')));

  // Mobile menu
  const menu = document.querySelector('.menu-toggle');
  const links = document.querySelector('.nav-links');
  if (menu && links) {
    const close = () => { links.classList.remove('open'); menu.setAttribute('aria-expanded', 'false'); };
    menu.addEventListener('click', () => {
      const open = links.classList.toggle('open');
      menu.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    links.querySelectorAll('a').forEach(a => a.addEventListener('click', close));
    document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
    document.addEventListener('click', e => { if (!links.contains(e.target) && e.target !== menu) close(); });
  }

  // Nav gets a solid background once the page scrolls.
  const nav = document.querySelector('.nav');
  if (nav) {
    const update = () => nav.classList.toggle('scrolled', window.scrollY > 24);
    update();
    window.addEventListener('scroll', update, { passive: true });
  }

  const year = document.querySelector('#year');
  if (year) year.textContent = new Date().getFullYear();

})();
