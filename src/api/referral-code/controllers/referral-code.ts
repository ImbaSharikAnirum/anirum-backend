/**
 * referral-code controller
 */

import { factories } from '@strapi/strapi';

export default factories.createCoreController('api::referral-code.referral-code', ({ strapi }) => ({
  /**
   * Валидация реферального кода
   * POST /api/referral-codes/validate
   */
  async validate(ctx) {
    try {
      const { code, coursePrice } = ctx.request.body;
      const userId = ctx.state.user?.id;

      if (!code || !coursePrice) {
        return ctx.badRequest('Не указан промокод или стоимость курса');
      }

      if (coursePrice <= 0) {
        return ctx.badRequest('Некорректная стоимость курса');
      }

      const result = await strapi.service('api::referral-code.referral-code')
        .validateReferralCode(code, coursePrice, userId);

      return ctx.send(result);
    } catch (error) {
      strapi.log.error('Error in validate controller:', error);
      return ctx.internalServerError('Внутренняя ошибка сервера');
    }
  },

  /**
   * Получение реферального кода пользователя
   * GET /api/referral-codes/my
   */
  async getMy(ctx) {
    try {
      const userId = ctx.state.user?.id;

      if (!userId) {
        return ctx.unauthorized('Пользователь не авторизован');
      }

      // Ищем существующие коды пользователя
      const existingCodes = await strapi.entityService.findMany('api::referral-code.referral-code', {
        filters: {
          referrer: userId
        },
        populate: {
          referrer: true
        }
      }) as any;

      if (existingCodes && existingCodes.length > 0) {
        return ctx.send({
          referralCode: existingCodes[0]
        });
      }

      // Если кода нет, генерируем новый
      const user = ctx.state.user;
      const userName = user.name || user.username;
      
      const newCode = await strapi.service('api::referral-code.referral-code')
        .generateReferralCode(userId, userName);

      return ctx.send({
        referralCode: newCode
      });
    } catch (error) {
      strapi.log.error('Error in getMy controller:', error);
      return ctx.internalServerError('Внутренняя ошибка сервера');
    }
  },

  /**
   * Получение статистики по реферальным кодам пользователя
   * GET /api/referral-codes/stats
   */
  async getStats(ctx) {
    try {
      const userId = ctx.state.user?.id;

      if (!userId) {
        return ctx.unauthorized('Пользователь не авторизован');
      }

      // Получаем реферальные коды пользователя
      const referralCodes = await strapi.entityService.findMany('api::referral-code.referral-code', {
        filters: {
          referrer: userId
        }
      });

      if (!referralCodes || referralCodes.length === 0) {
        return ctx.send({
          totalCodes: 0,
          totalUses: 0,
          totalEarned: 0,
          recentActivity: []
        });
      }

      // Получаем счета, созданные по реферальным кодам
      const referralInvoices = await strapi.entityService.findMany('api::invoice.invoice', {
        filters: {
          referrer: userId,
          statusPayment: true // только оплаченные
        },
        populate: {
          owner: true,
          course: true,
          referralCode: true
        },
        sort: { createdAt: 'desc' },
        start: 0,
        limit: 10
      }) as any;

      // Рассчитываем статистику
      const totalUses = referralCodes.reduce((sum, code) => sum + (code.currentUses || 0), 0);
      const totalEarned = referralInvoices.reduce((sum, invoice) => {
        // 10% от originalSum или sum если originalSum нет
        const baseAmount = invoice.originalSum || invoice.sum;
        return sum + Math.round(baseAmount * 0.1);
      }, 0);

      return ctx.send({
        totalCodes: referralCodes.length,
        totalUses,
        totalEarned,
        recentActivity: referralInvoices.map(invoice => ({
          date: invoice.createdAt,
          studentName: `${invoice.owner?.name || 'Пользователь'} ${(invoice.owner?.family || '')[0] || ''}.`,
          course: invoice.course?.description || 'Курс',
          amount: Math.round((invoice.originalSum || invoice.sum) * 0.1),
          status: 'paid'
        }))
      });
    } catch (error) {
      strapi.log.error('Error in getStats controller:', error);
      return ctx.internalServerError('Внутренняя ошибка сервера');
    }
  }
}));