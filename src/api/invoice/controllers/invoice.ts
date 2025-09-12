/**
 * invoice controller
 */

import { factories } from "@strapi/strapi";
import axios from "axios";
import crypto from "crypto";

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
              paymentId: null,        // Будет заполнен после ответа от Tinkoff
              paymentDate: null,      // Будет заполнен при подтверждении платежа
              statusPayment: false    // Остается false до подтверждения
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
                  paymentId: response.data.PaymentId.toString()
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
                owner: true
              }
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
            if (invoice.bonusesUsed && invoice.bonusesUsed > 0 && invoice.owner) {
              try {
                const userId = invoice.owner.id; // Используем числовой ID для entityService
                const user = await strapi.entityService.findOne('plugin::users-permissions.user', userId);
                
                if (user) {
                  await strapi.entityService.update('plugin::users-permissions.user', userId, {
                    data: {
                      bonusBalance: Math.max(0, (user.bonusBalance || 0) - invoice.bonusesUsed),
                      totalSpentBonuses: (user.totalSpentBonuses || 0) + invoice.bonusesUsed
                    }
                  });
                  
                  console.log(`Bonuses deducted: ${invoice.bonusesUsed}₽ from user ${userId}`);
                }
              } catch (error) {
                console.error('Error deducting bonuses:', error);
              }
            }

            // Начисляем бонусы рефереру если есть реферальный код
            if (invoice.referralCode && invoice.referrer) {
              try {
                const originalSum = invoice.originalSum || invoice.sum;
                const bonusAmount = Math.round(originalSum * 0.1); // 10% от оригинальной суммы
                
                const referrerId = invoice.referrer.id; // Используем числовой ID для entityService
                console.log(`[DEBUG] Referrer data:`, {
                  referrer: invoice.referrer,
                  referrerId: referrerId,
                  bonusAmount: bonusAmount
                });
                
                await strapi.service('api::referral-code.referral-code')
                  .creditReferrerBonus(referrerId, bonusAmount);
                
                // Увеличиваем счетчик использований промокода
                await strapi.service('api::referral-code.referral-code')
                  .applyReferralCode(invoice.referralCode.id);
                
                console.log(`Referral bonus credited: ${bonusAmount}₽ to referrer ${invoice.referrer}`);
                
              } catch (error) {
                console.error('Error crediting referral bonus:', error);
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
  })
);
