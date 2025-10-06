/**
 * guide controller
 */

import { factories } from '@strapi/strapi'
import { enhanceSearchQuery } from '../../../utils'

export default factories.createCoreController('api::guide.guide', ({ strapi }) => ({

  /**
   * Получить все гайды (с сортировкой по количеству креативов)
   * Используем поле creationsCount для эффективной сортировки
   */
  async find(ctx: any) {
    const { query } = ctx

    // Получаем параметры пагинации из query
    const page = parseInt(query.pagination?.page) || 1
    const pageSize = parseInt(query.pagination?.pageSize) || 25

    // Получаем гайды с нативной сортировкой по creationsCount и пагинацией
    const result = await strapi.entityService.findPage('api::guide.guide', {
      ...query,
      page,
      pageSize,
      filters: {
        ...query.filters,
        publishedAt: { $null: true } // Только драфты (исключаем опубликованные дубликаты)
      } as any,
      sort: {
        creationsCount: 'desc', // Сортировка по счетчику (эффективно через индекс)
        createdAt: 'desc',      // При равном счетчике - по дате
        id: 'desc'              // При равных значениях - по ID (детерминированный порядок)
      },
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

    // findPage возвращает { results: [], pagination: {} }
    return {
      data: result.results,
      meta: {
        pagination: result.pagination
      }
    }
  },

  /**
   * Получить гайд по ID
   */
  async findOne(ctx: any) {
    const { id } = ctx.params
    const { query } = ctx

    const result = await strapi.entityService.findOne('api::guide.guide', id, {
      ...query,
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

    return this.transformResponse(result)
  },

  /**
   * Создать новый гайд
   */
  async create(ctx: any) {
    const user = ctx.state.user

    if (!user) {
      return ctx.unauthorized('Необходима авторизация')
    }

    const { data } = ctx.request.body

    // Добавляем пользователя к гайду
    const result = await strapi.entityService.create('api::guide.guide', {
      data: {
        ...data,
        users_permissions_user: user.documentId,
        approved: false, // Новые гайды требуют модерации
      } as any,
      populate: {
        image: {
          fields: ['url', 'alternativeText', 'formats']
        },
        users_permissions_user: {
          fields: ['username', 'email']
        }
      }
    })

    return this.transformResponse(result)
  },

  /**
   * Сохранить/убрать гайд из сохраненных
   */
  async toggleSave(ctx: any) {
    const user = ctx.state.user
    const { id } = ctx.params
    const { action } = ctx.request.body // 'save' или 'unsave'

    if (!user) {
      return ctx.unauthorized('Необходима авторизация')
    }

    try {
      const guide = await strapi.entityService.findOne('api::guide.guide', id, {
        populate: ['savedBy']
      }) as any

      if (!guide) {
        return ctx.notFound('Гайд не найден')
      }

      const savedByIds = guide.savedBy?.map((u: any) => u.documentId) || []
      const userDocumentId = user.documentId

      let newSavedBy
      if (action === 'save') {
        // Добавляем пользователя в savedBy, если его там нет
        if (!savedByIds.includes(userDocumentId)) {
          newSavedBy = [...savedByIds, userDocumentId]
        } else {
          return ctx.badRequest('Гайд уже сохранен')
        }
      } else if (action === 'unsave') {
        // Убираем пользователя из savedBy
        newSavedBy = savedByIds.filter(id => id !== userDocumentId)
      } else {
        return ctx.badRequest('Действие должно быть save или unsave')
      }

      const result = await strapi.entityService.update('api::guide.guide', id, {
        data: {
          savedBy: newSavedBy
        } as any,
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

      return this.transformResponse(result)

    } catch (error) {
      console.error('Ошибка при изменении статуса сохранения:', error)
      return ctx.throw(500, 'Ошибка при изменении статуса сохранения')
    }
  },

  /**
   * Поиск гайдов по тегам и тексту
   */
  async search(ctx: any) {
    const { query = '', tags = [], userId } = ctx.request.body
    const { page = 1, pageSize = 20 } = ctx.query

    try {
      let filters = {
        // approved: true, // Временно отключено для теста
        publishedAt: { $null: true } // Только драфты (исключаем опубликованные дубликаты)
      }

      // Специальные запросы
      if (query === 'созданные гайды' && userId) {
        filters = {
          users_permissions_user: { documentId: userId },
          publishedAt: { $null: true }
        } as any
      } else if (query === 'сохраненные' && userId) {
        filters = {
          savedBy: { documentId: userId },
          publishedAt: { $null: true }
        } as any
      } else {
        // Поиск по тегам и тексту
        const searchConditions = []
        console.log('🔍 Search query:', query)
        if (query.trim()) {
          // 🤖 AI обработка запроса → массив связанных английских тегов
          try {
            const { enhancedTags } = await enhanceSearchQuery(query)

            if (enhancedTags.length > 0) {
              console.log(`🤖 AI enhanced search "${query}" → ${enhancedTags.length} tags:`, enhancedTags)

              // Используем прямой SQL для поиска по JSONB массиву
              const result = await strapi.service('api::guide.guide').searchByTagsSQL(
                enhancedTags,
                parseInt(page as any),
                parseInt(pageSize as any)
              )

              return result

            } else {
              console.log(`⚠️ AI returned no tags, fallback to text search`)
              // Fallback: обычный текстовый поиск если AI не вернул теги
              searchConditions.push(
                { title: { $containsi: query } },
                { text: { $containsi: query } }
              )
            }
          } catch (aiError) {
            console.error('❌ AI search enhancement failed, using fallback:', aiError)
            // Fallback: обычный текстовый поиск при ошибке AI
            searchConditions.push(
              { title: { $containsi: query } },
              { text: { $containsi: query } }
            )
          }
        }

        // Дополнительные теги от пользователя (если есть)
        if (tags.length > 0) {
          tags.forEach(tag => {
            searchConditions.push({
              tags: { $containsi: tag }
            })
          })
        }

        if (searchConditions.length > 0) {
          filters = {
            $and: [
              { publishedAt: { $null: true } }, // Драфты
              { $or: searchConditions }         // Хотя бы один тег совпал
            ]
          } as any
        }
      }

      console.log(`🔧 Final filters:`, JSON.stringify(filters, null, 2))

      const result = await strapi.entityService.findPage('api::guide.guide', {
        filters,
        page,
        pageSize,
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
        },
        sort: { createdAt: 'desc' }
      })

      return result

    } catch (error) {
      console.error('Ошибка поиска гайдов:', error)
      return ctx.throw(500, 'Ошибка поиска гайдов')
    }
  },

  /**
   * Получить популярные теги
   */
  async getPopularTags(ctx: any) {
    try {
      const { limit = 20 } = ctx.query

      const result = await strapi.service('api::guide.guide').getPopularTags(parseInt(limit))

      return ctx.send(result)
    } catch (error) {
      console.error('Ошибка получения популярных тегов:', error)
      return ctx.throw(500, 'Ошибка получения популярных тегов')
    }
  }

}))
