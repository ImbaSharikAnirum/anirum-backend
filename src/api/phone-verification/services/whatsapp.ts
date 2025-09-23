/**
 * WhatsApp service for sending verification codes via Green API
 */

interface GreenApiConfig {
  apiUrl: string;
  idInstance: string;
  apiTokenInstance: string;
}

interface SendMessagePayload {
  chatId: string;
  message: string;
}

interface SendMessageResponse {
  idMessage?: string;
  error?: string;
}

export default {
  /**
   * Получить конфигурацию Green API из environment variables
   */
  getGreenApiConfig(): GreenApiConfig {
    const apiUrl = process.env.GREEN_API_URL;
    const idInstance = process.env.GREEN_API_ID_INSTANCE;
    const apiTokenInstance = process.env.GREEN_API_TOKEN_INSTANCE;

    if (!apiUrl || !idInstance || !apiTokenInstance) {
      throw new Error('Green API configuration is missing. Check environment variables.');
    }

    return {
      apiUrl,
      idInstance,
      apiTokenInstance,
    };
  },

  /**
   * Отправить сообщение через Green API
   */
  async sendMessage(phone: string, message: string): Promise<SendMessageResponse> {
    try {
      const config = this.getGreenApiConfig();

      // Нормализуем номер телефона
      const normalizedPhone = phone.replace(/[^\d+]/g, '');
      const chatId = normalizedPhone.endsWith('@c.us')
        ? normalizedPhone
        : `${normalizedPhone}@c.us`;

      // URL для отправки сообщения
      const url = `https://${config.apiUrl}/waInstance${config.idInstance}/sendMessage/${config.apiTokenInstance}`;

      const payload: SendMessagePayload = {
        chatId,
        message,
      };

      console.log(`📤 Отправка WhatsApp сообщения на ${chatId}`);
      console.log(`🔗 URL: ${url}`);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json() as any;
      console.log(`📥 Green API ответ:`, data);

      if (!response.ok) {
        throw new Error(`Green API error: ${data.error || 'Unknown error'}`);
      }

      return {
        idMessage: data.idMessage,
      };

    } catch (error: unknown) {
      console.error('❌ Ошибка отправки WhatsApp сообщения:', error);
      throw error;
    }
  },

  /**
   * Отправить код верификации
   */
  async sendVerificationCode(phone: string, code: string): Promise<SendMessageResponse> {
    const message = `🔐 Код подтверждения Anirum: ${code}\n\nКод действителен 5 минут.\n\n*Никому не сообщайте этот код!*`;

    return this.sendMessage(phone, message);
  },
};