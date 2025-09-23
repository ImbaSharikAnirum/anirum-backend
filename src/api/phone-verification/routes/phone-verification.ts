/**
 * Phone verification custom routes
 */

export default {
  routes: [
    {
      method: "POST",
      path: "/phone-verification/send-code",
      handler: "phone-verification.sendCode",
      config: {
        policies: [],
        middlewares: [],
      },
    },
    {
      method: "POST",
      path: "/phone-verification/verify-code",
      handler: "phone-verification.verifyCode",
      config: {
        policies: [],
        middlewares: [],
      },
    },
    {
      method: "GET",
      path: "/phone-verification/status",
      handler: "phone-verification.getStatus",
      config: {
        policies: [],
        middlewares: [],
      },
    },
  ],
};