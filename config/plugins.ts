export default ({ env }) => ({
  upload: {
    config: {
      provider: "aws-s3",
      providerOptions: {
        s3Options: {
          region: env("AWS_REGION"),
          credentials: {
            accessKeyId: env("AWS_ACCESS_KEY_ID"),
            secretAccessKey: env("AWS_ACCESS_SECRET"),
          },
          params: {
            ACL: "public-read",
            Bucket: env("AWS_BUCKET_NAME"),
          },
        },
      },
      actionOptions: {
        upload: {},
        uploadStream: {},
        delete: {},
      },
    },
  },
  graphql: {
    config: {
      endpoint: "/graphql",
      shadowCRUD: false,
      landingPage: false, // playgroundAlways
      depthLimit: 8,
      amountLimit: 100,
      apolloServer: {
        tracing: false,
      },
    },
  },
  email: {
    config: {
      provider: "resend",
      providerOptions: {
        apiKey: env("RESEND_API_KEY"),
      },
      settings: {
        defaultFrom: env("EMAIL_DEFAULT_FROM", "noreply@anirum.com"),
        defaultReplyTo: env("EMAIL_DEFAULT_REPLY_TO", "support@anirum.com"),
      },
    },
  },
});
