/**
 * Pinterest custom routes
 */

module.exports = {
  routes: [
    {
      method: "POST",
      path: "/pinterest/auth",
      handler: "pinterest.authenticate",
      config: {
        auth: false,
      },
    },
    {
      method: "GET",
      path: "/pinterest/status",
      handler: "pinterest.getConnectionStatus",
      config: {
        auth: true,  // Просто требуем авторизацию без специального scope
      },
    },
    {
      method: "POST",
      path: "/pinterest/disconnect",
      handler: "pinterest.disconnect",
      config: {
        auth: true,  // Просто требуем авторизацию без специального scope
      },
    },
  ],
};
