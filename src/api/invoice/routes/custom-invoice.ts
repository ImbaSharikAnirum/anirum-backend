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
    {
      method: 'POST',
      path: '/invoices/bulk-send-payment-messages',
      handler: 'api::invoice.invoice.bulkSendPaymentMessages',
    },
    {
      method: 'POST',
      path: '/invoices/copy-to-next-month',
      handler: 'api::invoice.invoice.copyInvoicesToNextMonth',
    },
  ],
};