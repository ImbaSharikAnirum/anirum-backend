/**
 * pinterest controller
 */

import axios from "axios";
import querystring from "querystring";

module.exports = {
  async authenticate(ctx) {
    const { code, userId } = ctx.request.body;

    if (!code || !userId) {
      return ctx.badRequest("Code and userId are required");
    }

    try {
      const clientId = process.env.PINTEREST_CLIENT_ID;
      const clientSecret = process.env.PINTEREST_CLIENT_SECRET;
      const redirectUri = process.env.PINTEREST_REDIRECT_URI;

      if (!clientId || !clientSecret || !redirectUri) {
        return ctx.throw(500, "Pinterest OAuth configuration missing");
      }

      const authHeader = Buffer.from(`${clientId}:${clientSecret}`).toString(
        "base64"
      );

      const response = await axios.post(
        "https://api.pinterest.com/v5/oauth/token",
        querystring.stringify({
          code,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        }),
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization: `Basic ${authHeader}`,
          },
        }
      );

      const { access_token, refresh_token } = response.data;

      // Обновляем пользователя с токенами Pinterest
      await strapi.documents("plugin::users-permissions.user").update({
        documentId: userId,
        data: {
          pinterestAccessToken: access_token,
          pinterestRefreshToken: refresh_token || null,
        } as any,
      });

      return ctx.send({
        success: true,
        message: "Pinterest успешно подключен",
      });
    } catch (error) {
      console.error("Ошибка Pinterest OAuth:", error);

      if (error.response?.status === 400) {
        return ctx.badRequest("Недействительный код авторизации");
      }

      return ctx.throw(500, "Ошибка при подключении Pinterest");
    }
  },

  async getConnectionStatus(ctx) {
    const userId = ctx.state.user?.documentId;

    if (!userId) {
      return ctx.unauthorized("Необходима авторизация");
    }

    try {
      // Используем уже загруженного пользователя из ctx.state.user
      const user = ctx.state.user;
      const isConnected = !!user?.pinterestAccessToken;

      return ctx.send({
        isConnected,
        message: isConnected ? "Pinterest подключен" : "Pinterest не подключен",
      });
    } catch (error) {
      console.error("Ошибка проверки статуса Pinterest:", error);
      return ctx.throw(500, "Ошибка проверки статуса");
    }
  },

  async disconnect(ctx) {
    const userId = ctx.state.user?.documentId;

    if (!userId) {
      return ctx.unauthorized("Необходима авторизация");
    }

    try {
      await strapi.documents("plugin::users-permissions.user").update({
        documentId: userId,
        data: {
          pinterestAccessToken: null,
          pinterestRefreshToken: null,
        } as any,
      });

      return ctx.send({
        success: true,
        message: "Pinterest отключен",
      });
    } catch (error) {
      console.error("Ошибка отключения Pinterest:", error);
      return ctx.throw(500, "Ошибка при отключении Pinterest");
    }
  },
};
