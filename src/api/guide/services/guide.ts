/**
 * guide service
 */

import { factories } from '@strapi/strapi';

export default factories.createCoreService('api::guide.guide', ({ strapi }) => ({

  /**
   * Получить гайды пользователя
   */
  async findUserGuides(userId: string, options: any = {}) {
    return await strapi.entityService.findMany('api::guide.guide', {
      filters: {
        users_permissions_user: { documentId: userId }
      } as any,
      populate: {
        image: {
          fields: ['url', 'alternativeText', 'formats']
        },
        savedBy: {
          fields: ['id']
        }
      },
      sort: { createdAt: 'desc' },
      ...options
    });
  },

  /**
   * Получить сохраненные гайды пользователя
   */
  async findSavedGuides(userId: string, options: any = {}) {
    return await strapi.entityService.findMany('api::guide.guide', {
      filters: {
        savedBy: { documentId: userId }
      } as any,
      populate: {
        image: {
          fields: ['url', 'alternativeText', 'formats']
        },
        users_permissions_user: {
          fields: ['username', 'email']
        }
      },
      sort: { createdAt: 'desc' },
      ...options
    });
  },

  /**
   * Проверить, сохранен ли гайд пользователем
   */
  async isGuideSavedByUser(guideId: string, userId: string) {
    const guide = await strapi.entityService.findOne('api::guide.guide', guideId, {
      populate: ['savedBy']
    }) as any;

    if (!guide) {
      return false;
    }

    return guide.savedBy?.some((user: any) => user.documentId === userId) || false;
  },

  /**
   * Получить популярные теги
   */
  async getPopularTags(limit = 20) {
    const guides = await strapi.entityService.findMany('api::guide.guide', {
      filters: { approved: true } as any,
      fields: ['tags'],
      pagination: false
    });

    const tagCounts: any = {};
    guides.forEach((guide: any) => {
      if (guide.tags && Array.isArray(guide.tags)) {
        guide.tags.forEach((tag: any) => {
          if (typeof tag === 'string' && tag.trim()) {
            const normalizedTag = tag.trim().toLowerCase();
            tagCounts[normalizedTag] = (tagCounts[normalizedTag] || 0) + 1;
          }
        });
      }
    });

    return Object.entries(tagCounts)
      .sort(([,a], [,b]) => (b as number) - (a as number))
      .slice(0, limit)
      .map(([tag, count]) => ({ tag, count }));
  },

  /**
   * Поиск гайдов по тегам через прямой SQL запрос
   * Использует PostgreSQL JSONB оператор @> для проверки вхождения элемента в массив
   */
  async searchByTags(tags: string[], page = 1, pageSize = 20) {
    const db = strapi.db.connection;
    const offset = (page - 1) * pageSize;

    console.log(`🔍 SQL search for tags:`, tags);

    // Прямой SQL запрос с PostgreSQL JSONB оператором @>
    // tags @> '["head"]'::jsonb - проверяет, содержит ли массив tags элемент "head"
    const tagConditions = tags.map((_, index) => `tags @> $${index + 1}::jsonb`).join(' OR ');

    const query = `
      SELECT *
      FROM guides
      WHERE approved = true
        AND published_at IS NULL
        AND (${tagConditions})
      ORDER BY created_at DESC
      LIMIT $${tags.length + 1}
      OFFSET $${tags.length + 2}
    `;

    // Параметры: каждый тег оборачиваем в JSON массив ["tag"]
    const params = [
      ...tags.map(tag => JSON.stringify([tag])),
      pageSize,
      offset
    ];

    console.log(`📝 SQL query:`, query);
    console.log(`📦 SQL params:`, params);

    const results = await db.raw(query, params);

    // PostgreSQL возвращает results.rows
    const guides = results.rows || results;

    console.log(`✅ Found ${guides.length} guides`);

    return {
      results: guides,
      pagination: {
        page,
        pageSize,
        pageCount: Math.ceil(guides.length / pageSize),
        total: guides.length
      }
    };
  }

}));