# Railway Deployment Setup

## Автоматическое определение окружения

Backend автоматически определяет, в каком окружении он запущен:

- **Локально (Development)**: Использует SQLite (`.tmp/data.db`)
- **Railway (Production)**: Использует PostgreSQL через `DATABASE_URL`

## Переменные окружения Railway

Railway автоматически предоставляет переменную `DATABASE_URL` при подключении PostgreSQL сервиса.

### Обязательные переменные для Railway:

```env
# Security Keys (скопируйте из локального .env)
APP_KEYS=your_app_keys_here
API_TOKEN_SALT=your_api_token_salt
ADMIN_JWT_SECRET=your_admin_jwt_secret
TRANSFER_TOKEN_SALT=your_transfer_token_salt
JWT_SECRET=your_jwt_secret

# AWS S3 Configuration
AWS_ACCESS_KEY_ID=your_aws_key
AWS_ACCESS_SECRET=your_aws_secret
AWS_BUCKET_NAME=your_bucket_name
AWS_REGION=eu-central-1

# Email Configuration (Resend)
RESEND_API_KEY=your_resend_api_key
EMAIL_DEFAULT_FROM=noreply@anirum.com
EMAIL_DEFAULT_REPLY_TO=support@anirum.com

# Pinterest OAuth
PINTEREST_CLIENT_ID=your_client_id
PINTEREST_CLIENT_SECRET=your_client_secret
PINTEREST_REDIRECT_URI=https://your-domain.com/auth/pinterest/callback

# Tinkoff Payment
TINKOFF_TERMINAL_KEY=your_terminal_key
TINKOFF_TERMINAL_PASSWORD=your_terminal_password

# Green API (WhatsApp)
GREEN_API_URL=your_green_api_url
GREEN_API_ID_INSTANCE=your_instance_id
GREEN_API_TOKEN_INSTANCE=your_token

# Telegram Bot
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
```

### НЕ нужно указывать вручную на Railway:

- `DATABASE_URL` - автоматически предоставляется Railway при подключении PostgreSQL
- `DATABASE_CLIENT` - автоматически определяется как "postgres"
- `DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_NAME` и т.д. - парсятся из `DATABASE_URL`

## Как подключить PostgreSQL на Railway:

1. В Railway проекте нажмите "+ New Service"
2. Выберите "Database" → "PostgreSQL"
3. Railway автоматически создаст переменную `DATABASE_URL`
4. Подключите PostgreSQL сервис к вашему Strapi сервису
5. Перезапустите Strapi сервис

## Локальная разработка:

```bash
# В .env файле установите:
DATABASE_CLIENT=sqlite
DATABASE_FILENAME=.tmp/data.db

# Запустите dev сервер:
npm run develop
```

## Production deployment:

```bash
# Railway автоматически определит PostgreSQL через DATABASE_URL
railway up
```

## Проверка подключения:

После деплоя проверьте логи Railway:

```bash
railway logs
```

Вы должны увидеть успешное подключение к PostgreSQL без ошибок "database is locked".

## Troubleshooting:

### Ошибка "database is locked"
- Убедитесь, что Railway использует PostgreSQL, а не SQLite
- Проверьте наличие переменной `DATABASE_URL` в Railway
- Убедитесь, что PostgreSQL сервис подключен к Strapi сервису

### Ошибка подключения к PostgreSQL
- Проверьте правильность `DATABASE_URL`
- Убедитесь, что PostgreSQL сервис запущен
- Проверьте network настройки в Railway
