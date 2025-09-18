/**
 * guide router
 */

import { factories } from '@strapi/strapi';

export default factories.createCoreRouter('api::guide.guide', {
  config: {
    find: {
      middlewares: [],
      policies: []
    },
    findOne: {
      middlewares: [],
      policies: []
    },
    create: {
      middlewares: [],
      policies: []
    },
    update: {
      middlewares: [],
      policies: []
    },
    delete: {
      middlewares: [],
      policies: []
    }
  }
});