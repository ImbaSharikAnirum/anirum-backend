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
   * Поиск гайдов по тегам через прямой SQL (PostgreSQL JSONB)
   * Использует оператор @> для проверки вхождения элемента в JSONB массив
   */
  async searchByTagsSQL(tags: string[], page = 1, pageSize = 20) {
    const db = strapi.db.connection;
    const offset = (page - 1) * pageSize;

    console.log(`🔍 SQL search for ${tags.length} tags:`, tags.slice(0, 3), '...')

    // Создаем условие: tags @> ? OR tags @> ? OR ...
    const tagConditions = tags.map(() => `tags @> ?::jsonb`).join(' OR ')

    // Параметры: каждый тег как JSON массив ["tag"]
    const tagParams = tags.map(tag => JSON.stringify([tag]))

    console.log(`📝 SQL query sample: tags @> '["${tags[0]}"]' OR tags @> '["${tags[1]}"]' ...`)

    const result = await db.raw(`
      SELECT id, document_id, title, text, link, pinterest_id, created_at, updated_at, published_at, tags
      FROM guides
      WHERE published_at IS NULL
        AND (${tagConditions})
      ORDER BY created_at DESC
      LIMIT ?
      OFFSET ?
    `, [...tagParams, pageSize, offset])

    // PostgreSQL возвращает result.rows
    const rawGuides = result.rows || result

    console.log(`✅ Found ${rawGuides.length} guides via SQL`)

    // Загружаем полные данные с populate для image, user через entityService
    const guideIds = rawGuides.map((g: any) => g.id)

    const fullGuides = await strapi.entityService.findMany('api::guide.guide', {
      filters: { id: { $in: guideIds } } as any,
      populate: {
        image: {
          fields: ['url', 'alternativeText', 'formats']
        },
        users_permissions_user: {
          fields: ['username', 'email']
        },
        savedBy: {
          fields: ['id']
        }
      }
    })

    // Сортируем в том же порядке, что и SQL результат
    const guidesMap = new Map(fullGuides.map((g: any) => [g.id, g]))
    const guides = guideIds.map(id => guidesMap.get(id)).filter(Boolean)

    console.log(`📦 First guide:`, guides[0]?.title, 'has image:', !!guides[0]?.image)

    // Подсчитываем total для pagination
    const countResult = await db.raw(`
      SELECT COUNT(*) as total
      FROM guides
      WHERE published_at IS NULL
        AND (${tagConditions})
    `, tagParams)

    const total = parseInt(countResult.rows?.[0]?.total || countResult[0]?.total || 0)

    return {
      results: guides,
      pagination: {
        page,
        pageSize,
        pageCount: Math.ceil(total / pageSize),
        total
      }
    }
  }

}));