/**
 * Скрипт для настройки Telegram webhook
 * Запуск: node scripts/setup-telegram-webhook.js
 */

require('dotenv').config();

async function setupTelegramWebhook() {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const baseUrl = process.env.URL || 'https://anirum.up.railway.app';

  if (!botToken) {
    console.error('❌ TELEGRAM_BOT_TOKEN не найден в .env файле');
    process.exit(1);
  }

  const webhookUrl = `${baseUrl}/api/telegram-webhook`;

  console.log(`🔗 Настройка webhook для бота...`);
  console.log(`📍 Webhook URL: ${webhookUrl}`);

  try {
    // Устанавливаем webhook
    const setWebhookResponse = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: webhookUrl,
        allowed_updates: ['message'], // Только сообщения
        drop_pending_updates: true    // Очистить старые обновления
      }),
    });

    const setResult = await setWebhookResponse.json();

    if (setResult.ok) {
      console.log('✅ Webhook успешно установлен!');
    } else {
      console.error('❌ Ошибка установки webhook:', setResult.description);
      process.exit(1);
    }

    // Проверяем информацию о webhook
    const getWebhookResponse = await fetch(`https://api.telegram.org/bot${botToken}/getWebhookInfo`);
    const webhookInfo = await getWebhookResponse.json();

    if (webhookInfo.ok) {
      console.log('\n📋 Информация о webhook:');
      console.log(`   URL: ${webhookInfo.result.url}`);
      console.log(`   Pending updates: ${webhookInfo.result.pending_update_count}`);
      console.log(`   Last error: ${webhookInfo.result.last_error_message || 'Нет ошибок'}`);
      console.log(`   Max connections: ${webhookInfo.result.max_connections}`);
    }

    // Получаем информацию о боте
    const getBotResponse = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
    const botInfo = await getBotResponse.json();

    if (botInfo.ok) {
      console.log('\n🤖 Информация о боте:');
      console.log(`   Username: @${botInfo.result.username}`);
      console.log(`   Name: ${botInfo.result.first_name}`);
      console.log(`   ID: ${botInfo.result.id}`);
    }

    console.log('\n✅ Настройка завершена! Теперь можно тестировать ссылки вида:');
    console.log(`   https://t.me/${botInfo.result.username}?start=verify_test123`);

  } catch (error) {
    console.error('❌ Ошибка при настройке webhook:', error.message);
    process.exit(1);
  }
}

// Запускаем настройку
setupTelegramWebhook();