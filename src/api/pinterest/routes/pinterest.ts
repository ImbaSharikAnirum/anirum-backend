/**
 * Pinterest custom routes
 */

export default {
  routes: [
    {
      method: "POST",
      path: "/pinterest/auth",
      handler: "pinterest.authenticate",
      config: {
        auth: false,
        policies: [],
        middlewares: [],
      },
    },
    {
      method: "GET",
      path: "/pinterest/status",
      handler: "pinterest.getConnectionStatus",
    },
    {
      method: "POST",
      path: "/pinterest/disconnect",
      handler: "pinterest.disconnect",
    },
  ],
};
