/**
 * creation controller
 */

import { factories } from "@strapi/strapi";
import { generateTagsFromImage } from "../../../utils";

export default factories.createCoreController(
  "api::creation.creation",
  ({ strapi }) => ({
  /**
   * Загрузка пользовательского изображения по Pinterest пину
   * Логика:
   * 1. Проверяем существование Guide с pinterest_id
   * 2. Если нет → создаём новый Guide с AI тегами (через generateTagsFromImage)
   * 3. Создаём Creation с привязкой к Guide
   */
  async uploadCreation(ctx) {
    const user = ctx.state.user;

    if (!user) {
      return ctx.unauthorized("Необходима авторизация");
    }

    try {
      const {
        imageId,
        pinterest_id,
        pinTitle,
        pinLink,
      } = ctx.request.body;

      // Валидация
      if (!imageId || !pinterest_id) {
        return ctx.badRequest("Требуются imageId и pinterest_id");
      }

      // 1. Проверяем: существует ли Guide с этим pinterest_id?
      let guide = await strapi.documents("api::guide.guide").findFirst({
        filters: {
          pinterest_id: { $eq: pinterest_id },
        } as any,
        populate: ["image"],
      });

      // 2. Если Guide не существует → создаём новый с AI тегами
      if (!guide) {
        console.log(`Guide с pinterest_id ${pinterest_id} не найден. Создаём новый...`);

        // Создаём Guide БЕЗ тегов (сначала)
        const newGuide = await strapi.documents("api::guide.guide").create({
          data: {
            title: pinTitle || "Pinterest Pin",
            link: pinLink || null,
            pinterest_id,
            tags: [], // Сначала пустые теги
            image: imageId,
            users_permissions_user: { documentId: user.documentId },
            approved: false, // Требует модерации
          } as any,
          populate: ["image"],
        });

        // Генерируем теги через OpenAI Vision API
        let generatedTags = [];
        try {
          const imageUrl = newGuide?.image?.url;

          if (imageUrl) {
            console.log("Генерация тегов для изображения:", imageUrl);
            generatedTags = await generateTagsFromImage(imageUrl);
            console.log("Сгенерированные теги:", generatedTags);
          }
        } catch (tagError) {
          console.error("Ошибка генерации тегов (продолжаем без автотегов):", tagError);
        }

        // Обновляем Guide с тегами
        guide = await strapi.documents("api::guide.guide").update({
          documentId: newGuide.documentId,
          data: { tags: generatedTags } as any,
          populate: ["image"],
        });

        console.log(`Guide создан с ${generatedTags.length} тегами`);
      } else {
        console.log(`Guide с pinterest_id ${pinterest_id} уже существует (id: ${guide.documentId})`);
      }

      // 3. Создаём Creation с привязкой к Guide
      const creation = await strapi.documents("api::creation.creation").create({
        data: {
          image: imageId,
          pinterest_id,
          users_permissions_user: { documentId: user.documentId },
          guide: { documentId: guide.documentId },
        } as any,
        populate: ["image", "guide", "users_permissions_user"],
      });

      console.log("Creation успешно создан:", creation.id);

      return ctx.send({
        success: true,
        creation,
        guide,
        message: "Изображение успешно загружено и сохранено как гайд",
      });
    } catch (error) {
      console.error("Ошибка загрузки creation:", error);
      return ctx.throw(500, "Ошибка при загрузке изображения", {
        error: error.message,
      });
    }
  },

  /**
   * Получение creations текущего пользователя
   */
  async getMyCreations(ctx) {
    const user = ctx.state.user;

    if (!user) {
      return ctx.unauthorized("Необходима авторизация");
    }

    try {
      const creations = await strapi.documents("api::creation.creation").findMany({
        filters: {
          users_permissions_user: { documentId: { $eq: user.documentId } },
        } as any,
        populate: ["image", "guide"],
        sort: { createdAt: "desc" },
      });

      return ctx.send({
        data: creations,
        meta: { total: creations.length },
      });
    } catch (error) {
      console.error("Ошибка получения creations:", error);
      return ctx.throw(500, "Ошибка при получении creations");
    }
  },
}));
