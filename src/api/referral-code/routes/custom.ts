/**
 * Кастомные роуты для реферальной системы
 */

export default {
  routes: [
    {
      method: 'POST',
      path: '/referral-codes/validate',
      handler: 'referral-code.validate',
      config: {
        policies: [],
        middlewares: []
      }
    },
    {
      method: 'GET', 
      path: '/referral-codes/my',
      handler: 'referral-code.getMy',
      config: {
        policies: [],
        middlewares: []
      }
    },
    {
      method: 'GET',
      path: '/referral-codes/stats', 
      handler: 'referral-code.getStats',
      config: {
        policies: [],
        middlewares: []
      }
    }
  ]
};