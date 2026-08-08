import { processEngineFlow, globalUserStore } from './core-engine.js';

/**
 * Cloudflare Worker Handler for Smart x Ethiopian Core Engine
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Health check & API state endpoint
    if (request.method === 'GET') {
      return new Response(
        JSON.stringify({
          status: 'ok',
          engine: 'Smart x Ethiopian Core Engine',
          platform: 'Cloudflare Workers',
          time: new Date().toISOString(),
          hasTelegramToken: Boolean(env.TELEGRAM_BOT_TOKEN),
          hasGeminiKey: Boolean(env.GEMINI_API_KEY),
        }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    let update;
    try {
      update = await request.json();
    } catch (e) {
      return new Response('Invalid JSON', { status: 400 });
    }

    const apiKey = env.GEMINI_API_KEY || process.env?.GEMINI_API_KEY;
    const botToken = env.TELEGRAM_BOT_TOKEN || process.env?.TELEGRAM_BOT_TOKEN;

    // Handle Telegram Webhook Update
    try {
      let chatId, userId, userText, interactionType = 'Chat', callbackQueryId;

      if (update.message) {
        chatId = update.message.chat.id;
        userId = update.message.from.id;
        if (update.message.contact) {
          userText = update.message.contact.phone_number;
          interactionType = 'Contact';
        } else {
          userText = update.message.text || '';
          interactionType = 'Chat';
        }
      } else if (update.callback_query) {
        callbackQueryId = update.callback_query.id;
        chatId = update.callback_query.message.chat.id;
        userId = update.callback_query.from.id;
        userText = update.callback_query.data;
        interactionType = 'Callback';
      }

      if (chatId && userId) {
        const result = await processEngineFlow({
          userId,
          userMessage: userText,
          interactionType,
          apiKey,
          store: globalUserStore,
        });

        if (botToken) {
          // Send response via Telegram Bot API
          if (callbackQueryId) {
            await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ callback_query_id: callbackQueryId }),
            });
          }

          const payload = {
            chat_id: chatId,
            text: result.message,
            parse_mode: 'Markdown',
          };

          if (result.keyboard && result.keyboard.length > 0) {
            // Determine if keyboard is inline or reply
            if (result.type.includes('PROMPT')) {
              payload.reply_markup = { inline_keyboard: result.keyboard };
            } else if (result.keyboard[0][0].request_contact) {
              payload.reply_markup = {
                keyboard: result.keyboard,
                one_time_keyboard: true,
                resize_keyboard: true,
              };
            } else {
              payload.reply_markup = { inline_keyboard: result.keyboard };
            }
          }

          await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
        }
      }

      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      console.error('Worker Processing Error:', err);
      return new Response(JSON.stringify({ ok: false, error: err.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
};
