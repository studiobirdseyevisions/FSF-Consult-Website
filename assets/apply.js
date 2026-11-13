/* "Apply on Unicaf's site" step.
 *
 * Any element with data-apply opens a short popup. The student leaves their details, which are saved to
 * FSF's Google Sheet (marked "Went to apply"), and is then sent to Unicaf's application form through
 * FSF's tracking link. Optional: data-apply-course="Course name" pre-fills the course.
 *
 * To change the tracking link, edit APPLY_LINK below — it is the only place it lives.
 */
(function () {
  const APPLY_LINK = 'https://link.unicaf.org/fsfwa';
  const SHEET = 'https://script.google.com/macros/s/AKfycbxrtbl-E2Rv7o9htQPBmwVX5n3tqvkfEoLr5PPU3yhsClYQeSZq_7_OOcGBT4_51nipuw/exec';

  const css = `
  .apply-modal{width:min(560px,calc(100% - 28px));max-height:calc(100% - 28px);padding:0;border:0;border-radius:18px;background:#f0efef;color:#141414;font-family:inherit;box-shadow:0 30px 80px #14141455}
  .apply-modal::backdrop{background:#141414b8;backdrop-filter:blur(3px)}
  .apply-head{padding:24px 26px;background:#2842a0;color:#f0efef;display:flex;justify-content:space-between;gap:18px;align-items:flex-start}
  .apply-head small{display:block;font-size:13px;letter-spacing:.04em;font-weight:750;opacity:.85}
  .apply-head h2{margin:8px 0 0;font-size:clamp(24px,4vw,32px);line-height:1.08;letter-spacing:-.04em}
  .apply-close{flex:none;width:38px;height:38px;border-radius:10px;border:1px solid #f0efef80;background:transparent;color:#f0efef;font-size:22px;cursor:pointer}
  .apply-body{padding:22px 26px 26px}
  .apply-body>p{margin:0 0 18px;font-size:15px;line-height:1.55;color:#3a3a3a}
  .apply-form{display:grid;grid-template-columns:1fr 1fr;gap:14px}
  .apply-form label{display:flex;flex-direction:column;gap:7px;font-size:14px;font-weight:700}
  .apply-form .wide{grid-column:1/-1}
  .apply-form input{height:46px;padding:0 12px;font:inherit;font-weight:400;font-size:16px;color:#141414;background:#fff;border:1px solid #2842a055;border-radius:10px;outline:none}
  .apply-form input:focus{border-color:#2842a0;box-shadow:0 0 0 3px #2842a026}
  .apply-hint{font-weight:400;font-size:12px;color:#3a3a3a}
  .apply-next{grid-column:1/-1;margin:2px 0 0;padding:12px 14px;border-radius:10px;background:#2842a012;color:#2842a0;font-size:14px;line-height:1.5}
  .apply-note{grid-column:1/-1;margin:0;font-size:13px;line-height:1.5;color:#3a3a3a}
  .apply-go{grid-column:1/-1;justify-self:start;border:0;border-radius:12px;padding:15px 20px;background:#2842a0;color:#f0efef;font:inherit;font-size:15px;font-weight:750;cursor:pointer}
  .apply-go:hover{background:#141414}.apply-go[disabled]{opacity:.6;cursor:wait}
  .apply-status{grid-column:1/-1;margin:0;padding:12px 14px;border-radius:10px;font-size:14px;line-height:1.5;background:#b3261e14;color:#b3261e}
  .apply-status[hidden]{display:none}
  @media(max-width:560px){.apply-form{grid-template-columns:1fr}.apply-head,.apply-body{padding-left:20px;padding-right:20px}}`;
  document.head.insertAdjacentHTML('beforeend', `<style>${css}</style>`);

  const t = (en, am) => (window.FSF ? FSF.t(en, am) : en);
  const tx = (en, am) => `data-en="${en}" data-am="${am}">${t(en, am)}`;

  document.body.insertAdjacentHTML('beforeend', `
  <dialog class="apply-modal" id="apply-modal" aria-labelledby="apply-title">
    <div class="apply-head">
      <div><small ${tx('Unicaf Scholarship · up to 82%', 'የUnicaf ስኮላርሺፕ · እስከ 82%')}</small><h2 id="apply-title" ${tx('Before you apply', 'ከማመልከትዎ በፊት')}</h2></div>
      <button class="apply-close" type="button" aria-label="Close">×</button>
    </div>
    <div class="apply-body">
      <p ${tx("Leave your details so FSF can help you through your application. Then we'll take you to Unicaf's application form.", 'በማመልከቻዎ ሂደት FSF እንዲረዳዎ ዝርዝሮችዎን ይተዉ። ከዚያም ወደ Unicaf የማመልከቻ ቅጽ እንወስድዎታለን።')}</p>
      <form class="apply-form" novalidate>
        <label><span ${tx('Full name', 'ሙሉ ስም')}</span><input name="name" autocomplete="name" required maxlength="120"></label>
        <label><span ${tx('Phone number', 'ስልክ ቁጥር')}</span><input name="phone" type="tel" autocomplete="tel" required maxlength="40"></label>
        <label><span ${tx('Email (optional)', 'ኢሜይል (አማራጭ)')}</span><input name="email" type="email" autocomplete="email" maxlength="160"></label>
        <label><span ${tx('Course (optional)', 'ኮርስ (አማራጭ)')}</span><input name="course" maxlength="200"></label>
        <p class="apply-next" ${tx("Next: Unicaf's short application form (about 2 minutes). Use the same email there so we can match your application.", 'ቀጥሎ፦ የUnicaf አጭር የማመልከቻ ቅጽ (2 ደቂቃ ገደማ)። ማመልከቻዎን እንድናገናኝ እዚያም ተመሳሳይ ኢሜይል ይጠቀሙ።')}</p>
        <p class="apply-note" ${tx("FSF keeps these details to help you with your application. We don't share them.", 'FSF እነዚህን ዝርዝሮች በማመልከቻዎ እርስዎን ለመርዳት ይይዛል። ለማንም አናጋራቸውም።')}</p>
        <button class="apply-go" type="submit" ${tx('Continue to application ↗', 'ወደ ማመልከቻው ይቀጥሉ ↗')}</button>
        <p class="apply-status" role="status" aria-live="polite" hidden></p>
      </form>
    </div>
  </dialog>`);

  const modal = document.getElementById('apply-modal');
  const form = modal.querySelector('form');
  const status = modal.querySelector('.apply-status');
  const button = modal.querySelector('.apply-go');

  function open(course) {
    status.hidden = true;
    if (course) form.elements.course.value = course;
    if (modal.open) return;
    modal.showModal();
    form.elements.name.focus();
  }
  modal.querySelector('.apply-close').addEventListener('click', () => modal.close());
  modal.addEventListener('click', e => { if (e.target === modal) modal.close(); });

  // Wire up every Apply button on the page (and show any that were hidden).
  document.querySelectorAll('[data-apply]').forEach(el => {
    el.hidden = false;
    el.addEventListener('click', e => {
      e.preventDefault();
      // If another popup (the course enquiry) is open, close it first.
      const parent = el.closest('dialog');
      if (parent && parent !== modal) parent.close();
      open(el.dataset.applyCourse || '');
    });
  });
  window.FSFApply = { open };

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const empty = [...form.querySelectorAll('[required]')].find(f => !f.value.trim());
    if (empty) {
      status.textContent = t('Please fill in your name and phone number.', 'እባክዎ ስምዎን እና ስልክ ቁጥርዎን ይሙሉ።');
      status.hidden = false;
      empty.focus();
      return;
    }
    const v = name => form.elements[name].value.trim();
    const payload = new URLSearchParams({
      name: v('name'),
      phone: v('phone'),
      email: v('email'),
      course: v('course'),
      contact: [v('phone'), v('email')].filter(Boolean).join(' / '),
      message: 'Went to apply on Unicaf' + (v('course') ? ': ' + v('course') : ''),
      page: 'Went to apply (' + (document.title.split('—')[0].trim() || location.pathname) + ')'
    });
    button.disabled = true;
    status.hidden = true;
    try {
      if (window.FSF) await FSF.send(SHEET, payload);
      else await fetch(SHEET, { method: 'POST', mode: 'no-cors', body: payload });
      window.location.href = APPLY_LINK;
    } catch (err) {
      status.textContent = t("We couldn't continue. Check your internet connection and try again.", 'መቀጠል አልተቻለም። የኢንተርኔት ግንኙነትዎን አረጋግጠው እንደገና ይሞክሩ።');
      status.hidden = false;
      button.disabled = false;
    }
  });
})();
