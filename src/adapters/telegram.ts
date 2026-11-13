import type { PlatformAdapter } from "./types";

/**
 * Telegram adapter stub. Intentionally not implemented in v1.
 *
 * When adding Telegram:
 * 1. Verify the `X-Telegram-Bot-Api-Secret-Token` header (set when
 *    calling setWebhook) -- or HMAC over the raw body if you terminate TLS
 *    yourself.
 * 2. Parse `Update` JSON: use `message.message_id` / `message.chat.id`
 *    as the conversation identity, `message.text`, and `from` for sender.
 * 3. Reply with `sendMessage` (`chat_id` + `reply_to_message_id`).
 * 4. Register a route `POST /telegram/webhook` that calls ingest with
 *    `platform=telegram`.
 */
export const telegramAdapter: PlatformAdapter = {
  platform: "telegram",
  verifyRequest() {
    throw new Error("Telegram adapter is not implemented yet");
  },
  parseInbound() {
    throw new Error("Telegram adapter is not implemented yet");
  },
  async postReply() {
    throw new Error("Telegram adapter is not implemented yet");
  },
};
