/**
 * Telegram webhook routes
 */

export default {
  routes: [
    {
      method: 'POST',
      path: '/telegram-webhook',
      handler: 'telegram-webhook.webhook',
      config: {
        auth: false, // Telegram webhook не требует авторизации
        policies: [],
        middlewares: [],
      },
    },
    {
      method: 'POST',
      path: '/telegram-webhook/setup',
      handler: 'telegram-webhook.setupWebhook',
      config: {
        auth: false, // Для удобства настройки
        policies: [],
        middlewares: [],
      },
    },
    {
      method: 'GET',
      path: '/telegram-webhook/info',
      handler: 'telegram-webhook.getWebhookInfo',
      config: {
        auth: false,
        policies: [],
        middlewares: [],
      },
    },
  ],
};