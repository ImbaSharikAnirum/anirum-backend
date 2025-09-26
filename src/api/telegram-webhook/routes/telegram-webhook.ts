/**
 * Telegram Webhook routes
 */

export default {
  routes: [
    {
      method: "POST",
      path: "/telegram-webhook",
      handler: "telegram-webhook.webhook",
      config: {
        policies: [],
        middlewares: [],
        auth: false, // Webhook не требует авторизации
      },
    },
    {
      method: "POST",
      path: "/telegram-webhook/create-verification-session",
      handler: "telegram-webhook.createVerificationSession",
      config: {
        policies: [],
        middlewares: [],
        auth: {
          scope: ['find'] // Требует авторизации
        }
      },
    },
    {
      method: "GET",
      path: "/telegram-webhook/verification-status/:hash",
      handler: "telegram-webhook.getVerificationStatus",
      config: {
        policies: [],
        middlewares: [],
      },
    },
    {
      method: "POST",
      path: "/telegram-webhook/setup-webhook",
      handler: "telegram-webhook.setupWebhook",
      config: {
        policies: [],
        middlewares: [],
        auth: false, // Для удобства настройки
      },
    },
    {
      method: "GET",
      path: "/telegram-webhook/webhook-info",
      handler: "telegram-webhook.getWebhookInfo",
      config: {
        policies: [],
        middlewares: [],
        auth: false,
      },
    },
  ],
};