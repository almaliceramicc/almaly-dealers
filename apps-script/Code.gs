/**
 * Приём заявок дилерского портала «Алмалы-Керамик».
 * Заявки складываются в лист «Заявки», статусы меняются из панели продавца.
 *
 * Настройка: см. apps-script/README.md
 */
var ADMIN_CODE = 'admin';                      // ← пароль продавца из docs/config.js (сейчас admin)
var NOTIFY_EMAIL = '';                         // ← почта для уведомлений, можно оставить пустой
var TELEGRAM_TOKEN = '';                       // ← токен бота от @BotFather, если нужны уведомления в Telegram
var TELEGRAM_CHAT = '';                        // ← кому слать: один чат, список через запятую
                                               //   или ['123', '-100123'] — группа менеджеров.
                                               //   Пусто — скрипт сам возьмёт последний чат, где писали боту.
var BOT_PASSWORD = 'almaly-2026';              // ← пароль входа в бота для сотрудников
var SHEET = 'Заявки';
var SUBS_KEY = 'TG_SUBS';                      // список сотрудников, подписанных на бота
var STATUS_RU = {new: 'Новая', work: 'В работе', done: 'Отгружена', cancel: 'Отменена'};

var HEAD = ['Номер', 'Получена', 'Статус', 'Дата заявки', 'Заказчик', 'ИНН', 'Контактное лицо',
            'Телефон', 'Почта', 'Город', 'Доставка', 'ТК / адрес', 'Оплата', 'Отгрузка',
            'Комментарий', 'Упаковок', 'м²', 'Позиции (JSON)'];

function sheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET);
  if (!sh) {
    sh = ss.insertSheet(SHEET);
    sh.appendRow(HEAD);
    sh.getRange(1, 1, 1, HEAD.length).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

/** Значения вроде «+7 900…» таблица принимает за формулу — помечаем их как текст. */
function text_(v) {
  var s = v == null ? '' : String(v);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function totals_(items) {
  var packs = 0, sqm = 0;
  (items || []).forEach(function (i) { packs += Number(i.packs) || 0; sqm += (Number(i.packs) || 0) * (Number(i.sqm) || 0); });
  return {packs: packs, sqm: Math.round(sqm * 100) / 100};
}

/* ================= сотрудники, подписанные на бота ================= */

function subs_() {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty(SUBS_KEY) || '{}'); }
  catch (e) { return {}; }
}
function saveSubs_(map) {
  PropertiesService.getScriptProperties().setProperty(SUBS_KEY, JSON.stringify(map));
}
function addSub_(chat, name) {
  var m = subs_();
  m[String(chat)] = {name: name || '', since: new Date().toISOString()};
  saveSubs_(m);
}
function removeSub_(chat) {
  var m = subs_(); delete m[String(chat)]; saveSubs_(m);
}
function isSub_(chat) { return !!subs_()[String(chat)]; }

/** Кому слать уведомления: сотрудники, вошедшие по паролю, плюс чаты из TELEGRAM_CHAT. */
function chatIds_() {
  var ids = Object.keys(subs_());
  var raw = TELEGRAM_CHAT;
  if (raw && raw.length) {
    var list = Array.isArray(raw) ? raw : String(raw).split(',');
    list.forEach(function (x) {
      var id = String(x).trim();
      if (id && ids.indexOf(id) === -1) ids.push(id);
    });
  }
  if (!ids.length) { var found = chatId_(); if (found) ids.push(found); }
  return ids;
}

/** Последний чат, где писали боту (запоминается в свойствах проекта). */
function chatId_() {
  var props = PropertiesService.getScriptProperties();
  var saved = props.getProperty('TELEGRAM_CHAT');
  if (saved) return saved;
  var r = UrlFetchApp.fetch('https://api.telegram.org/bot' + TELEGRAM_TOKEN + '/getUpdates',
    {muteHttpExceptions: true});
  var data = JSON.parse(r.getContentText() || '{}');
  var chats = (data.result || []).map(function (u) {
    var m = u.message || u.my_chat_member || u.channel_post || {};
    return m.chat;
  }).filter(function (c) { return c && c.id; });
  if (!chats.length) return '';
  var id = String(chats[chats.length - 1].id);
  props.setProperty('TELEGRAM_CHAT', id);
  return id;
}

/** Показать, кто сейчас получает уведомления, и кто недавно писал боту.
 *  Запустите из редактора и посмотрите «Журнал выполнения». */
function whoGetsNotifications() {
  Logger.log('Сейчас уведомления уходят в чаты: ' + (chatIds_().join(', ') || 'никому'));
  var r = UrlFetchApp.fetch('https://api.telegram.org/bot' + TELEGRAM_TOKEN + '/getUpdates',
    {muteHttpExceptions: true});
  var data = JSON.parse(r.getContentText() || '{}');
  var seen = {};
  (data.result || []).forEach(function (u) {
    var m = u.message || u.my_chat_member || u.channel_post || {};
    var c = m.chat;
    if (c && c.id) seen[c.id] = (c.title || [c.first_name, c.last_name].filter(String).join(' ') || c.username || '') +
      ' (' + c.type + ')';
  });
  var lines = Object.keys(seen).map(function (id) { return id + ' — ' + seen[id]; });
  Logger.log('Недавно писали боту: ' + (lines.join(' | ') || 'никто за последние сутки'));
}

/** Сбросить запомненный чат — если уведомления должны уходить в другое место. */
function forgetChat() {
  PropertiesService.getScriptProperties().deleteProperty('TELEGRAM_CHAT');
  Logger.log('Чат забыт — следующее уведомление уйдёт туда, откуда боту написали последним');
}

/** Уведомление менеджеру о новой заявке: Telegram и/или почта.
 *  Сбой уведомления не должен ронять приём заявки — ошибки только пишем в журнал. */
function notify_(no, o, t) {
  var lines = [
    'Новая заявка № ' + no,
    o.customer + (o.person ? ', ' + o.person : ''),
    'Телефон: ' + o.phone,
    o.city ? 'Город: ' + o.city : '',
    'Итого: ' + t.packs + ' уп. / ' + t.sqm + ' м²',
    '',
  ].filter(String).concat((o.items || []).map(function (i) {
    return '• ' + i.name + ' ' + i.format + ' — ' + i.packs + ' уп., ' + i.wh;
  }));
  if (o.delivery) lines.push('', 'Доставка: ' + o.delivery + (o.address ? ' — ' + o.address : ''));
  if (o.payment) lines.push('Оплата: ' + o.payment);
  if (o.note) lines.push('Комментарий: ' + o.note);
  var text = lines.join('\n');

  if (TELEGRAM_TOKEN) {
    var chats = chatIds_();
    if (!chats.length) Logger.log('Telegram: получателей нет — сотрудники ещё не вошли в бота');
    chats.forEach(function (chat) {
      tg_('sendMessage', {chat_id: chat, text: text, disable_web_page_preview: true,
        reply_markup: JSON.stringify(orderKeyboard_(no, 'new', o.phone))});
    });
  }
  if (NOTIFY_EMAIL) {
    try {
      MailApp.sendEmail(NOTIFY_EMAIL, 'Заявка № ' + no + ' — ' + o.customer, text);
    } catch (err) { Logger.log('Почта: ' + err); }
  }
}

/** Проверка уведомлений: запустите один раз из редактора Apps Script. */
function testNotify() {
  notify_('АК-ТЕСТ-001', {customer: 'ООО «Проверка»', person: 'Тест', phone: '+7 900 000-00-00',
    city: 'Москва', delivery: 'Самовывоз со склада', payment: 'Безналичный расчёт с НДС', note: 'Тестовое уведомление',
    items: [{name: 'Айссноу', format: '60×120', packs: 10, wh: 'Москва'}]}, {packs: 10, sqm: 14.4});
}


/* ==================== бот: разговор с сотрудником ==================== */

/** Вызов Telegram API. Ошибки не роняют скрипт — уходят в журнал. */
function tg_(method, payload) {
  try {
    var res = UrlFetchApp.fetch('https://api.telegram.org/bot' + TELEGRAM_TOKEN + '/' + method,
      {method: 'post', muteHttpExceptions: true, payload: payload});
    var body = JSON.parse(res.getContentText() || '{}');
    if (!body.ok) Logger.log('Telegram ' + method + ': ' + (body.description || res.getContentText()));
    return body;
  } catch (err) { Logger.log('Telegram ' + method + ': ' + err); return {ok: false}; }
}

/** Кнопки под заявкой: смена статуса и связь с заказчиком. */
function orderKeyboard_(no, status, phone) {
  var rows = [];
  var buttons = [];
  if (status !== 'work') buttons.push({text: '▶️ В работу', callback_data: 'st|' + no + '|work'});
  if (status !== 'done') buttons.push({text: '✅ Отгружена', callback_data: 'st|' + no + '|done'});
  if (buttons.length) rows.push(buttons);
  var second = [{text: '↩️ Новая', callback_data: 'st|' + no + '|new'},
                {text: '✖️ Отменить', callback_data: 'st|' + no + '|cancel'}];
  rows.push(second);
  var digits = String(phone || '').replace(/\D/g, '');
  var contact = [];
  if (digits) contact.push({text: '💬 WhatsApp', url: 'https://wa.me/' + digits});
  contact.push({text: '📄 Показать заявку', callback_data: 'show|' + no});
  rows.push(contact);
  return {inline_keyboard: rows};
}

/** Строка заявки из листа -> объект. */
function rowToOrder_(r) {
  return {no: String(r[0]), received: r[1], status: r[2] || 'new',
    date: r[3], customer: r[4], inn: String(r[5]), person: r[6],
    phone: String(r[7]).replace(/^'/, ''), email: r[8], city: r[9],
    delivery: r[10], address: r[11], payment: r[12], ship: r[13], note: r[14],
    packs: r[15], sqm: r[16], items: (function () { try { return JSON.parse(r[17] || '[]'); } catch (e) { return []; } })()};
}

function findOrder_(no) {
  var vals = sheet_().getDataRange().getValues();
  for (var i = 1; i < vals.length; i++) {
    if (String(vals[i][0]) === String(no)) return {row: i + 1, order: rowToOrder_(vals[i])};
  }
  return null;
}

function orderText_(o) {
  var lines = [
    'Заявка № ' + o.no + ' — ' + (STATUS_RU[o.status] || o.status),
    o.customer + (o.person ? ', ' + o.person : ''),
    'Телефон: ' + o.phone,
  ];
  if (o.email) lines.push('Почта: ' + o.email);
  if (o.city) lines.push('Город: ' + o.city);
  lines.push('Итого: ' + o.packs + ' уп. / ' + o.sqm + ' м²', '');
  (o.items || []).forEach(function (i) {
    lines.push('• ' + i.name + ' ' + i.format + ' — ' + i.packs + ' уп., ' + i.wh);
  });
  lines.push('');
  if (o.delivery) lines.push('Доставка: ' + o.delivery + (o.address ? ' — ' + o.address : ''));
  if (o.payment) lines.push('Оплата: ' + o.payment);
  if (o.note) lines.push('Комментарий: ' + o.note);
  return lines.join('\n');
}

var BOT_MENU = 'Что умеет бот:\n' +
  '/new — новые заявки\n' +
  '/work — заявки в работе\n' +
  '/last — последние 5 заявок\n' +
  '/who — кто получает уведомления\n' +
  '/stop — отписаться от уведомлений';

/** Список заявок по статусу: каждая отдельным сообщением с кнопками. */
function sendList_(chat, status, title) {
  var vals = sheet_().getDataRange().getValues().slice(1).filter(function (r) { return r[0]; });
  var list = vals.map(rowToOrder_).filter(function (o) { return !status || o.status === status; }).reverse();
  if (!list.length) return tg_('sendMessage', {chat_id: chat, text: title + ': пусто'});
  tg_('sendMessage', {chat_id: chat, text: title + ': ' + list.length});
  list.slice(0, 5).forEach(function (o) {
    tg_('sendMessage', {chat_id: chat, text: orderText_(o), disable_web_page_preview: true,
      reply_markup: JSON.stringify(orderKeyboard_(o.no, o.status, o.phone))});
  });
  if (list.length > 5) tg_('sendMessage', {chat_id: chat, text: 'Показаны 5 из ' + list.length + '. Остальные — в панели продавца.'});
}

/** Разбор входящего обновления Telegram. */
function handleTelegram_(u) {
  if (u.callback_query) return handleCallback_(u.callback_query);
  var msg = u.message || u.edited_message;
  if (!msg || !msg.chat) return;
  var chat = msg.chat.id;
  var text = String(msg.text || '').trim();
  var name = msg.chat.title || [msg.from && msg.from.first_name, msg.from && msg.from.last_name]
    .filter(String).join(' ');

  if (!isSub_(chat)) {
    // вход по паролю: пока не введён — бот ничего не показывает
    if (text === BOT_PASSWORD) {
      addSub_(chat, name);
      tg_('sendMessage', {chat_id: chat,
        text: 'Доступ открыт. Новые заявки будут приходить сюда.\n\n' + BOT_MENU});
    } else {
      tg_('sendMessage', {chat_id: chat,
        text: 'Бот отдела оптовых продаж «Алмалы-Керамик».\n' +
              'Введите пароль сотрудника одним сообщением.'});
    }
    return;
  }

  if (text === '/start' || text === '/help') {
    return tg_('sendMessage', {chat_id: chat, text: 'Вы уже вошли.\n\n' + BOT_MENU});
  }
  if (text === '/new') return sendList_(chat, 'new', 'Новые заявки');
  if (text === '/work') return sendList_(chat, 'work', 'Заявки в работе');
  if (text === '/last') return sendList_(chat, '', 'Последние заявки');
  if (text === '/who') {
    var m = subs_();
    var lines = Object.keys(m).map(function (id) { return '• ' + (m[id].name || id); });
    return tg_('sendMessage', {chat_id: chat,
      text: 'Уведомления получают:\n' + (lines.join('\n') || 'никто')});
  }
  if (text === '/stop') {
    removeSub_(chat);
    return tg_('sendMessage', {chat_id: chat, text: 'Отписал. Чтобы вернуться — снова введите пароль.'});
  }
  tg_('sendMessage', {chat_id: chat, text: BOT_MENU});
}

/** Нажатие кнопки под заявкой. */
function handleCallback_(cb) {
  var chat = cb.message && cb.message.chat && cb.message.chat.id;
  var answer = function (t) { tg_('answerCallbackQuery', {callback_query_id: cb.id, text: t || ''}); };
  if (!isSub_(chat)) return answer('Сначала войдите по паролю');

  var parts = String(cb.data || '').split('|');
  var found = findOrder_(parts[1]);
  if (!found) return answer('Заявка не найдена — возможно, её удалили');

  if (parts[0] === 'show') {
    answer();
    return tg_('sendMessage', {chat_id: chat, text: orderText_(found.order), disable_web_page_preview: true,
      reply_markup: JSON.stringify(orderKeyboard_(found.order.no, found.order.status, found.order.phone))});
  }
  if (parts[0] === 'st') {
    var status = parts[2];
    sheet_().getRange(found.row, 3).setValue(status);
    found.order.status = status;
    answer('Статус: ' + (STATUS_RU[status] || status));
    tg_('editMessageText', {chat_id: chat, message_id: cb.message.message_id,
      text: orderText_(found.order), disable_web_page_preview: true,
      reply_markup: JSON.stringify(orderKeyboard_(found.order.no, status, found.order.phone))});
    // остальным сотрудникам — короткая сводка, чтобы двое не звонили одному дилеру
    var who = (cb.from && cb.from.first_name) || 'сотрудник';
    chatIds_().forEach(function (id) {
      if (String(id) !== String(chat))
        tg_('sendMessage', {chat_id: id, text: '№ ' + found.order.no + ' → ' +
          (STATUS_RU[status] || status) + ' (' + who + ')'});
    });
  }
}

/** Подключить бота к этому веб-приложению. Запустите один раз после развёртывания. */
function setupBot() {
  var url = ScriptApp.getService().getUrl();
  var r = tg_('setWebhook', {url: url, allowed_updates: JSON.stringify(['message', 'callback_query'])});
  Logger.log('Адрес веб-приложения: ' + url);
  Logger.log('Подключение бота: ' + JSON.stringify(r));
  tg_('setMyCommands', {commands: JSON.stringify([
    {command: 'new', description: 'новые заявки'},
    {command: 'work', description: 'заявки в работе'},
    {command: 'last', description: 'последние заявки'},
    {command: 'who', description: 'кто получает уведомления'},
    {command: 'stop', description: 'отписаться'}])});
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var body = JSON.parse(e.postData.contents || '{}');

    // Telegram шлёт обновления на тот же адрес — узнаём их по update_id
    if (body.update_id) { handleTelegram_(body); return json_({ok: true}); }

    if (body.action === 'create') {
      var o = body.order || {};
      if (!o.customer || !o.phone || !(o.items || []).length)
        return json_({ok: false, error: 'не заполнены обязательные поля'});
      var t = totals_(o.items);
      var no = o.no || ('АК-' + Utilities.formatDate(new Date(), 'Europe/Moscow', 'yyMMdd') + '-' +
        Math.floor(Math.random() * 900 + 100));
      sheet_().appendRow([no, new Date(), 'new', "'" + (o.date || ''), text_(o.customer), text_(o.inn),
        text_(o.person), text_(o.phone), text_(o.email), text_(o.city), text_(o.delivery),
        text_(o.address), text_(o.payment), "'" + (o.ship || ''), text_(o.note),
        t.packs, t.sqm, JSON.stringify(o.items)]);
      notify_(no, o, t);
      return json_({ok: true, no: no});
    }

    // Дилер спрашивает статус своих заявок по их номерам: отдаём только статус, без данных заказчика.
    if (body.action === 'track') {
      var wanted = (body.nos || []).slice(0, 30).map(String);
      if (!wanted.length) return json_({ok: true, statuses: {}});
      var all = sheet_().getDataRange().getValues().slice(1);
      var statuses = {};
      all.forEach(function (r) {
        if (r[0] && wanted.indexOf(String(r[0])) !== -1) statuses[String(r[0])] = r[2] || 'new';
      });
      return json_({ok: true, statuses: statuses});
    }

    if (body.code !== ADMIN_CODE) return json_({ok: false, error: 'неверный код доступа'});

    if (body.action === 'list') {
      var rows = sheet_().getDataRange().getValues().slice(1);
      var orders = rows.filter(function (r) { return r[0]; }).map(function (r) {
        return {no: r[0], received: r[1] instanceof Date ? r[1].toISOString() : String(r[1]),
          status: r[2] || 'new',
          date: r[3] instanceof Date ? Utilities.formatDate(r[3], 'Europe/Moscow', 'yyyy-MM-dd') : String(r[3]).replace(/^'/, ''),
          customer: r[4], inn: String(r[5]), person: r[6], phone: String(r[7]).replace(/^'/, ''),
          email: r[8], city: r[9],
          delivery: r[10], address: r[11], payment: r[12],
          ship: r[13] instanceof Date ? Utilities.formatDate(r[13], 'Europe/Moscow', 'yyyy-MM-dd') : String(r[13]).replace(/^'/, ''),
          note: r[14], items: JSON.parse(r[17] || '[]')};
      }).reverse();
      return json_({ok: true, orders: orders});
    }

    if (body.action === 'delete') {
      var shd = sheet_(), vals = shd.getDataRange().getValues();
      for (var d = 1; d < vals.length; d++) {
        if (String(vals[d][0]) === String(body.no)) {
          shd.deleteRow(d + 1);
          return json_({ok: true});
        }
      }
      return json_({ok: false, error: 'заявка не найдена'});
    }

    if (body.action === 'status') {
      var sh = sheet_(), values = sh.getDataRange().getValues();
      for (var i = 1; i < values.length; i++) {
        if (String(values[i][0]) === String(body.no)) {
          sh.getRange(i + 1, 3).setValue(body.status);
          return json_({ok: true});
        }
      }
      return json_({ok: false, error: 'заявка не найдена'});
    }

    return json_({ok: false, error: 'неизвестное действие'});
  } catch (err) {
    return json_({ok: false, error: String(err)});
  } finally {
    lock.releaseLock();
  }
}

function doGet() {
  return json_({ok: true, service: 'Алмалы-Керамик: приём заявок'});
}
