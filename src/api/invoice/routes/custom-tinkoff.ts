/**
 * Кастомные роуты для Tinkoff платежей
 */

export default {
  routes: [
    {
      method: 'POST',
      path: '/invoices/tinkoff/payment',
      handler: 'api::invoice.invoice.createTinkoffPayment',
      config: {
        auth: false,
        policies: [],
        middlewares: [],
      },
    },
    {
      method: 'POST',
      path: '/invoices/tinkoff/notify',
      handler: 'api::invoice.invoice.handleTinkoffNotification',
      config: {
        auth: false,
        policies: [],
        middlewares: [],
      },
    },
  ],
};