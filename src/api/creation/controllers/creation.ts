/**
 * creation controller
 */

import { factories } from "@strapi/strapi";
import { generateTagsFromImage } from "../../../utils";
import axios from "axios";
import FormData from "form-data";

/**
 * Загрузить изображение из URL в Strapi
 */
async function downloadImageFromUrl(imageUrl: string, fileName: string = "pinterest-pin.jpg") {
  try {
    // Скачиваем изображение
    const response = await axios.get(imageUrl, { responseType: "arraybuffer" });
    const buffer = Buffer.from(response.data, "binary");

    // Загружаем в Strapi через upload service
    const uploadedFiles = await strapi.plugins.upload.services.upload.upload({
      data: {},
      files: {
        name: fileName,
        type: response.headers["content-type"] || "image/jpeg",
        size: buffer.length,
        buffer: buffer, // ← Используем buffer вместо path
      },
    });

    return uploadedFiles[0]; // Возвращаем первый загруженный файл
  } catch (error) {
    console.error("Ошибка загрузки изображения из URL:", error);
    throw error;
  }
}

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
        imageId, // Изображение креатива (загруженное пользователем)
        pinterest_id,
        pinTitle,
        pinLink,
        pinImageUrl, // URL оригинального изображения пина из Pinterest API
      } = ctx.request.body;

      // Валидация
      if (!imageId || !pinterest_id || !pinImageUrl) {
        return ctx.badRequest("Требуются imageId, pinterest_id и pinImageUrl");
      }

      // 1. Проверяем: существует ли Guide с этим pinterest_id?
      let guide = await strapi.documents("api::guide.guide").findFirst({
        filters: {
          pinterest_id: { $eq: pinterest_id },
        } as any,
        populate: ["image"],
      });

      // 2. Если Guide не существует → создаём новый с изображением пина (не креатива!)
      if (!guide) {
        console.log(`Guide с pinterest_id ${pinterest_id} не найден. Создаём новый...`);

        // Шаг 1: Загружаем изображение пина из Pinterest URL
        let pinImage;
        try {
          console.log("Загрузка изображения пина из URL:", pinImageUrl);
          pinImage = await downloadImageFromUrl(pinImageUrl, `pinterest-pin-${pinterest_id}.jpg`);
          console.log("Изображение пина загружено, ID:", pinImage.id);
        } catch (downloadError) {
          console.error("Ошибка загрузки изображения пина:", downloadError);
          return ctx.badRequest("Не удалось загрузить изображение пина из Pinterest");
        }

        // Шаг 2: Создаём Guide с загруженным изображением пина
        const newGuide = await strapi.documents("api::guide.guide").create({
          data: {
            title: pinTitle || "Pinterest Pin",
            link: pinLink || null,
            pinterest_id,
            tags: [], // Сначала пустые теги
            image: pinImage.id, // ← Изображение пина из Pinterest
            users_permissions_user: { documentId: user.documentId },
            approved: false, // Требует модерации
          } as any,
          populate: ["image"],
        });

        // Шаг 3: Генерируем теги через OpenAI Vision API по загруженному изображению пина
        let generatedTags = [];
        try {
          const uploadedPinImageUrl = newGuide?.image?.url;
          if (uploadedPinImageUrl) {
            console.log("Генерация тегов для изображения пина:", uploadedPinImageUrl);
            generatedTags = await generateTagsFromImage(uploadedPinImageUrl);
            console.log("Сгенерированные теги:", generatedTags);
          }
        } catch (tagError) {
          console.error("Ошибка генерации тегов (продолжаем без автотегов):", tagError);
        }

        // Шаг 4: Обновляем Guide с тегами
        guide = await strapi.documents("api::guide.guide").update({
          documentId: newGuide.documentId,
          data: { tags: generatedTags } as any,
          populate: ["image"],
        });

        console.log(`Guide создан с изображением и ${generatedTags.length} тегами`);
      } else {
        console.log(`Guide с pinterest_id ${pinterest_id} уже существует (id: ${guide.documentId})`);
      }

      // 3. Создаём Creation с привязкой к Guide
      // Creation содержит загруженное пользователем изображение (imageId)
      const creation = await strapi.documents("api::creation.creation").create({
        data: {
          image: imageId, // ← Изображение креатива пользователя
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
