/**
 * skill-tree controller
 */

import { factories } from '@strapi/strapi'
import fs from 'fs'
import path from 'path'
import os from 'os'

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
      for (const skillData of skills) {
        let imageId: number | undefined

        console.log('Навык:', skillData.title, 'имеет изображение:', !!skillData.image, 'тип:', typeof skillData.image)

        // Обработка изображения (base64)
        if (skillData.image && skillData.image.startsWith('data:image')) {
          const tempFilePath = path.join(os.tmpdir(), `skill-${Date.now()}.tmp`)
          try {
            // Конвертируем base64 в Buffer
            const base64Data = skillData.image.split(',')[1]
            const buffer = Buffer.from(base64Data, 'base64')

            // Определяем mime type
            const mimeMatch = skillData.image.match(/data:([^;]+);/)
            const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg'
            const ext = mimeType.split('/')[1]
            const fileName = `skill-${Date.now()}.${ext}`

            // Сохраняем во временный файл
            fs.writeFileSync(tempFilePath, buffer)
            const stats = fs.statSync(tempFilePath)

            // Загружаем файл через Upload plugin (Strapi 5)
            const uploadedFiles = await strapi.plugins.upload.services.upload.upload({
              data: {},
              files: {
                filepath: tempFilePath,
                originalFilename: fileName,
                mimetype: mimeType,
                size: stats.size,
              },
            })

            imageId = uploadedFiles[0]?.id
          } catch (uploadError) {
            console.error('Ошибка загрузки изображения навыка:', uploadError)
          } finally {
            // Удаляем временный файл
            if (fs.existsSync(tempFilePath)) {
              try {
                fs.unlinkSync(tempFilePath)
              } catch (unlinkError) {
                console.error('Ошибка удаления временного файла:', unlinkError)
              }
            }
          }
        }

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
        let imageId: number | undefined

        // Обработка изображения гайда (base64)
        if (guideData.image && guideData.image.startsWith('data:image')) {
          const tempFilePath = path.join(os.tmpdir(), `guide-${Date.now()}.tmp`)
          try {
            const base64Data = guideData.image.split(',')[1]
            const buffer = Buffer.from(base64Data, 'base64')

            const mimeMatch = guideData.image.match(/data:([^;]+);/)
            const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg'
            const ext = mimeType.split('/')[1]
            const fileName = `guide-${Date.now()}.${ext}`

            // Сохраняем во временный файл
            fs.writeFileSync(tempFilePath, buffer)
            const stats = fs.statSync(tempFilePath)

            // Загружаем файл через Upload plugin (Strapi 5)
            const uploadedFiles = await strapi.plugins.upload.services.upload.upload({
              data: {},
              files: {
                filepath: tempFilePath,
                originalFilename: fileName,
                mimetype: mimeType,
                size: stats.size,
              },
            })

            imageId = uploadedFiles[0]?.id
          } catch (uploadError) {
            console.error('Ошибка загрузки изображения гайда:', uploadError)
          } finally {
            // Удаляем временный файл
            if (fs.existsSync(tempFilePath)) {
              try {
                fs.unlinkSync(tempFilePath)
              } catch (unlinkError) {
                console.error('Ошибка удаления временного файла гайда:', unlinkError)
              }
            }
          }
        }

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

        if (guideData.documentId) {
          // Обновляем существующий гайд
          console.log(`Обновление существующего гайда: ${guideData.documentId}`)
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

          // Проверяем и добавляем связь с навыком (если её ещё нет)
          const skill = await strapi.entityService.findOne('api::skill.skill', realSkillNumericId, {
            populate: ['guides']
          }) as any

          // Нужно получить числовой ID гайда
          const guideNumericId = await strapi.db.query('api::guide.guide').findOne({
            where: { documentId: guideData.documentId },
            select: ['id']
          })

          if (!guideNumericId) {
            console.error(`❌ Не найден гайд с documentId: ${guideData.documentId}`)
            continue
          }

          const existingGuideIds = (skill.guides || []).map((g: any) => g.id)
          console.log(`Существующие гайды навыка (id): ${existingGuideIds.join(', ')}`)

          if (!existingGuideIds.includes(guideNumericId.id)) {
            // Гайд не связан с этим навыком, добавляем связь
            const updatedGuideIds = [...existingGuideIds, guideNumericId.id]

            console.log(`Добавление связи: навык ${realSkillNumericId} <- гайд ${guideNumericId.id}`)

            await strapi.entityService.update('api::skill.skill', realSkillNumericId, {
              data: {
                guides: updatedGuideIds
              } as any
            })
            console.log(`✅ Связан существующий гайд ${guideData.documentId} (id: ${guideNumericId.id}) с навыком ${realSkillDocId}`)
          } else {
            console.log(`Гайд ${guideData.documentId} (id: ${guideNumericId.id}) уже связан с навыком ${realSkillDocId}`)
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

          const realSkillDocId = skillIdMap.get(skillData.tempId) || skillData.documentId

          await strapi.entityService.update('api::skill.skill', realSkillDocId, {
            data: {
              guideEdges: updatedGuideEdges
            }
          })
          console.log(`Обновлены guideEdges для навыка ${realSkillDocId}`)
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
