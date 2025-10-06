/**
 * guide controller
 */

import { factories } from '@strapi/strapi'

export default factories.createCoreController('api::guide.guide', ({ strapi }) => ({

  /**
   * Получить все гайды (с сортировкой по количеству креативов)
   * Используем поле creationsCount для эффективной сортировки
   */
  async find(ctx: any) {
    const { query } = ctx

    // 🔧 ОДНОРАЗОВАЯ МИГРАЦИЯ: Синхронизация creationsCount для всех гайдов
    // TODO: Удалить этот блок после первого запуска
    console.log('🔧 Запуск одноразовой миграции creationsCount...')

    let migrationPage = 1
    let hasMore = true
    let totalProcessed = 0

    while (hasMore) {
      const guidesPage = await strapi.documents('api::guide.guide').findMany({
        start: (migrationPage - 1) * 100,
        limit: 100
      })

      if (!guidesPage || guidesPage.length === 0) {
        hasMore = false
        break
      }

      console.log(`  📄 Обработка страницы ${migrationPage} (${guidesPage.length} гайдов)...`)

      for (const guide of guidesPage) {
        const creations = await strapi.documents('api::creation.creation').findMany({
          filters: { guide: { documentId: { $eq: guide.documentId } } },
          fields: ['id'],
          start: 0,
          limit: 9999
        })

        await strapi.documents('api::guide.guide').update({
          documentId: guide.documentId,
          data: { creationsCount: creations.length }
        })

        totalProcessed++
        console.log(`    ✅ "${guide.title}": creationsCount = ${creations.length}`)
      }

      if (guidesPage.length < 100) {
        hasMore = false
      } else {
        migrationPage++
      }
    }

    console.log(`✨ Миграция creationsCount завершена! Обработано гайдов: ${totalProcessed}\n`)
    // END MIGRATION creationsCount

    // 🔧 ОДНОРАЗОВАЯ МИГРАЦИЯ 2: Извлечение pinterest_id из guide.link для Creation
    // TODO: Удалить этот блок после первого запуска
    console.log('🔧 Запуск миграции pinterest_id для Creation...')

    let creationMigrationPage = 1
    let hasMoreCreations = true
    let totalCreationsProcessed = 0

    while (hasMoreCreations) {
      const creationsPage = await strapi.documents('api::creation.creation').findMany({
        filters: {
          $or: [
            { pinterest_id: { $null: true } },
            { pinterest_id: '' }
          ]
        } as any,
        populate: ['guide'],
        start: (creationMigrationPage - 1) * 100,
        limit: 100
      })

      if (!creationsPage || creationsPage.length === 0) {
        hasMoreCreations = false
        break
      }

      console.log(`  📄 Обработка страницы ${creationMigrationPage} (${creationsPage.length} creation)...`)

      for (const creation of creationsPage) {
        if (creation.guide?.link) {
          // Извлекаем pinterest_id из ссылки вида https://www.pinterest.com/pin/646548090292561581/
          const match = creation.guide.link.match(/\/pin\/(\d+)/)
          if (match && match[1]) {
            const pinterestId = match[1]

            await strapi.documents('api::creation.creation').update({
              documentId: creation.documentId,
              data: { pinterest_id: pinterestId }
            })

            totalCreationsProcessed++
            console.log(`    ✅ Creation ${creation.documentId}: pinterest_id = ${pinterestId}`)
          }
        }
      }

      if (creationsPage.length < 100) {
        hasMoreCreations = false
      } else {
        creationMigrationPage++
      }
    }

    console.log(`✨ Миграция pinterest_id завершена! Обработано creation: ${totalCreationsProcessed}\n`)
    // END MIGRATION pinterest_id

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
      } as any,
      sort: {
        creationsCount: 'desc', // Сортировка по счетчику (эффективно через индекс)
        createdAt: 'desc'       // При равном счетчике - по дате
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
      let filters = { approved: true }

      // Специальные запросы
      if (query === 'созданные гайды' && userId) {
        filters = {
          users_permissions_user: { documentId: userId }
        } as any
      } else if (query === 'сохраненные' && userId) {
        filters = {
          savedBy: { documentId: userId }
        } as any
      } else {
        // Поиск по тегам и тексту
        const searchConditions = []

        if (query.trim()) {
          searchConditions.push(
            { title: { $containsi: query } },
            { text: { $containsi: query } }
          )
        }

        if (tags.length > 0) {
          tags.forEach(tag => {
            searchConditions.push({
              tags: { $contains: tag }
            })
          })
        }

        if (searchConditions.length > 0) {
          filters = { ...filters, $or: searchConditions } as any
        }
      }

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
