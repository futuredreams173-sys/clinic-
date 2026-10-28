/* ============================================================
   ملفاتي — Application controller
   ============================================================ */
(function (global) {
  'use strict';

  var C = global.MFCrypto, DB = global.MFDB, A = global.MFAuth, U = global.MFUI;

  /* ---------------- helpers ---------------- */
  var $  = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function icon(id, cls) {
    return '<svg class="' + (cls || '') + '" aria-hidden="true"><use href="#' + id + '"/></svg>';
  }
  function fmtBytes(n) { return DB.formatBytes(n); }

  function fmtDate(ts, withTime) {
    if (!ts) return '—';
    try {
      var d = new Date(ts);
      var opts = { year: 'numeric', month: 'short', day: 'numeric' };
      if (withTime) { opts.hour = '2-digit'; opts.minute = '2-digit'; }
      return new Intl.DateTimeFormat('ar-EG', opts).format(d);
    } catch (e) { return new Date(ts).toLocaleDateString(); }
  }
  function relTime(ts) {
    var s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return 'الآن';
    if (s < 3600) return 'قبل ' + Math.floor(s / 60) + ' د';
    if (s < 86400) return 'قبل ' + Math.floor(s / 3600) + ' س';
    if (s < 2592000) return 'قبل ' + Math.floor(s / 86400) + ' يوم';
    return fmtDate(ts);
  }
  function uid(p) { return DB.uid(p); }

  function extOf(name) {
    var m = /\.([a-z0-9]{1,7})$/i.exec(String(name || ''));
    return m ? m[1].toLowerCase() : '';
  }

  var KIND = {
    image: ['png','jpg','jpeg','gif','webp','svg','bmp','ico','avif'],
    video: ['mp4','webm','mkv','mov','avi','m4v'],
    audio: ['mp3','wav','ogg','m4a','flac','aac'],
    pdf:   ['pdf'],
    doc:   ['doc','docx','odt','rtf','txt','md','csv','ppt','pptx','xls','xlsx'],
    zip:   ['zip','rar','7z','tar','gz','bz2']
  };
  function kindOf(file) {
    if (file.kind) return file.kind;
    var e = extOf(file.name);
    if (file.mime && file.mime.indexOf('image/') === 0) return 'image';
    if (file.mime && file.mime.indexOf('video/') === 0) return 'video';
    if (file.mime && file.mime.indexOf('audio/') === 0) return 'audio';
    for (var k in KIND) if (KIND[k].indexOf(e) > -1) return k;
    return 'other';
  }
  var KIND_ICON = { image:'i-image', video:'i-video', audio:'i-music', pdf:'i-file', doc:'i-note', zip:'i-archive', other:'i-file' };
  var KIND_LABEL = { image:'صورة', video:'فيديو', audio:'صوت', pdf:'PDF', doc:'مستند', zip:'أرشيف', other:'ملف' };
  var MIME = { image:'image/*', video:'video/*', audio:'audio/*', pdf:'application/pdf',
               doc:'text/*,application/msword,application/vnd.openxmlformats-officedocument.*', zip:'application/zip' };

  function typeLabel(f) {
    var k = kindOf(f);
    if (k !== 'other') return KIND_LABEL[k];
    var e = extOf(f.name);
    return e ? e.toUpperCase() : 'ملف';
  }

  /* ---------------- app state ---------------- */
  var state = {
    view: 'dashboard',
    owner: null,
    data: { files: [], notes: [] },
    query: '',
    filter: 'all',
    sort: 'newest',
    layout: 'grid',
    busy: false
  };

  /* ============================================================
     DATA ACCESS  (كل عملية تمرّ من هنا — العزل مضمون)
     ============================================================ */
  function owner() {
    var uidS = A.getSessionUserId();
    if (!uidS) throw new Error(A.errors.NO_SESSION);
    return uidS;
  }

  function load() {
    state.data = A.isAuthed() ? DB.loadUserData(owner()) : { files: [], notes: [] };
    state.owner = A.isAuthed() ? A.getSessionUserId() : null;
    // حفظ التفضيلات محلياً داخل بيانات المستخدم
    if (state.data.prefs && state.data.prefs.layout) state.layout = state.data.prefs.layout;
    hydrate();
    return state.data;
  }

  /**
   * حارس العزل على مستوى الواجهة:
   * إن تغيّر مالك الجلسة (خروج مستخدم ودخول آخر) نُعيد قراءة بياناته فوراً،
   * فلا تبقى أي أثر لبيانات المستخدم السابق في DOM.
   */
  function ensureOwner() {
    if (!A.isAuthed()) { state.owner = null; return false; }
    var cur = A.getSessionUserId();
    if (state.owner === cur) return true;
    load();
    hydrate().then(function () {
      if (A.isAuthed() && state.owner === A.getSessionUserId()) render();
    });
    return true;
  }

  /* ------------------------------------------------------------
     hydrate(): فك تشفير العرض إلى ذاكرة داخل الجدول فقط
     هذه الحقول (_plain / _thumbUrl) لا تُكتب في localStorage أبداً
     ------------------------------------------------------------ */
  function hydrate() {
    var key = A.getDataKey();
    if (!key || !state.data) return Promise.resolve();
    var jobs = [];

    (state.data.notes || []).forEach(function (n) {
      if (n._plain != null) return;
      if (!n.content) { n._plain = ''; return; }
      jobs.push(C.decryptText(key, n.content).then(function (t) {
        n._plain = t;
      }).catch(function () { n._plain = '⚠ تعذّر فك تشفير هذه الملاحظة'; }));
    });

    (state.data.files || []).forEach(function (f) {
      if (f._thumbUrl != null) return;
      if (!f.thumb) return;
      if (typeof f.thumb === 'object') {
        jobs.push(C.decryptText(key, f.thumb).then(function (t) {
          f._thumbUrl = t;
        }).catch(function () { f._thumbUrl = null; }));
      } else {
        f._thumbUrl = f.thumb;   // سجل قديم غير مشفّر
      }
    });

    return Promise.all(jobs);
  }

  /* إخفاء النص المصغّر من الذاكرة عند القفل */
  function scrubHydration() {
    (state.data.notes || []).forEach(function (n) { n._plain = undefined; });
    (state.data.files || []).forEach(function (f) { f._thumbUrl = undefined; });
  }

  function persist() {
    try {
      var snap = JSON.parse(JSON.stringify(state.data));
      // لا نكتب أبداً الحقول المشفّرة في الذاكرة إلى القاعدة
      (snap.notes || []).forEach(function (n) { delete n._plain; });
      (snap.files || []).forEach(function (f) { delete f._thumbUrl; });
      DB.saveUserData(owner(), snap);
      refreshStorageUI();
      return true;
    } catch (e) {
      U.toast('مساحة التخزين ممتلئة! احذف بعض الملفات أو نزّل الملاحظات أولاً.', 'err');
      return false;
    }
  }

  function activeFiles() { return state.data.files.filter(function (f) { return !f.trashed; }); }
  function trashed() {
    return state.data.files.filter(function (f) { return f.trashed; })
      .concat(state.data.notes.filter(function (n) { return n.trashed; }));
  }
  function activeNotes() { return state.data.notes.filter(function (n) { return !n.trashed; }); }

  function matches(f) {
    if (!state.query) return true;
    var q = state.query.toLowerCase();
    return String(f.name || '').toLowerCase().indexOf(q) > -1;
  }
  function matchesNote(n) {
    if (!state.query) return true;
    var q = state.query.toLowerCase();
    return (String(n.title || '') + ' ' + String(n._plain || '')).toLowerCase().indexOf(q) > -1;
  }

  function sortList(arr) {
    var s = state.sort;
    return arr.slice().sort(function (a, b) {
      if (s === 'newest') return b.updatedAt - a.updatedAt;
      if (s === 'oldest') return a.updatedAt - b.updatedAt;
      if (s === 'name')   return String(a.name || a.title).localeCompare(String(b.name || b.title), 'ar');
      if (s === 'size')   return (b.size || 0) - (a.size || 0);
      return 0;
    });
  }

  function visibleFiles() {
    var list = activeFiles().filter(matches);
    if (state.filter !== 'all') list = list.filter(function (f) { return kindOf(f) === state.filter; });
    if (state.filter === 'star') list = activeFiles().filter(function (f) { return f.star && matches(f); });
    return sortList(list);
  }

  /* ============================================================
     ROUTER
     ============================================================ */
  var ROUTES = ['dashboard','files','notes','trash','account'];

  function go(view) {
    if (ROUTES.indexOf(view) < 0) view = 'dashboard';
    state.view = view;
    if (location.hash !== '#/' + view) location.hash = '#/' + view;
    render();
    document.body.classList.remove('is-nav-open');
    var app = $('#appScreen'); if (app) app.classList.remove('is-nav');
    var sc = $('#scrim'); if (sc) sc.hidden = true;
  }

  function readHash() {
    var h = (location.hash || '').replace(/^#\/?/, '').split('?')[0];
    return ROUTES.indexOf(h) > -1 ? h : 'dashboard';
  }

  /* ============================================================
     RENDER — shell
     ============================================================ */
  function render() {
    if (!A.isAuthed()) return;
    if (!ensureOwner()) return;
    if (!state.data.files) load();

    $$('.nav__item').forEach(function (b) {
      b.classList.toggle('is-active', b.dataset.nav === state.view);
    });

    var counts = {
      files: activeFiles().length,
      notes: activeNotes().length,
      trash: trashed().length
    };
    $$('[data-count]').forEach(function (el) {
      var n = counts[el.dataset.count] || 0;
      el.textContent = n;
      el.hidden = n === 0 && el.dataset.count !== 'files';
    });

    var root = $('#viewRoot');
    var html = '';
    if (state.view === 'dashboard') html = viewDashboard();
    else if (state.view === 'files') html = viewFiles();
    else if (state.view === 'notes') html = viewNotes();
    else if (state.view === 'trash') html = viewTrash();
    else if (state.view === 'account') html = viewAccount();
    root.innerHTML = '<div class="view">' + html + '</div>';

    afterRender();
    refreshStorageUI();
    updateTopbar();
  }

  function updateTopbar() {
    var u = A.getUser(); if (!u) return;
    var initial = (u.name || u.email || 'م').trim().charAt(0);
    $('#topName').textContent = u.name || u.email;
    $('#topAvatar').textContent = initial;
    $('#popName').textContent = u.name || '—';
    $('#popMail').textContent = u.email;
    $('#popAvatar').textContent = initial;
  }

  /* ---------------- storage UI ---------------- */
  function refreshStorageUI() {
    var q = DB.quotaInfo();
    var bar = $('#storageBar');
    if (!bar) return;
    bar.style.width = Math.max(1.5, q.pct).toFixed(1) + '%';
    $('#storageUsed').textContent = fmtBytes(q.used);
    $('#storagePct').textContent = q.pct.toFixed(1) + '%';
    bar.parentNode.classList.toggle('is-warn', q.pct > 80);
    $('#storageHint').textContent = q.pct > 80
      ? 'اقتربت من الحدّ الأقصى (5 م.ب) — نزّل بعض الملفات.'
      : 'من أصل 5 ميجابايت مخصّصة للمتصفح';
  }

  /* ============================================================
     VIEW — Dashboard
     ============================================================ */
  function viewDashboard() {
    var u = A.getUser();
    var files = activeFiles(), notes = activeNotes();
    var totalBytes = files.reduce(function (s, f) { return s + (f.size || 0); }, 0);
    var recent = sortList(files).slice(0, 5);
    var q = DB.quotaInfo();

    var stats =
      '<div class="stats">' +
        statCard('i-folder', '', files.length, 'ملف محفوظ') +
        statCard('i-note', 'v', notes.length, 'ملاحظة') +
        statCard('i-drive', 'a', fmtBytes(totalBytes), 'حجم المحتوى') +
        statCard('i-shield', 'g', q.pct.toFixed(0) + '%', 'المساحة المستخدمة') +
      '</div>';

    var banner =
      '<div class="banner">' + icon('i-shield') +
        '<div><b>خصوصيتك مضمونة على مستويين</b>' +
        '<p>١) بياناتك مخزّنة تحت مفتاح خاص بحسابك في localStorage ولا تُقرأ إلا بعد التحقق من جلستك. ' +
        '٢) محتوى كل ملف وملاحظة مشفّر بـ AES‑256 بمفتاح مشتق من كلمة مرورك — لا يُخزَّن في أي مكان.</p></div>' +
      '</div>';

    var quick =
      '<div class="quick">' +
        '<button type="button" data-act="pick">' + icon('i-upload') +
          '<span><b>رفع ملف</b><span>صور، مستندات، صوت…</span></span></button>' +
        '<button type="button" data-act="new-note">' + icon('i-note') +
          '<span><b>ملاحظة جديدة</b><span>نص سريع ومشفّر</span></span></button>' +
        '<button type="button" data-nav="files">' + icon('i-folder') +
          '<span><b>تصفح ملفاتي</b><span>' + files.length + ' ملف</span></span></button>' +
        '<button type="button" data-act="lock">' + icon('i-lock') +
          '<span><b>قفل الآن</b><span>إخفاء المحتوى فوراً</span></span></button>' +
      '</div>';

    var recentHtml = recent.length
      ? '<div class="rowlist">' + recent.map(function (f) {
          return '<div class="rowitem">' +
            '<span class="rowitem__ic">' + icon(KIND_ICON[kindOf(f)]) + '</span>' +
            '<span class="rowitem__t"><b>' + esc(f.name) + '</b>' +
              '<span>' + typeLabel(f) + ' · ' + fmtBytes(f.size) + '</span></span>' +
            '<span class="rowitem__s">' + relTime(f.updatedAt) + '</span>' +
            '<button class="iconbtn" data-open="' + f.id + '" title="معاينة">' + icon('i-eye') + '</button>' +
          '</div>';
        }).join('') + '</div>'
      : '<div class="card__pad"><p style="color:var(--ink-3);font-size:.9rem">لا توجد ملفات بعد. ابدأ برفع أول ملف أو كتابة ملاحظة.</p></div>';

    var locked =
      !A.isUnlocked()
        ? '<div class="banner" style="background:linear-gradient(135deg,#FFF4E8,#FFEDEF);border-color:#F3DCC4">' +
          icon('i-lock') + '<div><b>المحتوى مقفل</b>' +
          '<p>أدخل كلمة المرور لفكّ تشفير ملفاتك.</p>' +
          '<button class="btn btn--soft btn--sm" style="margin-top:10px" data-act="ask-unlock">فكّ القفل</button></div></div>'
        : '';

    return pageHead('الرئيسية', 'مرحباً ' + (u.name || '') + ' — هذه نظرة سريعة على مساحتك.') +
      locked + banner + stats +
      '<div class="two">' +
        '<section class="card">' +
          '<div class="card__head"><h2>آخر الملفات</h2>' +
            '<button class="link" data-nav="files">عرض الكل</button></div>' +
          recentHtml +
        '</section>' +
        '<section class="card card__pad">' +
          '<h2 style="font-size:1.02rem;font-weight:650;margin-bottom:14px">إجراءات سريعة</h2>' +
          quick +
          '<div style="margin-top:20px;padding-top:16px;border-top:1px dashed var(--line)">' +
            '<div class="kv"><span>تاريخ الانضمام</span><b>' + fmtDate(u.createdAt) + '</b></div>' +
            '<div class="kv"><span>آخر دخول</span><b>' + (u.lastLogin ? fmtDate(u.lastLogin, true) : '—') + '</b></div>' +
            '<div class="kv"><span>حالة الحساب</span><b style="color:var(--green)">نشط وآمن</b></div>' +
          '</div>' +
        '</section>' +
      '</div>';
  }

  function statCard(ic, mod, val, label) {
    return '<div class="stat"><span class="stat__ic' + (mod ? ' stat__ic--' + mod : '') + '">' + icon(ic) + '</span>' +
      '<span><b>' + esc(val) + '</b><span>' + label + '</span></span></div>';
  }

  function pageHead(title, sub, actions) {
    return '<div class="page-head"><div><h1>' + title + '</h1><p>' + (sub || '') + '</p></div>' +
      (actions ? '<div class="page-head__acts">' + actions + '</div>' : '') + '</div>';
  }

  /* ============================================================
     VIEW — Files
     ============================================================ */
  var FILTERS = [
    ['all','الكل','i-grid'],
    ['image','صور','i-image'],
    ['doc','مستندات','i-note'],
    ['video','فيديو','i-video'],
    ['audio','صوت','i-music'],
    ['zip','أرشيف','i-archive'],
    ['star','المفضلة','i-star']
  ];

  function toolbar(showSort) {
    return '<div class="toolbar">' +
      '<div class="filters">' + FILTERS.map(function (f) {
        return '<button class="filter' + (state.filter === f[0] ? ' is-active' : '') + '" ' +
          'type="button" data-filter="' + f[0] + '">' + icon(f[2]) + esc(f[1]) + '</button>';
      }).join('') + '</div>' +
      '<div class="toolbar__end">' +
        (showSort ? '<select class="selectbox" data-sort>' +
          '<option value="newest">الأحدث أولاً</option>' +
          '<option value="oldest">الأقدم أولاً</option>' +
          '<option value="name">الاسم (أ–ي)</option>' +
          '<option value="size">الأكبر حجماً</option>' +
        '</select>' : '') +
        '<div class="viewtoggle">' +
          '<button type="button" data-layout="grid" class="' + (state.layout === 'grid' ? 'is-active' : '') + '" title="شبكة">' + icon('i-grid') + '</button>' +
          '<button type="button" data-layout="list" class="' + (state.layout === 'list' ? 'is-active' : '') + '" title="قائمة">' + icon('i-list') + '</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function dropzone() {
    return '<div class="drop" id="dropzone" tabindex="0" role="button" aria-label="رفع ملف">' +
      '<div class="drop__ic">' + icon('i-upload') + '</div>' +
      '<b>اسحب ملفاتك هنا</b>' +
      '<span>أو <em>تصفّح جهازك</em> — الحدّ الأقصى 4 ميجابايت للملف الواحد</span>' +
      '<span style="margin-top:6px">كل ما ترفعه يُشفَّر محلياً قبل الحفظ</span>' +
    '</div>';
  }

  function viewFiles() {
    var list = visibleFiles();
    var all = activeFiles().length;
    var sub = all
      ? (list.length === all ? all + ' ملف' : list.length + ' من ' + all + ' ملف') +
        (state.query ? ' — نتائج «' + esc(state.query) + '»' : '')
      : 'لا توجد ملفات بعد';

    return pageHead('ملفاتي', sub,
        '<button class="btn btn--ghost" type="button" data-act="new-note">' + icon('i-plus') + 'ملاحظة</button>' +
        '<button class="btn btn--primary" type="button" data-act="pick">' + icon('i-upload') + 'رفع ملف</button>') +
      (all === 0 ? dropzone() : '') +
      toolbar(true) +
      (list.length
        ? '<div class="grid ' + (state.layout === 'list' ? 'grid--list' : '') + '">' + list.map(fileCard).join('') + '</div>'
        : (all === 0
            ? emptyState('i-folder', 'مساحتك فارغة', 'ارفع أول ملف لك أو اكتب ملاحظة — ستظهر هنا مباشرة وبشكل مشفّر.', 'رفع ملف', 'pick')
            : emptyState('i-search', 'لا توجد نتائج', 'لم نعثر على ملف يطابق بحثك أو الفلتر المحدد.', 'مسح الفلتر', 'clear-filters')));
  }

  function fileCard(f, i) {
    var kind = kindOf(f);
    var thumb = '';
    if (kind === 'image' && f._thumbUrl) {
      thumb = '<img src="' + f._thumbUrl + '" alt="" loading="lazy">';
    } else {
      thumb = icon(KIND_ICON[kind]);
    }
    return '<article class="file" data-id="' + f.id + '" style="animation-delay:' + Math.min(i * 24, 240) + 'ms">' +
      '<div class="file__thumb">' + thumb +
        '<span class="file__type">' + esc(typeLabel(f)) + '</span>' +
        '<button class="file__star' + (f.star ? ' is-on' : '') + '" data-act="star" data-id="' + f.id + '" ' +
          'title="المفضلة" aria-label="تبديل المفضلة">' + icon('i-star') + '</button>' +
      '</div>' +
      '<div class="file__body">' +
        '<div class="file__name" title="' + esc(f.name) + '">' + esc(f.name) + '</div>' +
        '<div class="file__meta"><span>' + fmtBytes(f.size) + '</span><i></i>' +
          '<span>' + fmtDate(f.updatedAt) + '</span>' +
          (f.enc ? '<i></i><span style="color:var(--brand)">مشفّر</span>' : '') +
        '</div>' +
      '</div>' +
      '<div class="file__acts">' +
        '<button data-act="preview" data-id="' + f.id + '" title="معاينة">' + icon('i-eye') + '</button>' +
        '<button data-act="download" data-id="' + f.id + '" title="تنزيل">' + icon('i-download') + '</button>' +
        '<button data-act="rename" data-id="' + f.id + '" title="إعادة تسمية">' + icon('i-edit') + '</button>' +
        '<button data-act="trash" data-id="' + f.id + '" class="is-danger" title="حذف">' + icon('i-trash') + '</button>' +
      '</div>' +
    '</article>';
  }

  /* ============================================================
     VIEW — Notes
     ============================================================ */
  var NOTE_COLORS = ['#0E8C96','#1F6FEB','#6E56CF','#B4690E','#C4324B','#0E9F6E'];

  function viewNotes() {
    var all = activeNotes();
    var list = sortList(all.filter(matchesNote));
    if (state.filter === 'star') list = list.filter(function (n) { return n.star; });

    return pageHead('ملاحظاتي',
        all.length ? list.length + ' من ' + all.length + ' ملاحظة' : 'ملاحظاتك مشفّرة أيضاً',
        '<button class="btn btn--primary" type="button" data-act="new-note">' + icon('i-plus') + 'ملاحظة جديدة</button>') +
      '<div class="toolbar">' +
        '<div class="filters">' +
          '<button class="filter' + (state.filter !== 'star' ? ' is-active' : '') + '" type="button" data-filter="all">' + icon('i-grid') + 'الكل</button>' +
          '<button class="filter' + (state.filter === 'star' ? ' is-active' : '') + '" type="button" data-filter="star">' + icon('i-star') + 'المثبتة</button>' +
        '</div>' +
        '<div class="toolbar__end"><select class="selectbox" data-sort>' +
          '<option value="newest">الأحدث أولاً</option><option value="oldest">الأقدم أولاً</option>' +
          '<option value="name">العنوان (أ–ي)</option>' +
        '</select></div>' +
      '</div>' +
      (list.length
        ? '<div class="notes">' + list.map(noteCard).join('') + '</div>'
        : emptyState('i-note', 'لا توجد ملاحظات', 'دوّن أفكارك، نتائج المرضى التجريبية، أو أي معلومة — النص يُشفَّر قبل الحفظ.', 'ملاحظة جديدة', 'new-note'));
  }

  function noteCard(n, i) {
    var color = n.color || NOTE_COLORS[0];
    return '<article class="note" data-note="' + n.id + '" style="border-inline-start-color:' + color +
      ';animation-delay:' + Math.min(i * 24, 240) + 'ms">' +
      '<h3>' + esc(n.title || 'بدون عنوان') + '</h3>' +
      '<div class="note__body">' + esc(n._plain || '') + '</div>' +
      '<div class="note__foot">' +
        '<span class="note__date">' + relTime(n.updatedAt) + '</span>' +
        '<span class="note__acts">' +
          '<button data-act="edit-note" data-id="' + n.id + '" title="تعديل">' + icon('i-edit') + '</button>' +
          '<button data-act="pin-note" data-id="' + n.id + '" title="تثبيت">' + icon('i-pin') + '</button>' +
          '<button data-act="del-note" data-id="' + n.id + '" class="is-danger" title="حذف">' + icon('i-trash') + '</button>' +
        '</span>' +
      '</div>' +
    '</article>';
  }

  /* ============================================================
     VIEW — Trash
     ============================================================ */
  function viewTrash() {
    var list = trashed();
    return pageHead('المحذوفات', list.length + ' عنصر — تُحذف نهائياً بعد 30 يوماً',
        list.length ? '<button class="btn btn--ghost" type="button" data-act="empty-trash">' +
          icon('i-trash') + 'إفراغ السلة</button>' : '') +
      (list.length
        ? '<div class="card"><div class="rowlist">' + list.map(function (it) {
            var isFile = it.kind !== undefined || it.size !== undefined;
            return '<div class="rowitem">' +
              '<span class="rowitem__ic" style="background:#FCEBEF;color:var(--rose)">' +
                icon(isFile ? KIND_ICON[kindOf(it)] : 'i-note') + '</span>' +
              '<span class="rowitem__t"><b>' + esc(it.name || it.title || 'بدون عنوان') + '</b>' +
                '<span>' + (isFile ? 'ملف' : 'ملاحظة') + ' · حُذف ' + relTime(it.trashedAt || it.updatedAt) + '</span></span>' +
              '<span class="rowitem__s" style="display:flex;gap:6px">' +
                '<button class="btn btn--soft btn--sm" data-act="restore" data-id="' + it.id + '">' + icon('i-restore') + 'استعادة</button>' +
                '<button class="btn btn--danger btn--sm" data-act="purge" data-id="' + it.id + '">' + icon('i-trash') + 'حذف نهائي</button>' +
              '</span>' +
            '</div>';
          }).join('') + '</div></div>'
        : emptyState('i-trash', 'سلة فارغة', 'لا يوجد أي عنصر محذوف. يمكنك استعادة أي ملف تحذفه هنا قبل الحذف النهائي.'));
  }

  /* ============================================================
     VIEW — Account
     ============================================================ */
  function viewAccount() {
    var u = A.getUser();
    var files = activeFiles().length, notes = activeNotes().length;
    var q = DB.quotaInfo();

    return pageHead('الملف الشخصي', 'إدارة حسابك وإعدادات الأمان') +
      '<div class="two">' +
        '<div style="display:flex;flex-direction:column;gap:20px">' +

        '<section class="card">' +
          '<div class="card__head"><h2>البيانات الأساسية</h2></div>' +
          '<div class="card__pad">' +
            '<div style="display:flex;gap:16px;align-items:center;margin-bottom:20px">' +
              '<span class="avatar avatar--lg" style="width:64px;height:64px;font-size:1.6rem">' +
                esc((u.name || 'م').charAt(0)) + '</span>' +
              '<div><b style="font-size:1.1rem">' + esc(u.name) + '</b>' +
                '<div style="color:var(--ink-4);font-size:.88rem" dir="ltr">' + esc(u.email) + '</div></div>' +
            '</div>' +
            '<form class="mform" id="profileForm">' +
              '<label class="field"><span class="field__label">الاسم الكامل</span>' +
                '<input type="text" id="pfName" value="' + esc(u.name) + '" maxlength="60"></label>' +
              '<label class="field"><span class="field__label">البريد الإلكتروني</span>' +
                '<input type="text" id="pfMail" dir="ltr" value="' + esc(u.email) + '"></label>' +
              '<div><button class="btn btn--primary" type="submit">' + icon('i-check') + 'حفظ التغييرات</button></div>' +
            '</form>' +
          '</div>' +
        '</section>' +

        '<section class="card">' +
          '<div class="card__head"><h2>تغيير كلمة المرور</h2></div>' +
          '<div class="card__pad">' +
            '<div class="banner" style="margin-bottom:18px">' + icon('i-key') +
              '<div><b>تنبيه مهم</b><p>تغيير كلمة المرور يعيد تشفير كامل محتواك بمفتاح جديد. ' +
              'إن نسيتَ كلمة المرور الحالية فلن يمكن استرجاع البيانات إطلاقاً.</p></div></div>' +
            '<form class="mform" id="pwForm">' +
              '<label class="field"><span class="field__label">كلمة المرور الحالية</span>' +
                '<input type="password" id="pwOld" dir="ltr" autocomplete="current-password" style="height:48px;border:1.5px solid var(--line);border-radius:10px;padding:0 14px;outline:none"></label>' +
              '<div class="grid2">' +
                '<label class="field"><span class="field__label">كلمة المرور الجديدة</span>' +
                  '<input type="password" id="pwNew" dir="ltr" autocomplete="new-password" style="height:48px;border:1.5px solid var(--line);border-radius:10px;padding:0 14px;outline:none"></label>' +
                '<label class="field"><span class="field__label">تأكيد الجديدة</span>' +
                  '<input type="password" id="pwNew2" dir="ltr" autocomplete="new-password" style="height:48px;border:1.5px solid var(--line);border-radius:10px;padding:0 14px;outline:none"></label>' +
              '</div>' +
              '<div><button class="btn btn--primary" type="submit">' + icon('i-lock') + 'تحديث كلمة المرور</button></div>' +
            '</form>' +
          '</div>' +
        '</section>' +

        '<section class="card danger-zone">' +
          '<div class="card__head"><h2 style="color:var(--rose)">منطقة الخطر</h2></div>' +
          '<div class="card__pad">' +
            '<div style="display:flex;gap:12px;flex-wrap:wrap">' +
              '<button class="btn btn--ghost" data-act="export">' + icon('i-download') + 'تصدير نسخة احتياطية (JSON)</button>' +
              '<button class="btn btn--danger" data-act="delete-account">' + icon('i-trash') + 'حذف الحساب نهائياً</button>' +
            '</div>' +
            '<p class="fineprint" style="text-align:start;margin-top:12px">' +
              'حذف الحساب يزيل كل بياناتك من هذا الجهاز فوراً ولا يمكن التراجع عنه.</p>' +
          '</div>' +
        '</section>' +

        '</div>' +

        '<div style="display:flex;flex-direction:column;gap:20px">' +
          '<section class="card">' +
            '<div class="card__head"><h2>حالة التخزين</h2></div>' +
            '<div class="card__pad">' +
              '<div class="prog" style="margin-bottom:14px"><i style="width:' + q.pct.toFixed(1) + '%"></i></div>' +
              '<div class="kv"><span>المستخدم</span><b>' + fmtBytes(q.used) + ' من 5 م.ب</b></div>' +
              '<div class="kv"><span>النسبة</span><b>' + q.pct.toFixed(1) + '%</b></div>' +
              '<div class="kv"><span>عدد الملفات</span><b>' + files + '</b></div>' +
              '<div class="kv"><span>عدد الملاحظات</span><b>' + notes + '</b></div>' +
              '<div class="kv"><span>الملفات المحذوفة</span><b>' + trashed().length + '</b></div>' +
            '</div>' +
          '</section>' +
          '<section class="card">' +
            '<div class="card__head"><h2>الأمان والخصوصية</h2></div>' +
            '<div class="card__pad">' +
              secRow('i-shield', 'عزل الحسابات', 'بياناتك تحت مفتاح ' + esc(A.getSessionUserId() || '').slice(0, 16) + '…') +
              secRow('i-key', 'تشفير المحتوى', 'AES‑256-GCM') +
              secRow('i-lock', 'اشتقاق المفتاح', 'PBKDF2 · 160,000 دورة') +
              secRow('i-drive', 'قاعدة البيانات', 'localStorage — على جهازك فقط') +
              secRow('i-clock', 'صلاحية الجلسة', '14 يوماً') +
              '<button class="btn btn--ghost btn--block" style="margin-top:16px" data-act="logout">' +
                icon('i-logout') + 'تسجيل الخروج من هذا الجهاز</button>' +
            '</div>' +
          '</section>' +
        '</div>' +
      '</div>';
  }

  function secRow(ic, title, val) {
    return '<div style="display:flex;gap:12px;align-items:center;padding:11px 0;border-bottom:1px dashed var(--line)">' +
      '<span class="rowitem__ic" style="width:34px;height:34px">' + icon(ic) + '</span>' +
      '<span style="flex:1"><b style="display:block;font-size:.88rem">' + title + '</b>' +
      '<span style="font-size:.76rem;color:var(--ink-4)" dir="auto">' + val + '</span></span>' +
      '<span class="chip chip--ok">' + icon('i-check') + 'مفعّل</span></div>';
  }

  function emptyState(ic, title, msg, btnLabel, act) {
    return '<div class="empty"><div class="empty__ic">' + icon(ic) + '</div>' +
      '<h3>' + title + '</h3><p>' + msg + '</p>' +
      (btnLabel ? '<button class="btn btn--primary" data-act="' + act + '">' + icon('i-plus') + btnLabel + '</button>' : '') +
      '</div>';
  }

  /* ============================================================
     AFTER RENDER — bindings
     ============================================================ */
  function afterRender() {
    var sel = $('[data-sort]');
    if (sel) sel.value = state.sort;

    var dz = $('#dropzone');
    if (dz) bindDrop(dz);

    var pf = $('#profileForm');
    if (pf) pf.addEventListener('submit', onProfileSubmit);
    var pwf = $('#pwForm');
    if (pwf) pwf.addEventListener('submit', onPasswordSubmit);
  }

  /* ============================================================
     FILE OPERATIONS
     ============================================================ */
  function findFile(id) {
    return state.data.files.filter(function (f) { return f.id === id; })[0];
  }
  function findNote(id) {
    return state.data.notes.filter(function (n) { return n.id === id; })[0];
  }

  function lockedGuard() {
    if (A.isUnlocked()) return true;
    U.toast('المحتوى مقفل — أدخل كلمة المرور أولاً.', 'err');
    askUnlock();
    return false;
  }

  function askUnlock() {
    var wrap = document.createElement('div');
    wrap.className = 'mform';
    wrap.innerHTML =
      '<div class="banner" style="margin:0">' + icon('i-lock') +
      '<div><b>البيانات مقفلة</b><p>أدخل كلمة المرور لفكّ تشفير محتوى حسابك على هذا الجهاز.</p></div></div>' +
      '<label class="field"><span class="field__label">كلمة المرور</span>' +
      '<input type="password" id="unlockPw" dir="ltr" autocomplete="current-password" ' +
      'style="height:48px;border:1.5px solid var(--line);border-radius:10px;padding:0 14px;outline:none"></label>';

    var m = U.open({
      title: 'فكّ قفل البيانات',
      body: wrap,
      actions: [
        { label: 'لاحقاً', cls: 'btn--ghost', onClick: function () { U.close(); } },
        { label: 'فتح', cls: 'btn--primary', onClick: doUnlock }
      ]
    });
    var input = wrap.querySelector('#unlockPw');
    setTimeout(function () { input.focus(); }, 80);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); doUnlock(); } });
    void m;

    function doUnlock() {
      var pw = input.value;
      if (!pw) { input.focus(); return; }
      A.unlock(pw).then(function () {
        U.close();
        U.toast('تم فتح القفل — محتواك جاهز.', 'ok');
        return hydrate();
      }).then(function () { render(); }).catch(function (e) {
        U.toast(e.message || 'كلمة المرور غير صحيحة', 'err');
        input.value = ''; input.focus();
      });
    }
  }

  /* ---------- upload ---------- */
  var MAX_SIZE = 4 * 1024 * 1024;

  function bindDrop(zone) {
    ['dragenter','dragover'].forEach(function (t) {
      zone.addEventListener(t, function (e) { e.preventDefault(); zone.classList.add('is-over'); });
    });
    ['dragleave','drop'].forEach(function (t) {
      zone.addEventListener(t, function (e) { e.preventDefault(); zone.classList.remove('is-over'); });
    });
    zone.addEventListener('drop', function (e) {
      if (e.dataTransfer && e.dataTransfer.files) handleFiles(e.dataTransfer.files);
    });
    zone.addEventListener('click', pick);
    zone.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); }
    });
  }

  function pick() {
    if (!lockedGuard()) return;
    var inp = $('#filePicker');
    inp.value = '';
    inp.click();
  }

  function handleFiles(fileList) {
    if (!lockedGuard()) return;
    var arr = Array.prototype.slice.call(fileList || []);
    if (!arr.length) return;

    var progress = document.createElement('div');
    progress.innerHTML =
      '<div class="prog" style="margin-bottom:12px"><i id="upProg" style="width:0%"></i></div>' +
      '<p style="font-size:.88rem;color:var(--ink-3);text-align:center" id="upTxt">جاري التشفير والحفظ…</p>';
    var modal = U.open({ title: 'رفع ' + arr.length + ' ملف', body: progress, actions: [] });

    var added = 0, skipped = 0, shrunk = 0, idx = 0;

    function step() {
      if (idx >= arr.length) return finish();
      var file = arr[idx++];
      var bar = progress.querySelector('#upProg');
      if (bar) bar.style.width = ((idx / arr.length) * 100).toFixed(0) + '%';

      if (file.size > MAX_SIZE) { skipped++; return step(); }

      var reader = new FileReader();
      reader.onerror = function () { skipped++; step(); };
      reader.onload = function () {
        var dataUrl = String(reader.result || '');

        // 1) ضغط الصور الكبيرة قبل التشفير — يوفّر مساحة localStorage كبيرة
        shrinkIfNeeded(file, dataUrl, function (finalUrl, wasShrunk) {
          if (wasShrunk) shrunk++;
          // 2) تشفير المحتوى
          encryptPayload(file, finalUrl).then(function (payload) {
            // 3) بناء السجل والحفظ
            storeRecord(file, payload, finalUrl, function (ok) {
              if (ok) added++; else skipped++;
              step();
            });
          }).catch(function () { skipped++; step(); });
        });
      };
      reader.readAsDataURL(file);
    }

    function finish() {
      modal.close();
      render();
      if (added) U.toast('تمت إضافة ' + added + ' ملف مشفر بنجاح.', 'ok');
      if (shrunk) U.toast('تم ضغط ' + shrunk + ' صورة لتوافق مساحة المتصفح.', 'info');
      if (skipped) U.toast('تعذّر حفظ ' + skipped + ' ملف (حجم كبير أو امتلاء المساحة).', 'err');
    }

    step();   // بدء المعالجة
  }

  /* ضغط/تصغير الصور قبل الحفظ */
  function shrinkIfNeeded(file, dataUrl, cb) {
    var isImg = (file.type || '').indexOf('image/') === 0 &&
                !/image\/(svg|gif)/i.test(file.type || '');
    if (!isImg || file.size <= 480 * 1024) return cb(dataUrl, false);

    try {
      var img = new Image();
      img.onload = function () {
        var maxEdge = 1600;
        var w = img.width, h = img.height;
        if (Math.max(w, h) <= maxEdge && file.size <= 900 * 1024) return cb(dataUrl, false);
        var scale = Math.min(1, maxEdge / Math.max(w, h));
        var cv = document.createElement('canvas');
        cv.width = Math.max(1, Math.round(w * scale));
        cv.height = Math.max(1, Math.round(h * scale));
        var ctx = cv.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, cv.width, cv.height);
        ctx.drawImage(img, 0, 0, cv.width, cv.height);
        var out = null;
        try { out = cv.toDataURL('image/jpeg', 0.82); } catch (e) { out = null; }
        // اaccept فقط إن كان أصغر فعلاً
        if (out && out.length < dataUrl.length) cb(out, true);
        else cb(dataUrl, false);
      };
      img.onerror = function () { cb(dataUrl, false); };
      img.src = dataUrl;
    } catch (e) { cb(dataUrl, false); }
  }

  /* اختيار نمط التشفير حسب نوع الملف */
  function encryptPayload(file, dataUrl) {
    var b64 = (dataUrl.split(',')[1] || '');
    var isText = (file.type || '').indexOf('text/') === 0 ||
                 /\.(txt|md|csv|json|xml|log|sql|js|css|html|yml|yaml|ini|conf)$/i.test(file.name);
    if (isText) {
      var txt = '';
      try { txt = decodeURIComponent(escape(atob(b64))); } catch (e) { txt = ''; }
      return C.encryptText(A.getDataKey(), txt);
    }
    return C.encryptBlob(A.getDataKey(), b64);
  }

  /* حفظ سجل الملف داخل بيانات المالك فقط */
  function storeRecord(file, payload, dataUrl, cb) {
    var name = file.name;
    var base = name.replace(/\.[^.]+$/, '');
    var ext = extOf(name) ? '.' + extOf(name) : '';
    var n = 1;
    while (state.data.files.some(function (f) { return !f.trashed && f.name === name; })) {
      name = base + ' (' + (n++) + ')' + ext;
    }

    var probe = { name: name, mime: file.type || 'application/octet-stream' };
    var isText = (file.type || '').indexOf('text/') === 0 ||
                 /\.(txt|md|csv|json|xml|log|sql|js|css|html|yml|yaml|ini|conf)$/i.test(file.name);

    var rec = {
      id: uid('f'),
      name: name,
      mime: probe.mime,
      size: file.size,
      kind: null,
      ext: extOf(file.name),
      body: payload,
      thumb: null,
      star: false,
      trashed: false,
      trashedAt: null,
      enc: !!(payload && payload.d),
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    var commit = function () {
      state.data.files.push(rec);
      if (!persist()) { state.data.files.pop(); cb(false); }
      else cb(true);
    };

    if (kindOf(rec) === 'image' && !isText) {
      makeThumb(dataUrl, function (thumb) {
        if (!thumb) { rec.thumb = null; return commit(); }
        // تشفير المصغّرة أيضاً — لا نترك أي محتوى صور بصيغة صريحة
        C.encryptText(A.getDataKey(), thumb).then(function (p) {
          rec.thumb = p; rec._thumbUrl = thumb; commit();
        }).catch(function () { rec.thumb = null; commit(); });
      });
    } else commit();
  }

  function makeThumb(dataUrl, cb) {
    try {
      var img = new Image();
      img.onload = function () {
        var max = 320, w = img.width, h = img.height;
        var scale = Math.min(1, max / Math.max(w, h));
        var cv = document.createElement('canvas');
        cv.width = Math.max(1, Math.round(w * scale));
        cv.height = Math.max(1, Math.round(h * scale));
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        var out;
        try { out = cv.toDataURL('image/jpeg', 0.72); } catch (e) { out = null; }
        cb(out);
      };
      img.onerror = function () { cb(null); };
      img.src = dataUrl;
    } catch (e) { cb(null); }
  }

  function download(f) {
    if (!lockedGuard()) return;
    C.decryptText(A.getDataKey(), f.body).then(function (plain) {
      var isText = (f.mime || '').indexOf('text/') === 0 ||
                   /\.(txt|md|csv|json|xml|log|sql|js|css|html)$/i.test(f.name);
      var blob;
      if (isText) blob = new Blob([plain], { type: (f.mime || 'text/plain') + ';charset=utf-8' });
      else blob = b64ToBlob(plain, f.mime);
      triggerDownload(blob, f.name);
      U.toast('جارٍ تنزيل «' + f.name + '»', 'info');
    }).catch(function () {
      U.toast('تعذّر فك التشفير — تأكد من كلمة المرور.', 'err');
    });
  }

  function b64ToBlob(b64, mime) {
    var bin = atob(b64 || ''), len = bin.length;
    var ua = new Uint8Array(len);
    for (var i = 0; i < len; i++) ua[i] = bin.charCodeAt(i);
    return new Blob([ua], { type: mime || 'application/octet-stream' });
  }

  function triggerDownload(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name || 'file';
    document.body.appendChild(a); a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1500);
  }

  /* ---------- preview ---------- */
  function preview(f) {
    if (!lockedGuard()) return;
    C.decryptText(A.getDataKey(), f.body).then(function (plain) {
      var kind = kindOf(f);
      var box = document.createElement('div');
      var inner = '';

      if (kind === 'image') {
        inner = '<img src="data:' + f.mime + ';base64,' + plain + '" alt="' + esc(f.name) + '">';
      } else if (kind === 'video') {
        inner = '<video controls src="data:' + f.mime + ';base64,' + plain + '"></video>';
      } else if (kind === 'audio') {
        inner = '<audio controls src="data:' + f.mime + ';base64,' + plain + '"></audio>';
      } else if (kind === 'pdf') {
        inner = '<iframe src="data:application/pdf;base64,' + plain + '#toolbar=0"></iframe>';
      } else {
        var isText = (f.mime || '').indexOf('text/') === 0 ||
                     /\.(txt|md|csv|json|xml|log|sql|js|css|html)$/i.test(f.name);
        if (isText) {
          inner = '<pre class="preview__text">' + esc(plain.slice(0, 120000)) +
                  (plain.length > 120000 ? '\n\n… (تم اقتطاع العرض)' : '') + '</pre>';
        } else {
          inner = '<div class="preview__none">' + icon(KIND_ICON[kind]) +
            '<p>لا يمكن معاينة هذا النوع داخل المتصفح.</p></div>';
        }
      }

      box.innerHTML =
        '<div class="preview">' + inner + '</div>' +
        '<dl style="margin-top:18px">' +
          row2('اسم الملف', f.name) +
          row2('النوع', typeLabel(f) + (f.mime ? ' · ' + f.mime : '')) +
          row2('الحجم', fmtBytes(f.size)) +
          row2('أُنشئ', fmtDate(f.createdAt, true)) +
          row2('آخر تعديل', fmtDate(f.updatedAt, true)) +
          row2('الحالة', f.enc ? 'مشفّر AES‑256' : 'غير مشفّر') +
        '</dl>';

      U.open({
        title: 'معاينة الملف',
        body: box,
        wide: kind === 'image' || kind === 'pdf' || kind === 'video',
        actions: [
          { label: 'تنزيل', cls: 'btn--primary', onClick: function () { download(f); } },
          { label: 'إعادة تسمية', cls: 'btn--ghost', onClick: function () { U.close(); renameFile(f); } },
          { label: 'إغلاق', cls: 'btn--ghost', onClick: function () { U.close(); } }
        ]
      });
    }).catch(function (e) {
      U.toast(e && e.message === 'DECRYPT_FAILED' ? 'فشل فك التشفير — ربما تغيّرت كلمة المرور.' : 'تعذّر فتح الملف.', 'err');
    });
  }

  function row2(k, v) {
    return '<div class="metarow"><dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd></div>';
  }

  function renameFile(f) {
    U.promptField({
      title: 'إعادة تسمية الملف',
      label: 'اسم الملف',
      value: f.name,
      hint: 'الامتداد الأصلي يُحفظ تلقائياً.',
      okLabel: 'حفظ'
    }).then(function (v) {
      if (!v) return;
      if (extOf(f.name)) {
        var e = '.' + extOf(f.name);
        if (!v.toLowerCase().endsWith(e.toLowerCase())) v += e;
      }
      f.name = v; f.updatedAt = Date.now();
      if (persist()) { render(); U.toast('تمت إعادة التسمية.', 'ok'); }
    });
  }

  function trashFile(f) {
    f.trashed = true; f.trashedAt = Date.now(); f.updatedAt = Date.now();
    if (persist()) {
      render();
      U.toast('نُقل «' + f.name + '» إلى المحذوفات.', 'ok');
    }
  }

  function toggleStar(f) {
    f.star = !f.star; f.updatedAt = Date.now();
    persist(); render();
  }

  /* ---------- notes ---------- */
  function noteEditor(note) {
    var isNew = !note;
    var draft = note ? {
      title: note.title || '',
      plain: note.plain || '',
      color: note.color || NOTE_COLORS[0]
    } : { title: '', plain: '', color: NOTE_COLORS[0] };

    var wrap = document.createElement('div');
    wrap.className = 'mform';
    wrap.innerHTML =
      '<label class="field"><span class="field__label">العنوان</span>' +
        '<input type="text" id="nTitle" maxlength="90" placeholder="مثال: ملخص زيارة المريض"></label>' +
      '<label class="field"><span class="field__label">المحتوى</span>' +
        '<textarea id="nBody" placeholder="اكتب هنا… النص يُشفَّر قبل الحفظ."></textarea></label>' +
      '<div class="field"><span class="field__label">اللون</span><div class="swatches" id="nSwatch"></div></div>';

    var sw = wrap.querySelector('#nSwatch');
    NOTE_COLORS.forEach(function (c) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'swatch' + (c === draft.color ? ' is-on' : '');
      b.style.background = c;
      b.setAttribute('aria-label', 'لون');
      b.addEventListener('click', function () {
        draft.color = c;
        $$('.swatch', sw).forEach(function (x) { x.classList.remove('is-on'); });
        b.classList.add('is-on');
      });
      sw.appendChild(b);
    });

    wrap.querySelector('#nTitle').value = draft.title;
    wrap.querySelector('#nBody').value = draft.plain;

    U.open({
      title: isNew ? 'ملاحظة جديدة' : 'تعديل الملاحظة',
      body: wrap,
      actions: [
        { label: 'إلغاء', cls: 'btn--ghost', onClick: function () { U.close(); } },
        { label: 'حفظ', cls: 'btn--primary', onClick: save }
      ]
    });

    setTimeout(function () { wrap.querySelector('#nTitle').focus(); }, 70);

    function save() {
      var title = wrap.querySelector('#nTitle').value.trim();
      var plain = wrap.querySelector('#nBody').value;
      if (!title && !plain.trim()) { U.toast('اكتب عنواناً أو محتوى أولاً.', 'err'); return; }

      if (!A.isUnlocked()) { U.close(); lockedGuard(); return; }

      C.encryptText(A.getDataKey(), plain).then(function (payload) {
        if (isNew) {
          state.data.notes.push({
            id: uid('n'), title: title || 'بدون عنوان',
            content: payload, _plain: plain, color: draft.color,
            star: false, trashed: false, trashedAt: null,
            createdAt: Date.now(), updatedAt: Date.now()
          });
        } else {
          note.title = title || 'بدون عنوان';
          note.content = payload; note._plain = plain;
          note.color = draft.color; note.updatedAt = Date.now();
        }
        if (persist()) {
          U.close();
          render();
          U.toast(isNew ? 'أُنشئت الملاحظة وشُفّرت.' : 'حُفظت التعديلات.', 'ok');
        } else if (isNew) { state.data.notes.pop(); }
      }).catch(function () { U.toast('تعذّر تشفير الملاحظة.', 'err'); });
    }
  }

  function deleteNote(n) {
    n.trashed = true; n.trashedAt = Date.now(); n.updatedAt = Date.now();
    if (persist()) { render(); U.toast('نُقلت الملاحظة إلى المحذوفات.', 'ok'); }
  }

  function pinNote(n) {
    n.star = !n.star; n.updatedAt = Date.now();
    persist(); render();
    U.toast(n.star ? 'ثُبّتت الملاحظة.' : 'أُزيل التثبيت.', 'info');
  }

  /* ---------- trash ops ---------- */
  function restoreItem(id) {
    var f = findFile(id), n = findNote(id);
    if (f) { f.trashed = false; f.trashedAt = null; f.updatedAt = Date.now(); }
    else if (n) { n.trashed = false; n.trashedAt = null; n.updatedAt = Date.now(); }
    else { U.toast('العنصر غير موجود.', 'err'); return; }
    if (persist()) { render(); U.toast('تمت الاستعادة.', 'ok'); }
  }

  function purgeItem(id) {
    U.confirm({
      title: 'حذف نهائي',
      message: 'سيُحذف هذا العنصر نهائياً من جهازك ولا يمكن استرجاعه. متأكد؟',
      okLabel: 'حذف نهائي'
    }).then(function (ok) {
      if (!ok) return;
      state.data.files = state.data.files.filter(function (x) { return x.id !== id; });
      state.data.notes = state.data.notes.filter(function (x) { return x.id !== id; });
      if (persist()) { render(); U.toast('حُذف نهائياً.', 'ok'); }
    });
  }

  function emptyTrash() {
    U.confirm({
      title: 'إفراغ سلة المحذوفات',
      message: 'سيُحذف كل ما في السلة نهائياً (' + trashed().length + ' عنصر).',
      okLabel: 'إفراغ'
    }).then(function (ok) {
      if (!ok) return;
      state.data.files = state.data.files.filter(function (f) { return !f.trashed; });
      state.data.notes = state.data.notes.filter(function (n) { return !n.trashed; });
      if (persist()) { render(); U.toast('أُفرغت السلة.', 'ok'); }
    });
  }

  /* ---------- account ops ---------- */
  function onProfileSubmit(e) {
    e.preventDefault();
    var name = $('#pfName').value.trim();
    var mail = $('#pfMail').value.trim();
    if (!name) { U.toast('الاسم مطلوب.', 'err'); return; }
    A.updateProfile({ name: name, email: mail })
      .then(function () { U.toast('حُفظت بيانات الحساب.', 'ok'); render(); })
      .catch(function (err) { U.toast(err.message, 'err'); });
  }

  function onPasswordSubmit(e) {
    e.preventDefault();
    var o = $('#pwOld').value, n1 = $('#pwNew').value, n2 = $('#pwNew2').value;
    if (n1 !== n2) { U.toast('كلمتا المرور الجديدتان غير متطابقتين.', 'err'); return; }
    if (n1.length < 8) { U.toast('كلمة المرور 8 محارف على الأقل.', 'err'); return; }
    var btn = e.target.querySelector('button[type=submit]');
    btn.classList.add('is-busy');
    A.changePassword(o, n1).then(function (count) {
      btn.classList.remove('is-busy');
      e.target.reset();
      U.toast('غيّرت كلمة المرور وأُعيد تشفير ' + count + ' عنصراً.', 'ok');
      // إعادة تحميل من القاعدة لأن المحتوى أُعيد تشفيره بمفتاح جديد
      load();
      hydrate().then(function () { render(); });
    }).catch(function (err) {
      btn.classList.remove('is-busy');
      U.toast(err.message || 'تعذّر التغيير.', 'err');
    });
  }

  function exportBackup() {
    var u = A.getUser();
    var dump = {
      app: 'malafaty', version: DB.SCHEMA, exportedAt: new Date().toISOString(),
      account: { name: u.name, email: u.email, createdAt: u.createdAt },
      note: 'المحتوى مشفّر — لفكّه استورد الملف ضمن نفس المفتاح.',
      files: state.data.files.map(function (f) {
        return { name: f.name, mime: f.mime, size: f.size, encryptedBody: f.body, createdAt: f.createdAt };
      }),
      notes: state.data.notes.map(function (n) {
        return { title: n.title, color: n.color, encryptedContent: n.content, createdAt: n.createdAt };
      })
    };
    var blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
    triggerDownload(blob, 'malafaty-backup-' + new Date().toISOString().slice(0, 10) + '.json');
    U.toast('صُدّرت النسخة الاحتياطية.', 'ok');
  }

  function deleteAccount() {
    U.confirm({
      heading: 'حذف الحساب',
      title: 'سيُمحى حسابك بالكامل',
      message: 'كل ملفاتك وملاحظاتك ستُحذف من هذا الجهاز فوراً. لا يمكن التراجع. هل أنت متأكد؟',
      okLabel: 'نعم، احذف كل شيء'
    }).then(function (ok) {
      if (!ok) return;
      A.deleteAccount().then(function () {
        U.toast('حُذف الحساب وكل بياناته.', 'ok');
        showAuth('signup');
      }).catch(function (e) { U.toast(e.message, 'err'); });
    });
  }

  /* ============================================================
     GLOBAL EVENT DELEGATION
     ============================================================ */
  function onDocClick(e) {
    var t = e.target;

    var navBtn = t.closest('[data-nav]');
    if (navBtn) { e.preventDefault(); go(navBtn.dataset.nav); return; }

    var closeM = t.closest('[data-close-modal]');
    if (closeM) { U.close(); return; }

    var filterBtn = t.closest('[data-filter]');
    if (filterBtn) { state.filter = filterBtn.dataset.filter; render(); return; }

    var layBtn = t.closest('[data-layout]');
    if (layBtn) {
      state.layout = layBtn.dataset.layout;
      state.data.prefs.layout = state.layout;
      persist(); render(); return;
    }

    var act = t.closest('[data-act]');
    if (act) { handleAction(act.dataset.act, act.dataset.id, e); return; }

    var openBtn = t.closest('[data-open]');
    if (openBtn) {
      var f = findFile(openBtn.dataset.open);
      if (f) preview(f);
      return;
    }
  }

  function handleAction(act, id, e) {
    if (e) e.preventDefault();

    switch (act) {
      case 'pick': pick(); break;
      case 'clear-filters':
        state.query = ''; state.filter = 'all';
        $('#globalSearch').value = '';
        render(); break;
      case 'new-note':
        if (!lockedGuard()) return;
        noteEditor(null); break;
      case 'lock':
        closeUserMenu();
        A.lock();
        scrubHydration();
        render();
        askUnlock(); break;
      case 'ask-unlock': askUnlock(); break;
      case 'logout':
        closeUserMenu();
        U.confirm({ title: 'تسجيل الخروج', message: 'ستحتاج إلى كلمة المرور للدخول مرة أخرى.',
                    okLabel: 'خروج', danger: false }).then(function (ok) {
          if (!ok) return;
          A.logout(); showAuth('login'); U.toast('تم تسجيل الخروج بأمان.', 'ok');
        }); break;
      case 'delete-account': deleteAccount(); break;
      case 'export': exportBackup(); break;
      case 'empty-trash': emptyTrash(); break;

      case 'preview': { var f = findFile(id); if (f) preview(f); break; }
      case 'download': { var f2 = findFile(id); if (f2) download(f2); break; }
      case 'rename':   { var f3 = findFile(id); if (f3) renameFile(f3); break; }
      case 'trash':    { var f4 = findFile(id); if (f4) trashFile(f4); break; }
      case 'star':     { var f5 = findFile(id); if (f5) toggleStar(f5); break; }
      case 'restore':  restoreItem(id); break;
      case 'purge':    purgeItem(id); break;

      case 'edit-note': { var n = findNote(id); if (n) noteEditor(n); break; }
      case 'del-note':  { var n2 = findNote(id); if (n2) deleteNote(n2); break; }
      case 'pin-note':  { var n3 = findNote(id); if (n3) pinNote(n3); break; }
    }
  }

  /* ---------------- user menu ---------------- */
  function closeUserMenu() {
    var pop = $('#userMenuPop'); if (pop) pop.hidden = true;
    var btn = $('#userMenuBtn'); if (btn) btn.setAttribute('aria-expanded', 'false');
  }

  /* ============================================================
     AUTH SCREEN LOGIC
     ============================================================ */
  function showAuth(tab) {
    $('#appScreen').hidden = true;
    $('#authScreen').hidden = false;
    setAuthTab(tab || 'login');
    document.title = 'ملفاتي — الدخول';
  }

  function showApp() {
    if (!$('#appScreen').hidden) { ensureOwner(); return; }   // معاملة idempotent
    $('#authScreen').hidden = true;
    $('#appScreen').hidden = false;
    document.title = 'ملفاتي — مساحتك';
    load();
    go(readHash());
    // إعادة رسم بعد اكتمال فك التشفير للمصغّرات والملاحظات
    hydrate().then(function () { if (A.isAuthed()) render(); });
  }

  function setAuthTab(tab) {
    var seg = $('.seg');
    seg.dataset.tab = tab;
    $$('.seg__btn').forEach(function (b) {
      var on = b.dataset.authTab === tab;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    $('#loginForm').hidden = tab !== 'login';
    $('#signupForm').hidden = tab !== 'signup';
    $('#authTitle').textContent = tab === 'login' ? 'مرحباً بعودتك' : 'أنشئ مساحتك الخاصة';
    $('#authSub').textContent = tab === 'login'
      ? 'سجّل دخولك للوصول إلى ملفاتك وملاحظاتك الخاصة.'
      : 'حساب ببريدك وكلمة مرورك — ولا يستطيع أحد غيرك رؤية بياناتك.';
    hideAlert();
  }

  function showAlert(msg) {
    var el = $('#authAlert');
    el.innerHTML = icon('i-alert') + '<span>' + esc(msg) + '</span>';
    el.hidden = false;
    el.className = 'alert alert--error';
  }
  function hideAlert() { var el = $('#authAlert'); if (el) { el.hidden = true; el.innerHTML = ''; } }

  function busy(btn, on) {
    btn.classList.toggle('is-busy', on);
    btn.disabled = on;
  }

  function bindAuth() {
    $$('.seg__btn').forEach(function (b) {
      b.addEventListener('click', function () { setAuthTab(b.dataset.authTab); });
    });

    $$('[data-toggle-pw]').forEach(function (b) {
      b.addEventListener('click', function () {
        var inp = document.getElementById(b.dataset.togglePw);
        inp.type = inp.type === 'password' ? 'text' : 'password';
        b.setAttribute('aria-label', inp.type === 'password' ? 'إظهار كلمة المرور' : 'إخفاء كلمة المرور');
      });
    });

    $('#loginForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = $('#loginBtn');
      hideAlert();
      busy(btn, true);
      A.login({ email: $('#loginEmail').value, password: $('#loginPass').value })
        .then(function () {
          busy(btn, false);
          $('#loginForm').reset();
          U.toast('أهلاً بعودتك — تم فتح مساحتك.', 'ok');
          showApp();
        })
        .catch(function (err) {
          busy(btn, false);
          showAlert(err.message || 'تعذّر تسجيل الدخول.');
        });
    });

    $('#signupForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = $('#signBtn');
      hideAlert();
      busy(btn, true);
      A.register({
        name: $('#signName').value,
        email: $('#signEmail').value,
        password: $('#signPass').value,
        confirm: $('#signPass2').value
      }).then(function () {
        busy(btn, false);
        $('#signupForm').reset();
        U.toast('تم إنشاء حسابك — مساحتك جاهزة!', 'ok');
        showApp();
      }).catch(function (err) {
        busy(btn, false);
        showAlert(err.message || 'تعذّر إنشاء الحساب.');
      });
    });

    $('#signPass').addEventListener('input', function () {
      var s = C.passwordScore(this.value);
      var el = $('#strength');
      el.dataset.level = s;
      el.querySelector('.strength__txt').textContent =
        ['قوة كلمة المرور','ضعيفة','متوسطة','جيدة','ممتازة'][s];
    });
  }

  /* ============================================================
     BOOT
     ============================================================ */
  function boot() {
    if (!C.supported()) {
      document.body.innerHTML =
        '<div style="max-width:520px;margin:80px auto;text-align:center;font-family:system-ui;padding:20px">' +
        '<h1 style="color:#0E8C96">ملفاتي</h1>' +
        '<p style="color:#5B7484;line-height:1.9">متصفحك لا يدعم WebCrypto المطلوب لتشفير المحتوى. ' +
        'الرجاء استخدام Chrome أو Edge أو Firefox بأحدث إصدار، وعلى صفحة تُشغَّل عبر HTTPS أو localhost.</p></div>';
      return;
    }

    bindAuth();

    // استعادة الجلسة المحفوظة
    A.restore().then(function (user) {
      if (user) {
        // جلسة صالحة لكن المفتاح يحتاج كلمة المرور
        showApp();
        setTimeout(function () { askUnlock(); }, 350);
      } else {
        showAuth('login');
      }
    }).catch(function () { showAuth('login'); });

    // استماع أحداث المصادقة — تُبقي شاشات التطبيق متزامنة مع حالة الجلسة
    A.on(function (evt) {
      if (evt.type === 'logout' || evt.type === 'deleted') {
        state.data = { files: [], notes: [] };
        state.owner = null;
        showAuth(evt.type === 'logout' ? 'login' : 'signup');
        return;
      }
      // دخول ناجح (سواء عبر النموذج أو عبر API) ⟵ أعِرض التطبيق
      if (evt.type === 'login' && $('#authScreen').hidden === false) showApp();
      // استئناف جلسة محفوظة ⟵ أعِرض التطبيق ثم اطلب فك القفل
      if (evt.type === 'restore' && $('#authScreen').hidden === false && $('#appScreen').hidden) {
        showApp();
        setTimeout(function () { if (A.isAuthed() && !A.isUnlocked()) askUnlock(); }, 350);
      }
    });

    /* ---- app-level events ---- */
    document.addEventListener('click', onDocClick);

    $('#menuBtn').addEventListener('click', function () {
      var app = $('#appScreen');
      var open = app.classList.toggle('is-nav');
      $('#scrim').hidden = !open;
      this.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    $('#scrim').addEventListener('click', function () {
      $('#appScreen').classList.remove('is-nav');
      this.hidden = true;
      var mb = $('#menuBtn'); if (mb) mb.setAttribute('aria-expanded', 'false');
    });

    $('#userMenuBtn').addEventListener('click', function (e) {
      e.stopPropagation();
      var pop = $('#userMenuPop');
      pop.hidden = !pop.hidden;
      this.setAttribute('aria-expanded', pop.hidden ? 'false' : 'true');
    });
    document.addEventListener('click', function (e) {
      if (!e.target.closest('#userMenu')) closeUserMenu();
    });

    $('#filePicker').addEventListener('change', function () {
      handleFiles(this.files);
    });

    var searchTimer;
    $('#globalSearch').addEventListener('input', function () {
      var v = this.value;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(function () {
        state.query = v.trim();
        if (state.view !== 'files' && state.view !== 'notes' && state.query) state.view = 'files';
        render();
      }, 180);
    });

    document.addEventListener('change', function (e) {
      if (e.target.matches('[data-sort]')) { state.sort = e.target.value; render(); }
    });

    window.addEventListener('hashchange', function () {
      if (A.isAuthed()) go(readHash());
    });

    // تحديث الأوقت النسبي — فقط حين تكون الواجهة خالية تماماً
    setInterval(function () {
      if (!A.isAuthed()) return;
      if (!$('#modal').hidden) return;                 // نافذة مفتوحة
      if ($('#userMenuPop') && !$('#userMenuPop').hidden) return;
      if (document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) return;
      if (state.view === 'dashboard' || state.view === 'trash') render();
    }, 60000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  global.MFApp = { go: go, render: render };
})(window);
