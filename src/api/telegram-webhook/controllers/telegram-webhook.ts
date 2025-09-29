/**
 * Telegram Webhook controller для обработки верификации кодов
 */

import pendingSessions from '../../phone-verification/services/pending-sessions';

// Типы для Telegram Bot API
interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from: {
      id: number;
      is_bot: boolean;
      first_name: string;
      last_name?: string;
      username?: string;
      language_code?: string;
    };
    chat: {
      id: number;
      first_name: string;
      last_name?: string;
      username?: string;
      type: string;
    };
    date: number;
    text?: string;
  };
}

interface TelegramApiResponse {
  ok: boolean;
  result?: any;
  error_code?: number;
  description?: string;
}

export default {
  /**
   * Webhook endpoint для получения обновлений от Telegram бота
   * POST /api/telegram-webhook
   */
  async webhook(ctx) {
    try {
      const update: TelegramUpdate = ctx.request.body;


      // Обрабатываем входящие сообщения
      if (update.message) {
        const { message } = update;
        const { chat, from, text, date } = message;


        // Обрабатываем команду /start
        if (text === '/start' || text.startsWith('/start')) {
          await this.handleStartCommand(chat.id, from.username, text);
        }
      }

      return ctx.send({ ok: true });

    } catch (error) {
      console.error('❌ Ошибка в Telegram webhook:', error);
      return ctx.send({ ok: true }); // Всегда возвращаем ok для Telegram
    }
  },

  /**
   * Обработка команды /start с проверкой pending сессий
   */
  async handleStartCommand(chatId: number, username: string | undefined, text: string) {
    try {
      if (!username) {
        await this.sendMessage(chatId, '❌ Для верификации у вас должен быть установлен username в Telegram.');
        return;
      }


      // Ищем pending сессию для этого username
      const session = pendingSessions.findPendingSessionByUsername(username);

      if (session) {

        // Обновляем сессию с chat_id
        const updated = pendingSessions.updateSessionWithChatId(session.id, chatId);

        if (updated) {
          // Отправляем код верификации
          const codeMessage = `🔐 <b>Код подтверждения Anirum:</b> <code>${session.code}</code>

Код действителен <b>5 минут</b>.

⚠️ <i>Никому не сообщайте этот код!</i>

✅ Введите этот код в веб-приложении для завершения верификации.`;

          await this.sendMessage(chatId, codeMessage);

          // Сохраняем chat_id в профиль пользователя
          try {
            await strapi.plugins['users-permissions'].services.user.edit(session.userId, {
              telegram_chat_id: chatId.toString()
            });
            console.log(`✅ Сохранен telegram_chat_id: ${chatId} для пользователя ${session.userId}`);
          } catch (error) {
            console.error('❌ Ошибка сохранения telegram_chat_id:', error);
          }

          // Помечаем код как доставленный
          pendingSessions.markCodeAsDelivered(session.id);
        } else {
          await this.sendMessage(chatId, '❌ Сессия верификации истекла. Попробуйте заново из веб-приложения.');
        }
      } else {
        // Нет pending сессии - отправляем обычное приветствие
        await this.sendWelcomeMessage(chatId, username);
      }

    } catch (error) {
      console.error('❌ Ошибка обработки /start:', error);
      await this.sendMessage(chatId, '❌ Произошла ошибка. Попробуйте позже.');
    }
  },

  /**
   * Отправить приветственное сообщение (когда нет pending сессий)
   */
  async sendWelcomeMessage(chatId: number, username: string) {
    const welcomeMessage = `👋 Привет, @${username}!

Это бот Anirum для верификации аккаунтов.

🔐 <b>Как получить код верификации:</b>
1. Введите ваш username (@${username}) в веб-приложении
2. Нажмите кнопку отправки кода
3. Вернитесь сюда и нажмите /start снова
4. Получите код и введите его в приложении

📱 Chat ID: <code>${chatId}</code>
🕐 Время: ${new Date().toLocaleString('ru-RU')}

<i>Ваш аккаунт готов к верификации!</i>`;

    await this.sendMessage(chatId, welcomeMessage);
  },

  /**
   * Универсальный метод отправки сообщений
   */
  async sendMessage(chatId: number, text: string) {
    try {
      const botToken = process.env.TELEGRAM_BOT_TOKEN;

      if (!botToken) {
        console.error('❌ TELEGRAM_BOT_TOKEN не найден в переменных окружения');
        return;
      }

      const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chat_id: chatId,
          text: text,
          parse_mode: 'HTML'
        }),
      });

      const result = await response.json() as TelegramApiResponse;

      if (!result.ok) {
        console.error(`❌ Ошибка отправки сообщения:`, result);
      }

      return result;

    } catch (error) {
      console.error('❌ Ошибка отправки сообщения:', error);
      throw error;
    }
  },

  /**
   * Настроить webhook в Telegram
   * POST /api/telegram-webhook/setup
   */
  async setupWebhook(ctx) {
    try {
      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      const baseUrl = process.env.URL || 'https://anirum.up.railway.app';

      if (!botToken) {
        return ctx.badRequest('TELEGRAM_BOT_TOKEN не найден в переменных окружения');
      }

      const webhookUrl = `${baseUrl}/api/telegram-webhook`;


      // Устанавливаем webhook
      const response = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url: webhookUrl,
          allowed_updates: ['message'],
          drop_pending_updates: true
        }),
      });

      const result = await response.json() as TelegramApiResponse;

      if (!result.ok) {
        throw new Error(`Telegram API Error: ${result.description}`);
      }

      // Получаем информацию о webhook
      const webhookInfoResponse = await fetch(`https://api.telegram.org/bot${botToken}/getWebhookInfo`);
      const webhookInfo = await webhookInfoResponse.json() as TelegramApiResponse;


      return ctx.send({
        success: true,
        message: 'Webhook успешно настроен',
        webhookUrl,
        webhookInfo: webhookInfo.ok ? webhookInfo.result : null
      });

    } catch (error) {
      console.error('❌ Ошибка настройки webhook:', error);
      return ctx.internalServerError(`Ошибка настройки webhook: ${error.message}`);
    }
  },

  /**
   * Получить информацию о webhook
   * GET /api/telegram-webhook/info
   */
  async getWebhookInfo(ctx) {
    try {
      const botToken = process.env.TELEGRAM_BOT_TOKEN;

      if (!botToken) {
        return ctx.badRequest('TELEGRAM_BOT_TOKEN не найден');
      }

      const response = await fetch(`https://api.telegram.org/bot${botToken}/getWebhookInfo`);
      const result = await response.json() as TelegramApiResponse;

      if (!result.ok) {
        throw new Error(`Telegram API Error: ${result.description}`);
      }

      return ctx.send({
        success: true,
        webhookInfo: result.result
      });

    } catch (error) {
      console.error('❌ Ошибка получения информации о webhook:', error);
      return ctx.internalServerError(`Ошибка: ${error.message}`);
    }
  }
};