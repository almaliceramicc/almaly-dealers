/* Каталог дилерского портала: карточки, фильтры, страница модели, заявка.
   Свои данные (data.json), свои фотографии — витрина с QR-кодами не затрагивается. */
const load = fetch('data.json', {cache: 'no-cache'}).then(r => r.json());
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const nf = (v, d = 2) => Number(v).toLocaleString('ru-RU', {maximumFractionDigits: d});
const m2 = v => v > 0 ? nf(v) + ' м²' : '—';
const img = (t, i, thumb) => `img/${t.art}/${t.photos[i]}${thumb ? '_t' : ''}.jpg`;
const num = v => Math.max(0.1, +String(v).replace(',', '.') || 0.1);

/** Из строки упаковки «1 уп-2шт-1,44м2-27 кг» достаём м² и вес одной упаковки. */
function packInfo(t) {
  const p = (t.packing || '').replace(',', '.');
  const sqm = +(p.match(/([\d.]+)\s*м2/i)?.[1]) || (String(t.format).includes('120') ? 1.44 : 1.8);
  const kg = +(p.match(/([\d.]+)\s*кг/i)?.[1]) || 0;
  return {sqm, kg};
}
/** Дилер вводит метры — считаем целые упаковки с округлением вверх. */
const packsFor = (need, sqm) => Math.max(1, Math.ceil(need / sqm));

/** Довоз со склада Тверь в Москву — один день. Меняется здесь, применяется везде. */
const TVER_ETA = 'Доставка в Москву — 1 день';
const TVER_ETA_LOW = 'доставка в Москву — 1 день';   // для середины предложения

/* ponytail: порог «мало» — 30 м² (≈20 упаковок 60×120); вынести в config, если появится своя норма. */
const LOW_SQM = 30;
/** Наличие словом и цветом: зелёный — достаточно, янтарный — мало, нейтральный — под заказ. */
function availability(t) {
  const total = t.stock.msk + t.stock.tver;
  if (total <= 0) return {cls: 'order', text: 'Под заказ'};
  if (total < LOW_SQM) return {cls: 'low', text: 'Осталось мало'};
  return {cls: 'ok', text: 'В наличии'};
}

const NO_PHOTO = `<div class="no-photo">
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v14H4z"/><path d="m4 16 5-5 4 4 3-3 4 4"/>
    <circle cx="9" cy="9" r="1.4"/></svg><span>фото скоро</span></div>`;

/* ---------- общие состояния ---------- */
const toast = (text, kind = '') => {
  const el = $('#toast'); if (!el) return;
  el.textContent = text; el.className = 'show ' + kind;
  clearTimeout(toast.t); toast.t = setTimeout(() => el.className = '', 3600);
};

/** Карточки проявляются по мере прокрутки. */
function revealOnScroll(root) {
  const items = root.querySelectorAll('.reveal:not(.in)');
  if (!('IntersectionObserver' in window)) return items.forEach(el => el.classList.add('in'));
  const io = new IntersectionObserver((entries, obs) => {
    entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); obs.unobserve(e.target); } });
  }, {rootMargin: '120px'});
  items.forEach(el => io.observe(el));
}

/** Адреса и контакты в подвале — по одной колонке на шоу-рум. */
function renderFootContacts() {
  const box = $('#foot-contacts'); if (!box) return;
  const offices = typeof OFFICES !== 'undefined' ? OFFICES : [];
  if (!offices.length) {
    box.innerHTML = `<h4>Контакты</h4><ul><li>Адрес и телефоны отдела появятся здесь.</li></ul>`;
    return;
  }
  box.outerHTML = offices.map(o => `
    <div>
      <h4>${esc(o.title)}</h4>
      <ul>
        <li>${esc(o.address)}</li>
        ${o.phones.map(t => `<li><a href="tel:${t.replace(/[^+\d]/g, '')}">${esc(t)}</a></li>`).join('')}
        <li><a href="mailto:${esc(o.email)}">${esc(o.email)}</a></li>
      </ul>
    </div>`).join('');
}

/* ---------- заявка ---------- */
const CART = 'almaly_dealer_cart';
const getCart = () => { try { return JSON.parse(localStorage.getItem(CART)) || []; } catch { return []; } };
const setCart = (c, bump) => { localStorage.setItem(CART, JSON.stringify(c)); updateCount(bump); };
const totals = cart => cart.reduce((a, i) => ({
  packs: a.packs + i.packs, sqm: a.sqm + i.packs * i.sqm, kg: a.kg + i.packs * (i.kg || 0)
}), {packs: 0, sqm: 0, kg: 0});

function updateCount(bump) {
  const cart = getCart(), n = cart.length, el = $('#cart-count');
  if (el) {
    el.textContent = n;
    const link = el.closest('.navlink');
    link?.classList.toggle('filled', n > 0);
    if (bump && link) { link.classList.remove('bump'); void link.offsetWidth; link.classList.add('bump'); }
  }
  document.body.classList.toggle('has-cart', n > 0);
  const t = totals(cart);
  const bar = $('#cart-bar');
  if (bar) bar.querySelector('.info').innerHTML =
    `<b>${n}</b> позиц. · <b>${t.packs}</b> уп. · <b>${nf(t.sqm)}</b> м²`;
  const link = $('#sticky-cart');
  if (link) { link.hidden = !n; link.textContent = `Заявка · ${n}`; }
}

/** Добавляет позицию в заявку и сообщает об этом. */
function addToCart(t, need, wh) {
  const {sqm, kg} = packInfo(t);
  const packs = packsFor(need, sqm);
  const cart = getCart();
  const same = cart.find(i => i.art === t.art && i.wh === wh);
  if (same) { same.packs += packs; same.need = +(same.need + need).toFixed(2); }
  else cart.push({art: t.art, name: t.name, format: t.format, surface: t.surface,
                  photo: t.photos.length ? img(t, 0, true) : '',
                  sqm, kg, need: +need.toFixed(2), packs, wh});
  setCart(cart, true);
  toast(`${t.name}: ${packs} уп. (${nf(packs * sqm)} м²) — в заявке`, 'ok');
  return packs;
}

/* ============================ каталог ==================================== */
const FSTATE = 'almaly_filters';

async function renderCatalog() {
  updateCount(); renderFootContacts();
  const grid = $('#grid');
  grid.innerHTML = Array.from({length: 8}, () => `<div class="sk-card"><div class="sk-ph skeleton"></div>
    <div class="sk-b"><div class="sk-line skeleton" style="width:70%"></div>
      <div class="sk-line skeleton" style="width:40%"></div>
      <div class="sk-line skeleton" style="width:90%"></div></div></div>`).join('');

  let tiles;
  try { tiles = (await load).tiles; }
  catch {
    grid.removeAttribute('aria-busy');
    grid.innerHTML = `<div class="empty" style="grid-column:1/-1"><h3>Каталог не загрузился</h3>
      <p>Проверьте подключение к интернету и обновите страницу.</p>
      <button class="btn primary" onclick="location.reload()">Обновить</button></div>`;
    return;
  }
  grid.removeAttribute('aria-busy');

  const [q, fmt, srf, wh, sort, instock, count] =
    ['q','fmt','srf','wh','sort','instock','count'].map(id => document.getElementById(id));
  const formats = [...new Set(tiles.map(t => t.format))].sort();
  fmt.innerHTML = ['Все форматы', ...formats].map((v, i) =>
    `<button class="chip" type="button" aria-pressed="${i === 0}" data-v="${i ? v : ''}">${v}</button>`).join('');
  [...new Set(tiles.map(t => t.surface))].sort().forEach(v => srf.add(new Option(v, v)));

  /* фильтры переживают переход на карточку и обратно */
  try {
    const s = JSON.parse(sessionStorage.getItem(FSTATE) || '{}');
    if (s.q) q.value = s.q;
    if (s.srf) srf.value = s.srf;
    if (s.wh) wh.value = s.wh;
    if (s.sort) sort.value = s.sort;
    if (s.instock) instock.checked = true;
    if (s.fmt) fmt.querySelectorAll('.chip').forEach(c => c.setAttribute('aria-pressed', c.dataset.v === s.fmt));
  } catch {}

  const state = () => ({q: q.value.trim(), fmt: fmt.querySelector('[aria-pressed=true]').dataset.v,
    srf: srf.value, wh: wh.value, sort: sort.value, instock: instock.checked});

  const filtered = () => {
    const s = state(), text = s.q.toLowerCase();
    const stockOf = t => s.wh === 'msk' ? t.stock.msk : s.wh === 'tver' ? t.stock.tver : t.stock.msk + t.stock.tver;
    const list = tiles.filter(t => (!s.fmt || t.format === s.fmt) && (!s.srf || t.surface === s.srf) &&
      (!s.instock || stockOf(t) > 0) &&
      (!text || (t.name + ' ' + t.art).toLowerCase().includes(text)));
    if (s.sort === 'stock') list.sort((a, b) => stockOf(b) - stockOf(a));
    if (s.sort === 'new') list.sort((a, b) => (b.is_new ? 1 : 0) - (a.is_new ? 1 : 0));
    if (s.sort === 'name') list.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    return list;
  };

  const most = Math.max(1, ...tiles.map(x => Math.max(x.stock.msk, x.stock.tver)));
  const stockRow = (name, value) => {
    const share = Math.min(100, Math.round((value / most) * 100));
    const cls = value <= 0 ? 'none' : value < most * 0.12 ? 'low' : '';
    return `<div class="stock-row ${value <= 0 ? 'is-none' : ''}"><span class="name">${name}</span>
      <span class="gauge" aria-hidden="true"><i class="${cls}" style="width:${value > 0 ? Math.max(share, 6) : 100}%"></i></span>
      <b>${m2(value)}</b></div>`;
  };

  const cardHtml = (t, i) => {
    const {sqm} = packInfo(t), av = availability(t);
    return `<article class="card reveal" style="transition-delay:${Math.min(i, 11) * 30}ms" data-art="${t.art}">
      <div class="ph">
        ${t.is_new ? '<span class="badge-new">Новинка</span>' : ''}
        ${t.photos.length
          ? `<img src="${img(t, 0, true)}" alt="Керамогранит ${esc(t.name)}, ${t.format} см" loading="lazy"
               decoding="async" width="700" height="875" onload="this.classList.add('in')"
               onerror="this.classList.add('in')">`
          : NO_PHOTO}
      </div>
      <div class="b">
        <h3><a class="stretch" href="tile.html?a=${t.art}">${esc(t.name)}</a></h3>
        <div class="row"><span class="avail ${av.cls}">${av.text}</span></div>
        <div class="meta"><span class="tag">${t.format} см</span><span class="tag">${esc(t.surface)}</span>
          <span class="tag">${nf(sqm)} м² / уп.</span></div>
        <div class="stock">${stockRow('Москва', t.stock.msk)}${stockRow('Тверь', t.stock.tver)}
          ${t.stock.tver > 0 ? `<span class="eta">Тверь · ${TVER_ETA_LOW}</span>` : ''}</div>
      </div>
      <div class="quick">
        <span class="qty-wrap">
          <input type="number" min="0.1" step="0.1" value="${(sqm * 10).toFixed(1)}"
                 aria-label="Сколько нужно, м²: ${esc(t.name)}" data-qty inputmode="decimal">
          <span class="unit">м²</span>
        </span>
        <button class="btn primary" type="button" data-add="${t.art}">В заявку</button>
      </div>
    </article>`;
  };

  const draw = () => {
    const list = filtered();
    grid.innerHTML = list.map(cardHtml).join('') ||
      `<div class="empty" style="grid-column:1/-1"><h3>Ничего не найдено</h3>
        <p>Попробуйте изменить формат, поверхность или очистить поиск.</p>
        <button class="btn" type="button" id="empty-reset">Сбросить фильтры</button></div>`;
    count.textContent = `${list.length} из ${tiles.length}`;
    const fsCount = $('#fs-count'); if (fsCount) fsCount.textContent = list.length;
    drawActive();
    revealOnScroll(grid);
    // подстраховка: фото из кеша могли загрузиться до навешивания onload
    grid.querySelectorAll('.ph img').forEach(i => { if (i.complete) i.classList.add('in'); });
    try { sessionStorage.setItem(FSTATE, JSON.stringify(state())); } catch {}
  };

  /* чипы активных фильтров + счётчик на кнопке «Фильтры» */
  const LABEL = {fmt: 'Формат', srf: 'Поверхность', wh: 'Склад', sort: 'Сортировка',
    instock: 'Только в наличии', q: 'Поиск'};
  const WH = {msk: 'Москва', tver: 'Тверь'};
  const reset = key => {
    if (key === 'fmt') fmt.querySelectorAll('.chip').forEach((c, i) => c.setAttribute('aria-pressed', i === 0));
    if (key === 'srf') srf.value = '';
    if (key === 'wh') wh.value = '';
    if (key === 'sort') sort.value = '';
    if (key === 'instock') instock.checked = false;
    if (key === 'q') q.value = '';
    draw();
  };
  const drawActive = () => {
    const s = state(), box = $('#active-filters'), chips = [];
    if (s.q) chips.push(['q', `${LABEL.q}: «${s.q}»`]);
    if (s.fmt) chips.push(['fmt', `${LABEL.fmt}: ${s.fmt}`]);
    if (s.srf) chips.push(['srf', `${LABEL.srf}: ${s.srf}`]);
    if (s.wh) chips.push(['wh', `${LABEL.wh}: ${WH[s.wh]}`]);
    if (s.instock) chips.push(['instock', LABEL.instock]);
    if (s.sort) chips.push(['sort', `${LABEL.sort}: ${sort.selectedOptions[0].text}`]);
    box.hidden = !chips.length;
    box.innerHTML = chips.map(([k, text]) =>
      `<span class="fchip">${esc(text)}<button type="button" data-clear="${k}"
        aria-label="Убрать фильтр: ${esc(text)}">✕</button></span>`).join('') +
      (chips.length > 1 ? '<button class="link-btn" type="button" data-clear="all">Сбросить всё</button>' : '');
    const n = chips.filter(([k]) => k !== 'q').length, badge = $('#filters-n');
    if (badge) { badge.hidden = !n; badge.textContent = n; }
  };
  const resetAll = () => {
    q.value = ''; srf.value = ''; wh.value = ''; sort.value = ''; instock.checked = false;
    fmt.querySelectorAll('.chip').forEach((c, i) => c.setAttribute('aria-pressed', i === 0));
    draw();
  };
  $('#active-filters').addEventListener('click', e => {
    const b = e.target.closest('[data-clear]'); if (!b) return;
    b.dataset.clear === 'all' ? resetAll() : reset(b.dataset.clear);
  });
  grid.addEventListener('click', e => { if (e.target.id === 'empty-reset') resetAll(); });

  fmt.addEventListener('click', e => {
    const b = e.target.closest('.chip'); if (!b) return;
    fmt.querySelectorAll('.chip').forEach(c => c.setAttribute('aria-pressed', c === b));
    draw();
  });
  [q, srf, wh, sort, instock].forEach(el => el.addEventListener('input', draw));

  /* быстрое добавление прямо из карточки */
  grid.addEventListener('click', e => {
    const b = e.target.closest('[data-add]'); if (!b) return;
    e.preventDefault();
    const card = b.closest('.card');
    const t = tiles.find(x => x.art === b.dataset.add);
    addToCart(t, num(card.querySelector('[data-qty]').value),
      t.stock.msk > 0 ? 'Москва' : t.stock.tver > 0 ? 'Тверь' : 'Под заказ');
    card.classList.add('added');
    b.textContent = 'Добавлено ✓';
    clearTimeout(card.t);
    card.t = setTimeout(() => { card.classList.remove('added'); b.textContent = 'В заявку'; }, 1800);
  });

  initFilterSheet(draw, resetAll);
  draw();

  $('#s-models').textContent = tiles.length;
  $('#s-new').textContent = tiles.filter(t => t.is_new).length;
  $('#s-stock').textContent = nf(tiles.reduce((a, t) => a + t.stock.msk + t.stock.tver, 0), 0);
  $('#stat').textContent = `${tiles.length} моделей · обновление остатков ежедневно`;
}

/** Мобильные фильтры: те же элементы переезжают в нижнюю панель — состояние одно. */
function initFilterSheet(draw, resetAll) {
  const sheet = $('#filter-sheet'), back = $('#sheet-back'), btn = $('#filters-btn');
  if (!sheet || !btn) return;
  const moves = [['fmt', 'm-fmt'], ['srf', 'm-srf'], ['wh', 'm-wh'], ['sort', 'm-sort']];
  const toggleEl = $('#instock').closest('.toggle');
  const home = new Map();
  [...moves.map(([id]) => document.getElementById(id)), toggleEl].forEach(el =>
    home.set(el, [el.parentNode, el.nextSibling]));

  const mq = matchMedia('(max-width:760px)');
  const place = () => {
    if (mq.matches) {
      moves.forEach(([id, into]) => document.getElementById(into).append(document.getElementById(id)));
      $('#m-instock').append(toggleEl);
    } else {
      home.forEach(([parent, next], el) => parent.insertBefore(el, next));
      close();
    }
  };
  const open = () => {
    sheet.hidden = back.hidden = false;
    requestAnimationFrame(() => { sheet.classList.add('open'); back.classList.add('open'); });
    document.body.style.overflow = 'hidden';
    sheet.querySelector('button, select, input')?.focus({preventScroll: true});
  };
  const close = () => {
    sheet.classList.remove('open'); back.classList.remove('open');
    document.body.style.overflow = '';
    setTimeout(() => { if (!sheet.classList.contains('open')) sheet.hidden = back.hidden = true; }, 280);
  };
  btn.addEventListener('click', open);
  back.addEventListener('click', close);
  $('#fs-apply').addEventListener('click', close);
  $('#fs-reset').addEventListener('click', () => { resetAll(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !sheet.hidden) close(); });
  mq.addEventListener('change', place);
  place();
}

/* ============================ страница модели ============================ */
async function renderTile() {
  updateCount(); renderFootContacts();
  const box = $('#tile');
  const {tiles} = await load;
  const t = tiles.find(x => x.art === new URLSearchParams(location.search).get('a'));
  if (!t) {
    box.innerHTML = `<div class="empty" style="margin:60px 0"><h3>Модель не найдена</h3>
      <p>Возможно, артикул изменился или карточка убрана из каталога.</p>
      <a class="btn primary" href="index.html">Вернуться в каталог</a></div>`;
    return;
  }
  document.title = `${t.name} — керамогранит ${t.format} см | Алмалы-Керамик`;
  const {sqm, kg} = packInfo(t);
  const av = availability(t);
  const res = (t.stock.msk_res || 0) + (t.stock.tver_res || 0);

  box.innerHTML = `
    <nav class="crumbs" aria-label="Хлебные крошки">
      <a href="index.html">Каталог</a><span class="sep">/</span>
      <a href="index.html#catalog">${t.format} см</a><span class="sep">/</span>
      <span>${esc(t.name)}</span>
    </nav>
    <div class="tile">
      <div class="gallery">
        ${t.photos.length ? `
          <div class="main-ph"><img id="big" src="${img(t, 0)}"
            alt="Керамогранит ${esc(t.name)}, ${t.format} см" decoding="async"></div>
          ${t.photos.length > 1 ? `<div class="thumbs" id="thumbs">${t.photos.map((p, i) =>
            `<button type="button" data-i="${i}" aria-current="${i === 0}" aria-label="Фото ${i + 1}">
               <img src="${img(t, i, true)}" alt="" loading="lazy"></button>`).join('')}</div>` : ''}`
          : `<div class="main-ph" style="aspect-ratio:4/3">${NO_PHOTO}</div>`}
      </div>

      <div class="side">
        <div class="tile-head">
          ${t.is_new ? '<span class="tag new">Новинка</span>' : ''}
          <span class="avail ${av.cls}">${av.text}</span>
        </div>
        <h1>${esc(t.name)}</h1>

        <div class="panel">
          <div class="panel-title">Характеристики</div>
          <table class="spec">
            <tr><th>Формат</th><td>${t.format} см</td></tr>
            <tr><th>Поверхность</th><td>${esc(t.surface)}</td></tr>
            <tr><th>В упаковке</th><td>${nf(sqm)} м²${kg ? ` · ${nf(kg, 1)} кг` : ''}</td></tr>
            <tr><th>Паллета</th><td>${esc(t.pallet) || '—'}</td></tr>
          </table>
          <div class="panel-title" style="margin-top:20px">Остатки складов</div>
          <table class="spec">
            <tr><th>Москва</th><td>${m2(t.stock.msk)}</td></tr>
            <tr><th>Тверь</th><td>${m2(t.stock.tver)}</td></tr>
            ${res > 0 ? `<tr><th>В резерве</th><td>${m2(res)}</td></tr>` : ''}
          </table>
          ${t.stock.tver > 0 ? `<p class="eta-note">Со склада Тверь: ${TVER_ETA_LOW}.</p>` : ''}
        </div>

        <div class="panel accent">
          <div class="panel-title">Расчёт заказа</div>
          <div class="row-2">
            <div class="field"><label for="need">Нужно, м²</label>
              <input id="need" type="number" min="0.1" step="0.1" value="${(sqm * 10).toFixed(2)}" inputmode="decimal"></div>
            <div class="field"><label for="wh-sel">Склад отгрузки</label>
              <select id="wh-sel">
                <option value="Москва">Москва — ${m2(t.stock.msk)}</option>
                <option value="Тверь">Тверь — ${m2(t.stock.tver)} · +1 день</option>
                <option value="Под заказ">Под заказ</option>
              </select></div>
          </div>
          <div class="calc-out" id="calc"></div>
          <div id="calc-note"></div>
          <button class="btn primary wide lg" id="add" type="button" style="margin-top:16px">Добавить в заявку</button>
        </div>

        <div class="panel">
          <div class="panel-title">Упаковка и отгрузка</div>
          <p class="lead">Отгружаем только целыми упаковками: ${nf(sqm)} м²${kg ? ` и ${nf(kg, 1)} кг` : ''} в упаковке.
            ${t.pallet ? `Паллета: ${esc(t.pallet)}.` : ''}
            Самовывоз со склада, транспорт поставщика или транспортная компания —
            способ выбирается при оформлении заявки. Цены и сроки подтверждает менеджер.</p>
        </div>
      </div>
    </div>`;

  $('#thumbs')?.addEventListener('click', e => {
    const b = e.target.closest('button[data-i]'); if (!b) return;
    $('#big').src = img(t, +b.dataset.i);
    $('#thumbs').querySelectorAll('button').forEach(x => x.setAttribute('aria-current', x === b));
  });

  const need = $('#need'), whSel = $('#wh-sel');
  whSel.value = t.stock.msk > 0 ? 'Москва' : t.stock.tver > 0 ? 'Тверь' : 'Под заказ';
  const calc = () => {
    const want = num(need.value), packs = packsFor(want, sqm), real = packs * sqm;
    const avail = whSel.value === 'Москва' ? t.stock.msk : whSel.value === 'Тверь' ? t.stock.tver : Infinity;
    $('#calc').innerHTML = `
      <div class="calc-cell"><b>${packs}</b><span>упаковок</span></div>
      <div class="calc-cell"><b>${nf(real)}</b><span>м² к отгрузке</span></div>
      ${kg ? `<div class="calc-cell quiet"><b>${nf(packs * kg, 0)}</b><span>кг, ориентировочно</span></div>` : ''}`;
    const other = whSel.value === 'Москва' ? ['Тверь', t.stock.tver] : ['Москва', t.stock.msk];
    const eta = whSel.value === 'Тверь'
      ? `<div class="note" style="margin-top:12px">
           <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
             <path d="M3 7h11v9H3zM14 10h4l3 3v3h-7z"/><circle cx="7" cy="18" r="1.8"/><circle cx="17.5" cy="18" r="1.8"/></svg>
           <span>Отгрузка со склада Тверь: ${TVER_ETA_LOW}, на день дольше, чем из Москвы.</span></div>`
      : '';
    $('#calc-note').innerHTML = eta + (real <= avail ? '' : `<div class="note warn" style="margin-top:12px">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
        <path d="M12 8v5M12 17h.01M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>
      <span>На складе ${whSel.value} свободно ${m2(avail)}.
      ${other[1] > 0 ? `На складе ${other[0]} — ${m2(other[1])}.` : ''}
      Недостающее оформим под заказ — менеджер подтвердит срок.</span></div>`);
    const info = $('#sticky-info');
    if (info) info.innerHTML = `<b>${packs} уп. · ${nf(real)} м²</b>${esc(whSel.value)}`;
  };
  ['input', 'change'].forEach(ev => { need.addEventListener(ev, calc); whSel.addEventListener(ev, calc); });
  calc();

  const add = () => addToCart(t, num(need.value), whSel.value);
  $('#add').addEventListener('click', add);
  $('#sticky-add-btn')?.addEventListener('click', add);
}
