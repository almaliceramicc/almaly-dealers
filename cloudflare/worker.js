/**
 * Мост между Telegram и Google Apps Script.
 *
 * Зачем: Telegram не ходит по редиректам, а Apps Script на любой POST отвечает 302 —
 * напрямую вебхук с ним не работает. Воркер принимает обновление, сразу отвечает
 * Telegram «ок», а сообщение передаёт скрипту уже в фоне, проходя редирект.
 *
 * Настройка: см. cloudflare/README.md
 */
const APPS_SCRIPT = 'ВСТАВЬТЕ_АДРЕС_ВЕБ_ПРИЛОЖЕНИЯ';   // адрес из docs/config.js → ORDERS_API
const SECRET = 'ВСТАВЬТЕ_СЕКРЕТ';                      // тот же, что в setWebhook(secret_token)

export default {
  async fetch(request, env, ctx) {
    if (request.method !== 'POST') return new Response('Мост Telegram → Apps Script работает');

    // пускаем только Telegram: он присылает секрет заголовком
    if (SECRET && request.headers.get('x-telegram-bot-api-secret-token') !== SECRET) {
      return new Response('forbidden', {status: 403});
    }

    const body = await request.text();
    // Telegram ждать не заставляем: отвечаем сразу, скрипту передаём в фоне
    ctx.waitUntil(fetch(APPS_SCRIPT, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body,
      redirect: 'follow',
    }).catch(err => console.log('Apps Script: ' + err)));

    return new Response('ok');
  },
};
