/* "Ask FSF" popup.
 *
 * Any link to the home page's contact form (href ending in "#contact") or any element with data-ask
 * opens a short popup instead of leaving the page: what it's about (studying or business), name,
 * phone or email, and the question. It is saved to FSF's Google Sheet with type "student" or
 * "business", so the sheet's script can file it in the right tab. Without JavaScript the link still
 * goes to the home page form.
 */
(function () {
  const SHEET = 'https://script.google.com/macros/s/AKfycbxrtbl-E2Rv7o9htQPBmwVX5n3tqvkfEoLr5PPU3yhsClYQeSZq_7_OOcGBT4_51nipuw/exec';

  const css = `
  .ask-modal{width:min(560px,calc(100% - 28px));max-height:calc(100% - 28px);padding:0;border:0;border-radius:18px;background:#f0efef;color:#141414;font-family:inherit;box-shadow:0 30px 80px #14141455}
  .ask-modal::backdrop{background:#141414c8}
  .ask-head{padding:24px 26px;background:#2842a0;color:#f0efef;display:flex;justify-content:space-between;gap:18px;align-items:flex-start}
  .ask-head small{display:block;font-size:13px;letter-spacing:.04em;font-weight:750;opacity:.85}
  .ask-head h2{margin:8px 0 0;font-size:clamp(24px,4vw,32px);line-height:1.08;letter-spacing:-.04em}
  .ask-close{flex:none;width:38px;height:38px;border-radius:10px;border:1px solid #f0efef80;background:transparent;color:#f0efef;font-size:22px;cursor:pointer}
  .ask-body{padding:22px 26px 26px}
  .ask-form{display:grid;gap:14px}
  .ask-form label{display:flex;flex-direction:column;gap:7px;font-size:14px;font-weight:700}
  .ask-form input,.ask-form textarea{padding:12px;font:inherit;font-weight:400;font-size:16px;color:#141414;background:#fff;border:1px solid #2842a055;border-radius:10px;outline:none}
  .ask-form input{height:46px}
  .ask-form textarea{min-height:96px;resize:vertical}
  .ask-form input:focus,.ask-form textarea:focus{border-color:#2842a0;box-shadow:0 0 0 3px #2842a026}
  .ask-topic{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:0;padding:0;border:0}
  .ask-topic legend{padding:0;margin-bottom:7px;font-size:14px;font-weight:700}
  .ask-topic input{position:absolute;opacity:0;pointer-events:none}
  .ask-topic label{align-items:center;justify-content:center;padding:12px 10px;border:1px solid #2842a055;border-radius:12px;font-size:15px;cursor:pointer;background:#fff}
  .ask-topic input:checked+label{background:#2842a0;border-color:#2842a0;color:#f0efef}
  .ask-topic input:focus-visible+label{outline:2px solid #2842a0;outline-offset:2px}
  .ask-hp{position:absolute!important;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}
  .ask-note{margin:0;font-size:13px;line-height:1.5;color:#3a3a3a}
  .ask-go{justify-self:start;border:0;border-radius:12px;padding:15px 20px;background:#2842a0;color:#f0efef;font:inherit;font-size:15px;font-weight:750;cursor:pointer}
  .ask-go:hover{background:#141414}.ask-go:active{transform:scale(.97)}.ask-go[disabled]{opacity:.6;cursor:wait}
  .ask-status{margin:0;padding:12px 14px;border-radius:10px;font-size:14px;line-height:1.5;background:#2842a012;color:#2842a0}
  .ask-status.error{background:#b3261e14;color:#b3261e}
  .ask-status[hidden]{display:none}
  @media(max-width:560px){.ask-head,.ask-body{padding-left:20px;padding-right:20px}}`;
  document.head.insertAdjacentHTML('beforeend', `<style>${css}</style>`);

  const t = (en, am) => (window.FSF ? FSF.t(en, am) : en);
  const tx = (en, am) => `data-en="${en}" data-am="${am}">${t(en, am)}`;

  document.body.insertAdjacentHTML('beforeend', `
  <dialog class="ask-modal" id="ask-modal" aria-labelledby="ask-title">
    <div class="ask-head">
      <div><small ${tx('Talk to FSF', 'FSFን ያነጋግሩ')}</small><h2 id="ask-title" ${tx('Ask us anything.', 'ማንኛውንም ይጠይቁን።')}</h2></div>
      <button class="ask-close" type="button" aria-label="Close" data-en-label="Close" data-am-label="ዝጋ">×</button>
    </div>
    <div class="ask-body">
      <form class="ask-form" novalidate>
        <fieldset class="ask-topic">
          <legend ${tx("I'm asking about", 'የምጠይቀው ስለ')}</legend>
          <input type="radio" name="type" id="ask-student" value="student" checked><label for="ask-student" ${tx('Studying', 'ትምህርት')}</label>
          <input type="radio" name="type" id="ask-business" value="business"><label for="ask-business" ${tx('My business', 'ንግዴ')}</label>
        </fieldset>
        <label><span ${tx('Your name', 'ስምዎ')}</span><input name="name" autocomplete="name" required></label>
        <label><span ${tx('Phone or email', 'ስልክ ወይም ኢሜይል')}</span><input name="contact" autocomplete="tel" required></label>
        <label><span ${tx('Your question', 'ጥያቄዎ')}</span><textarea name="message" required></textarea></label>
        <label class="ask-hp" aria-hidden="true">Leave this empty<input name="website" tabindex="-1" autocomplete="off"></label>
        <p class="ask-note" ${tx("An FSF officer will get in touch with you within 24 hours. Your details are saved to FSF's private enquiry sheet, and we don't share them.", 'የFSF ባለሙያ በ24 ሰዓት ውስጥ ያገኝዎታል። ዝርዝሮችዎ በFSF የግል የጥያቄ ሰንጠረዥ ውስጥ ይቀመጣሉ፤ ለማንም አናጋራቸውም።')}</p>
        <button class="ask-go" type="submit" ${tx('Send message →', 'መልዕክት ይላኩ →')}</button>
        <p class="ask-status" role="status" aria-live="polite" hidden></p>
      </form>
    </div>
  </dialog>`);

  const modal = document.getElementById('ask-modal');
  const form = modal.querySelector('form');
  const status = modal.querySelector('.ask-status');
  const button = modal.querySelector('.ask-go');

  function say(text, isError) {
    status.textContent = text;
    status.classList.toggle('error', !!isError);
    status.hidden = false;
  }

  function open(type) {
    status.hidden = true;
    form.elements.type.value = type === 'business' ? 'business' : 'student';
    if (!modal.open) modal.showModal();
    form.elements.name.focus();
  }
  modal.querySelector('.ask-close').addEventListener('click', () => modal.close());
  modal.addEventListener('click', e => { if (e.target === modal) modal.close(); });

  document.querySelectorAll('a[href$="#contact"], [data-ask]').forEach(el => {
    el.addEventListener('click', e => {
      e.preventDefault();
      const parent = el.closest('dialog');
      if (parent && parent !== modal) parent.close();
      open(el.dataset.ask);
    });
  });
  window.FSFAsk = { open };

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const empty = [...form.querySelectorAll('[required]')].find(f => !f.value.trim());
    if (empty) {
      say(t('Please fill in your name, how to reach you, and your question.', 'እባክዎ ስምዎን፣ የመገናኛ መንገድዎን እና ጥያቄዎን ይሙሉ።'), true);
      empty.focus();
      return;
    }
    const data = new FormData(form);
    const type = data.get('type');
    const payload = new URLSearchParams(data);
    payload.set('page', 'Courses page — ' + type);
    button.disabled = true;
    say(t('Sending…', 'በመላክ ላይ…'));
    try {
      if (window.FSF) await FSF.send(SHEET, payload);
      else await fetch(SHEET, { method: 'POST', mode: 'no-cors', body: payload });
      const name = form.elements.name.value.trim().split(' ')[0];
      say(t(`Thank you, ${name}. An FSF officer will get in touch with you within 24 hours.`, `እናመሰግናለን ${name}። የFSF ባለሙያ በ24 ሰዓት ውስጥ ያገኝዎታል።`));
      form.reset();
      form.elements.type.value = type;
    } catch (err) {
      say(t("Your message couldn't be sent. Check your internet connection and try again.", 'መልዕክቱ አልተላከም። የኢንተርኔት ግንኙነትዎን አረጋግጠው እንደገና ይሞክሩ።'), true);
    } finally {
      button.disabled = false;
    }
  });
})();
