/* ============================================================
   POS Контроль — UI-компоненты: иконки, тосты, модалки, графики
   ============================================================ */
var ICON_PATHS = {
  logo: '<path d="M3.5 8.5 5.3 4h13.4l1.8 4.5"/><path d="M4.6 8.5V19a1 1 0 0 0 1 1h12.8a1 1 0 0 0 1-1V8.5"/><path d="M9 20v-5.4h6V20"/><path d="M8.2 11.6h.01M12 11.6h.01M15.8 11.6h.01"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.6"/><rect x="14" y="3" width="7" height="7" rx="1.6"/><rect x="14" y="14" width="7" height="7" rx="1.6"/><rect x="3" y="14" width="7" height="7" rx="1.6"/>',
  cash: '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/>',
  package: '<path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
  layers: '<path d="m12 2 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5"/><path d="m3 17 9 5 9-5"/>',
  pin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
  clock: '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/>',
  chart: '<path d="M3 3v18h18"/><rect x="7" y="12" width="3" height="6" rx="1"/><rect x="12" y="8" width="3" height="10" rx="1"/><rect x="17" y="5" width="3" height="13" rx="1"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"/>',
  sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3"/><path d="M1 14h6M9 8h6M17 16h6"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>',
  edit: '<path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  chevronRight: '<polyline points="9 18 15 12 9 6"/>',
  chevronLeft: '<polyline points="15 18 9 12 15 6"/>',
  chevronDown: '<polyline points="6 9 12 15 18 9"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
  search: '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.5" y2="16.5"/>',
  wallet: '<path d="M20 12V8H6a2 2 0 0 1 0-4h12v4"/><path d="M4 6v12a2 2 0 0 0 2 2h14v-4"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/>',
  qr: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3z"/><path d="M20.5 14H21M14 20.5V21M18 20.5h3M20.5 18V17"/>',
  split: '<path d="M16 3h5v5"/><path d="M4 20 21 3"/><path d="M21 16v5h-5"/><path d="m15 15 6 6"/><path d="M4 4l5 5"/>',
  camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z"/><circle cx="12" cy="13" r="3"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>',
  external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="m3 3 18 18"/><path d="M10.6 5.1A10.9 10.9 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.2"/><path d="M6.6 6.6C3.8 8.5 2 12 2 12s3.5 7 10 7a10.9 10.9 0 0 0 5.4-1.4"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  lock: '<rect x="3" y="11" width="18" height="10" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  user: '<path d="M20 21a8 8 0 0 0-16 0"/><circle cx="12" cy="7" r="4"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  alert: '<path d="m10.3 3.9-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3l-8-14a2 2 0 0 0-3.4 0Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  info: '<circle cx="12" cy="12" r="9"/><line x1="12" y1="16" x2="12" y2="11"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
  checkCircle: '<path d="M21.8 10A10 10 0 1 1 17 3.3"/><polyline points="9 11 12 14 22 4"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  arrowUp: '<line x1="7" y1="17" x2="17" y2="7"/><polyline points="8 7 17 7 17 16"/>',
  arrowDown: '<line x1="7" y1="7" x2="17" y2="17"/><polyline points="17 8 17 17 8 17"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/>',
  phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.9a2 2 0 0 1-.5 2.1L8 10a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.9.6 2.9.7a2 2 0 0 1 1.7 2Z"/>',
  mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.9 5.6a2 2 0 0 1-2.1 0L2 7"/>',
  telegram: '<path d="m22 3-9.5 18a.5.5 0 0 1-.9 0L8 14 3 11a.5.5 0 0 1 0-.9L21 2a.5.5 0 0 1 1 1Z"/><path d="m8 14 5-5"/>',
  menu: '<line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>',
  sparkles: '<path d="m12 3 1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9Z"/><path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9Z"/>',
  receipt: '<path d="M4 2v20l2-1.5L8 22l2-1.5L12 22l2-1.5L16 22l2-1.5L20 22V2l-2 1.5L16 2l-2 1.5L12 2l-2 1.5L8 2 6 3.5Z"/><line x1="8" y1="8" x2="16" y2="8"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="8" y1="16" x2="13" y2="16"/>',
  store: '<path d="M3 9 5 3h14l2 6"/><path d="M4 9v12h16V9"/><path d="M9 21v-7h6v7"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/>',
  code: '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
  briefcase: '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/>',
  arrive: '<circle cx="12" cy="12" r="9"/><polyline points="12 8 16 12 12 16"/><line x1="8" y1="12" x2="16" y2="12"/>',
  leave: '<circle cx="12" cy="12" r="9"/><polyline points="12 8 8 12 12 16"/><line x1="8" y1="12" x2="16" y2="12"/>',
  database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  globe: '<circle cx="12" cy="12" r="9"/><line x1="3" y1="12" x2="21" y2="12"/><path d="M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18Z"/>',
  map: '<path d="M9 3 3 6v15l6-3 6 3 6-3V3l-6 3-6-3Z"/><path d="M9 3v15M15 6v15"/>',
  tag: '<path d="M12.6 2.6A2 2 0 0 0 11.2 2H4a2 2 0 0 0-2 2v7.2a2 2 0 0 0 .6 1.4l8.7 8.7a2.4 2.4 0 0 0 3.4 0l6.6-6.6a2.4 2.4 0 0 0 0-3.4z"/><circle cx="7.5" cy="7.5" r=".5"/>',
  filter: '<polygon points="22 3 2 3 10 12.5 10 19 14 21 14 12.5 22 3"/>',
  gift: '<rect x="3" y="8" width="18" height="13" rx="2"/><path d="M12 8v13"/><path d="M3 12h18"/><path d="M12 8a3 3 0 1 0-3-3c0 2 3 3 3 3Z"/><path d="M12 8a3 3 0 1 1 3-3c0 2-3 3-3 3Z"/>',
  star: '<polygon points="12 2 15 8.5 22 9.5 17 14.5 18.2 21.5 12 18.2 5.8 21.5 7 14.5 2 9.5 9 8.5"/>',
  cloud: '<path d="M17.5 19a4.5 4.5 0 0 0 .7-8.95A6.5 6.5 0 0 0 5.6 9.2A4.5 4.5 0 0 0 6 19Z"/>',
  cloudOff: '<path d="M6.5 19a4.5 4.5 0 0 1-1-8.9 6.5 6.5 0 0 1 2.3-3.5"/><path d="M9.5 5.6A6.5 6.5 0 0 1 18.2 10a4.5 4.5 0 0 1 2.3 6.4"/><line x1="2" y1="2" x2="22" y2="22"/>',
  sync: '<path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 21v-5h5"/><path d="M21 3v5h-5"/>',
  sun: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/>',
  moon: '<path d="M21 12.8A8.5 8.5 0 1 1 11.2 3a6.6 6.6 0 0 0 9.8 9.8Z"/>',
  monitor: '<rect x="2.5" y="4" width="19" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>'
};

function icon(name, size, className) {
  var p = ICON_PATHS[name] || ICON_PATHS.info;
  var s = size || 18;
  return '<svg class="icon ' + (className || '') + '" width="' + s + '" height="' + s +
    '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + p + '</svg>';
}

/* ---------- Тосты ---------- */
function toast(message, type, duration) {
  var wrap = document.querySelector('.toast-wrap');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.className = 'toast-wrap';
    document.body.appendChild(wrap);
  }
  var typeName = type || 'success';
  var iconName = typeName === 'error' ? 'alert' : (typeName === 'warn' ? 'alert' : (typeName === 'info' ? 'info' : 'checkCircle'));
  var el = document.createElement('div');
  el.className = 'toast ' + typeName;
  el.setAttribute('role', 'status');
  el.innerHTML = icon(iconName, 17) + '<span>' + esc(message) + '</span>';
  while (wrap.children.length >= 4) wrap.removeChild(wrap.firstChild);
  wrap.appendChild(el);
  setTimeout(function () {
    el.classList.add('out');
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 240);
  }, duration || (typeName === 'error' ? 4200 : 3000));
}

/* ---------- Модальные окна ---------- */
var MODAL_STACK = [];

function openModal(opts) {
  opts = opts || {};
  var overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  var sizeClass = opts.size === 'lg' ? 'modal-lg' : (opts.size === 'sm' ? 'modal-sm' : '');
  overlay.innerHTML =
    '<div class="modal ' + sizeClass + '" role="dialog" aria-modal="true">' +
      '<div class="modal-head">' +
        '<div style="min-width:0">' +
          '<h2>' + esc(opts.title || '') + '</h2>' +
          (opts.subtitle ? '<div class="sub">' + esc(opts.subtitle) + '</div>' : '') +
        '</div>' +
        '<button type="button" class="icon-btn" data-close aria-label="Закрыть">' + icon('x', 18) + '</button>' +
      '</div>' +
      '<div class="modal-body">' + (opts.body || '') + '</div>' +
      (opts.footer ? '<div class="modal-foot">' + opts.footer + '</div>' : '<div style="height:20px"></div>') +
    '</div>';
  document.body.appendChild(overlay);
  document.body.classList.add('no-scroll');

  var closed = false;
  function close() {
    if (closed) return;
    closed = true;
    overlay.remove();
    var idx = MODAL_STACK.indexOf(handle);
    if (idx !== -1) MODAL_STACK.splice(idx, 1);
    if (!MODAL_STACK.length) document.body.classList.remove('no-scroll');
    if (typeof opts.onClose === 'function') opts.onClose();
  }
  var handle = { el: overlay, modal: overlay.querySelector('.modal'), close: close };

  overlay.querySelector('[data-close]').addEventListener('click', close);
  overlay.addEventListener('mousedown', function (e) {
    if (e.target === overlay && opts.closeOnBackdrop !== false) close();
  });
  MODAL_STACK.push(handle);
  if (typeof opts.onMount === 'function') opts.onMount(handle.modal, close);
  var autofocus = overlay.querySelector('[autofocus]');
  if (autofocus) setTimeout(function () { autofocus.focus(); }, 60);
  return handle;
}

document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape' && MODAL_STACK.length) {
    MODAL_STACK[MODAL_STACK.length - 1].close();
  }
});

function confirmDialog(opts) {
  opts = opts || {};
  return new Promise(function (resolve) {
    var done = false;
    function finish(value) {
      if (done) return;
      done = true;
      resolve(value);
      modal.close();
    }
    var modal = openModal({
      title: opts.title || 'Подтверждение',
      size: 'sm',
      closeOnBackdrop: true,
      body: '<div style="display:flex;gap:12px;align-items:flex-start">' +
        '<div style="width:40px;height:40px;border-radius:11px;flex:0 0 auto;display:flex;align-items:center;justify-content:center;background:' +
        (opts.danger ? 'var(--danger-soft);color:var(--danger)' : 'var(--primary-soft);color:var(--primary)') + '">' +
        icon(opts.danger ? 'alert' : 'info', 19) + '</div>' +
        '<div style="font-size:13.5px;line-height:1.55;color:var(--ink-2);padding-top:2px">' + (opts.message || '') + '</div>' +
        '</div>',
      footer: '<button type="button" class="btn btn-secondary" data-cancel>' + esc(opts.cancelText || 'Отмена') + '</button>' +
        '<button type="button" class="btn ' + (opts.danger ? 'btn-danger' : 'btn-primary') + '" data-ok>' + esc(opts.confirmText || 'Подтвердить') + '</button>',
      onClose: function () { if (!done) { done = true; resolve(false); } },
      onMount: function (el) {
        el.querySelector('[data-cancel]').addEventListener('click', function () { finish(false); });
        el.querySelector('[data-ok]').addEventListener('click', function () { finish(true); });
      }
    });
  });
}

function promptDialog(opts) {
  opts = opts || {};
  return new Promise(function (resolve) {
    var done = false;
    function finish(value) {
      if (done) return;
      done = true;
      resolve(value);
      modal.close();
    }
    var modal = openModal({
      title: opts.title || 'Введите значение',
      size: 'sm',
      body: '<div class="field">' +
        (opts.label ? '<label>' + esc(opts.label) + '</label>' : '') +
        (opts.multiline
          ? '<textarea class="input" data-input placeholder="' + esc(opts.placeholder || '') + '">' + esc(opts.value || '') + '</textarea>'
          : '<input class="input" data-input type="' + (opts.type || 'text') + '" value="' + esc(opts.value || '') + '" placeholder="' + esc(opts.placeholder || '') + '" autofocus>') +
        (opts.hint ? '<div class="hint">' + esc(opts.hint) + '</div>' : '') +
        '</div>',
      footer: '<button type="button" class="btn btn-secondary" data-cancel>Отмена</button>' +
        '<button type="button" class="btn btn-primary" data-ok>' + esc(opts.confirmText || 'Сохранить') + '</button>',
      onClose: function () { if (!done) { done = true; resolve(null); } },
      onMount: function (el) {
        var input = el.querySelector('[data-input]');
        el.querySelector('[data-cancel]').addEventListener('click', function () { finish(null); });
        el.querySelector('[data-ok]').addEventListener('click', function () { finish(input.value); });
        input.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' && !opts.multiline) finish(input.value);
        });
      }
    });
  });
}

function openImageViewer(src, title, subtitle) {
  openModal({
    title: title || 'Чек об оплате',
    subtitle: subtitle || '',
    size: 'sm',
    body: '<div class="receipt-view"><img src="' + src + '" alt="Чек"></div>',
    footer: '<button type="button" class="btn btn-secondary" data-close2>Закрыть</button>',
    onMount: function (el, close) {
      el.querySelector('[data-close2]').addEventListener('click', close);
    }
  });
}

/* ---------- Переиспользуемые фрагменты ---------- */
function avatarHtml(name, extraClass) {
  return '<span class="avatar ' + (extraClass || '') + '" style="background:' + avatarGradient(name) + '">' +
    esc(initials(name)) + '</span>';
}

function productPhotoHtml(product, className) {
  var name = product && product.name ? product.name : '?';
  if (product && product.photo) {
    return '<img class="' + (className || '') + '" src="' + product.photo + '" alt="' + esc(name) + '">';
  }
  return '<div class="fallback ' + (className || '') + '" style="background:' + productGradient(name) + '">' +
    esc(name.trim().slice(0, 1).toUpperCase()) + '</div>';
}

function emptyState(iconName, title, text, actionHtml) {
  return '<div class="empty">' +
    '<div class="art">' + icon(iconName || 'package', 24) + '</div>' +
    '<h4>' + esc(title) + '</h4>' +
    (text ? '<p>' + esc(text) + '</p>' : '') +
    (actionHtml || '') +
    '</div>';
}

function badge(text, cls, dot) {
  return '<span class="badge ' + (cls || '') + '">' + (dot ? '<span class="dot"></span>' : '') + esc(text) + '</span>';
}

function sectionTitle(title, sub, right) {
  return '<div class="section-title">' +
    '<div><h2>' + title + '</h2>' + (sub ? '<div class="sub">' + sub + '</div>' : '') + '</div>' +
    (right || '') + '</div>';
}

function fieldError(id, message) {
  return '<div class="field-error" id="' + id + '">' + icon('alert', 14) + esc(message) + '</div>';
}

function bindPasswordToggle(scope) {
  (scope || document).querySelectorAll('[data-pw-toggle]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var input = document.getElementById(btn.getAttribute('data-pw-toggle'));
      if (!input) return;
      var show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.innerHTML = icon(show ? 'eyeOff' : 'eye', 18);
      btn.setAttribute('aria-label', show ? 'Скрыть пароль' : 'Показать пароль');
    });
  });
}

function setButtonBusy(btn, busy, busyText) {
  if (!btn) return;
  if (busy) {
    btn.dataset.originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>' + esc(busyText || 'Подождите…');
  } else {
    btn.disabled = false;
    if (btn.dataset.originalHtml) btn.innerHTML = btn.dataset.originalHtml;
  }
}

/* ---------- Графики ---------- */
function hexToRgba(color, alpha) {
  var value = String(color || '').trim();
  if (value.charAt(0) !== '#') return value;
  var hex = value.slice(1);
  if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  var int = parseInt(hex, 16);
  return 'rgba(' + ((int >> 16) & 255) + ',' + ((int >> 8) & 255) + ',' + (int & 255) + ',' + alpha + ')';
}

function cssVar(name, fallback) {
  try {
    var value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value || fallback;
  } catch (e) {
    return fallback;
  }
}

var CHART_COLORS = {
  get revenue() { return cssVar('--primary', '#4f46e5'); },
  get expenses() { return cssVar('--danger', '#f04438'); },
  get grid() { return cssVar('--chart-grid', '#eef0f4'); },
  get axis() { return cssVar('--chart-axis', '#98a2b3'); },
  get text() { return cssVar('--chart-text', '#667085'); },
  get strong() { return cssVar('--chart-strong', '#101828'); }
};

function setupCanvas(canvas) {
  var dpr = window.devicePixelRatio || 1;
  var rect = canvas.getBoundingClientRect();
  var width = Math.max(200, rect.width || canvas.parentElement.clientWidth || 600);
  var height = Math.max(140, rect.height || 220);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  var ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx: ctx, width: width, height: height };
}

function niceMax(value) {
  if (value <= 0) return 1000;
  var exp = Math.floor(Math.log10(value));
  var base = Math.pow(10, exp);
  var normalized = value / base;
  var nice = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10;
  return nice * base;
}

function drawLineChart(canvas, data, opts) {
  if (!canvas) return;
  opts = opts || {};
  function draw(hoverIndex) {
    var s = setupCanvas(canvas);
    var ctx = s.ctx, W = s.width, H = s.height;
    var padL = 54, padR = 14, padT = 16, padB = 30;
    var innerW = W - padL - padR;
    var innerH = H - padT - padB;

    ctx.clearRect(0, 0, W, H);
    if (!data || !data.length) return;

    var maxValue = 0;
    data.forEach(function (d) { maxValue = Math.max(maxValue, d.revenue || 0, d.expenses || 0); });
    var top = niceMax(maxValue || 1000);

    ctx.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.textBaseline = 'middle';

    for (var i = 0; i <= 4; i++) {
      var y = padT + (innerH / 4) * i;
      var value = top - (top / 4) * i;
      ctx.strokeStyle = CHART_COLORS.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padL, Math.round(y) + 0.5);
      ctx.lineTo(W - padR, Math.round(y) + 0.5);
      ctx.stroke();
      ctx.fillStyle = CHART_COLORS.axis;
      ctx.textAlign = 'right';
      ctx.fillText(fmtCompact(value), padL - 10, y);
    }

    var stepX = data.length > 1 ? innerW / (data.length - 1) : innerW;
    function xAt(i) { return padL + (data.length === 1 ? innerW / 2 : stepX * i); }
    function yAt(v) { return padT + innerH - (innerH * ((v || 0) / top)); }

    ctx.textAlign = 'center';
    data.forEach(function (d, i) {
      if (!d.label) return;
      ctx.fillStyle = CHART_COLORS.axis;
      ctx.fillText(d.label, xAt(i), H - padB / 2 + 2);
    });

    function drawSeries(key, color, fill) {
      var pts = data.map(function (d, i) { return { x: xAt(i), y: yAt(d[key]) }; });
      if (fill) {
        var grad = ctx.createLinearGradient(0, padT, 0, padT + innerH);
        grad.addColorStop(0, hexToRgba(CHART_COLORS.revenue, .20));
        grad.addColorStop(1, hexToRgba(CHART_COLORS.revenue, 0));
        ctx.beginPath();
        ctx.moveTo(pts[0].x, padT + innerH);
        pts.forEach(function (p) { ctx.lineTo(p.x, p.y); });
        ctx.lineTo(pts[pts.length - 1].x, padT + innerH);
        ctx.closePath();
        ctx.fillStyle = grad;
        ctx.fill();
      }
      ctx.beginPath();
      pts.forEach(function (p, i) {
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.2;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.stroke();
    }

    drawSeries('expenses', CHART_COLORS.expenses, false);
    drawSeries('revenue', CHART_COLORS.revenue, true);

    if (typeof hoverIndex === 'number' && hoverIndex >= 0 && hoverIndex < data.length) {
      var hx = xAt(hoverIndex);
      ctx.strokeStyle = hexToRgba(CHART_COLORS.revenue, .38);
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(hx, padT);
      ctx.lineTo(hx, padT + innerH);
      ctx.stroke();
      ctx.setLineDash([]);
      [{ key: 'revenue', color: CHART_COLORS.revenue }, { key: 'expenses', color: CHART_COLORS.expenses }].forEach(function (serie) {
        var v = data[hoverIndex][serie.key] || 0;
        var py = yAt(v);
        ctx.beginPath();
        ctx.arc(hx, py, 4.2, 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();
        ctx.strokeStyle = serie.color;
        ctx.lineWidth = 2.4;
        ctx.stroke();
      });
    }
  }

  canvas.__redraw = function () { draw(canvas.__hoverIndex); };
  draw(-1);

  if (!canvas.__tooltipBound) {
    canvas.__tooltipBound = true;
    var tooltip = document.createElement('div');
    tooltip.style.cssText = 'position:absolute;pointer-events:none;background:#101828;color:#fff;font-size:11.5px;' +
      'padding:7px 10px;border-radius:9px;box-shadow:0 8px 20px rgba(16,24,40,.25);opacity:0;transition:opacity .1s;' +
      'z-index:5;white-space:nowrap;line-height:1.45;transform:translate(-50%,-100%)';
    var wrap = canvas.parentElement;
    if (getComputedStyle(wrap).position === 'static') wrap.style.position = 'relative';
    wrap.appendChild(tooltip);

    canvas.addEventListener('mousemove', function (e) {
      if (!data || !data.length) return;
      var rect = canvas.getBoundingClientRect();
      var padL = 54, padR = 14;
      var innerW = rect.width - padL - padR;
      var x = e.clientX - rect.left;
      var ratio = Math.min(1, Math.max(0, (x - padL) / innerW));
      var idx = data.length === 1 ? 0 : Math.round(ratio * (data.length - 1));
      if (canvas.__hoverIndex === idx) {
        tooltip.style.left = Math.min(rect.width - 60, Math.max(60, e.clientX - rect.left)) + 'px';
        tooltip.style.top = '10px';
        return;
      }
      canvas.__hoverIndex = idx;
      canvas.__redraw();
      var d = data[idx];
      tooltip.innerHTML = '<b>' + esc(d.full || d.label || '') + '</b><br>' +
        '<span style="color:#a5b4fc">●</span> Выручка: ' + fmtMoney(d.revenue) + '<br>' +
        '<span style="color:#fda29b">●</span> Расходы: ' + fmtMoney(d.expenses);
      tooltip.style.left = Math.min(rect.width - 70, Math.max(70, x)) + 'px';
      tooltip.style.top = '8px';
      tooltip.style.opacity = '1';
    });
    canvas.addEventListener('mouseleave', function () {
      tooltip.style.opacity = '0';
      canvas.__hoverIndex = -1;
      canvas.__redraw();
    });
  }
}

function drawDonut(canvas, segments, centerLabel, centerValue) {
  if (!canvas) return;
  var rect = canvas.getBoundingClientRect();
  var side = Math.max(120, Math.round(rect.width || canvas.width || 132));
  var dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(side * dpr);
  canvas.height = Math.round(side * dpr);
  if (!canvas.style.height) canvas.style.height = side + 'px';
  var ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  var W = side, H = side;
  ctx.clearRect(0, 0, W, H);
  var size = Math.min(W, H);
  var cx = W / 2, cy = H / 2;
  var outer = size / 2 - 6;
  var inner = outer * 0.68;
  var total = segments.reduce(function (sum, x) { return sum + (x.value || 0); }, 0);

  if (total <= 0) {
    ctx.beginPath();
    ctx.arc(cx, cy, (outer + inner) / 2, 0, Math.PI * 2);
    ctx.lineWidth = outer - inner;
    ctx.strokeStyle = CHART_COLORS.grid;
    ctx.stroke();
  } else {
    var angle = -Math.PI / 2;
    segments.forEach(function (seg) {
      if (!seg.value) return;
      var sweep = (seg.value / total) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(cx, cy, (outer + inner) / 2, angle + 0.02, angle + sweep - 0.02);
      ctx.lineWidth = outer - inner;
      ctx.strokeStyle = seg.color;
      ctx.lineCap = 'round';
      ctx.stroke();
      angle += sweep;
    });
  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = CHART_COLORS.text;
  ctx.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillText(centerLabel || 'Всего', cx, cy - 11);
  ctx.fillStyle = CHART_COLORS.strong;
  ctx.font = '700 15px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillText(centerValue || '', cx, cy + 8);
}

function redrawCharts() {
  document.querySelectorAll('canvas').forEach(function (c) {
    if (typeof c.__redraw === 'function') c.__redraw();
  });
}

window.addEventListener('pos:theme', function () {
  setTimeout(redrawCharts, 30);
});

var resizeTimer = null;
window.addEventListener('resize', function () {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(redrawCharts, 160);
});

/* ---------- Выбор периода / даты ---------- */
function periodToolbarHtml(sel) {
  var s = normalizePeriodSel(sel);
  var today = todayKey();
  var html = '<div class="date-bar" id="periodDateBar">';

  if (s.period === 'today' || s.period === 'week') {
    var monthStart = s.date.slice(0, 8) + '01';
    html += '<div class="date-nav">' +
      '<button type="button" class="icon-btn" data-step="-1" title="Предыдущий день">' + icon('chevronLeft', 15) + '</button>' +
      '<label class="date-field"><span>Дата</span><input class="input" type="date" data-date-input value="' + s.date + '" max="' + today + '"></label>' +
      '<button type="button" class="icon-btn" data-step="1" title="Следующий день"' + (s.date >= today ? ' disabled' : '') + '>' + icon('chevronRight', 15) + '</button>' +
      '</div>' +
      '<div class="date-quick">' +
        '<button type="button" class="chip' + (s.date === today ? ' active' : '') + '" data-quick="today">' + (s.period === 'week' ? 'До сегодня' : 'Сегодня') + '</button>' +
        '<button type="button" class="chip" data-quick="yesterday">' + (s.period === 'week' ? 'До вчера' : 'Вчера') + '</button>' +
        (s.period === 'week' ? '<span class="muted tiny">7 дней по выбранную дату</span>' : '') +
      '</div>' +
      '<span class="date-result">' + esc(rangeSubLabel(s, startOfDay(parseDayKey(s.date) || new Date()), endOfDay(parseDayKey(s.date) || new Date()))) + '</span>';
  } else if (s.period === 'month') {
    html += '<div class="date-nav">' +
      '<button type="button" class="icon-btn" data-month-step="-1" title="Предыдущий месяц">' + icon('chevronLeft', 15) + '</button>' +
      '<label class="date-field"><span>Месяц</span><input class="input" type="month" data-month-input value="' + s.month + '" max="' + today.slice(0, 7) + '"></label>' +
      '<button type="button" class="icon-btn" data-month-step="1" title="Следующий месяц">' + icon('chevronRight', 15) + '</button>' +
      '</div>' +
      '<div class="date-quick">' +
        '<button type="button" class="chip' + (s.month === today.slice(0, 7) ? ' active' : '') + '" data-month-quick="current">Этот месяц</button>' +
      '</div>' +
      '<span class="date-result">' + esc(rangeSubLabel(s, resolveRange(s).from, resolveRange(s).to)) + '</span>';
  } else {
    html += '<label class="date-field"><span>С</span><input class="input" type="date" data-from-input value="' + s.from + '" max="' + today + '"></label>' +
      '<label class="date-field"><span>По</span><input class="input" type="date" data-to-input value="' + s.to + '" max="' + today + '"></label>' +
      '<div class="date-quick">' +
        '<button type="button" class="chip" data-range-quick="month">Этот месяц</button>' +
        '<button type="button" class="chip" data-range-quick="prev-month">Прошлый месяц</button>' +
        '<button type="button" class="chip" data-range-quick="week">7 дней</button>' +
      '</div>' +
      '<span class="date-result">' + esc(rangeSubLabel(s, resolveRange(s).from, resolveRange(s).to)) + '</span>';
  }

  html += '</div>';
  return html;
}

function bindPeriodToolbar(root, state, onChange) {
  var bar = root.querySelector('#periodDateBar');
  if (!bar) return;
  var today = todayKey();

  function commit() {
    var s = normalizePeriodSel(state);
    state.period = s.period; state.date = s.date; state.month = s.month; state.from = s.from; state.to = s.to;
    onChange();
  }

  bar.querySelectorAll('[data-step]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var d = addDays(parseDayKey(state.date) || new Date(), Number(btn.getAttribute('data-step')));
      if (startOfDay(d) > startOfDay(new Date())) return;
      state.date = dayKey(d);
      commit();
    });
  });
  var dateInput = bar.querySelector('[data-date-input]');
  if (dateInput) dateInput.addEventListener('change', function () {
    if (!dateInput.value) return;
    state.date = dateInput.value < today ? dateInput.value : today;
    commit();
  });

  bar.querySelectorAll('[data-quick]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var q = btn.getAttribute('data-quick');
      state.date = q === 'yesterday' ? dayKey(addDays(new Date(), -1)) : today;
      commit();
    });
  });

  var monthInput = bar.querySelector('[data-month-input]');
  if (monthInput) monthInput.addEventListener('change', function () {
    if (!monthInput.value) return;
    state.month = monthInput.value > today.slice(0, 7) ? today.slice(0, 7) : monthInput.value;
    commit();
  });
  bar.querySelectorAll('[data-month-step]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var mk = parseMonthKey(state.month) || { year: new Date().getFullYear(), month: new Date().getMonth() + 1 };
      var total = mk.year * 12 + (mk.month - 1) + Number(btn.getAttribute('data-month-step'));
      var next = { year: Math.floor(total / 12), month: (total % 12) + 1 };
      var key = next.year + '-' + pad2(next.month);
      if (key > today.slice(0, 7)) return;
      state.month = key;
      commit();
    });
  });
  bar.querySelectorAll('[data-month-quick]').forEach(function (btn) {
    btn.addEventListener('click', function () { state.month = today.slice(0, 7); commit(); });
  });

  var fromInput = bar.querySelector('[data-from-input]');
  var toInput = bar.querySelector('[data-to-input]');
  if (fromInput) fromInput.addEventListener('change', function () {
    if (!fromInput.value) return;
    state.from = fromInput.value;
    if (state.from > state.to) state.to = state.from;
    commit();
  });
  if (toInput) toInput.addEventListener('change', function () {
    if (!toInput.value) return;
    state.to = toInput.value;
    if (state.to < state.from) state.from = state.to;
    commit();
  });
  bar.querySelectorAll('[data-range-quick]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var q = btn.getAttribute('data-range-quick');
      var now = new Date();
      if (q === 'month') {
        state.from = dayKey(new Date(now.getFullYear(), now.getMonth(), 1));
        state.to = today;
      } else if (q === 'prev-month') {
        state.from = dayKey(new Date(now.getFullYear(), now.getMonth() - 1, 1));
        state.to = dayKey(new Date(now.getFullYear(), now.getMonth(), 0));
      } else {
        state.from = dayKey(addDays(now, -6));
        state.to = today;
      }
      commit();
    });
  });
}

/* Инициализация toast при ошибке сохранения */
window.addEventListener('pos:storage-error', function () {
  toast('Не удалось сохранить данные: хранилище браузера переполнено. Уменьшите количество фото или сделайте резервную копию.', 'error', 6000);
});
