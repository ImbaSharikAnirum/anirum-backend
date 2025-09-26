/**
 * Telegram service for sending verification codes via Bot API
 */

interface TelegramBotConfig {
  botToken: string;
  apiUrl: string;
}

interface SendMessagePayload {
  chat_id: string;
  text: string;
  parse_mode?: 'HTML' | 'Markdown';
}

interface SendMessageResponse {
  ok: boolean;
  result?: {
    message_id: number;
    chat: {
      id: number;
      username?: string;
      type: string;
    };
  };
  error_code?: number;
  description?: string;
}

export default {
  /**
   * Получить конфигурацию Telegram Bot из environment variables
   */
  getTelegramBotConfig(): TelegramBotConfig {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;

    if (!botToken) {
      throw new Error('Telegram Bot configuration is missing. Check TELEGRAM_BOT_TOKEN environment variable.');
    }

    return {
      botToken,
      apiUrl: 'api.telegram.org',
    };
  },

  /**
   * Нормализация username (убираем @ если есть)
   */
  normalizeUsername(username: string): string {
    return username.startsWith('@') ? username.slice(1) : username;
  },

  /**
   * Отправить сообщение через Telegram Bot API
   */
  async sendMessage(username: string, message: string): Promise<SendMessageResponse> {
    try {
      const config = this.getTelegramBotConfig();
      const normalizedUsername = this.normalizeUsername(username);

      console.log(`📱 Отправка Telegram сообщения для @${normalizedUsername}`);

      // URL для отправки сообщения
      const url = `https://${config.apiUrl}/bot${config.botToken}/sendMessage`;

      const payload: SendMessagePayload = {
        chat_id: `@${normalizedUsername}`,
        text: message,
        parse_mode: 'HTML'
      };

      console.log(`📤 Отправка Telegram сообщения на @${normalizedUsername}`);
      console.log(`🔗 URL: ${url}`);
      console.log(`📋 Payload:`, JSON.stringify(payload, null, 2));

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json() as SendMessageResponse;
      console.log(`📥 Telegram Bot API ответ:`, data);

      if (!data.ok) {
        // Обрабатываем специфические ошибки Telegram
        const errorMessage = this.handleTelegramError(data.error_code, data.description);
        throw new Error(errorMessage);
      }

      return data;

    } catch (error: unknown) {
      console.error('❌ Ошибка отправки Telegram сообщения:', error);
      throw error;
    }
  },

  /**
   * Обработка ошибок Telegram Bot API
   */
  handleTelegramError(errorCode?: number, description?: string): string {
    switch (errorCode) {
      case 400:
        if (description?.includes('chat not found')) {
          return 'Пользователь не найден. Проверьте правильность username или убедитесь, что пользователь начал диалог с ботом.';
        }
        if (description?.includes('username invalid')) {
          return 'Неверный формат username. Используйте формат @username';
        }
        return 'Ошибка в запросе к Telegram API';

      case 403:
        if (description?.includes('bot was blocked')) {
          return 'Бот заблокирован пользователем. Попросите пользователя разблокировать бота.';
        }
        if (description?.includes('user is deactivated')) {
          return 'Аккаунт пользователя деактивирован';
        }
        return 'Доступ к пользователю запрещен. Пользователь должен сначала начать диалог с ботом.';

      case 429:
        return 'Слишком много запросов. Попробуйте позже.';

      case 401:
        return 'Неверный токен бота. Проверьте настройки TELEGRAM_BOT_TOKEN.';

      default:
        return description || 'Неизвестная ошибка Telegram API';
    }
  },

  /**
   * Отправить код верификации
   */
  async sendVerificationCode(username: string, code: string): Promise<SendMessageResponse> {
    const message = `🔐 <b>Код подтверждения Anirum:</b> <code>${code}</code>

Код действителен <b>5 минут</b>.

⚠️ <i>Никому не сообщайте этот код!</i>`;

    return this.sendMessage(username, message);
  },

  /**
   * Проверить доступность бота (для тестирования)
   */
  async getBotInfo(): Promise<any> {
    try {
      const config = this.getTelegramBotConfig();
      const url = `https://${config.apiUrl}/bot${config.botToken}/getMe`;

      const response = await fetch(url);
      const data = await response.json();

      console.log('🤖 Информация о боте:', data);
      return data;

    } catch (error: unknown) {
      console.error('❌ Ошибка получения информации о боте:', error);
      throw error;
    }
  },
};