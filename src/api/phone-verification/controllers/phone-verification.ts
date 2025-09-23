/**
 * phone-verification controller
 */

import bcrypt from 'bcrypt';
import dayjs from 'dayjs';
import whatsappService from '../services/whatsapp';

// В памяти храним коды верификации (для продакшена лучше Redis)
const verificationCodes = new Map();

export default {
  /**
   * Отправить код верификации на номер телефона
   * POST /api/phone-verification/send-code
   */
  async sendCode(ctx) {
    try {
      const { phone, messenger = 'whatsapp' } = ctx.request.body;
      const userId = ctx.state.user?.id;

      if (!userId) {
        return ctx.unauthorized('Необходима авторизация');
      }

      if (!phone || !phone.trim()) {
        return ctx.badRequest('Номер телефона обязателен');
      }

      // Нормализуем номер телефона (убираем все кроме цифр и +)
      const normalizedPhone = phone.replace(/[^\d+]/g, '');

      console.log(`📱 Отправка кода для ${normalizedPhone}, пользователь ${userId}`);

      // Rate limiting - проверяем последнюю отправку
      const key = `${normalizedPhone}_${userId}`;
      const lastAttempt = verificationCodes.get(key);

      if (lastAttempt && dayjs().diff(dayjs(lastAttempt.createdAt), 'minute') < 1) {
        return ctx.badRequest('Подождите 1 минуту перед повторной отправкой');
      }

      // Генерируем 6-значный код
      const code = Math.floor(100000 + Math.random() * 900000).toString();
      const codeHash = await bcrypt.hash(code, 10);

      // Сохраняем в памяти
      verificationCodes.set(key, {
        codeHash,
        phone: normalizedPhone,
        messenger,
        userId,
        attempts: 0,
        createdAt: new Date(),
        expiresAt: dayjs().add(5, 'minute').toDate()
      });

      console.log(`🔐 Код сгенерирован для ${normalizedPhone}: ${code}`);

      try {
        // Отправляем через Green API
        if (messenger === 'whatsapp') {
          const result = await whatsappService.sendVerificationCode(normalizedPhone, code);
          console.log(`📤 Сообщение отправлено через Green API:`, result);
        }

        return ctx.send({
          success: true,
          message: `Код отправлен в ${messenger === 'whatsapp' ? 'WhatsApp' : 'Telegram'}`,
          phone: normalizedPhone
        });

      } catch (sendError) {
        console.error('❌ Ошибка отправки кода через мессенджер:', sendError);
        // Удаляем код при ошибке отправки
        verificationCodes.delete(key);
        return ctx.badRequest('Ошибка отправки кода. Проверьте номер телефона.');
      }

    } catch (error: unknown) {
      console.error('❌ Ошибка в sendCode:', error);
      return ctx.internalServerError('Внутренняя ошибка сервера');
    }
  },

  /**
   * Проверить введенный код верификации
   * POST /api/phone-verification/verify-code
   */
  async verifyCode(ctx) {
    try {
      const { phone, code } = ctx.request.body;
      const userId = ctx.state.user?.id;

      if (!userId) {
        return ctx.unauthorized('Необходима авторизация');
      }

      if (!phone || !code) {
        return ctx.badRequest('Номер телефона и код обязательны');
      }

      // Нормализуем номер телефона
      const normalizedPhone = phone.replace(/[^\d+]/g, '');
      const normalizedCode = code.replace(/\D/g, ''); // Только цифры

      if (normalizedCode.length !== 6) {
        return ctx.badRequest('Код должен содержать 6 цифр');
      }

      console.log(`🔍 Проверка кода для ${normalizedPhone}, код: ${normalizedCode}`);

      const key = `${normalizedPhone}_${userId}`;
      const verification = verificationCodes.get(key);

      if (!verification) {
        return ctx.badRequest('Код не найден. Запросите новый код.');
      }

      // Проверяем срок действия
      if (dayjs().isAfter(dayjs(verification.expiresAt))) {
        verificationCodes.delete(key);
        return ctx.badRequest('Код истек. Запросите новый код.');
      }

      // Проверяем количество попыток
      if (verification.attempts >= 3) {
        verificationCodes.delete(key);
        return ctx.badRequest('Превышено количество попыток. Запросите новый код.');
      }

      // Увеличиваем счетчик попыток
      verification.attempts += 1;
      verificationCodes.set(key, verification);

      // Проверяем код
      const isValidCode = await bcrypt.compare(normalizedCode, verification.codeHash);

      if (!isValidCode) {
        console.log(`❌ Неверный код для ${normalizedPhone}. Попытка ${verification.attempts}/3`);
        return ctx.badRequest(`Неверный код. Осталось попыток: ${3 - verification.attempts}`);
      }

      // Успешная верификация!
      console.log(`✅ Код подтвержден для ${normalizedPhone}`);

      // Удаляем код после успешной проверки (одноразовое использование)
      verificationCodes.delete(key);

      try {
        // Обновляем профиль пользователя
        const phoneField = verification.messenger === 'whatsapp'
          ? 'whatsapp_phone_verified'
          : 'telegram_phone_verified';

        // @ts-ignore - Strapi typing
        await strapi.plugins['users-permissions'].services.user.edit(userId, {
          [phoneField]: true
        });

        console.log(`✅ Профиль обновлен: ${phoneField} = true для пользователя ${userId}`);

        return ctx.send({
          success: true,
          message: 'Номер успешно подтвержден',
          verified: true,
          messenger: verification.messenger
        });

      } catch (updateError: unknown) {
        console.error('❌ Ошибка обновления профиля:', updateError);
        return ctx.internalServerError('Ошибка сохранения данных');
      }

    } catch (error: unknown) {
      console.error('❌ Ошибка в verifyCode:', error);
      return ctx.internalServerError('Внутренняя ошибка сервера');
    }
  },

  /**
   * Получить статус верификации (для отладки)
   * GET /api/phone-verification/status
   */
  async getStatus(ctx) {
    const userId = ctx.state.user?.id;

    if (!userId) {
      return ctx.unauthorized('Необходима авторизация');
    }

    try {
      // @ts-ignore - Strapi typing
      const user = await strapi.plugins['users-permissions'].services.user.fetch({ id: userId });

      return ctx.send({
        whatsapp_verified: !!user.whatsapp_phone_verified,
        telegram_verified: !!user.telegram_phone_verified,
        active_codes: Array.from(verificationCodes.keys()).filter(key => key.endsWith(`_${userId}`)).length
      });

    } catch (error: unknown) {
      console.error('❌ Ошибка получения статуса:', error);
      return ctx.internalServerError('Ошибка получения данных');
    }
  }
};