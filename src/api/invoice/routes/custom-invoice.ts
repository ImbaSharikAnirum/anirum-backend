/**
 * Custom invoice routes
 */

export default {
  routes: [
    {
      method: 'POST',
      path: '/invoices/send-payment-message',
      handler: 'api::invoice.invoice.sendPaymentMessage',
    },
  ],
};