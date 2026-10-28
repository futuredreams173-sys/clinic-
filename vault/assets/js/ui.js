/* ============================================================
   ملفاتي — UI primitives: toasts + modal
   ============================================================ */
(function (global) {
  'use strict';

  var ICON = {
    ok:   '#i-check',
    err:  '#i-alert',
    info: '#i-info'
  };

  /* ---------------- toasts ---------------- */
  function toast(message, kind) {
    kind = kind || 'ok';
    var host = document.getElementById('toasts');
    if (!host) return;
    var el = document.createElement('div');
    el.className = 'toast toast--' + (kind === 'ok' ? 'ok' : kind === 'err' ? 'err' : 'info');
    el.setAttribute('role', kind === 'err' ? 'alert' : 'status');

    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    var use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', ICON[kind] || ICON.info);
    svg.appendChild(use);

    var txt = document.createElement('span');
    txt.textContent = String(message);

    el.appendChild(svg);
    el.appendChild(txt);
    host.appendChild(el);

    var life = kind === 'err' ? 5200 : 3200;
    setTimeout(function () {
      el.classList.add('is-out');
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 300);
    }, life);

    while (host.children.length > 4) host.removeChild(host.firstChild);
  }

  /* ---------------- modal ---------------- */
  var modalEl, bodyEl, headEl, footEl, lastFocus = null;

  function ensure() {
    if (modalEl) return;
    modalEl = document.getElementById('modal');
    bodyEl  = document.getElementById('modalBody');
    headEl  = document.getElementById('modalTitle');
    footEl  = document.getElementById('modalFoot');
    modalEl.addEventListener('click', function (e) {
      if (e.target.closest('[data-close-modal]')) close();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !modalEl.hidden) close();
    });
  }

  /**
   * open({ title, body:Node|HTMLString, actions:[{label,cls,onClick}], wide })
   */
  function open(opts) {
    ensure();
    lastFocus = document.activeElement;
    headEl.textContent = opts.title || '';
    bodyEl.innerHTML = '';
    footEl.innerHTML = '';
    modalEl.querySelector('.modal__card').classList.toggle('is-lg', !!opts.wide);

    if (typeof opts.body === 'string') bodyEl.innerHTML = opts.body;
    else if (opts.body) bodyEl.appendChild(opts.body);

    (opts.actions || []).forEach(function (a) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn ' + (a.cls || 'btn--ghost');
      b.textContent = a.label;
      if (a.id) b.id = a.id;
      b.addEventListener('click', function () {
        if (a.onClick) a.onClick(b);
        else close();
      });
      footEl.appendChild(b);
    });

    modalEl.hidden = false;
    document.body.style.overflow = 'hidden';

    var focusable = bodyEl.querySelector('input,textarea,button,[tabindex]');
    (focusable || modalEl.querySelector('[data-close-modal]')).focus({ preventScroll: true });
    return { body: bodyEl, foot: footEl, close: close };
  }

  function close() {
    ensure();
    if (modalEl.hidden) return;
    modalEl.hidden = true;
    document.body.style.overflow = '';
    // تنظيف موارد المعاينة (object URLs)
    var vids = bodyEl.querySelectorAll('[data-revoke]');
    for (var i = 0; i < vids.length; i++) {
      try { URL.revokeObjectURL(vids[i].getAttribute('data-revoke')); } catch (e) {}
    }
    bodyEl.innerHTML = '';
    if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
  }

  /* confirmation dialog — returns Promise<boolean> */
  function confirm(opts) {
    return new Promise(function (resolve) {
      var wrap = document.createElement('div');
      wrap.innerHTML =
        '<div class="confirm-ic"><svg><use href="' + (opts.danger === false ? '#i-info' : '#i-alert') + '"/></svg></div>' +
        '<div class="confirm-txt"><b></b><span class="msg"></span></div>';
      wrap.querySelector('b').textContent = opts.title || 'هل أنت متأكد؟';
      wrap.querySelector('.msg').textContent = opts.message || '';

      var settled = false;
      var m = open({
        title: opts.heading || 'تأكيد',
        body: wrap,
        actions: [
          { label: opts.cancelLabel || 'إلغاء', cls: 'btn--ghost', onClick: function () { settled = true; close(); resolve(false); } },
          { label: opts.okLabel || 'متابعة', cls: opts.danger === false ? 'btn--primary' : 'btn--danger',
            onClick: function () { settled = true; close(); resolve(true); } }
        ]
      });
      // إذا أُغلق النافذة بـ Esc
      var obs = setInterval(function () {
        if (modalEl.hidden && !settled) { settled = true; clearInterval(obs); resolve(false); }
        else if (settled) clearInterval(obs);
      }, 120);
      void m;
    });
  }

  /* prompt-like single input */
  function promptField(opts) {
    return new Promise(function (resolve) {
      var wrap = document.createElement('div');
      wrap.className = 'mform';
      var id = 'pf_' + Math.random().toString(36).slice(2, 7);
      wrap.innerHTML =
        '<label class="field"><span class="field__label"></span>' +
        '<input type="text" id="' + id + '"></label>' +
        '<p class="fineprint" style="text-align:start"></p>';
      wrap.querySelector('.field__label').textContent = opts.label || 'القيمة';
      var input = wrap.querySelector('input');
      input.value = opts.value || '';
      if (opts.placeholder) input.placeholder = opts.placeholder;
      var hint = wrap.querySelector('.fineprint');
      hint.textContent = opts.hint || '';
      if (!opts.hint) hint.remove();

      var settled = false;
      open({
        title: opts.title || 'تعديل',
        body: wrap,
        actions: [
          { label: 'إلغاء', cls: 'btn--ghost', onClick: function () { settled = true; close(); resolve(null); } },
          { label: opts.okLabel || 'حفظ', cls: 'btn--primary', onClick: function () {
            var v = input.value.trim();
            if (!v) { input.focus(); return; }
            settled = true; close(); resolve(v);
          } }
        ]
      });
      setTimeout(function () { input.focus(); input.select(); }, 60);
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); var v = input.value.trim(); if (v) { settled = true; close(); resolve(v); } }
      });
      var obs = setInterval(function () {
        if (modalEl.hidden && !settled) { settled = true; clearInterval(obs); resolve(null); }
        else if (settled) clearInterval(obs);
      }, 120);
    });
  }

  global.MFUI = { toast: toast, open: open, close: close, confirm: confirm, promptField: promptField };
})(window);
