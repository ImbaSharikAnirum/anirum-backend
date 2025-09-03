/**
 * teacher router
 */

export default {
  routes: [
    {
      method: 'GET',
      path: '/teachers',
      handler: 'api::teacher.teacher.getTeachers',
      config: {
        auth: false, // Публичный доступ
        policies: [],
        middlewares: [],
      },
    },
    {
      method: 'GET', 
      path: '/teachers/:id',
      handler: 'api::teacher.teacher.getTeacherById',
      config: {
        auth: false, // Публичный доступ
        policies: [],
        middlewares: [],
      },
    },
  ],
};