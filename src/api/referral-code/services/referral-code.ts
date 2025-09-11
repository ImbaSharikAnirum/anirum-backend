/**
 * referral-code service
 */

import { factories } from '@strapi/strapi';

export default factories.createCoreService('api::referral-code.referral-code', ({ strapi }) => ({
  /**
   * Валидация реферального кода
   */
  async validateReferralCode(code: string, coursePrice: number, userId?: number) {
    try {
      // Находим код по строке
      const referralCodes = await strapi.entityService.findMany('api::referral-code.referral-code', {
        filters: { 
          code: code,
          isActive: true
        },
        populate: {
          referrer: true,
          applicableCourses: true
        }
      }) as any;

      if (!referralCodes || referralCodes.length === 0) {
        return {
          isValid: false,
          error: 'Промокод не найден'
        };
      }

      const referralCode = referralCodes[0];

      // Проверяем, не пытается ли пользователь использовать свой собственный код
      if (userId && referralCode.referrer && (referralCode.referrer.id === userId || referralCode.referrer.documentId === userId)) {
        return {
          isValid: false,
          error: 'Нельзя использовать собственный промокод'
        };
      }

      // Проверяем даты действия
      const now = new Date();
      if (referralCode.validFrom && new Date(referralCode.validFrom) > now) {
        return {
          isValid: false,
          error: 'Промокод еще не активен'
        };
      }

      if (referralCode.validTo && new Date(referralCode.validTo) < now) {
        return {
          isValid: false,
          error: 'Срок действия промокода истек'
        };
      }

      // Проверяем лимит использований
      if (referralCode.currentUses >= referralCode.maxUses) {
        return {
          isValid: false,
          error: 'Превышен лимит использований промокода'
        };
      }

      // Проверяем минимальную сумму заказа
      if (referralCode.minOrderAmount > 0 && coursePrice < referralCode.minOrderAmount) {
        return {
          isValid: false,
          error: `Минимальная сумма заказа: ${referralCode.minOrderAmount}₽`
        };
      }

      // Рассчитываем скидку (модель 10% + 10%)
      const discountAmount = Math.round(coursePrice * (referralCode.discountPercentage / 100));
      const referrerBonus = Math.round(coursePrice * (referralCode.bonusPercentage / 100));

      return {
        isValid: true,
        referralCode: referralCode,
        discountAmount,
        referrerBonus,
        referrer: referralCode.referrer
      };

    } catch (error) {
      strapi.log.error('Error validating referral code:', error);
      return {
        isValid: false,
        error: 'Ошибка проверки промокода'
      };
    }
  },

  /**
   * Применение реферального кода (увеличение счетчика использований)
   */
  async applyReferralCode(codeId: string | number) {
    try {
      const referralCode = await strapi.entityService.findOne('api::referral-code.referral-code', codeId);
      
      if (!referralCode) {
        throw new Error('Referral code not found');
      }

      // Увеличиваем счетчик использований
      await strapi.entityService.update('api::referral-code.referral-code', codeId, {
        data: {
          currentUses: referralCode.currentUses + 1
        }
      });

      return true;
    } catch (error) {
      strapi.log.error('Error applying referral code:', error);
      throw error;
    }
  },

  /**
   * Начисление бонусов рефереру
   */
  async creditReferrerBonus(referrerId: string | number, bonusAmount: number) {
    try {
      const user = await strapi.entityService.findOne('plugin::users-permissions.user', referrerId);
      
      if (!user) {
        throw new Error('Referrer not found');
      }

      // Обновляем баланс бонусов
      await strapi.entityService.update('plugin::users-permissions.user', referrerId, {
        data: {
          bonusBalance: (user.bonusBalance || 0) + bonusAmount,
          totalEarnedBonuses: (user.totalEarnedBonuses || 0) + bonusAmount
        }
      });

      return true;
    } catch (error) {
      strapi.log.error('Error crediting referrer bonus:', error);
      throw error;
    }
  },

  /**
   * Генерация уникального реферального кода для пользователя
   */
  async generateReferralCode(userId: string | number, userName: string) {
    try {
      // Генерируем код на основе имени пользователя + год
      const year = new Date().getFullYear();
      let baseCode = `${userName.toUpperCase()}${year}`;
      let code = baseCode;
      let counter = 1;

      // Проверяем уникальность кода
      while (true) {
        const existing = await strapi.entityService.findMany('api::referral-code.referral-code', {
          filters: { code: code }
        }) as any;

        if (!existing || existing.length === 0) {
          break;
        }

        code = `${baseCode}_${counter}`;
        counter++;
      }

      // Создаем реферальный код
      const referralCode = await strapi.entityService.create('api::referral-code.referral-code', {
        data: {
          code: code,
          referrer: userId,
          discountPercentage: 10, // 10% скидка приглашенному
          bonusPercentage: 10,    // 10% бонус рефереру
          maxUses: 100,
          currentUses: 0,
          isActive: true,
          applicableToAll: true,
          minOrderAmount: 0,
          description: `Реферальный код пользователя ${userName}`
        }
      });

      return referralCode;
    } catch (error) {
      strapi.log.error('Error generating referral code:', error);
      throw error;
    }
  }
}));