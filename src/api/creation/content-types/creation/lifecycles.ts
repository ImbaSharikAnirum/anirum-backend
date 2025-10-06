/**
 * Creation lifecycle hooks
 * Автоматическое обновление creationsCount в связанном Guide
 */

export default {
  /**
   * После создания creation - увеличиваем счетчик у гайда
   */
  async afterCreate(event: any) {
    const { result } = event

    try {
      // Получаем guide с populate для доступа к documentId
      const guide = result.guide

      if (!guide?.documentId) {
        console.warn('Creation создан без связи с Guide:', result.id)
        return
      }

      // Увеличиваем счетчик креативов у гайда
      await strapi.documents('api::guide.guide').update({
        documentId: guide.documentId,
        data: {
          creationsCount: { $increment: 1 }
        } as any
      })

      console.log(`✅ Creation создан: Guide ${guide.documentId} creationsCount += 1`)
    } catch (error) {
      console.error('❌ Ошибка обновления creationsCount при создании creation:', error)
    }
  },

  /**
   * После удаления creation - уменьшаем счетчик у гайда
   */
  async afterDelete(event: any) {
    const { result } = event

    try {
      const guide = result.guide

      if (!guide?.documentId) {
        console.warn('Creation удален без связи с Guide:', result.id)
        return
      }

      // Уменьшаем счетчик креативов у гайда
      await strapi.documents('api::guide.guide').update({
        documentId: guide.documentId,
        data: {
          creationsCount: { $decrement: 1 }
        } as any
      })

      console.log(`✅ Creation удален: Guide ${guide.documentId} creationsCount -= 1`)
    } catch (error) {
      console.error('❌ Ошибка обновления creationsCount при удалении creation:', error)
    }
  },

  /**
   * Перед удалением - загружаем guide для доступа в afterDelete
   */
  async beforeDelete(event: any) {
    const { params } = event

    try {
      // Загружаем creation с guide перед удалением
      const creation = await strapi.documents('api::creation.creation').findOne({
        documentId: params.documentId,
        populate: ['guide']
      })

      // Сохраняем guide в event для использования в afterDelete
      if (creation) {
        event.result = creation
      }
    } catch (error) {
      console.error('❌ Ошибка загрузки creation перед удалением:', error)
    }
  }
}
