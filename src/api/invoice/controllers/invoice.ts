/**
 * invoice controller
 */

import { factories } from '@strapi/strapi'
import axios from 'axios'
import crypto from 'crypto'

export default factories.createCoreController('api::invoice.invoice', ({ strapi }) => ({
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
        const user = await strapi.documents("plugin::users-permissions.user").findOne({
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
          modeling3d: "3D моделирование"
        };
        courseName = directionNames[course.direction] || course.direction;
      }
    } catch (error) {
      console.error("Ошибка при получении курса:", error);
    }

    const orderId = invoiceId
      ? `order_invoice_${invoiceId}_${Date.now()}`
      : `order_course_${courseId}_${Date.now()}`;

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
      console.log("🔄 Отправляем запрос к Tinkoff API:", {
        orderId,
        amount: amountInCoins,
        userEmail,
        invoiceId,
        courseId,
      });

      const apiUrl = "https://securepay.tinkoff.ru/v2/Init";

      const response = await axios.post(apiUrl, requestData, {
        headers: { "Content-Type": "application/json" },
      });

      console.log("✅ Ответ от Tinkoff API:", response.data);

      if (response.data.Success) {
        ctx.send({
          paymentUrl: response.data.PaymentURL,
          orderId,
          message: "Ссылка на оплату создана",
        });
      } else {
        console.error("❌ Ошибка Tinkoff API:", response.data);
        ctx.throw(400, `Ошибка создания платежа: ${response.data.Message}`);
      }
    } catch (error) {
      console.error(
        "❌ Ошибка Tinkoff Init:",
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

    // Извлекаем invoiceId из OrderId
    let invoiceId = null;
    if (OrderId?.startsWith("order_invoice_")) {
      // Формат: order_invoice_123_1703123456789
      const parts = OrderId.split("_");
      if (parts.length >= 3) {
        invoiceId = parts[2];
      }
    }

    try {
      if (Success && Status === "CONFIRMED" && invoiceId) {
        // Обновляем invoice по documentId используя Document Service API
        try {
          await strapi.documents("api::invoice.invoice").update({
            documentId: invoiceId,
            data: {
              statusPayment: true,
              paymentId: PaymentId || null,
              paymentDate: new Date(),
            },
          });
          
          console.log(`✅ Платеж подтвержден для invoice ${invoiceId}`);
          return ctx.send({ status: "ok" });
        } catch (updateError) {
          console.log(`❌ Invoice с documentId ${invoiceId} не найден или ошибка обновления:`, updateError);
          return ctx.send({ status: "Invoice not found or update failed" });
        }
      } else {
        console.log(
          "❌ Платеж не подтвержден или не найден invoiceId:",
          Status
        );
        return ctx.send({ status: "Payment not confirmed" });
      }
    } catch (error) {
      console.error("Ошибка при обработке уведомления:", error);
      return ctx.throw(500, "Ошибка на сервере при обработке уведомления");
    }
  },
}));
