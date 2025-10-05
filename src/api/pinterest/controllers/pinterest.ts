/**
 * pinterest controller
 */

import axios from "axios";
import querystring from "querystring";
import { generateTagsFromImage } from "../../../utils";

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

      // Добавляем флаг isSaved и link для каждого пина
      const pinsWithSaved = data.items.map((pin: any) => {
        const pinLink = `https://www.pinterest.com/pin/${pin.id}/`;
        const isSaved = guides.some((guide: any) => guide.link === pinLink);
        return { ...pin, link: pinLink, isSaved };
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
      console.log("ctx.request.body:", ctx.request.body);

      const {
        imageId, // ← Теперь ожидаем готовый imageId вместо imageUrl
        title,
        text = "",
        link,
        tags = [],
        approved = false,
      } = ctx.request.body;

      // Валидация данных (imageId обязательно)
      if (!imageId) {
        return ctx.badRequest("Требуется imageId");
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

      // Изображение уже загружено на фронте, используем переданный imageId

      // 1. Создаем гайд БЕЗ тегов (как в предыдущем проекте)
      const newGuide = await strapi.documents("api::guide.guide").create({
        data: {
          title: title || "Pinterest Pin", // Дефолтный заголовок
          text: text || "",
          link: link || null, // link опционально
          tags: [], // Сначала пустые теги
          approved,
          image: imageId,
          users_permissions_user: { documentId: user.documentId },
        } as any,
        populate: ["image"],
      });

      // 2. Генерируем теги только по изображению
      let generatedTags = [];

      try {
        // Теги по изображению (используем оригинальное изображение для лучшего качества)
        const generatedImageUrl = newGuide?.image?.url;

        if (generatedImageUrl) {
          generatedTags = await generateTagsFromImage(generatedImageUrl);
        }
      } catch (tagError) {
        console.error("Ошибка генерации тегов (продолжаем без автотегов):", tagError);
      }

      // 3. Объединяем переданные теги с автогенерированными из изображения
      const manualTags = Array.isArray(tags) ? tags : [];
      const combinedTags = [...new Set([...manualTags, ...generatedTags])];


      // 4. Обновляем гайд с объединёнными тегами
      const updatedGuide = await strapi.documents("api::guide.guide").update({
        documentId: newGuide.documentId,
        data: { tags: combinedTags } as any,
        populate: ["image"],
      });

      return ctx.send({
        success: true,
        guide: updatedGuide, // Возвращаем гайд с тегами
        message: "Пин сохранен как гайд",
      });
    } catch (error) {
      console.error("Ошибка сохранения пина как гайда:", error);
      return ctx.throw(500, "Ошибка при сохранении пина", {
        error: error.message,
      });
    }
  },

  async saveAllPinsAsGuides(ctx) {
    const user = ctx.state.user;

    if (!user) {
      return ctx.unauthorized("Необходима авторизация");
    }

    // Проверка: только менеджеры
    if (user.role?.type !== "manager") {
      return ctx.forbidden("Доступно только для менеджеров");
    }

    const token = user?.pinterestAccessToken;

    if (!token) {
      return ctx.unauthorized("Pinterest не подключен");
    }

    console.log("🚀 [SAVE ALL PINS] Начало массового сохранения пинов");
    console.log(`👤 Менеджер: ${user.username} (${user.documentId})`);

    try {
      // ✅ Шаг 1: Загружаем ВСЕ пины с Pinterest API с пагинацией
      console.log("\n📥 Загрузка всех пинов с Pinterest API...");
      let allPins = [];
      let bookmark = null;
      let pageNumber = 1;

      do {
        const url = `https://api.pinterest.com/v5/pins?page_size=100${
          bookmark ? `&bookmark=${bookmark}` : ""
        }`;

        console.log(`  📄 Страница ${pageNumber}: Запрос к Pinterest API...`);

        const response = await fetch(url, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error(`  ❌ Ошибка Pinterest API: ${response.status} - ${errorText}`);
          throw new Error(`Pinterest API error: ${response.status}`);
        }

        const data = await response.json() as any;
        const pageItems = data.items || [];

        console.log(`  ✅ Загружено ${pageItems.length} пинов (страница ${pageNumber})`);

        allPins.push(...pageItems);
        bookmark = data.bookmark;
        pageNumber++;

      } while (bookmark);

      console.log(`\n✨ Всего загружено пинов: ${allPins.length}`);

      if (allPins.length === 0) {
        console.log("⚠️ Нет пинов для сохранения");
        return ctx.send({
          success: true,
          results: { success: [], skipped: [], errors: [] },
          summary: { total: 0, saved: 0, skipped: 0, errors: 0 },
        });
      }

      // ✅ Шаг 2: Обрабатываем каждый пин
      console.log("\n💾 Начало сохранения пинов как гайдов...");

      const results = {
        success: [],
        skipped: [],
        errors: [],
      };

      let processedCount = 0;

      for (const pin of allPins) {
        processedCount++;

        try {
          const pinId = pin.id;
          const pinLink = `https://www.pinterest.com/pin/${pinId}/`;
          const title = pin.title || pin.note || "Pinterest Pin";
          const description = pin.description || "";

          console.log(`\n  [${processedCount}/${allPins.length}] Обработка пина ${pinId}`);

          // Проверка дубликатов
          const existingGuide = await strapi.documents("api::guide.guide").findFirst({
            filters: { link: pinLink } as any,
          });

          if (existingGuide) {
            console.log(`    ⏭️ Пропущен (уже существует как гайд ${existingGuide.documentId})`);
            results.skipped.push({
              pinId,
              reason: "Уже существует",
              guideId: existingGuide.documentId,
            });
            continue;
          }

          // Получаем URL изображения (приоритет: оригинал → максимальное качество)
          let imageUrl = null;
          let imageSize = 'unknown';

          if ((pin.media?.images?.['originals'] as any)?.url) {
            imageUrl = (pin.media?.images?.['originals'] as any)?.url;
            imageSize = 'originals (оригинал)';
          } else if ((pin.media?.images?.['1200x'] as any)?.url) {
            imageUrl = (pin.media?.images?.['1200x'] as any)?.url;
            imageSize = '1200x (высокое)';
          } else if ((pin.media?.images?.['736x'] as any)?.url) {
            imageUrl = (pin.media?.images?.['736x'] as any)?.url;
            imageSize = '736x (среднее)';
          } else {
            const fallbackImage = Object.values(pin.media?.images || {})[0] as any;
            if (fallbackImage?.url) {
              imageUrl = fallbackImage.url;
              imageSize = 'fallback';
            }
          }

          if (!imageUrl) {
            console.log(`    ❌ Ошибка: изображение недоступно`);
            results.errors.push({
              pinId,
              error: "Изображение недоступно",
            });
            continue;
          }

          // Загружаем изображение через прокси
          console.log(`    📥 Загрузка изображения (размер: ${imageSize})...`);

          const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(imageUrl)}`;
          const imageResponse = await fetch(proxyUrl);

          if (!imageResponse.ok) {
            throw new Error(`HTTP ${imageResponse.status}: Не удалось загрузить изображение`);
          }

          const blob = await imageResponse.blob();

          if (!blob.type.startsWith('image/')) {
            throw new Error(`Неверный тип файла: ${blob.type}`);
          }

          const fileName = `pinterest-pin-${pinId}-${Date.now()}.${blob.type.split('/')[1] || 'jpg'}`;
          const buffer = Buffer.from(await blob.arrayBuffer());

          // Загружаем в Strapi
          const uploadedFiles = await strapi.plugins.upload.services.upload.upload({
            data: {},
            files: {
              path: buffer,
              name: fileName,
              type: blob.type,
              size: buffer.length,
            },
          });

          const imageId = uploadedFiles[0].id;
          console.log(`    ✅ Изображение загружено (ID: ${imageId})`);

          // Создаем гайд БЕЗ тегов
          const newGuide = await strapi.documents("api::guide.guide").create({
            data: {
              title,
              text: description,
              link: pinLink,
              tags: [],
              approved: false,
              image: imageId,
              users_permissions_user: { documentId: user.documentId },
            } as any,
            populate: ["image"],
          });

          console.log(`    📝 Гайд создан (ID: ${newGuide.documentId})`);

          // Генерируем теги по изображению
          let generatedTags = [];
          try {
            const generatedImageUrl = newGuide?.image?.url;
            if (generatedImageUrl) {
              console.log(`    🏷️ Генерация тегов...`);
              generatedTags = await generateTagsFromImage(generatedImageUrl);
              console.log(`    ✅ Сгенерировано тегов: ${generatedTags.length}`);
            }
          } catch (tagError) {
            console.log(`    ⚠️ Ошибка генерации тегов (продолжаем без тегов)`);
          }

          // Обновляем гайд с тегами
          await strapi.documents("api::guide.guide").update({
            documentId: newGuide.documentId,
            data: { tags: generatedTags } as any,
          });

          console.log(`    💚 УСПЕШНО сохранен как гайд`);

          results.success.push({
            pinId,
            guideId: newGuide.documentId,
            tagsCount: generatedTags.length,
            imageSize,
          });

        } catch (error) {
          console.log(`    ❌ Ошибка: ${error.message}`);
          results.errors.push({
            pinId: pin.id,
            error: error.message || "Неизвестная ошибка",
          });
        }
      }

      // ✅ Финальная статистика
      console.log("\n" + "=".repeat(60));
      console.log("📊 ИТОГОВАЯ СТАТИСТИКА:");
      console.log("=".repeat(60));
      console.log(`📥 Всего загружено пинов: ${allPins.length}`);
      console.log(`💚 Успешно сохранено: ${results.success.length}`);
      console.log(`⏭️ Пропущено (дубликаты): ${results.skipped.length}`);
      console.log(`❌ Ошибок: ${results.errors.length}`);
      console.log("=".repeat(60) + "\n");

      return ctx.send({
        success: true,
        results,
        summary: {
          total: allPins.length,
          saved: results.success.length,
          skipped: results.skipped.length,
          errors: results.errors.length,
        },
      });
    } catch (error) {
      console.error("\n❌ КРИТИЧЕСКАЯ ОШИБКА массового сохранения:", error);
      return ctx.throw(500, "Ошибка при массовом сохранении пинов", {
        error: error.message,
      });
    }
  },
};
