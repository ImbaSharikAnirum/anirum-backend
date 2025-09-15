/**
 * Pinterest OAuth роуты
 */

export default {
  routes: [
    {
      method: 'POST',
      path: '/pinterest/auth',
      handler: 'api::pinterest.pinterest.authenticate',
      config: {
        auth: false,
        policies: [],
        middlewares: [],
      },
    },
    {
      method: 'GET',
      path: '/pinterest/status',
      handler: 'api::pinterest.pinterest.getConnectionStatus',
      config: {
        auth: true,
        policies: [],
        middlewares: [],
      },
    },
    {
      method: 'POST',
      path: '/pinterest/disconnect',
      handler: 'api::pinterest.pinterest.disconnect',
      config: {
        auth: true,
        policies: [],
        middlewares: [],
      },
    },
  ],
};