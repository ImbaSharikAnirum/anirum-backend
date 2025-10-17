/**
 * skill-tree controller
 */

import { factories } from '@strapi/strapi'

export default factories.createCoreController('api::skill-tree.skill-tree', ({ strapi }) => ({

  /**
   * Batch публикация дерева навыков с гайдами
   * Принимает все данные за один запрос и сохраняет атомарно
   *
   * POST /skill-trees/:documentId/publish
   * Body: {
   *   skills: [
   *     { tempId: 'temp-1', title: 'Навык', position: {x, y}, image?: base64, guideEdges?: [...] },
   *     { documentId: 'existing-123', title: 'Навык', position: {x, y}, guideEdges?: [...] }
   *   ],
   *   skillEdges: [{ id, source, target, type }],
   *   deletedSkills: ['skill-documentId-1'],
   *   guides: [
   *     { tempId: 'temp-guide-1', title: 'Гайд', skillId: 'skill-123', image?: base64, text?, link? },
   *     { documentId: 'guide-123', title: 'Гайд', skillId: 'skill-123' }
   *   ]
   * }
   */
  async publish(ctx: any) {
    const { documentId } = ctx.params
    const user = ctx.state.user

    if (!user) {
      return ctx.unauthorized('Необходима авторизация')
    }

    const { skills = [], skillEdges = [], deletedSkills = [], guides = [] } = ctx.request.body

    try {
      // 1. Проверяем, что пользователь владелец дерева или менеджер
      const tree = await strapi.entityService.findOne('api::skill-tree.skill-tree', documentId, {
        populate: ['owner']
      }) as any

      if (!tree) {
        return ctx.notFound('Дерево навыков не найдено')
      }

      const isOwner = tree.owner?.documentId === user.documentId
      const isManager = user.role?.type === 'manager'

      if (!isOwner && !isManager) {
        return ctx.forbidden('Недостаточно прав для редактирования этого дерева')
      }

      // Маппинг временных ID на реальные documentId
      const skillIdMap = new Map<string, string>()
      const guideIdMap = new Map<string, string>()

      // Выполняем все операции в транзакции для атомарности
      const result = await strapi.db.transaction(async ({ trx }) => {
        // 2. Обработка удаленных навыков
        for (const skillDocId of deletedSkills) {
          await strapi.entityService.delete('api::skill.skill', skillDocId)
        }

        // 3. Обработка навыков (создание/обновление) с изображениями
        for (const skillData of skills) {
          let imageId: number | undefined

          // Обработка изображения (base64)
          if (skillData.image && skillData.image.startsWith('data:image')) {
            try {
              // Конвертируем base64 в Buffer
              const base64Data = skillData.image.split(',')[1]
              const buffer = Buffer.from(base64Data, 'base64')

              // Определяем mime type
              const mimeMatch = skillData.image.match(/data:([^;]+);/)
              const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg'
              const ext = mimeType.split('/')[1]

              // Загружаем файл через Upload plugin
              const uploadedFiles = await strapi.plugins.upload.services.upload.upload({
                data: {},
                files: {
                  path: buffer,
                  name: `skill-${Date.now()}.${ext}`,
                  type: mimeType,
                  size: buffer.length,
                },
              })

              imageId = uploadedFiles[0]?.id
            } catch (uploadError) {
              console.error('Ошибка загрузки изображения навыка:', uploadError)
            }
          }

          if (skillData.documentId) {
            // Обновляем существующий навык
            const updateData: any = {
              title: skillData.title,
              position: skillData.position,
            }

            if (imageId) {
              updateData.image = imageId
            }

            await strapi.entityService.update('api::skill.skill', skillData.documentId, {
              data: updateData
            })
          } else if (skillData.tempId) {
            // Создаем новый навык
            const createData: any = {
              title: skillData.title,
              position: skillData.position,
              skill_tree: documentId,
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
          let imageId: number | undefined

          // Обработка изображения гайда (base64)
          if (guideData.image && guideData.image.startsWith('data:image')) {
            try {
              const base64Data = guideData.image.split(',')[1]
              const buffer = Buffer.from(base64Data, 'base64')

              const mimeMatch = guideData.image.match(/data:([^;]+);/)
              const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg'
              const ext = mimeType.split('/')[1]

              const uploadedFiles = await strapi.plugins.upload.services.upload.upload({
                data: {},
                files: {
                  path: buffer,
                  name: `guide-${Date.now()}.${ext}`,
                  type: mimeType,
                  size: buffer.length,
                },
              })

              imageId = uploadedFiles[0]?.id
            } catch (uploadError) {
              console.error('Ошибка загрузки изображения гайда:', uploadError)
            }
          }

          // Определяем реальный skillId (с учетом маппинга)
          const realSkillId = skillIdMap.get(guideData.skillId) || guideData.skillId

          if (guideData.documentId) {
            // Обновляем существующий гайд
            const updateData: any = {
              title: guideData.title,
              text: guideData.text,
              link: guideData.link,
            }

            if (imageId) {
              updateData.image = imageId
            }

            await strapi.entityService.update('api::guide.guide', guideData.documentId, {
              data: updateData
            })
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
            const skill = await strapi.entityService.findOne('api::skill.skill', realSkillId, {
              populate: ['guides']
            }) as any

            // Собираем documentId существующих гайдов и добавляем новый
            const existingGuideDocIds = (skill.guides || []).map((g: any) => g.documentId)
            const updatedGuideDocIds = [...existingGuideDocIds, createdGuide.documentId]

            await strapi.entityService.update('api::skill.skill', realSkillId, {
              data: {
                guides: updatedGuideDocIds
              } as any
            })
          }
        }

        // 6. Обновляем guideEdges для каждого навыка
        for (const skillData of skills) {
          if (skillData.guideEdges && skillData.guideEdges.length > 0) {
            // Заменяем временные ID гайдов на реальные
            const updatedGuideEdges = skillData.guideEdges.map((edge: any) => ({
              ...edge,
              source: guideIdMap.get(edge.source) || edge.source,
              target: guideIdMap.get(edge.target) || edge.target,
            }))

            const realSkillDocId = skillIdMap.get(skillData.tempId) || skillData.documentId

            await strapi.entityService.update('api::skill.skill', realSkillDocId, {
              data: {
                guideEdges: updatedGuideEdges
              }
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
        const updatedTree = await strapi.entityService.update('api::skill-tree.skill-tree', documentId, {
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

        return {
          tree: updatedTree,
          skillIdMap: Object.fromEntries(skillIdMap),
          guideIdMap: Object.fromEntries(guideIdMap)
        }
      })

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
