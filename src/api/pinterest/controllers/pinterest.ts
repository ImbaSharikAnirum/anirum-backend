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

  async getPins(ctx) {
    const user = ctx.state.user;

    console.log("Pinterest getPins - User:", user?.documentId);
    console.log("Pinterest getPins - Has token:", !!user?.pinterestAccessToken);

    const token = user?.pinterestAccessToken;

    if (!token) {
      console.log("Pinterest getPins - No token found");
      return ctx.unauthorized("Pinterest не подключен");
    }

    try {
      // Получаем параметры пагинации из query
      const pageSize = parseInt(ctx.query.page_size) || 50;
      const bookmark = ctx.query.bookmark || "";

      const url = `https://api.pinterest.com/v5/pins?page_size=${pageSize}${
        bookmark ? `&bookmark=${bookmark}` : ""
      }`;

      console.log("Pinterest API URL:", url);
      console.log("Pinterest token (first 10 chars):", token.substring(0, 10) + "...");

      const response = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      });

      console.log("Pinterest API response status:", response.status);

      if (!response.ok) {
        const errorText = await response.text();
        console.log("Pinterest API error response:", errorText);
        throw new Error(`Pinterest API error: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const data = await response.json() as any;

      // Получаем сохраненные пины из гайдов для проверки isSaved
      const guides = await strapi.documents("api::guide.guide").findMany({
        filters: {
          users_permissions_user: { documentId: user.documentId },
          link: { $contains: "https://www.pinterest.com/pin/" },
        } as any,
        fields: ["id", "link"],
        pagination: false,
      });

      // Добавляем флаг isSaved для каждого пина
      const pinsWithSaved = data.items.map((pin: any) => {
        const pinLink = `https://www.pinterest.com/pin/${pin.id}/`;
        const isSaved = guides.some((guide: any) => guide.link === pinLink);
        return { ...pin, isSaved };
      });

      return ctx.send({
        items: pinsWithSaved,
        bookmark: data.bookmark || null,
        total: data.total || pinsWithSaved.length,
      });
    } catch (error) {
      console.error("Ошибка при получении пинов:", error);

      if (error.message.includes("401") || error.message.includes("Unauthorized")) {
        return ctx.unauthorized("Токен Pinterest недействителен");
      }

      return ctx.throw(500, "Ошибка при получении пинов", {
        error: error.message,
      });
    }
  },

  async savePinAsGuide(ctx) {
    const user = ctx.state.user;

    if (!user) {
      return ctx.unauthorized("Необходима авторизация");
    }

    try {
      const {
        imageUrl,
        title,
        text = "",
        link,
        tags = [],
        approved = false,
      } = ctx.request.body;

      // Валидация данных
      if (!imageUrl || !title || !link) {
        return ctx.badRequest("Требуются imageUrl, title и link");
      }

      // Проверяем, не сохранен ли уже этот пин
      const existingGuide = await strapi.documents("api::guide.guide").findFirst({
        filters: {
          users_permissions_user: { documentId: user.documentId },
          link: link,
        } as any,
      });

      if (existingGuide) {
        return ctx.badRequest("Этот пин уже сохранен как гайд");
      }

      // Загружаем изображение с Pinterest
      const imageResponse = await fetch(imageUrl);
      if (!imageResponse.ok) {
        throw new Error("Не удалось загрузить изображение");
      }

      const imageBuffer = await imageResponse.arrayBuffer();
      const buffer = Buffer.from(imageBuffer);

      // Определяем тип файла и имя
      const contentType = imageResponse.headers.get('content-type') || 'image/jpeg';
      const extension = contentType.split('/')[1] || 'jpg';
      const fileName = `pinterest-pin-${Date.now()}.${extension}`;

      // Загружаем файл в Strapi
      const uploadedFile = await strapi.plugins.upload.services.upload.upload({
        data: {
          ref: "api::guide.guide",
          refId: null,
          field: "image",
        },
        files: {
          name: fileName,
          type: contentType,
          size: buffer.length,
          buffer: buffer,
        },
      });

      // Создаем гайд
      const newGuide = await strapi.documents("api::guide.guide").create({
        data: {
          title,
          text,
          link,
          tags: Array.isArray(tags) ? tags : [],
          approved,
          image: uploadedFile[0]?.documentId,
          users_permissions_user: { documentId: user.documentId },
        } as any,
        populate: ["image"],
      });

      return ctx.send({
        success: true,
        guide: newGuide,
        message: "Пин сохранен как гайд",
      });
    } catch (error) {
      console.error("Ошибка сохранения пина как гайда:", error);
      return ctx.throw(500, "Ошибка при сохранении пина", {
        error: error.message,
      });
    }
  },
};
