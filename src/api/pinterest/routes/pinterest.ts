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
      config: {
        policies: [],
        middlewares: [],
      },
    },
    {
      method: "POST",
      path: "/pinterest/disconnect",
      handler: "pinterest.disconnect",
      config: {
        policies: [],
        middlewares: [],
      },
    },
    {
      method: "GET",
      path: "/pinterest/pins",
      handler: "pinterest.getPins",
      config: {
        policies: [],
        middlewares: [],
      },
    },
    {
      method: "POST",
      path: "/pinterest/save-pin-as-guide",
      handler: "pinterest.savePinAsGuide",
      config: {
        policies: [],
        middlewares: [],
      },
    },
    {
      method: "POST",
      path: "/pinterest/save-all-pins",
      handler: "pinterest.saveAllPinsAsGuides",
      config: {
        policies: [],
        middlewares: [],
      },
    },
  ],
};
