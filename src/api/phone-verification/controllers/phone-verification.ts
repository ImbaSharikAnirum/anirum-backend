/**
 * phone-verification controller
 */

import bcrypt from 'bcrypt';
import dayjs from 'dayjs';
import whatsappService from '../services/whatsapp';
import telegramService from '../services/telegram';

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

      // Валидация входных данных в зависимости от мессенджера
      if (messenger === 'whatsapp') {
        if (!phone || !phone.trim()) {
          return ctx.badRequest('Номер телефона обязателен для WhatsApp');
        }
      } else if (messenger === 'telegram') {
        if (!phone || !phone.trim()) {
          return ctx.badRequest('Username обязателен для Telegram');
        }
        // Проверяем формат username (может быть с @ или без)
        const usernameRegex = /^@?[a-zA-Z0-9_]{5,32}$/;
        const cleanUsername = phone.replace('@', '');
        if (!usernameRegex.test(cleanUsername)) {
          return ctx.badRequest('Неверный формат username. Используйте формат @username или username');
        }
      }

      // Нормализуем контакт в зависимости от мессенджера
      const normalizedContact = messenger === 'whatsapp'
        ? phone.replace(/[^\d+]/g, '') // Для WhatsApp - только цифры и +
        : phone.trim(); // Для Telegram - оставляем username как есть

      console.log(`📱 Отправка кода для ${normalizedContact} (${messenger}), пользователь ${userId}`);

      // Rate limiting - проверяем последнюю отправку
      const key = `${normalizedContact}_${userId}`;
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
        phone: normalizedContact, // Сохраняем нормализованный контакт
        messenger,
        userId,
        attempts: 0,
        createdAt: new Date(),
        expiresAt: dayjs().add(5, 'minute').toDate()
      });

      console.log(`🔐 Код сгенерирован для ${normalizedContact}: ${code}`);

      try {
        // Отправляем в зависимости от мессенджера
        if (messenger === 'whatsapp') {
          const result = await whatsappService.sendVerificationCode(normalizedContact, code);
          console.log(`📤 WhatsApp сообщение отправлено через Green API:`, result);
        } else if (messenger === 'telegram') {
          // Для Telegram отправляем код напрямую через Bot API
          try {
            const result = await telegramService.sendVerificationCode(normalizedContact, code);
            console.log(`📤 Telegram сообщение отправлено через Bot API:`, result);
          } catch (telegramError) {
            console.error(`❌ Ошибка отправки в Telegram:`, telegramError);

            // Если не удалось отправить напрямую, предлагаем Deep Link как fallback
            const botUsername = process.env.TELEGRAM_BOT_USERNAME || 'anirum_v2_bot';
            const deepLink = `https://t.me/${botUsername}?start=getcode`;

            return ctx.send({
              success: true,
              message: 'Не удалось отправить код напрямую. Откройте бот в Telegram',
              phone: normalizedContact,
              telegram: {
                requiresDeepLink: true,
                deepLink: deepLink,
                instructions: `Перейдите к боту и напишите: /getcode ${normalizedContact} ${code}`,
                fallbackCode: code
              }
            });
          }
        }

        return ctx.send({
          success: true,
          message: `Код отправлен в ${messenger === 'whatsapp' ? 'WhatsApp' : 'Telegram'}`,
          phone: normalizedContact
        });

      } catch (sendError) {
        console.error(`❌ Ошибка отправки кода через ${messenger}:`, sendError);
        // Удаляем код при ошибке отправки
        verificationCodes.delete(key);
        return ctx.badRequest(sendError.message || `Ошибка отправки кода через ${messenger}.`);
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

      // Нормализуем контакт (для WhatsApp - номер, для Telegram - username)
      const normalizedContact = phone.trim();
      const normalizedCode = code.replace(/\D/g, ''); // Только цифры

      if (normalizedCode.length !== 6) {
        return ctx.badRequest('Код должен содержать 6 цифр');
      }

      console.log(`🔍 Проверка кода для ${normalizedContact}, код: ${normalizedCode}`);

      const key = `${normalizedContact}_${userId}`;
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
        console.log(`❌ Неверный код для ${normalizedContact}. Попытка ${verification.attempts}/3`);
        return ctx.badRequest(`Неверный код. Осталось попыток: ${3 - verification.attempts}`);
      }

      // Успешная верификация!
      console.log(`✅ Код подтвержден для ${normalizedContact} (${verification.messenger})`);

      // Удаляем код после успешной проверки (одноразовое использование)
      verificationCodes.delete(key);

      try {
        // Обновляем профиль пользователя
        const verificationField = verification.messenger === 'whatsapp'
          ? 'whatsapp_phone_verified'
          : 'telegram_phone_verified';

        // @ts-ignore - Strapi typing
        await strapi.plugins['users-permissions'].services.user.edit(userId, {
          [verificationField]: true
        });

        console.log(`✅ Профиль обновлен: ${verificationField} = true для пользователя ${userId}`);

        return ctx.send({
          success: true,
          message: verification.messenger === 'whatsapp'
            ? 'Номер успешно подтвержден'
            : 'Username успешно подтвержден',
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