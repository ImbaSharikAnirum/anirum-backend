/**
 * Custom skill-tree routes
 */

export default {
  routes: [
    {
      method: 'POST',
      path: '/skill-trees/:id/publish',
      handler: 'api::skill-tree.skill-tree.publish',
      config: {
        policies: [],
        middlewares: [],
      },
    },
  ],
};
