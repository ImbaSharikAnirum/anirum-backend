/**
 * skill-tree controller
 */

import { factories } from '@strapi/strapi'

export default factories.createCoreController('api::skill-tree.skill-tree', ({ strapi }) => ({

  /**
   * Переопределяем findOne для получения всех гайдов (включая draft)
   * GET /skill-trees/:documentId
   */
  async findOne(ctx: any) {
    const { id } = ctx.params;

    // Используем стандартный метод с правильной популяцией
    const entity = await strapi.documents('api::skill-tree.skill-tree').findOne({
      documentId: id,
      // Указываем что хотим получить все статусы (draft + published)
      status: 'draft',
      populate: {
        image: true,
        owner: {
          fields: ['username', 'email']
        },
        skills: {
          populate: {
            image: true,
            guides: {
              // Явно указываем что хотим все гайды
              filters: {},
              populate: {
                image: true
              }
            }
          }
        }
      }
    });

    // Для каждого навыка получаем ВСЕ связанные гайды (включая draft)
    if (entity && entity.skills) {
      for (const skill of entity.skills) {
        if (skill.id) {
          // Получаем все гайды этого навыка через entityService (включая draft)
          const skillWithGuides = await strapi.entityService.findOne('api::skill.skill', skill.id, {
            populate: {
              guides: {
                populate: ['image']
              }
            }
          }) as any;

          // Заменяем гайды на полный список (включая draft)
          if (skillWithGuides && skillWithGuides.guides) {
            skill.guides = skillWithGuides.guides;
          }
        }
      }
    }

    return { data: entity };
  },

  /**
   * Batch публикация дерева навыков с гайдами
   * Принимает все данные за один запрос и сохраняет атомарно
   *
   * POST /skill-trees/:documentId/publish
   * Body: {
   *   skills: [
   *     { tempId: 'temp-1', title: 'Навык', position: {x, y}, imageId?: number, guideEdges?: [...] },
   *     { documentId: 'existing-123', title: 'Навык', position: {x, y}, guideEdges?: [...] }
   *   ],
   *   skillEdges: [{ id, source, target, type }],
   *   deletedSkills: ['skill-documentId-1'],
   *   guides: [
   *     { tempId: 'temp-guide-1', title: 'Гайд', skillId: 'skill-123', imageId?: number, text?, link? },
   *     { id: 123, title: 'Гайд', skillId: 'skill-123' }
   *   ]
   * }
   */
  async publish(ctx: any) {
    const { id } = ctx.params
    const user = ctx.state.user

    if (!user) {
      return ctx.unauthorized('Необходима авторизация')
    }

    const { skills = [], skillEdges = [], deletedSkills = [], guides = [] } = ctx.request.body

    try {
      // 1. Проверяем, что пользователь владелец дерева или менеджер
      const tree = await strapi.entityService.findOne('api::skill-tree.skill-tree', id, {
        populate: {
          owner: true,
          skills: true
        }
      }) as any

      if (!tree) {
        return ctx.notFound('Дерево навыков не найдено')
      }

      const isOwner = tree.owner?.documentId === user.documentId
      const isManager = user.role?.type === 'manager'

      if (!isOwner && !isManager) {
        return ctx.forbidden('Недостаточно прав для редактирования этого дерева')
      }

      // Сохраняем числовой id дерева для связей
      const treeNumericId = tree.id

      // Создаём маппинг documentId -> numeric id для существующих навыков
      const skillDocIdToNumericId = new Map<string, number>()
      tree.skills?.forEach((skill: any) => {
        skillDocIdToNumericId.set(skill.documentId, skill.id)
      })

      // Маппинг временных ID на реальные documentId
      const skillIdMap = new Map<string, string>()
      const guideIdMap = new Map<string, string>()

      // 2. Обработка удаленных навыков
      for (const skillDocId of deletedSkills) {
        // Находим навык в дереве чтобы получить его числовой id
        const skillToDelete = tree.skills?.find((s: any) => s.documentId === skillDocId)
        if (skillToDelete) {
          await strapi.entityService.delete('api::skill.skill', skillToDelete.id)
        }
      }

      // 3. Обработка навыков (создание/обновление) с изображениями
      for (const skillData of skills) {
        // Используем imageId, который был загружен на frontend
        const imageId = skillData.imageId

        if (skillData.documentId) {
          // Обновляем существующий навык
          const numericId = skillDocIdToNumericId.get(skillData.documentId)
          if (!numericId) {
            continue
          }
          const updateData: any = {
            title: skillData.title,
            position: skillData.position,
          }

          if (imageId) {
            updateData.image = imageId
          }

          await strapi.entityService.update('api::skill.skill', numericId, {
            data: updateData
          })
        } else if (skillData.tempId) {
          // Создаем новый навык
          const createData: any = {
            title: skillData.title,
            position: skillData.position,
            skill_tree: treeNumericId,
          }

          if (imageId) {
            createData.image = imageId
          }

          const createdSkill = await strapi.entityService.create('api::skill.skill', {
            data: createData
          }) as any

          // Сохраняем маппинг
          skillIdMap.set(skillData.tempId, createdSkill.documentId)
        }
      }

      // 4. Обработка гайдов (создание/обновление) с изображениями
      for (const guideData of guides) {
        // Используем imageId, который был загружен на frontend
        const imageId = guideData.imageId

        // Определяем реальный skillId (с учетом маппинга)
        const realSkillDocId = skillIdMap.get(guideData.skillId) || guideData.skillId
        const realSkillNumericId = skillDocIdToNumericId.get(realSkillDocId)

        if (!realSkillNumericId) {
          continue
        }

        if (guideData.id) {
          // Обновляем существующий гайд (получен numeric ID)

          // Проверяем, существует ли гайд
          const existingGuide = await strapi.entityService.findOne('api::guide.guide', guideData.id, {
            fields: ['id']
          }).catch(() => null)

          if (!existingGuide) {
            continue
          }

          const updateData: any = {
            title: guideData.title,
            text: guideData.text,
            link: guideData.link,
          }

          if (imageId) {
            updateData.image = imageId
          }

          await strapi.entityService.update('api::guide.guide', guideData.id, {
            data: updateData
          })

          // Проверяем и добавляем связь с навыком (если её ещё нет)
          const skill = await strapi.entityService.findOne('api::skill.skill', realSkillNumericId, {
            populate: ['guides']
          }) as any

          // Фильтруем только валидные ID гайдов (на случай если в связях есть несуществующие)
          const existingGuideIds = (skill.guides || [])
            .filter((g: any) => g && g.id)
            .map((g: any) => g.id)

          if (!existingGuideIds.includes(guideData.id)) {
            // Гайд не связан с этим навыком, добавляем связь
            // Проверяем, что все ID в массиве существуют
            const validGuideIds = []
            for (const gId of [...existingGuideIds, guideData.id]) {
              const guideExists = await strapi.entityService.findOne('api::guide.guide', gId, {
                fields: ['id']
              }).catch(() => null)

              if (guideExists) {
                validGuideIds.push(gId)
              }
            }

            await strapi.entityService.update('api::skill.skill', realSkillNumericId, {
              data: {
                guides: validGuideIds
              } as any
            })
          }
        } else if (guideData.tempId) {
          // Создаем новый гайд
          const createData: any = {
            title: guideData.title,
            text: guideData.text || '',
            link: guideData.link || '',
            approved: false,
            users_permissions_user: user.id,
          }

          if (imageId) {
            createData.image = imageId
          }

          const createdGuide = await strapi.entityService.create('api::guide.guide', {
            data: createData
          }) as any

          // Сохраняем маппинг
          guideIdMap.set(guideData.tempId, createdGuide.documentId)

          // 5. Связываем гайд с навыком (many-to-many relation)
          const skill = await strapi.entityService.findOne('api::skill.skill', realSkillNumericId, {
            populate: ['guides']
          }) as any

          // Фильтруем только валидные ID гайдов
          const existingGuideIds = (skill.guides || [])
            .filter((g: any) => g && g.id)
            .map((g: any) => g.id)

          // Проверяем существование всех гайдов перед обновлением
          const validGuideIds = []
          for (const gId of [...existingGuideIds, createdGuide.id]) {
            const guideExists = await strapi.entityService.findOne('api::guide.guide', gId, {
              fields: ['id']
            }).catch(() => null)

            if (guideExists) {
              validGuideIds.push(gId)
            }
          }

          await strapi.entityService.update('api::skill.skill', realSkillNumericId, {
            data: {
              guides: validGuideIds
            } as any
          })
        }
      }

      // 6. Обновляем guideEdges и guidePositions для каждого навыка
      for (const skillData of skills) {
        const hasGuideEdges = skillData.guideEdges && skillData.guideEdges.length > 0
        const hasGuidePositions = skillData.guidePositions && Object.keys(skillData.guidePositions).length > 0

        if (hasGuideEdges || hasGuidePositions) {
          // Получаем documentId навыка (с учетом маппинга для новых навыков)
          const realSkillDocId = skillIdMap.get(skillData.tempId) || skillData.documentId

          // Преобразуем documentId в numeric id для entityService
          const realSkillNumericId = skillDocIdToNumericId.get(realSkillDocId)

          if (!realSkillNumericId) {
            continue
          }

          const updateData: any = {}

          // Обрабатываем guideEdges
          if (hasGuideEdges) {
            // Заменяем временные ID гайдов на реальные
            const updatedGuideEdges = skillData.guideEdges.map((edge: any) => ({
              ...edge,
              source: guideIdMap.get(edge.source) || edge.source,
              target: guideIdMap.get(edge.target) || edge.target,
            }))

            updateData.guideEdges = updatedGuideEdges
          }

          // Обрабатываем guidePositions
          if (hasGuidePositions) {
            // Заменяем временные ID гайдов на реальные в ключах позиций
            const updatedGuidePositions: Record<string, any> = {}
            for (const [guideId, position] of Object.entries(skillData.guidePositions)) {
              const realGuideId = guideIdMap.get(guideId) || guideId
              updatedGuidePositions[realGuideId] = position
            }

            updateData.guidePositions = updatedGuidePositions
          }

          await strapi.entityService.update('api::skill.skill', realSkillNumericId, {
            data: updateData
          })
        }
      }

      // 7. Обновляем связи дерева (заменяем временные ID на реальные)
      const updatedSkillEdges = skillEdges.map((edge: any) => ({
        ...edge,
        source: skillIdMap.get(edge.source) || edge.source,
        target: skillIdMap.get(edge.target) || edge.target,
      }))

      // 8. Обновляем дерево со связями
      const updatedTree = await strapi.entityService.update('api::skill-tree.skill-tree', id, {
        data: {
          skillEdges: updatedSkillEdges
        },
        populate: {
          image: true,
          owner: {
            fields: ['username', 'email']
          },
          skills: {
            populate: {
              image: true,
              guides: {
                populate: {
                  image: true
                }
              }
            }
          }
        }
      })

      const result = {
        tree: updatedTree,
        skillIdMap: Object.fromEntries(skillIdMap),
        guideIdMap: Object.fromEntries(guideIdMap)
      }

      return {
        data: result.tree,
        meta: {
          skillIdMap: result.skillIdMap,
          guideIdMap: result.guideIdMap
        }
      }

    } catch (error) {
      console.error('Ошибка публикации дерева навыков:', error)
      return ctx.throw(500, 'Ошибка публикации дерева навыков')
    }
  }

}));
