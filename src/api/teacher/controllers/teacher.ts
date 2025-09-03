/**
 * teacher controller
 */

export default {
  /**
   * Получить список преподавателей (публичный метод)
   */
  async getTeachers(ctx) {
    try {
      // Получаем роль teacher
      const teacherRole = await strapi.db.query('plugin::users-permissions.role').findOne({
        where: { name: 'Teacher' },
      });

      if (!teacherRole) {
        return ctx.badRequest('Роль teacher не найдена');
      }

      // Получаем пользователей с ролью teacher
      const teachers = await strapi.db.query('plugin::users-permissions.user').findMany({
        where: { 
          role: teacherRole.id,
          blocked: false,
          confirmed: true
        },
        select: ['id', 'username', 'email'],
        populate: {
          avatar: {
            select: ['url', 'alternativeText']
          }
        }
      });

      // Возвращаем только безопасные данные
      const safeTeachers = teachers.map(teacher => ({
        id: teacher.id,
        username: teacher.username,
        email: teacher.email,
        avatar: teacher.avatar ? {
          url: teacher.avatar.url,
          alternativeText: teacher.avatar.alternativeText
        } : null
      }));

      ctx.body = safeTeachers;
    } catch (error) {
      strapi.log.error('Ошибка при получении преподавателей:', error);
      ctx.internalServerError('Не удалось получить список преподавателей');
    }
  },

  /**
   * Получить преподавателя по ID
   */
  async getTeacherById(ctx) {
    try {
      const { id } = ctx.params;

      // Получаем роль teacher
      const teacherRole = await strapi.db.query('plugin::users-permissions.role').findOne({
        where: { name: 'Teacher' },
      });

      if (!teacherRole) {
        return ctx.badRequest('Роль teacher не найдена');
      }

      // Получаем конкретного преподавателя
      const teacher = await strapi.db.query('plugin::users-permissions.user').findOne({
        where: { 
          id: id,
          role: teacherRole.id,
          blocked: false,
          confirmed: true
        },
        select: ['id', 'username', 'email'],
        populate: {
          avatar: {
            select: ['url', 'alternativeText']
          }
        }
      });

      if (!teacher) {
        return ctx.notFound('Преподаватель не найден');
      }

      // Возвращаем только безопасные данные
      const safeTeacher = {
        id: teacher.id,
        username: teacher.username,
        email: teacher.email,
        avatar: teacher.avatar ? {
          url: teacher.avatar.url,
          alternativeText: teacher.avatar.alternativeText
        } : null
      };

      ctx.body = safeTeacher;
    } catch (error) {
      strapi.log.error('Ошибка при получении преподавателя:', error);
      ctx.internalServerError('Не удалось получить преподавателя');
    }
  }
};