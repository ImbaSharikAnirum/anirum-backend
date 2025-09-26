/**
 * Telegram Webhook controller for handling bot commands
 */

import crypto from 'crypto';
import telegramService from '../../phone-verification/services/telegram';

// В памяти храним сессии верификации (для продакшена лучше Redis)
const verificationSessions = new Map();

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from: {
      id: number;
      is_bot: boolean;
      first_name: string;
      username?: string;
      language_code?: string;
    };
    chat: {
      id: number;
      first_name: string;
      username?: string;
      type: string;
    };
    date: number;
    text?: string;
  };
}

export default {
  /**
   * Webhook endpoint для получения обновлений от Telegram бота
   * POST /api/telegram-webhook
   */
  async webhook(ctx) {
    try {
      const update: TelegramUpdate = ctx.request.body;
      console.log('📥 Telegram Webhook получил обновление:', JSON.stringify(update, null, 2));

      // Проверяем наличие сообщения
      if (!update.message || !update.message.text) {
        return ctx.send({ ok: true });
      }

      const message = update.message;
      const text = message.text;
      const chatId = message.chat.id;
      const username = message.from.username;

      console.log(`📨 Сообщение от @${username} (${chatId}): ${text}`);

      // Обрабатываем команду /start с параметром верификации
      if (text.startsWith('/start verify_')) {
        await this.handleVerificationStart(chatId, username, text);
      }
      // Обрабатываем обычную команду /start
      else if (text === '/start') {
        await this.handleStart(chatId, username);
      }

      return ctx.send({ ok: true });

    } catch (error) {
      console.error('❌ Ошибка в Telegram webhook:', error);
      return ctx.internalServerError('Webhook error');
    }
  },

  /**
   * Обработка команды /start verify_HASH
   */
  async handleVerificationStart(chatId: number, username: string, text: string) {
    try {
      // Извлекаем хеш из команды
      const verifyMatch = text.match(/\/start verify_([a-zA-Z0-9]+)/);
      if (!verifyMatch) {
        await telegramService.sendMessage(String(chatId), 'Неверная команда верификации.');
        return;
      }

      const verificationHash = verifyMatch[1];
      console.log(`🔐 Запрос верификации с хешем: ${verificationHash}`);

      // Проверяем, есть ли активная сессия верификации
      const session = verificationSessions.get(verificationHash);
      if (!session) {
        await telegramService.sendMessage(String(chatId),
          '❌ Сессия верификации не найдена или истекла. Попробуйте заново из веб-приложения.');
        return;
      }

      // Проверяем, совпадает ли username
      if (session.username !== username) {
        await telegramService.sendMessage(String(chatId),
          '❌ Неверный username. Убедитесь, что используете правильный аккаунт.');
        return;
      }

      // Сохраняем chat_id для отправки кода
      session.chatId = chatId;
      session.activated = true;
      verificationSessions.set(verificationHash, session);

      console.log(`✅ Сессия активирована для @${username} (${chatId})`);

      // Отправляем код верификации
      await telegramService.sendMessage(String(chatId), session.verificationMessage);

      // Отправляем уведомление об успешной активации
      await telegramService.sendMessage(String(chatId),
        '✅ Аккаунт активирован! Код верификации отправлен выше. Введите его в веб-приложении.');

    } catch (error) {
      console.error('❌ Ошибка обработки верификации:', error);
      await telegramService.sendMessage(String(chatId),
        '❌ Произошла ошибка. Попробуйте позже.');
    }
  },

  /**
   * Обработка обычной команды /start
   */
  async handleStart(chatId: number, username: string) {
    try {
      const welcomeMessage = `👋 Добро пожаловать в Anirum!

Этот бот используется для верификации аккаунтов.

Чтобы подтвердить ваш аккаунт:
1. Введите ваш username в веб-приложении
2. Нажмите кнопку "Открыть Telegram"
3. Следуйте инструкциям

@${username}, ваш аккаунт готов к верификации!`;

      await telegramService.sendMessage(String(chatId), welcomeMessage);
      console.log(`👋 Отправлено приветствие для @${username}`);

    } catch (error) {
      console.error('❌ Ошибка отправки приветствия:', error);
    }
  },

  /**
   * Создание сессии верификации и получение Deep Link
   * POST /api/telegram-webhook/create-verification-session
   */
  async createVerificationSession(ctx) {
    try {
      const { username, code } = ctx.request.body;
      const userId = ctx.state.user?.id;

      if (!userId) {
        return ctx.unauthorized('Необходима авторизация');
      }

      if (!username || !code) {
        return ctx.badRequest('Username и код обязательны');
      }

      // Генерируем уникальный хеш для сессии
      const verificationHash = crypto.randomBytes(16).toString('hex');

      // Нормализуем username
      const normalizedUsername = username.startsWith('@') ? username.slice(1) : username;

      // Создаем сообщение с кодом
      const verificationMessage = `🔐 <b>Код подтверждения Anirum:</b> <code>${code}</code>

Код действителен <b>5 минут</b>.

⚠️ <i>Никому не сообщайте этот код!</i>`;

      // Сохраняем сессию
      const session = {
        hash: verificationHash,
        username: normalizedUsername,
        userId: userId,
        code: code,
        verificationMessage: verificationMessage,
        chatId: null,
        activated: false,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 5 * 60 * 1000) // 5 минут
      };

      verificationSessions.set(verificationHash, session);

      // Генерируем Deep Link
      const botUsername = 'anirum_v2_bot'; // имя бота без @
      const deepLink = `https://t.me/${botUsername}?start=verify_${verificationHash}`;

      console.log(`🔗 Создана сессия верификации для @${normalizedUsername}: ${verificationHash}`);

      return ctx.send({
        success: true,
        verificationHash: verificationHash,
        deepLink: deepLink,
        message: 'Сессия верификации создана'
      });

    } catch (error) {
      console.error('❌ Ошибка создания сессии верификации:', error);
      return ctx.internalServerError('Ошибка создания сессии');
    }
  },

  /**
   * Проверка статуса сессии верификации
   * GET /api/telegram-webhook/verification-status/:hash
   */
  async getVerificationStatus(ctx) {
    try {
      const { hash } = ctx.params;
      const session = verificationSessions.get(hash);

      if (!session) {
        return ctx.notFound('Сессия не найдена');
      }

      // Проверяем, не истекла ли сессия
      if (new Date() > session.expiresAt) {
        verificationSessions.delete(hash);
        return ctx.badRequest('Сессия истекла');
      }

      return ctx.send({
        activated: session.activated,
        chatId: session.chatId,
        username: session.username,
        expiresAt: session.expiresAt
      });

    } catch (error) {
      console.error('❌ Ошибка проверки статуса сессии:', error);
      return ctx.internalServerError('Ошибка проверки статуса');
    }
  },

  /**
   * Очистка истекших сессий (можно вызывать по cron)
   */
  cleanupExpiredSessions() {
    const now = new Date();
    let cleaned = 0;

    for (const [hash, session] of verificationSessions) {
      if (now > session.expiresAt) {
        verificationSessions.delete(hash);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.log(`🧹 Очищено ${cleaned} истекших сессий верификации`);
    }
  }
};