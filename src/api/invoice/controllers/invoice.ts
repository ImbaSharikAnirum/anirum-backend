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
          `👤 Владелец счета: ${invoice.owner.username}, WhatsApp верифицирован: ${invoice.owner.whatsapp_phone_verified}, Telegram верифицирован: ${invoice.owner.telegram_phone_verified}`
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
          invoice.owner.telegram_username
        ) {
          messenger = "telegram";
          contact = invoice.owner.telegram_username;
        }

        if (!messenger || !contact) {
          return ctx.badRequest(
            "У пользователя нет верифицированных контактов в мессенджерах"
          );
        }

        console.log(`📱 Выбран мессенджер: ${messenger}, контакт: ${contact}`);

        // Формируем URL оплаты
        const baseUrl = "https://anirum.com";
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

          const weekdaysText = formatWeekdays(invoice.course.weekdays as string[]);

          if (
            invoice.course.startTime &&
            invoice.course.endTime &&
            invoice.course.timezone
          ) {
            // Убираем секунды из времени (16:00:00 -> 16:00)
            const formatTime = (time: string) => time.split(":").slice(0, 2).join(":");
            // Определяем месяц
            let monthText = "";
            if (invoice.startDate) {
              const startDate = new Date(invoice.startDate);
              const monthNames = [
                "январь", "февраль", "март", "апрель", "май", "июнь",
                "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"
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
