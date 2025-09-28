/**
 * Система управления pending сессиями верификации Telegram
 */

interface PendingSession {
  id: string;
  username: string; // нормализованный без @
  code: string;
  userId: number;
  userDocumentId: string;
  messenger: 'telegram';
  createdAt: Date;
  expiresAt: Date;
  chatId?: number; // заполняется когда пользователь пишет /start
  codeDelivered?: boolean; // true когда код отправлен
}

// В памяти храним pending сессии (для продакшена лучше Redis)
const pendingSessions = new Map<string, PendingSession>();

export default {
  /**
   * Создать pending сессию для Telegram верификации
   */
  createPendingSession(data: {
    username: string;
    code: string;
    userId: number;
    userDocumentId: string;
  }): PendingSession {
    // Нормализуем username (убираем @ если есть)
    const normalizedUsername = data.username.startsWith('@')
      ? data.username.slice(1)
      : data.username;

    const sessionId = `telegram_${normalizedUsername}_${Date.now()}`;

    const session: PendingSession = {
      id: sessionId,
      username: normalizedUsername,
      code: data.code,
      userId: data.userId,
      userDocumentId: data.userDocumentId,
      messenger: 'telegram',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 5 * 60 * 1000), // 5 минут
      chatId: undefined,
      codeDelivered: false
    };

    // Удаляем старые сессии для этого username
    this.cleanupUserSessions(normalizedUsername);

    pendingSessions.set(sessionId, session);

    return session;
  },

  /**
   * Найти pending сессию по username
   */
  findPendingSessionByUsername(username: string): PendingSession | null {
    const normalizedUsername = username.startsWith('@')
      ? username.slice(1)
      : username;

    for (const [sessionId, session] of pendingSessions) {
      if (session.username === normalizedUsername) {
        // Проверяем, не истекла ли сессия
        if (new Date() > session.expiresAt) {
          this.deletePendingSession(sessionId);
          return null;
        }
        return session;
      }
    }

    return null;
  },

  /**
   * Обновить сессию с chat_id когда пользователь написал /start
   */
  updateSessionWithChatId(sessionId: string, chatId: number): boolean {
    const session = pendingSessions.get(sessionId);

    if (!session) {
      return false;
    }

    // Проверяем, не истекла ли сессия
    if (new Date() > session.expiresAt) {
      this.deletePendingSession(sessionId);
      return false;
    }

    session.chatId = chatId;
    pendingSessions.set(sessionId, session);

    return true;
  },

  /**
   * Пометить код как доставленный
   */
  markCodeAsDelivered(sessionId: string): boolean {
    const session = pendingSessions.get(sessionId);

    if (!session) {
      return false;
    }

    session.codeDelivered = true;
    pendingSessions.set(sessionId, session);

    return true;
  },

  /**
   * Удалить pending сессию
   */
  deletePendingSession(sessionId: string): boolean {
    return pendingSessions.delete(sessionId);
  },

  /**
   * Очистить все сессии для пользователя (по username)
   */
  cleanupUserSessions(username: string): void {
    const normalizedUsername = username.startsWith('@')
      ? username.slice(1)
      : username;

    for (const [sessionId, session] of pendingSessions) {
      if (session.username === normalizedUsername) {
        pendingSessions.delete(sessionId);
      }
    }
  },

  /**
   * Очистить истекшие сессии (можно вызывать по cron)
   */
  cleanupExpiredSessions(): void {
    const now = new Date();

    for (const [sessionId, session] of pendingSessions) {
      if (now > session.expiresAt) {
        pendingSessions.delete(sessionId);
      }
    }
  },

  /**
   * Получить статистику pending сессий (для отладки)
   */
  getSessionStats(): {
    total: number;
    pending: number;
    withChatId: number;
    delivered: number;
  } {
    let pending = 0;
    let withChatId = 0;
    let delivered = 0;

    for (const [, session] of pendingSessions) {
      pending++;
      if (session.chatId) withChatId++;
      if (session.codeDelivered) delivered++;
    }

    return {
      total: pendingSessions.size,
      pending,
      withChatId,
      delivered
    };
  },

  /**
   * Получить все активные сессии (для отладки)
   */
  getAllSessions(): PendingSession[] {
    return Array.from(pendingSessions.values());
  }
};