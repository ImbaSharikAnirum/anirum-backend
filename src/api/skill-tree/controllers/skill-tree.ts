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
      console.log('=== PUBLISH START ===')
      console.log('id from params:', id)
      console.log('Загрузка дерева...')
      const tree = await strapi.entityService.findOne('api::skill-tree.skill-tree', id, {
        populate: {
          owner: true,
          skills: true
        }
      }) as any
      console.log('Дерево загружено, id:', tree?.id, 'documentId:', tree?.documentId, 'skills:', tree?.skills?.length)

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
      console.log('Удаление навыков:', deletedSkills)
      for (const skillDocId of deletedSkills) {
        // Находим навык в дереве чтобы получить его числовой id
        const skillToDelete = tree.skills?.find((s: any) => s.documentId === skillDocId)
        if (skillToDelete) {
          console.log('Удаление навыка с id:', skillToDelete.id)
          await strapi.entityService.delete('api::skill.skill', skillToDelete.id)
        }
      }

      // 3. Обработка навыков (создание/обновление) с изображениями
      console.log('Обработка навыков, всего:', skills.length)
      console.log('🔍 Первый навык (полный объект):', JSON.stringify(skills[0], null, 2))

      for (const skillData of skills) {
        // Используем imageId, который был загружен на frontend
        const imageId = skillData.imageId

        console.log('📝 Навык:', skillData.title, 'imageId:', imageId, 'тип imageId:', typeof imageId)

        if (skillData.documentId) {
          // Обновляем существующий навык
          const numericId = skillDocIdToNumericId.get(skillData.documentId)
          if (!numericId) {
            console.error('Навык не найден:', skillData.documentId)
            continue
          }

          console.log('Обновление навыка:', skillData.documentId, 'id:', numericId)
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
          console.log('Создание навыка с treeNumericId:', treeNumericId)
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
          console.log('Создан навык:', createdSkill.documentId)
        }
      }

      // 4. Обработка гайдов (создание/обновление) с изображениями
      console.log('Обработка гайдов, всего:', guides.length)
      for (const guideData of guides) {
        // Используем imageId, который был загружен на frontend
        const imageId = guideData.imageId

        console.log('Гайд:', guideData.title, 'имеет imageId:', imageId)

        // Определяем реальный skillId (с учетом маппинга)
        const realSkillDocId = skillIdMap.get(guideData.skillId) || guideData.skillId
        const realSkillNumericId = skillDocIdToNumericId.get(realSkillDocId)

        console.log(`Обработка гайда: ${guideData.title}`)
        console.log(`  skillId из данных: ${guideData.skillId}`)
        console.log(`  realSkillDocId: ${realSkillDocId}`)
        console.log(`  realSkillNumericId: ${realSkillNumericId}`)

        if (!realSkillNumericId) {
          console.error(`❌ Не найден числовой ID для навыка с documentId: ${realSkillDocId}`)
          continue
        }

        if (guideData.id) {
          // Обновляем существующий гайд (получен numeric ID)
          console.log(`Обновление существующего гайда с id: ${guideData.id}`)
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

          const existingGuideIds = (skill.guides || []).map((g: any) => g.id)
          console.log(`Существующие гайды навыка (id): ${existingGuideIds.join(', ')}`)

          if (!existingGuideIds.includes(guideData.id)) {
            // Гайд не связан с этим навыком, добавляем связь
            const updatedGuideIds = [...existingGuideIds, guideData.id]

            console.log(`Добавление связи: навык ${realSkillNumericId} <- гайд ${guideData.id}`)

            await strapi.entityService.update('api::skill.skill', realSkillNumericId, {
              data: {
                guides: updatedGuideIds
              } as any
            })
            console.log(`✅ Связан существующий гайд (id: ${guideData.id}) с навыком ${realSkillDocId}`)
          } else {
            console.log(`Гайд (id: ${guideData.id}) уже связан с навыком ${realSkillDocId}`)
          }
        } else if (guideData.tempId) {
          // Создаем новый гайд
          console.log(`Создание нового гайда: ${guideData.title}`)
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
          console.log(`Создан гайд с documentId: ${createdGuide.documentId}`)

          // 5. Связываем гайд с навыком (many-to-many relation)
          const skill = await strapi.entityService.findOne('api::skill.skill', realSkillNumericId, {
            populate: ['guides']
          }) as any

          // Собираем numeric ID существующих гайдов и добавляем новый
          const existingGuideIds = (skill.guides || []).map((g: any) => g.id)
          const updatedGuideIds = [...existingGuideIds, createdGuide.id]

          console.log(`Добавление связи: навык ${realSkillNumericId} <- новый гайд ${createdGuide.id} (documentId: ${createdGuide.documentId})`)

          await strapi.entityService.update('api::skill.skill', realSkillNumericId, {
            data: {
              guides: updatedGuideIds
            } as any
          })
          console.log(`✅ Связан новый гайд ${createdGuide.documentId} (id: ${createdGuide.id}) с навыком ${realSkillDocId}`)
        }
      }

      // 6. Обновляем guideEdges для каждого навыка
      console.log('Обновление guideEdges для навыков...')
      for (const skillData of skills) {
        if (skillData.guideEdges && skillData.guideEdges.length > 0) {
          console.log('Навык имеет guideEdges:', skillData.title, 'кол-во связей:', skillData.guideEdges.length)
          console.log('guideEdges до обработки:', JSON.stringify(skillData.guideEdges))
          console.log('guideIdMap:', JSON.stringify(Object.fromEntries(guideIdMap)))

          // Заменяем временные ID гайдов на реальные
          const updatedGuideEdges = skillData.guideEdges.map((edge: any) => ({
            ...edge,
            source: guideIdMap.get(edge.source) || edge.source,
            target: guideIdMap.get(edge.target) || edge.target,
          }))

          console.log('guideEdges после обработки:', JSON.stringify(updatedGuideEdges))

          // Получаем documentId навыка (с учетом маппинга для новых навыков)
          const realSkillDocId = skillIdMap.get(skillData.tempId) || skillData.documentId

          // Преобразуем documentId в numeric id для entityService
          const realSkillNumericId = skillDocIdToNumericId.get(realSkillDocId)

          if (!realSkillNumericId) {
            console.error(`❌ Не найден numeric ID для навыка: ${realSkillDocId}`)
            continue
          }

          console.log(`Обновление guideEdges для навыка ${realSkillDocId} (numeric id: ${realSkillNumericId})`)

          await strapi.entityService.update('api::skill.skill', realSkillNumericId, {
            data: {
              guideEdges: updatedGuideEdges
            }
          })
          console.log(`✅ Обновлены guideEdges для навыка ${realSkillDocId}`)
        }
      }

      // 7. Обновляем связи дерева (заменяем временные ID на реальные)
      const updatedSkillEdges = skillEdges.map((edge: any) => ({
        ...edge,
        source: skillIdMap.get(edge.source) || edge.source,
        target: skillIdMap.get(edge.target) || edge.target,
      }))

      // 8. Обновляем дерево со связями
      console.log('Обновление дерева с id:', id)
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
