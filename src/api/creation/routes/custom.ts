/**
 * Custom routes для creation
 */

export default {
  routes: [
    {
      method: "POST",
      path: "/creations/upload",
      handler: "creation.uploadCreation",
      config: {
        policies: [],
        middlewares: [],
      },
    },
    {
      method: "GET",
      path: "/creations/my",
      handler: "creation.getMyCreations",
      config: {
        policies: [],
        middlewares: [],
      },
    },
  ],
};
