/* Оформление заявки: позиции в м², данные дилера, проверка полей, отправка и упаковочный лист. */
const F = ['customer','inn','person','phone','email','city','delivery','address','payment','ship','note'];
const formData = () => Object.fromEntries(F.map(k => [k, ($('#f-' + k)?.value || '').trim()]));
const fmtDate = s => s ? new Date(s + 'T00:00:00').toLocaleDateString('ru-RU') : '—';
/** Местная дата в виде ГГГГ-ММ-ДД: toISOString даёт UTC и под утро «отматывает» сутки. */
const today = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

const newNo = () => 'АК-' + today().slice(2).replace(/-/g, '') + '-' +
  Math.random().toString(36).slice(2, 5).toUpperCase();
function orderNo() {
  let n = localStorage.getItem('almaly_order_no');
  if (!n) { n = newNo(); localStorage.setItem('almaly_order_no', n); }
  return n;
}

/* ---------- позиции и итог ---------- */
function renderItems() {
  const cart = getCart(), box = $('#items');
  if (!cart.length) {
    box.innerHTML = `<div class="empty"><h3>В заявке пока нет позиций</h3>
      <p>Выберите модели в каталоге и укажите нужную площадь — упаковки посчитаем автоматически.</p>
      <a class="btn primary" href="index.html">Перейти в каталог</a></div>`;
    renderSummary(); renderSheet(); return;
  }
  box.innerHTML = `<table class="items">
    <thead><tr><th><span class="visually-hidden">Фото</span></th><th>Модель</th><th>Формат</th>
      <th>Нужно, м²</th><th>Упаковок</th><th>К отгрузке</th><th>Склад</th>
      <th><span class="visually-hidden">Убрать</span></th></tr></thead>
    <tbody>${cart.map((i, n) => `<tr>
      <td data-l="">${i.photo ? `<img class="thumb" src="${i.photo}" alt="" loading="lazy">`
        : '<span class="thumb noimg"></span>'}</td>
      <td data-l="Модель"><b>${esc(i.name)}</b><div class="art">${i.format} см · ${esc(i.surface)}</div></td>
      <td data-l="Формат">${i.format} см</td>
      <td data-l="Нужно, м²"><input class="qty" type="number" min="0.1" step="0.1" value="${i.need}"
        data-n="${n}" data-k="need" inputmode="decimal" aria-label="Нужно м²: ${esc(i.name)}"></td>
      <td data-l="Упаковок"><b>${i.packs}</b></td>
      <td data-l="К отгрузке">${nf(i.packs * i.sqm)} м²${i.kg ? ` · ${nf(i.packs * i.kg, 0)} кг` : ''}</td>
      <td data-l="Склад"><select data-n="${n}" data-k="wh" aria-label="Склад: ${esc(i.name)}">
        ${['Москва','Тверь','В пути'].map(w => `<option ${w === i.wh ? 'selected' : ''}>${w}</option>`).join('')}
      </select></td>
      <td data-l="" class="cell-rm"><button class="icon-btn danger" data-rm="${n}" type="button"
        aria-label="Убрать ${esc(i.name)} из заявки">✕</button></td></tr>`).join('')}
    </tbody></table>`;
  renderSummary(); renderSheet();
}

function renderSummary() {
  const cart = getCart(), t = totals(cart), box = $('#summary');
  box.innerHTML = `
    <h3>Итог заявки</h3>
    <div class="sum-row"><span>Позиций</span><b>${cart.length}</b></div>
    <div class="sum-row"><span>Упаковок</span><b>${t.packs}</b></div>
    ${t.kg ? `<div class="sum-row"><span>Вес, ориентировочно</span><b>${nf(t.kg, 0)} кг</b></div>` : ''}
    <div class="sum-row total"><span>К отгрузке</span><b>${nf(t.sqm)} м²</b></div>
    <button class="btn primary wide lg" id="send" type="button" ${cart.length ? '' : 'disabled'}>
      Отправить заявку</button>
    <div class="note">Заявка — не мгновенный онлайн-заказ. Менеджер проверит остатки,
      подтвердит цены и срок отгрузки.</div>`;
}

/* ---------- упаковочный лист ---------- */
function sheetHtml(o) {
  const t = totals(o.items || []);
  return `<div class="sheet">
    <div class="top">
      <div class="mark">
        <svg viewBox="0 0 104 104" aria-hidden="true"><polygon points="52,4 73,25 25,73 4,52" fill="#d8202a"/>
          <polygon points="79,31 100,52 52,100 31,79" fill="#17191b"/></svg>
        <div><h1>Заявка на отгрузку</h1>
          <div class="company">${COMPANY.name} · ${COMPANY.tagline}
            ${HAS_CONTACTS() ? `<br>${COMPANY.phone} · ${COMPANY.email}` : ''}</div>
        </div>
      </div>
      <div class="no">заявка<b>№ ${esc(o.no)}</b>от ${fmtDate(o.date)}</div>
    </div>
    <div class="pairs">
      <div class="pair"><span>Заказчик</span>${esc(o.customer) || '—'}</div>
      <div class="pair"><span>ИНН</span>${esc(o.inn) || '—'}</div>
      <div class="pair"><span>Контактное лицо</span>${esc(o.person) || '—'}</div>
      <div class="pair"><span>Телефон</span>${esc(o.phone) || '—'}</div>
      <div class="pair"><span>Почта</span>${esc(o.email) || '—'}</div>
      <div class="pair"><span>Город / адрес</span>${esc(o.city) || '—'}</div>
      <div class="pair"><span>Способ доставки</span>${esc(o.delivery)}</div>
      <div class="pair"><span>ТК / адрес доставки</span>${esc(o.address) || '—'}</div>
      <div class="pair"><span>Способ оплаты</span>${esc(o.payment)}</div>
      <div class="pair"><span>Желаемая отгрузка</span>${fmtDate(o.ship)}</div>
    </div>
    <table>
      <thead><tr><th>№</th><th>Модель</th><th>Формат</th><th>Поверхность</th>
        <th class="num">Упак.</th><th class="num">м²</th><th class="num">Вес, кг</th><th>Склад</th></tr></thead>
      <tbody>${(o.items || []).map((i, n) => `<tr>
        <td>${n + 1}</td><td>${esc(i.name)}</td><td>${i.format}</td><td>${esc(i.surface)}</td>
        <td class="num">${i.packs}</td><td class="num">${nf(i.packs * i.sqm)}</td>
        <td class="num">${i.kg ? nf(i.packs * i.kg, 0) : '—'}</td><td>${esc(i.wh)}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td colspan="4">Итого</td><td class="num">${t.packs}</td><td class="num">${nf(t.sqm)}</td>
        <td class="num">${t.kg ? nf(t.kg, 0) : '—'}</td><td></td></tr></tfoot>
    </table>
    ${o.note ? `<div class="company"><b>Комментарий:</b> ${esc(o.note)}</div>` : ''}
    <div class="signs"><div>Заказчик / подпись</div><div>Менеджер поставщика / подпись</div></div>
    <div class="foot">Количество округлено до целых упаковок. Цены и сроки подтверждает менеджер
      после проверки остатков.</div>
  </div>`;
}

const currentOrder = () => ({no: orderNo(), ...formData(), items: getCart(),
  date: $('#f-date')?.value || today()});

function renderSheet() {
  const has = getCart().length > 0;
  $('#sheet').innerHTML = has ? sheetHtml(currentOrder()) : '';
  $('#sheet-title').hidden = !has;
}

const orderText = o => {
  const t = totals(o.items);
  return [`Заявка № ${o.no} от ${fmtDate(o.date)}`,
    `Заказчик: ${o.customer}${o.person ? ', ' + o.person : ''}${o.phone ? ', ' + o.phone : ''}`,
    o.city && `Город: ${o.city}`, '',
    ...o.items.map((i, n) => `${n + 1}. ${i.name}, ${i.format} — ${i.packs} уп. / ${nf(i.packs * i.sqm)} м², ${i.wh}`),
    '', `Итого: ${t.packs} уп. / ${nf(t.sqm)} м²${t.kg ? ' / ' + nf(t.kg, 0) + ' кг' : ''}`,
    `Доставка: ${o.delivery}${o.address ? ' — ' + o.address : ''}`, `Оплата: ${o.payment}`,
    o.ship && `Отгрузка: ${fmtDate(o.ship)}`, o.note && `Комментарий: ${o.note}`,
  ].filter(Boolean).join('\n');
};

/* ---------- проверка полей ---------- */
const digits = s => s.replace(/\D/g, '');
/** Каждое правило говорит, что не так и что сделать. */
const RULES = {
  customer: v => v ? '' : 'Укажите наименование заказчика — так мы оформим документы.',
  person:   v => v ? '' : 'Укажите, к кому обращаться менеджеру.',
  phone:    v => !v ? 'Без телефона менеджер не сможет подтвердить заявку.'
                    : digits(v).length < 10 ? 'Проверьте номер: нужно не меньше 10 цифр.' : '',
  email:    v => !v || /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(v) ? '' : 'Проверьте адрес почты — похоже, в нём опечатка.',
  inn:      v => !v || [10, 12].includes(digits(v).length) ? '' : 'ИНН состоит из 10 или 12 цифр.',
};

function showError(key, message) {
  const field = document.querySelector(`.field[data-for="${key}"]`);
  if (!field) return;
  field.classList.toggle('invalid', !!message);
  field.querySelector('.msg').textContent = message;
  field.querySelector('input')?.setAttribute('aria-invalid', message ? 'true' : 'false');
}

function checkField(key) {
  const el = $('#f-' + key); if (!el || !RULES[key]) return true;
  const msg = RULES[key](el.value.trim());
  showError(key, msg);
  return !msg;
}

function validate() {
  const bad = Object.keys(RULES).filter(k => !checkField(k));
  if (!getCart().length) { toast('Заявка пуста — выберите плитку в каталоге', 'err'); return false; }
  if (!bad.length) return true;
  const el = $('#f-' + bad[0]);
  el.scrollIntoView({behavior: 'smooth', block: 'center'});
  el.focus({preventScroll: true});
  toast('Проверьте отмеченные поля', 'err');
  return false;
}

/** Телефон в привычном виде: +7 900 000-00-00, но исходные цифры не теряем. */
function maskPhone(el) {
  const d = digits(el.value).replace(/^8/, '7').slice(0, 11);
  if (!d) { el.value = ''; return; }
  const p = d.startsWith('7') ? d.slice(1) : d;
  const parts = ['+7', p.slice(0, 3), p.slice(3, 6), p.slice(6, 8), p.slice(8, 10)].filter(Boolean);
  el.value = parts[0] + (parts[1] ? ' ' + parts[1] : '') + (parts[2] ? ' ' + parts[2] : '') +
    (parts[3] ? '-' + parts[3] : '') + (parts[4] ? '-' + parts[4] : '');
}

/* ---------- отправка ---------- */
/** Ссылка на заявку для панели продавца: все данные внутри адреса, сервер не нужен. */
const adminLink = o => location.origin + location.pathname.replace(/order\.html$/, 'admin.html') +
  '#o=' + btoa(unescape(encodeURIComponent(JSON.stringify(o))));

let sending = false;
async function submitOrder() {
  if (sending || !validate()) return;
  const o = currentOrder();
  const btn = $('#send');
  if (!ORDERS_API) {          // приём заявок ещё не подключён — отдаём заявку ссылкой
    return done(o, 'Заявка сформирована. Отправьте её менеджеру кнопкой ниже.', adminLink(o));
  }
  sending = true;
  btn.disabled = true; btn.innerHTML = '<span class="spin" aria-hidden="true"></span>Отправляю…';
  try {
    // даты отправляем с апострофом: иначе таблица считает их своими датами и сдвигает
    const payload = {...o, date: "'" + o.date, ship: o.ship ? "'" + o.ship : ''};
    const r = await fetch(ORDERS_API, {method: 'POST', headers: {'Content-Type': 'text/plain;charset=utf-8'},
      body: JSON.stringify({action: 'create', order: payload})});
    const d = await r.json();
    if (!d.ok) throw new Error(d.error || 'сервер отклонил заявку');
    done({...o, no: d.no || o.no}, 'Менеджер свяжется с вами после проверки остатков.');
  } catch (e) {
    sending = false;
    btn.disabled = false; btn.textContent = 'Отправить заявку';
    const offline = !navigator.onLine;
    toast(offline ? 'Нет интернета — заявка не ушла. Проверьте связь и попробуйте снова.'
                  : 'Не удалось отправить: ' + e.message + '. Попробуйте ещё раз или отправьте в WhatsApp.', 'err');
  }
}

/** Экран «заявка отправлена»: номер, печать листа, новая заявка. */
function done(o, message, link) {
  localStorage.setItem('almaly_last_order', JSON.stringify(o));
  const mine = JSON.parse(localStorage.getItem('almaly_my_orders') || '[]');
  mine.unshift({no: o.no, date: o.date, sent: new Date().toISOString(), status: 'new',
    ...totals(o.items), items: o.items, delivery: o.delivery, address: o.address,
    payment: o.payment, ship: o.ship, note: o.note, customer: o.customer, person: o.person,
    phone: o.phone, email: o.email, inn: o.inn, city: o.city});
  localStorage.setItem('almaly_my_orders', JSON.stringify(mine.slice(0, 20)));
  localStorage.removeItem(CART); localStorage.removeItem('almaly_order_no');
  updateCount();
  $('#flow').innerHTML = `
    <div class="done">
      <div class="done-mark"><svg viewBox="0 0 40 40" aria-hidden="true"><path d="M9 21l7.5 7.5L31 13"/></svg></div>
      <h2>Заявка № ${esc(o.no)} принята</h2>
      <p>${esc(message)} Сохраните упаковочный лист — он пригодится при отгрузке.
        Номер заявки виден в разделе «Мои заявки» внизу страницы.</p>
      <div class="actions">
        ${link && HAS_CONTACTS() ? '<button class="btn primary" id="send-wa" type="button">Отправить менеджеру в WhatsApp</button>' : ''}
        <button class="btn" onclick="print()" type="button">Печать и PDF</button>
        ${link ? '<button class="btn" id="copy-link" type="button">Скопировать ссылку</button>' : ''}
        <a class="btn ghost" href="index.html">Новая заявка</a>
      </div>
    </div>`;
  $('#sheet').innerHTML = sheetHtml(o);
  $('#sheet-title').hidden = false;
  renderMyOrders();
  trackMyOrders();
  $('#send-wa')?.addEventListener('click', () =>
    open(`https://wa.me/${COMPANY.whatsapp}?text=` +
      encodeURIComponent(orderText(o) + '\n\nЗаявка для панели продавца:\n' + link), '_blank'));
  $('#copy-link')?.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(link); toast('Ссылка скопирована — отправьте её менеджеру', 'ok'); }
    catch { prompt('Скопируйте ссылку на заявку:', link); }
  });
  scrollTo({top: 0, behavior: 'smooth'});
}

/* ---------- мои заявки и их статусы ---------- */
const MINE = 'almaly_my_orders';
const STATUS = {new: 'Новая', work: 'В работе', done: 'Отгружена', cancel: 'Отменена',
                gone: 'Не активна'};
const STATUS_HINT = {
  new: 'Менеджер её ещё не открывал',
  work: 'Менеджер проверяет остатки и готовит отгрузку',
  done: 'Отгружена со склада',
  cancel: 'Заявка отменена — уточните причину у менеджера',
  gone: 'Заявку убрали из журнала: она обработана или отменена. Уточните у менеджера',
};
const myOrders = () => { try { return JSON.parse(localStorage.getItem(MINE) || '[]'); } catch { return []; } };
const saveMine = list => localStorage.setItem(MINE, JSON.stringify(list));
const fmtSent = s => s ? new Date(s).toLocaleString('ru-RU',
  {day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit'}) : '—';

/** История заявок этого дилера — статус, состав, повтор и печать листа. */
function renderMyOrders() {
  const box = $('#my-orders'); if (!box) return;
  const mine = myOrders();
  box.innerHTML = !mine.length ? '' : `
    <div class="section-title"><h2>Мои заявки</h2></div>
    <div class="mine-head">
      <p class="lead">Статус ставит менеджер. «Не активна» — заявку убрали из журнала:
        она обработана или отменена.</p>
      <span class="mine-act">
        ${ORDERS_API ? '<button class="link-btn" type="button" id="refresh-mine">Обновить статусы</button>' : ''}
        <button class="link-btn" type="button" id="clear-mine">Очистить историю</button>
      </span>
    </div>
    <div class="my-orders">${mine.map((o, n) => {
      const st = STATUS[o.status] ? o.status : '';
      const items = o.items || [];
      return `<article class="my-order ${o.status === 'gone' ? 'is-gone' : ''}">
        <div class="mo-top">
          <b>№ ${esc(o.no)}</b>
          <span class="when">${fmtSent(o.sent)}</span>
          <span class="status ${st ? 's-' + st : ''}" title="${esc(st ? STATUS_HINT[st] : 'Сервис ещё не сообщил статус')}">
            ${st ? STATUS[st] : 'Статус уточняется'}</span>
        </div>
        <div class="mo-sum">
          <span><b>${items.length || '—'}</b> позиц.</span>
          <span><b>${o.packs}</b> уп.</span>
          <span><b>${nf(o.sqm)}</b> м²</span>
          ${o.kg ? `<span><b>${nf(o.kg, 0)}</b> кг</span>` : ''}
          ${o.delivery ? `<span class="mo-way">${esc(o.delivery)}</span>` : ''}
        </div>
        ${items.length ? `
          <details class="mo-items">
            <summary>Состав заявки</summary>
            <ul>${items.map(i => `<li>${esc(i.name)} · ${i.format} см — <b>${i.packs}</b> уп.
              (${nf(i.packs * i.sqm)} м²), ${esc(i.wh)}</li>`).join('')}</ul>
            ${o.note ? `<p class="mo-note">Комментарий: ${esc(o.note)}</p>` : ''}
          </details>` : ''}
        <div class="mo-act">
          ${items.length ? `<button class="btn sm" type="button" data-repeat="${n}">Повторить заявку</button>
            <button class="btn sm" type="button" data-sheet="${n}">Упаковочный лист</button>` : ''}
          <button class="btn sm ghost" type="button" data-forget="${n}">Убрать из истории</button>
        </div>
      </article>`;
    }).join('')}</div>`;

  $('#refresh-mine')?.addEventListener('click', () => trackMyOrders(true));
  $('#clear-mine')?.addEventListener('click', () => {
    if (!confirm('Очистить историю заявок на этом устройстве? Сами заявки у менеджера останутся.')) return;
    localStorage.removeItem(MINE); renderMyOrders(); toast('История очищена');
  });
  box.querySelector('.my-orders')?.addEventListener('click', e => {
    const b = e.target.closest('[data-repeat],[data-sheet],[data-forget]'); if (!b) return;
    const list = myOrders();
    if (b.dataset.repeat !== undefined) return repeatOrder(list[+b.dataset.repeat]);
    if (b.dataset.sheet !== undefined) return printPast(list[+b.dataset.sheet]);
    const gone = list.splice(+b.dataset.forget, 1)[0];
    saveMine(list); renderMyOrders();
    toast(`Заявка № ${gone.no} убрана из истории`);
  });
}

/** Повтор заявки: те же позиции снова в корзину, данные заказчика уже сохранены в полях. */
function repeatOrder(o) {
  if (!o?.items?.length) return;
  const cart = getCart();
  o.items.forEach(i => {
    const same = cart.find(x => x.art === i.art && x.wh === i.wh);
    if (same) { same.packs += i.packs; same.need = +(same.need + i.need).toFixed(2); }
    else cart.push({...i});
  });
  setCart(cart, true);
  renderItems();
  toast(`Позиции заявки № ${o.no} снова в заявке — проверьте объём`, 'ok');
  scrollTo({top: 0, behavior: 'smooth'});
}

/** Печать листа по прошлой заявке — не заполняя форму заново. */
function printPast(o) {
  if (!o?.items?.length) return;
  $('#sheet').innerHTML = sheetHtml(o);
  $('#sheet-title').hidden = false;
  print();
  renderSheet();          // возвращаем на место текущий лист
}

/** Спрашиваем у сервиса статусы только своих номеров — личные данные при этом не передаются. */
async function trackMyOrders(loud) {
  const mine = myOrders();
  if (!ORDERS_API || !mine.length) return;
  if (loud) toast('Обновляю статусы…');
  try {
    const r = await fetch(ORDERS_API, {method: 'POST', headers: {'Content-Type': 'text/plain;charset=utf-8'},
      body: JSON.stringify({action: 'track', nos: mine.map(o => o.no)})});
    const d = await r.json();
    if (!d.ok || !d.statuses) throw new Error(d.error || 'сервис не ответил');
    let changed = false;
    mine.forEach(o => {
      // номера нет в журнале — значит менеджер её удалил: помечаем «Не активна»
      const status = d.statuses[o.no] || 'gone';
      if (status !== o.status) { o.status = status; changed = true; }
    });
    if (changed) saveMine(mine);
    renderMyOrders();
    if (loud) toast('Статусы обновлены', 'ok');
  } catch (e) {
    if (loud) toast('Статусы недоступны: ' + e.message + '. Уточните у менеджера.', 'err');
  }
}

/* ---------- страница ---------- */

function renderOrder() {
  updateCount(); renderFootContacts(); renderMyOrders(); trackMyOrders();
  $('#f-date').value = today();
  F.forEach(k => {
    const el = $('#f-' + k); if (!el) return;
    const saved = localStorage.getItem('almaly_f_' + k);
    if (saved && !el.value) el.value = saved;
    el.addEventListener('input', e => {
      if (k === 'phone') maskPhone(e.target);
      localStorage.setItem('almaly_f_' + k, e.target.value);
      showError(k, '');
      renderSheet();
    });
    el.addEventListener('blur', () => checkField(k));
  });
  if ($('#f-phone').value) maskPhone($('#f-phone'));
  renderItems();

  $('#items').addEventListener('input', e => {
    const el = e.target.closest('[data-k]'); if (!el) return;
    const cart = getCart(), i = cart[+el.dataset.n];
    if (el.dataset.k === 'need') {
      i.need = num(el.value);
      i.packs = packsFor(i.need, i.sqm);
    } else i.wh = el.value;
    setCart(cart); renderItems();
  });
  $('#items').addEventListener('click', e => {
    const b = e.target.closest('[data-rm]'); if (!b) return;
    const cart = getCart(), gone = cart.splice(+b.dataset.rm, 1)[0];
    setCart(cart); renderItems();
    toast(`${gone.name} убрана из заявки`);
  });

  $('#summary').addEventListener('click', e => { if (e.target.closest('#send')) submitOrder(); });
  $('#pdf').addEventListener('click', () => validate() && print());
  $('#clear').addEventListener('click', () => {
    if (!getCart().length) return toast('Заявка и так пуста');
    if (!confirm('Убрать все позиции из заявки?')) return;
    localStorage.removeItem(CART); localStorage.removeItem('almaly_order_no');
    renderItems(); updateCount(); toast('Заявка очищена');
  });
}
