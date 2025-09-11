/**
 * referral-code router
 */

import { factories } from '@strapi/strapi';

export default factories.createCoreRouter('api::referral-code.referral-code', {
  config: {
    // Стандартные CRUD операции для админки
  }
});

// Кастомные роуты
export const customRoutes = {
  routes: [
    {
      method: 'POST',
      path: '/referral-codes/validate',
      handler: 'referral-code.validate',
      config: {
        policies: [],
        middlewares: [],
        auth: {
          scope: ['find'] // Требует аутентификации
        }
      }
    },
    {
      method: 'GET', 
      path: '/referral-codes/my',
      handler: 'referral-code.getMy',
      config: {
        policies: [],
        middlewares: [],
        auth: {
          scope: ['find'] // Требует аутентификации
        }
      }
    },
    {
      method: 'GET',
      path: '/referral-codes/stats', 
      handler: 'referral-code.getStats',
      config: {
        policies: [],
        middlewares: [],
        auth: {
          scope: ['find'] // Требует аутентификации  
        }
      }
    },
  ]
};