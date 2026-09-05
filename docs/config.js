/* Контакты и реквизиты компании — попадают в подвал сайта, в бланк заказа
   и в сообщения менеджеру. Данные с визитки от 3 сентября 2026. */
const COMPANY = {
  name: 'ООО «Алмалы-Керамик»',
  tagline: 'Оптовые поставки керамогранита',
  phone: '+7 499 390-78-88',            // основной телефон офиса продаж
  email: 'almaliceramic@mail.ru',       // основная почта
  whatsapp: '79253907888',              // ← WhatsApp менеджера, формат 7XXXXXXXXXX без плюса
  site: 'https://almaliceramicc.github.io/almaly-dealers/',
};

/* Адреса шоу-румов и складов — показываются в подвале всех страниц. */
const OFFICES = [
  {
    title: 'Шоу-рум и офис продаж',
    address: 'г. Москва, ул. Монтажная, д. 3, этаж 4, офис 41',
    phones: ['+7 499 390-78-88', '+7 925 390-78-88'],
    email: 'almaliceramic@mail.ru',
  },
  {
    title: 'Шоу-рум, склад и офис продаж',
    address: 'г. Балашиха, Квартал Щитниково, 3ж',
    phones: ['+7 936 308-01-01'],
    email: '89363080101@mail.ru',
  },
];

/* Пока телефон и почта не заменены на рабочие, кнопки связи и строка контактов скрываются. */
const HAS_CONTACTS = () => !/0{3}-00-00/.test(COMPANY.phone) && !COMPANY.email.startsWith('zakaz@almaly-keramik');

/* Репозиторий портала — в него редактор каталога сохраняет фотографии. */
const REPO = 'almaliceramicc/almaly-dealers';

/* Приём заявок: веб-приложение Google Apps Script, заявки падают в Google-таблицу.
   Если адрес очистить, сайт вернётся в режим «заявка ссылкой в WhatsApp». */
const ORDERS_API = 'https://script.google.com/macros/s/AKfycbyyge4hKLR9K8nS1ajkHkkk2Ytahjzkv4scpKWTdy_ICEJxA8kbFVifXywbZWLJYw-3CQ/exec';

/* Доступ в панель продавца. Логины и пароли меняйте здесь.
   Это простая защита от посторонних глаз: страница статическая, и значения видно в исходном коде,
   поэтому не используйте пароли от почты, банка или Ozon. */
const ADMIN_USERS = [
  {login: 'admin', password: 'admin', name: 'Администратор'},
];
