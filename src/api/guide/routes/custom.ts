/**
 * Custom guide routes
 */

export default {
  routes: [
    {
      method: 'POST',
      path: '/guides/search',
      handler: 'api::guide.guide.search',
      config: {
        policies: [],
        middlewares: [],
      },
    },
    {
      method: 'POST',
      path: '/guides/:id/toggle-save',
      handler: 'api::guide.guide.toggleSave',
      config: {
        policies: [],
        middlewares: [],
      },
    },
    {
      method: 'GET',
      path: '/guides/popular-tags',
      handler: 'api::guide.guide.getPopularTags',
      config: {
        auth: false,
        policies: [],
        middlewares: [],
      },
    },
  ],
};