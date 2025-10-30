/**
 * invoice controller
 */

import { factories } from "@strapi/strapi";
import axios from "axios";
import crypto from "crypto";
import whatsappService from "../../phone-verification/services/whatsapp";
import telegramService from "../../phone-verification/services/telegram";

export default factories.createCoreController(
  "api::invoice.invoice",
  ({ strapi }) => ({
    /**
     * Создать платеж через Tinkoff
     */
    async createTinkoffPayment(ctx) {
      const {
        users_permissions_user: userId,
        student,
        course: courseId,
        amount,
        currency,
        invoiceId,
      } = ctx.request.body;

      // Проверяем обязательные параметры
      if (!amount || !currency || !courseId) {
        return ctx.throw(
          400,
          "Отсутствуют обязательные параметры: amount, currency, course"
        );
      }

      // Получаем email пользователя
      let userEmail = "guest@anirum.com"; // Значение по умолчанию

      if (userId) {
        try {
          const user = await strapi
            .documents("plugin::users-permissions.user")
            .findOne({
              documentId: userId,
              fields: ["email"],
            });

          if (user && user.email) {
            userEmail = user.email;
          }
        } catch (error) {
          console.error("Ошибка при поиске пользователя:", error);
        }
      }

      // Получаем информацию о курсе по documentId
      let courseName = "Курс";
      try {
        const course = await strapi.documents("api::course.course").findOne({
          documentId: courseId,
          fields: ["direction"],
        });

        if (course && course.direction) {
          // Преобразуем enum в читаемое название
          const directionNames = {
            sketching: "Скетчинг",
            drawing2d: "2D рисование",
            animation: "Анимация",
            modeling3d: "3D моделирование",
          };
          courseName = directionNames[course.direction] || course.direction;
        }
      } catch (error) {
        console.error("Ошибка при получении курса:", error);
      }

      // Генерируем короткий уникальный orderId
      const timestamp = Date.now().toString().slice(-8); // Последние 8 цифр
      const randomStr = Math.random().toString(36).substring(2, 8); // 6 случайных символов
      const orderId = `${timestamp}${randomStr}`; // 14 символов максимум

      // Подготавливаем invoice для платежа - устанавливаем orderId для связи с webhook
      if (invoiceId) {
        try {
          await strapi.documents("api::invoice.invoice").update({
            documentId: invoiceId,
            data: {
              tinkoffOrderId: orderId,
              paymentId: null, // Будет заполнен после ответа от Tinkoff
              paymentDate: null, // Будет заполнен при подтверждении платежа
              statusPayment: false, // Остается false до подтверждения
            },
          });
        } catch (error) {
          console.error("Ошибка подготовки invoice для платежа:", error);
        }
      }

      const terminalKey = process.env.TINKOFF_TERMINAL_KEY?.trim();
      const terminalPassword = process.env.TINKOFF_TERMINAL_PASSWORD?.trim();

      if (!terminalKey || !terminalPassword) {
        return ctx.throw(500, "Не настроены ключи для Tinkoff");
      }

      const amountInCoins = Math.round(amount * 100);

      const paramsForToken = {
        TerminalKey: terminalKey,
        Amount: amountInCoins,
        OrderId: orderId,
        Description: `Оплата курса: ${courseName}`,
      };

      const generateToken = (params, password) => {
        const tokenParams = { ...params, Password: password };
        const sortedKeys = Object.keys(tokenParams).sort();
        const tokenString = sortedKeys.map((key) => tokenParams[key]).join("");

        const hash = crypto
          .createHash("sha256")
          .update(tokenString)
          .digest("hex");

        return hash;
      };

      const token = generateToken(paramsForToken, terminalPassword);

      const requestData = {
        ...paramsForToken,
        Token: token,
        DATA: {
          Email: userEmail,
        },
        Receipt: {
          Email: userEmail,
          Taxation: "usn_income",
          Items: [
            {
              Name: courseName,
              Price: amountInCoins,
              Quantity: 1,
              Amount: amountInCoins,
              Tax: "none",
            },
          ],
        },
      };

      try {
        const apiUrl = "https://securepay.tinkoff.ru/v2/Init";

        const response = await axios.post(apiUrl, requestData, {
          headers: { "Content-Type": "application/json" },
        });

        if (response.data.Success) {
          // Сохраняем PaymentId от Tinkoff в invoice
          if (invoiceId && response.data.PaymentId) {
            try {
              await strapi.documents("api::invoice.invoice").update({
                documentId: invoiceId,
                data: {
                  paymentId: response.data.PaymentId.toString(),
                },
              });
            } catch (error) {
              console.error("Ошибка сохранения PaymentId в invoice:", error);
            }
          }

          ctx.send({
            paymentUrl: response.data.PaymentURL,
            orderId,
            message: "Ссылка на оплату создана",
          });
        } else {
          console.error("Ошибка Tinkoff API:", response.data);
          ctx.throw(400, `Ошибка создания платежа: ${response.data.Message}`);
        }
      } catch (error) {
        console.error(
          "Ошибка Tinkoff Init:",
          error.response?.data || error.message
        );
        ctx.throw(500, "Ошибка сервера при создании платежа");
      }
    },

    /**
     * Обработать уведомление от Tinkoff о статусе платежа
     */
    async handleTinkoffNotification(ctx) {
      const { OrderId, Success, Status, PaymentId } = ctx.request.body;

      try {
        if (Success && Status === "CONFIRMED" && OrderId) {
          // Ищем invoice по tinkoffOrderId с populate для реферальных полей
          const invoices = await strapi
            .documents("api::invoice.invoice")
            .findMany({
              filters: {
                tinkoffOrderId: OrderId,
              },
              populate: {
                referralCode: true,
                referrer: true,
                owner: true,
              },
            });

          if (invoices.length > 0) {
            const invoice = invoices[0];

            // Обновляем статус оплаты
            await strapi.documents("api::invoice.invoice").update({
              documentId: invoice.documentId,
              data: {
                statusPayment: true,
                paymentDate: new Date(),
                // paymentId уже сохранен при создании платежа - не перезаписываем
              },
            });

            // Списываем бонусы с баланса пользователя если они были использованы
            if (
              invoice.bonusesUsed &&
              invoice.bonusesUsed > 0 &&
              invoice.owner
            ) {
              try {
                const userId = invoice.owner.id; // Используем числовой ID для entityService
                const user = await strapi.entityService.findOne(
                  "plugin::users-permissions.user",
                  userId
                );

                if (user) {
                  await strapi.entityService.update(
                    "plugin::users-permissions.user",
                    userId,
                    {
                      data: {
                        bonusBalance: Math.max(
                          0,
                          (user.bonusBalance || 0) - invoice.bonusesUsed
                        ),
                        totalSpentBonuses:
                          (user.totalSpentBonuses || 0) + invoice.bonusesUsed,
                      },
                    }
                  );
                }
              } catch (error) {
                console.error("Error deducting bonuses:", error);
              }
            }

            // Начисляем бонусы рефереру если есть реферальный код
            if (invoice.referralCode && invoice.referrer) {
              try {
                const originalSum = invoice.originalSum || invoice.sum;
                const bonusAmount = Math.round(originalSum * 0.1); // 10% от оригинальной суммы

                const referrerId = invoice.referrer.id; // Используем числовой ID для entityService

                await strapi
                  .service("api::referral-code.referral-code")
                  .creditReferrerBonus(referrerId, bonusAmount);

                // Увеличиваем счетчик использований промокода
                await strapi
                  .service("api::referral-code.referral-code")
                  .applyReferralCode(invoice.referralCode.id);
              } catch (error) {
                console.error("Error crediting referral bonus:", error);
              }
            }

            return ctx.send({ status: "ok" });
          } else {
            return ctx.send({ status: "Invoice not found" });
          }
        } else {
          return ctx.send({ status: "Payment not confirmed" });
        }
      } catch (error) {
        console.error("Ошибка при обработке уведомления:", error);
        return ctx.throw(500, "Ошибка на сервере при обработке уведомления");
      }
    },

    /**
     * Массовая отправка сообщений с оплатой всем студентам курса
     * POST /api/invoices/bulk-send-payment-messages
     */
    async bulkSendPaymentMessages(ctx) {
      try {
        const { courseId, month, year } = ctx.request.body;
        const userId = ctx.state.user?.id;

        // Проверяем авторизацию
        if (!userId) {
          return ctx.unauthorized("Необходима авторизация");
        }

        // Проверяем роль пользователя (только менеджеры могут отправлять)
        const userRole = ctx.state.user?.role?.name;
        if (userRole !== "Manager") {
          return ctx.forbidden(
            "Только менеджеры могут отправлять массовые сообщения"
          );
        }

        // Валидация входных данных
        if (!courseId) {
          return ctx.badRequest("Необходимо указать courseId");
        }

        console.log(`📤 Массовая отправка сообщений для курса: ${courseId}`);
        console.log(
          `📅 Переданные параметры: month=${month}, year=${year}, типы: ${typeof month}, ${typeof year}`
        );

        // Формируем фильтры
        const filters: any = {
          course: {
            documentId: courseId,
          },
        };

        // Добавляем фильтрацию по дате если указаны month и year
        if (month && year) {
          const startDate = `${year}-${month.toString().padStart(2, "0")}-01`;
          const lastDay = new Date(year, month, 0).getDate();
          const endDate = `${year}-${month.toString().padStart(2, "0")}-${lastDay}`;

          filters.startDate = {
            $gte: startDate,
            $lte: endDate,
          };

          console.log(`🗓️ Фильтрация по датам: ${startDate} - ${endDate}`);
          console.log(`🔍 Итоговые фильтры:`, JSON.stringify(filters, null, 2));
        } else {
          console.log(
            `⚠️ Фильтрация по дате НЕ применяется (month или year не переданы)`
          );
        }

        // Получаем invoices курса с владельцами (с учетом фильтров по дате)
        const invoices = await strapi
          .documents("api::invoice.invoice")
          .findMany({
            filters,
            populate: ["owner"],
          });

        if (invoices.length === 0) {
          return ctx.badRequest("У курса нет студентов");
        }

        console.log(`👥 Найдено студентов: ${invoices.length}`);
        console.log(
          `📋 Детали найденных invoices:`,
          invoices.map((inv) => ({
            documentId: inv.documentId,
            studentName: `${inv.name} ${inv.family}`,
            startDate: inv.startDate,
            endDate: inv.endDate,
            ownerName: inv.owner?.username || "без владельца",
          }))
        );

        // Результаты отправки
        const results = {
          total: invoices.length,
          sent: 0,
          failed: 0,
          details: [],
        };

        // Обрабатываем каждого студента
        for (const invoice of invoices) {
          const studentName = `${invoice.name} ${invoice.family}`;

          try {
            if (!invoice.owner) {
              console.log(`⚠️ У студента ${studentName} нет владельца`);
              results.failed++;
              results.details.push({
                studentName,
                success: false,
                error: "У студента нет владельца",
              });
              continue;
            }

            // Определяем доступный мессенджер (приоритет WhatsApp)
            let messenger = null;
            let contact = null;

            if (
              invoice.owner.whatsapp_phone_verified &&
              invoice.owner.whatsapp_phone
            ) {
              messenger = "whatsapp";
              contact = invoice.owner.whatsapp_phone;
            } else if (
              invoice.owner.telegram_phone_verified &&
              (invoice.owner as any).telegram_chat_id
            ) {
              messenger = "telegram";
              contact = (invoice.owner as any).telegram_chat_id;
            }

            if (!messenger || !contact) {
              console.log(
                `⚠️ У студента ${studentName} нет верифицированных контактов`
              );
              results.failed++;
              results.details.push({
                studentName,
                success: false,
                error: "Нет верифицированных контактов в мессенджерах",
              });
              continue;
            }

            // Отправляем сообщение напрямую
            try {
              // Получаем информацию о курсе для формирования сообщения
              const course = await strapi
                .documents("api::course.course")
                .findOne({
                  documentId: courseId,
                  fields: [
                    "direction",
                    "weekdays",
                    "startTime",
                    "endTime",
                    "timezone",
                  ],
                });

              if (!course) {
                throw new Error("Курс не найден");
              }

              // Формируем URL оплаты
              const baseUrl = "https://www.anirum.com";
              const paymentUrl = `${baseUrl}/courses/${courseId}/payment/${invoice.documentId}`;

              // Формируем информацию о расписании
              let scheduleInfo = "";
              if (
                course.weekdays &&
                Array.isArray(course.weekdays) &&
                course.weekdays.length > 0
              ) {
                const formatWeekdays = (weekdays: string[]) => {
                  const weekdayNames = {
                    monday: "Понедельник",
                    tuesday: "Вторник",
                    wednesday: "Среда",
                    thursday: "Четверг",
                    friday: "Пятница",
                    saturday: "Суббота",
                    sunday: "Воскресенье",
                  };
                  return weekdays
                    .map((day) => weekdayNames[day] || day)
                    .join(", ");
                };

                const weekdaysText = formatWeekdays(
                  course.weekdays as string[]
                );

                if (course.startTime && course.endTime && course.timezone) {
                  const formatTime = (time: string) =>
                    time.split(":").slice(0, 2).join(":");
                  let monthText = "";
                  if (invoice.startDate) {
                    const startDate = new Date(invoice.startDate);
                    const monthNames = [
                      "январь",
                      "февраль",
                      "март",
                      "апрель",
                      "май",
                      "июнь",
                      "июль",
                      "август",
                      "сентябрь",
                      "октябрь",
                      "ноябрь",
                      "декабрь",
                    ];
                    monthText = `, месяц: ${monthNames[startDate.getMonth()]}`;
                  }

                  const timeInfo = `${formatTime(course.startTime as string)} - ${formatTime(course.endTime as string)} (${course.timezone})${monthText}`;
                  scheduleInfo = `Занятия проходят: ${weekdaysText}, время: ${timeInfo}`;
                } else {
                  scheduleInfo = `Занятия проходят: ${weekdaysText}`;
                }
              }

              // Формируем сообщение
              const message = `Здравствуйте!

Для оплаты курса, пожалуйста, перейдите по ссылке:
${paymentUrl}

${scheduleInfo ? scheduleInfo + "\n\n" : ""}Если у вас возникнут вопросы, обращайтесь к нам.
Спасибо!`;

              // Отправляем сообщение
              if (messenger === "whatsapp") {
                await whatsappService.sendMessage(contact, message);
              } else if (messenger === "telegram") {
                await telegramService.sendMessage(contact, message);
              }

              console.log(
                `✅ Сообщение отправлено студенту ${studentName} в ${messenger}`
              );
              results.sent++;
              results.details.push({
                studentName,
                success: true,
                messenger,
              });

              // Пауза между отправками для предотвращения rate limiting
              await new Promise((resolve) => setTimeout(resolve, 1000));
            } catch (sendError) {
              console.error(
                `❌ Ошибка отправки студенту ${studentName}:`,
                sendError
              );
              results.failed++;
              results.details.push({
                studentName,
                success: false,
                error: sendError.message || "Ошибка отправки сообщения",
              });
            }
          } catch (studentError) {
            console.error(
              `❌ Ошибка обработки студента ${studentName}:`,
              studentError
            );
            results.failed++;
            results.details.push({
              studentName,
              success: false,
              error: studentError.message || "Ошибка обработки студента",
            });
          }
        }

        console.log(
          `📊 Результаты массовой отправки: ${results.sent} отправлено, ${results.failed} ошибок`
        );

        return ctx.send({
          success: true,
          message: `Массовая отправка завершена: ${results.sent} из ${results.total} сообщений отправлено`,
          results,
        });
      } catch (error) {
        console.error("❌ Ошибка в bulkSendPaymentMessages:", error);
        return ctx.internalServerError("Внутренняя ошибка сервера");
      }
    },

    /**
     * Копировать счета текущего месяца на следующий месяц
     * POST /api/invoices/copy-to-next-month
     */
    async copyInvoicesToNextMonth(ctx) {
      try {
        const { courseId, currentMonth, currentYear } = ctx.request.body;
        const userId = ctx.state.user?.id;

        // Проверяем авторизацию
        if (!userId) {
          return ctx.unauthorized("Необходима авторизация");
        }

        // Проверяем роль пользователя (только менеджеры могут копировать)
        const userRole = ctx.state.user?.role?.name;
        if (userRole !== "Manager") {
          return ctx.forbidden("Только менеджеры могут копировать счета");
        }

        // Валидация входных данных
        if (!courseId || !currentMonth || !currentYear) {
          return ctx.badRequest(
            "Необходимо указать courseId, currentMonth и currentYear"
          );
        }

        // Функция для форматирования даты для типа "date" в Strapi
        // Тип "date" требует формат YYYY-MM-DD БЕЗ времени и timezone
        const formatDateLocal = (date: any) => {
          const year = date.getFullYear();
          const month = String(date.getMonth() + 1).padStart(2, "0");
          const day = String(date.getDate()).padStart(2, "0");
          return `${year}-${month}-${day}`;
        };

        // Получаем информацию о курсе
        const course = await strapi.documents("api::course.course").findOne({
          documentId: courseId,
          fields: [
            "weekdays",
            "startDate",
            "endDate",
            "pricePerLesson",
            "currency",
          ],
        });

        if (!course) {
          return ctx.badRequest("Курс не найден");
        }

        // Получаем все invoices текущего месяца
        const startDate = `${currentYear}-${currentMonth.toString().padStart(2, "0")}-01`;
        const lastDay = new Date(currentYear, currentMonth, 0).getDate();
        const endDate = `${currentYear}-${currentMonth.toString().padStart(2, "0")}-${lastDay}`;

        const currentInvoices = await strapi
          .documents("api::invoice.invoice")
          .findMany({
            filters: {
              course: {
                documentId: courseId,
              },
              startDate: {
                $gte: startDate,
                $lte: endDate,
              },
            },
            populate: ["owner"],
          });

        if (currentInvoices.length === 0) {
          return ctx.badRequest("Нет счетов для копирования в текущем месяце");
        }

        // Вычисляем следующий месяц
        let nextMonth = currentMonth + 1;
        let nextYear = currentYear;
        if (nextMonth > 12) {
          nextMonth = 1;
          nextYear += 1;
        }

        // Вычисляем даты для следующего месяца с учетом дней недели курса
        const calculateNextMonthDates = (weekdays) => {
          if (!weekdays || !Array.isArray(weekdays) || weekdays.length === 0) {
            // Если дни недели не указаны, просто сдвигаем на месяц
            const nextMonthStart = new Date(nextYear, nextMonth - 1, 1);
            const nextMonthEnd = new Date(nextYear, nextMonth, 0);
            return {
              startDate: formatDateLocal(nextMonthStart),
              endDate: formatDateLocal(nextMonthEnd),
            };
          }

          // Преобразуем дни недели в числа (0=воскресенье, 1=понедельник, ...)
          const weekdayMap = {
            sunday: 0,
            monday: 1,
            tuesday: 2,
            wednesday: 3,
            thursday: 4,
            friday: 5,
            saturday: 6,
          };
          const courseDays = weekdays
            .map((day) => weekdayMap[day])
            .filter((day) => day !== undefined);

          // Находим первый и последний день курса в следующем месяце
          const nextMonthStart = new Date(nextYear, nextMonth - 1, 1);
          const nextMonthEnd = new Date(nextYear, nextMonth, 0);

          let firstCourseDay = null;
          let lastCourseDay = null;

          // Ищем первый день курса в месяце
          for (let day = 1; day <= nextMonthEnd.getDate(); day++) {
            const date = new Date(nextYear, nextMonth - 1, day);
            if (courseDays.includes(date.getDay())) {
              if (!firstCourseDay) firstCourseDay = date;
              lastCourseDay = date;
            }
          }

          // Проверяем границы общего курса
          // Парсим даты курса БЕЗ UTC (как в frontend)
          let startDateStr: string;
          let endDateStr: string;

          if (typeof course.startDate === "string") {
            startDateStr = course.startDate;
          } else if (course.startDate instanceof Date) {
            // Используем локальные компоненты даты, а не UTC
            const year = course.startDate.getFullYear();
            const month = String(course.startDate.getMonth() + 1).padStart(
              2,
              "0"
            );
            const day = String(course.startDate.getDate()).padStart(2, "0");
            startDateStr = `${year}-${month}-${day}`;
          } else {
            // Fallback для неизвестных типов
            startDateStr = String(course.startDate);
          }

          if (typeof course.endDate === "string") {
            endDateStr = course.endDate;
          } else if (course.endDate instanceof Date) {
            // Используем локальные компоненты даты, а не UTC
            const year = course.endDate.getFullYear();
            const month = String(course.endDate.getMonth() + 1).padStart(
              2,
              "0"
            );
            const day = String(course.endDate.getDate()).padStart(2, "0");
            endDateStr = `${year}-${month}-${day}`;
          } else {
            // Fallback для неизвестных типов
            endDateStr = String(course.endDate);
          }

          const [courseStartYear, courseStartMonth, courseStartDay] =
            startDateStr.split("-").map(Number);
          const [courseEndYear, courseEndMonth, courseEndDay] = endDateStr
            .split("-")
            .map(Number);
          const courseStartDate = new Date(
            courseStartYear,
            courseStartMonth - 1,
            courseStartDay
          );
          const courseEndDate = new Date(
            courseEndYear,
            courseEndMonth - 1,
            courseEndDay
          );

          const effectiveStart =
            firstCourseDay && firstCourseDay >= courseStartDate
              ? firstCourseDay
              : new Date(
                  Math.max(nextMonthStart.getTime(), courseStartDate.getTime())
                );

          const effectiveEnd =
            lastCourseDay && lastCourseDay <= courseEndDate
              ? lastCourseDay
              : new Date(
                  Math.min(nextMonthEnd.getTime(), courseEndDate.getTime())
                );

          return {
            startDate: formatDateLocal(effectiveStart),
            endDate: formatDateLocal(effectiveEnd),
          };
        };

        const nextMonthDates = calculateNextMonthDates(course.weekdays);

        // Вычисляем количество занятий в следующем месяце
        const calculateLessonsCount = (
          weekdays: any,
          startDate: any,
          endDate: any
        ) => {
          // Парсим даты БЕЗ timezone
          const [startYear, startMonth, startDay] = startDate
            .split("-")
            .map(Number);
          const [endYear, endMonth, endDay] = endDate.split("-").map(Number);
          const start = new Date(startYear, startMonth - 1, startDay);
          const end = new Date(endYear, endMonth - 1, endDay);

          if (!weekdays || !Array.isArray(weekdays) || weekdays.length === 0) {
            // Если дни недели не указаны, считаем как ежедневные занятия
            const diffTime = Math.abs(end.getTime() - start.getTime());
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
            return diffDays;
          }

          // Преобразуем дни недели в числа
          const weekdayMap = {
            sunday: 0,
            monday: 1,
            tuesday: 2,
            wednesday: 3,
            thursday: 4,
            friday: 5,
            saturday: 6,
          };
          const courseDays = weekdays
            .map((day) => weekdayMap[day])
            .filter((day) => day !== undefined);

          let lessonsCount = 0;

          // Перебираем все дни в диапазоне и считаем совпадения с днями курса
          for (
            let date = new Date(start);
            date <= end;
            date.setDate(date.getDate() + 1)
          ) {
            if (courseDays.includes(date.getDay())) {
              lessonsCount++;
            }
          }

          return lessonsCount;
        };

        const lessonsCount = calculateLessonsCount(
          course.weekdays,
          nextMonthDates.startDate,
          nextMonthDates.endDate
        );

        // Рассчитываем общую сумму за месяц
        const monthlySum = Math.round(
          (course.pricePerLesson || 0) * lessonsCount
        );

        // Создаем новые invoices
        const newInvoices = [];
        const results = {
          originalCount: currentInvoices.length,
          copiedCount: 0,
          nextMonth,
          nextYear,
          lessonsCount,
          monthlySum,
          pricePerLesson: course.pricePerLesson,
          currency: course.currency,
          newInvoices: [],
        };

        for (const invoice of currentInvoices) {
          try {
            // Получаем последний день месяца корректно
            const lastDayOfMonth = new Date(nextYear, nextMonth, 0).getDate();

            // Проверяем, не существует ли уже счет для этого пользователя в следующем месяце
            const existingInvoice = await strapi
              .documents("api::invoice.invoice")
              .findMany({
                filters: {
                  course: {
                    documentId: courseId,
                  },
                  owner: {
                    documentId: invoice.owner?.documentId,
                  },
                  startDate: {
                    $gte: `${nextYear}-${nextMonth.toString().padStart(2, "0")}-01`,
                    $lte: `${nextYear}-${nextMonth.toString().padStart(2, "0")}-${String(lastDayOfMonth).padStart(2, "0")}`,
                  },
                },
              });

            if (existingInvoice.length > 0) {
              continue;
            }

            // Создаем новый invoice с рассчитанной суммой
            const newInvoiceData = {
              name: invoice.name,
              family: invoice.family,
              sum: monthlySum,
              currency: course.currency,
              startDate: nextMonthDates.startDate,
              endDate: nextMonthDates.endDate,
              statusPayment: false,
              course: courseId,
              owner: invoice.owner?.documentId,
              originalSum: monthlySum,
              discountAmount: 0,
              bonusesUsed: 0,
            };

            const newInvoice = await strapi
              .documents("api::invoice.invoice")
              .create({
                data: newInvoiceData,
              });

            newInvoices.push(newInvoice);
            results.copiedCount++;
          } catch (createError) {
            console.error(
              `❌ Ошибка создания счета для ${invoice.name} ${invoice.family}:`,
              createError
            );
          }
        }

        results.newInvoices = newInvoices;

        return ctx.send({
          success: true,
          message: `Скопировано ${results.copiedCount} из ${results.originalCount} счетов на ${nextMonth}/${nextYear}`,
          results,
        });
      } catch (error) {
        console.error("❌ Ошибка в copyInvoicesToNextMonth:", error);
        return ctx.internalServerError("Внутренняя ошибка сервера");
      }
    },

    /**
     * Отправить сообщение с оплатой в мессенджер пользователя
     * POST /api/invoices/send-payment-message
     */
    async sendPaymentMessage(ctx) {
      try {
        const { invoiceDocumentId, courseId } = ctx.request.body;
        const userId = ctx.state.user?.id;

        // Проверяем авторизацию
        if (!userId) {
          return ctx.unauthorized("Необходима авторизация");
        }

        // Проверяем роль пользователя (только менеджеры могут отправлять)
        const userRole = ctx.state.user?.role?.name;
        if (userRole !== "Manager") {
          return ctx.forbidden("Только менеджеры могут отправлять сообщения");
        }

        // Валидация входных данных
        if (!invoiceDocumentId || !courseId) {
          return ctx.badRequest("Необходимы invoiceDocumentId и courseId");
        }

        console.log(
          `📤 Отправка сообщения с оплатой для invoice: ${invoiceDocumentId}, course: ${courseId}`
        );

        // Получаем invoice с owner и course
        const invoice = await strapi.documents("api::invoice.invoice").findOne({
          documentId: invoiceDocumentId,
          populate: ["owner", "course"],
        });

        if (!invoice) {
          return ctx.notFound("Счет не найден");
        }

        if (!invoice.owner) {
          return ctx.badRequest("У счета нет владельца");
        }

        console.log(
          `👤 Владелец счета: ${invoice.owner.username}, WhatsApp верифицирован: ${invoice.owner.whatsapp_phone_verified}, Telegram верифицирован: ${invoice.owner.telegram_phone_verified}, Telegram chat_id: ${(invoice.owner as any).telegram_chat_id || "не установлен"}`
        );

        // Определяем доступный мессенджер (приоритет WhatsApp)
        let messenger = null;
        let contact = null;

        if (
          invoice.owner.whatsapp_phone_verified &&
          invoice.owner.whatsapp_phone
        ) {
          messenger = "whatsapp";
          contact = invoice.owner.whatsapp_phone;
        } else if (
          invoice.owner.telegram_phone_verified &&
          (invoice.owner as any).telegram_chat_id
        ) {
          messenger = "telegram";
          contact = (invoice.owner as any).telegram_chat_id;
        }

        if (!messenger || !contact) {
          return ctx.badRequest(
            "У пользователя нет верифицированных контактов в мессенджерах"
          );
        }

        console.log(`📱 Выбран мессенджер: ${messenger}, контакт: ${contact}`);

        // Формируем URL оплаты
        const baseUrl = "https://www.anirum.com";
        const paymentUrl = `${baseUrl}/courses/${courseId}/payment/${invoiceDocumentId}`;

        // Формируем информацию о расписании
        let scheduleInfo = "";
        if (
          invoice.course?.weekdays &&
          Array.isArray(invoice.course.weekdays) &&
          invoice.course.weekdays.length > 0
        ) {
          // Используем ту же логику что и в frontend
          const formatWeekdays = (weekdays: string[]) => {
            const weekdayNames = {
              monday: "Понедельник",
              tuesday: "Вторник",
              wednesday: "Среда",
              thursday: "Четверг",
              friday: "Пятница",
              saturday: "Суббота",
              sunday: "Воскресенье",
            };
            return weekdays.map((day) => weekdayNames[day] || day).join(", ");
          };

          const weekdaysText = formatWeekdays(
            invoice.course.weekdays as string[]
          );

          if (
            invoice.course.startTime &&
            invoice.course.endTime &&
            invoice.course.timezone
          ) {
            // Убираем секунды из времени (16:00:00 -> 16:00)
            const formatTime = (time: string) =>
              time.split(":").slice(0, 2).join(":");
            // Определяем месяц
            let monthText = "";
            if (invoice.startDate) {
              const startDate = new Date(invoice.startDate);
              const monthNames = [
                "январь",
                "февраль",
                "март",
                "апрель",
                "май",
                "июнь",
                "июль",
                "август",
                "сентябрь",
                "октябрь",
                "ноябрь",
                "декабрь",
              ];
              monthText = `, месяц: ${monthNames[startDate.getMonth()]}`;
            }

            const timeInfo = `${formatTime(invoice.course.startTime as string)} - ${formatTime(invoice.course.endTime as string)} (${invoice.course.timezone})${monthText}`;
            scheduleInfo = `Занятия проходят: ${weekdaysText}, время: ${timeInfo}`;
          } else {
            scheduleInfo = `Занятия проходят: ${weekdaysText}`;
          }
        }

        // Формируем сообщение
        const message = `Здравствуйте!

Для оплаты курса, пожалуйста, перейдите по ссылке:
${paymentUrl}

${scheduleInfo ? scheduleInfo + "\n\n" : ""}Если у вас возникнут вопросы, обращайтесь к нам.
Спасибо!`;

        console.log(`📝 Сформированное сообщение:\n${message}`);

        // Отправляем сообщение
        try {
          if (messenger === "whatsapp") {
            await whatsappService.sendMessage(contact, message);
          } else if (messenger === "telegram") {
            await telegramService.sendMessage(contact, message);
          }

          console.log(`✅ Сообщение успешно отправлено в ${messenger}`);

          return ctx.send({
            success: true,
            message: `Сообщение отправлено в ${messenger}`,
            messenger: messenger,
          });
        } catch (sendError) {
          console.error(
            `❌ Ошибка отправки сообщения в ${messenger}:`,
            sendError
          );
          return ctx.badRequest(
            `Ошибка отправки сообщения: ${sendError.message}`
          );
        }
      } catch (error) {
        console.error("❌ Ошибка в sendPaymentMessage:", error);
        return ctx.internalServerError("Внутренняя ошибка сервера");
      }
    },
  })
);
