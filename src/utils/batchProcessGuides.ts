import { generateTagsFromImage } from "./generateTagsFromImage";
import { generateTagsFromText } from "./generateTagsFromText";

/**
 * Утилита для массовой обработки гайдов менеджерами
 * Генерирует теги для всех гайдов без тегов или обновляет существующие
 */

interface GuideForProcessing {
  id: string;
  title: string;
  text?: string;
  image?: {
    url: string;
    formats?: {
      thumbnail?: { url: string };
      small?: { url: string };
      medium?: { url: string };
      large?: { url: string };
    };
  };
  tags?: string[];
}

interface ProcessingOptions {
  forceUpdate?: boolean; // Обновлять даже если теги уже есть
  batchSize?: number; // Размер батча для обработки
  delayBetweenRequests?: number; // Задержка между запросами (мс)
}

export class GuideBatchProcessor {
  private strapi: any;

  constructor(strapi: any) {
    this.strapi = strapi;
  }

  /**
   * Обработка всех гайдов пользователя
   */
  async processUserGuides(
    userId: string,
    options: ProcessingOptions = {}
  ): Promise<{ processed: number; errors: number; skipped: number }> {
    const { forceUpdate = false, batchSize = 5, delayBetweenRequests = 1000 } = options;

    try {
      // Получаем все гайды пользователя
      const guides = await this.strapi.entityService.findMany('api::guide.guide', {
        filters: {
          users_permissions_user: { documentId: userId }
        },
        populate: {
          image: {
            fields: ['url', 'formats']
          }
        },
        pagination: false
      }) as GuideForProcessing[];

      console.log(`Найдено ${guides.length} гайдов для обработки`);

      let processed = 0;
      let errors = 0;
      let skipped = 0;

      // Обрабатываем батчами
      for (let i = 0; i < guides.length; i += batchSize) {
        const batch = guides.slice(i, i + batchSize);

        console.log(`Обработка батча ${Math.floor(i / batchSize) + 1}/${Math.ceil(guides.length / batchSize)}`);

        const batchPromises = batch.map(async (guide) => {
          try {
            // Пропускаем если теги уже есть и не форсируем обновление
            if (!forceUpdate && guide.tags && guide.tags.length > 0) {
              skipped++;
              return;
            }

            const newTags = await this.generateTagsForGuide(guide);

            if (newTags.length > 0) {
              await this.updateGuideTags(guide.id, newTags);
              processed++;
              console.log(`✓ Обновлен гайд "${guide.title}" с ${newTags.length} тегами`);
            } else {
              skipped++;
              console.log(`⚠ Не удалось сгенерировать теги для "${guide.title}"`);
            }
          } catch (error) {
            errors++;
            console.error(`✗ Ошибка обработки гайда "${guide.title}":`, error);
          }
        });

        await Promise.all(batchPromises);

        // Задержка между батчами
        if (i + batchSize < guides.length) {
          await this.delay(delayBetweenRequests);
        }
      }

      console.log(`Обработка завершена: обработано ${processed}, ошибок ${errors}, пропущено ${skipped}`);

      return { processed, errors, skipped };
    } catch (error) {
      console.error('Ошибка массовой обработки гайдов:', error);
      throw error;
    }
  }

  /**
   * Обработка всех гайдов в системе (только для менеджеров)
   */
  async processAllGuides(
    options: ProcessingOptions = {}
  ): Promise<{ processed: number; errors: number; skipped: number }> {
    const { forceUpdate = false, batchSize = 3, delayBetweenRequests = 1500 } = options;

    try {
      const filters = forceUpdate
        ? {}
        : { $or: [{ tags: { $null: true } }, { tags: { $size: 0 } }] };

      const guides = await this.strapi.entityService.findMany('api::guide.guide', {
        filters,
        populate: {
          image: {
            fields: ['url', 'formats']
          }
        },
        pagination: false
      }) as GuideForProcessing[];

      console.log(`Найдено ${guides.length} гайдов для обработки`);

      let processed = 0;
      let errors = 0;
      let skipped = 0;

      // Обрабатываем более консервативными батчами для массовой обработки
      for (let i = 0; i < guides.length; i += batchSize) {
        const batch = guides.slice(i, i + batchSize);

        console.log(`Обработка батча ${Math.floor(i / batchSize) + 1}/${Math.ceil(guides.length / batchSize)}`);

        for (const guide of batch) {
          try {
            const newTags = await this.generateTagsForGuide(guide);

            if (newTags.length > 0) {
              await this.updateGuideTags(guide.id, newTags);
              processed++;
              console.log(`✓ Обновлен гайд "${guide.title}" с ${newTags.length} тегами`);
            } else {
              skipped++;
            }

            // Небольшая задержка между каждым запросом
            await this.delay(500);
          } catch (error) {
            errors++;
            console.error(`✗ Ошибка обработки гайда "${guide.title}":`, error);
          }
        }

        // Большая задержка между батчами
        if (i + batchSize < guides.length) {
          await this.delay(delayBetweenRequests);
        }
      }

      console.log(`Массовая обработка завершена: обработано ${processed}, ошибок ${errors}, пропущено ${skipped}`);

      return { processed, errors, skipped };
    } catch (error) {
      console.error('Ошибка массовой обработки всех гайдов:', error);
      throw error;
    }
  }

  /**
   * Генерация тегов для конкретного гайда
   */
  private async generateTagsForGuide(guide: GuideForProcessing): Promise<string[]> {
    const allTags: string[] = [];

    // Генерируем теги по тексту
    if (guide.title || guide.text) {
      const textTags = await generateTagsFromText(guide.title, guide.text);
      allTags.push(...textTags);
    }

    // Генерируем теги по изображению
    if (guide.image) {
      const imageUrl =
        guide.image.formats?.thumbnail?.url ||
        guide.image.formats?.small?.url ||
        guide.image.formats?.medium?.url ||
        guide.image.url;

      if (imageUrl) {
        const imageTags = await generateTagsFromImage(imageUrl);
        allTags.push(...imageTags);
      }
    }

    // Убираем дубликаты и возвращаем уникальные теги
    return [...new Set(allTags)];
  }

  /**
   * Обновление тегов гайда
   */
  private async updateGuideTags(guideId: string, tags: string[]): Promise<void> {
    await this.strapi.entityService.update('api::guide.guide', guideId, {
      data: { tags }
    });
  }

  /**
   * Задержка выполнения
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}