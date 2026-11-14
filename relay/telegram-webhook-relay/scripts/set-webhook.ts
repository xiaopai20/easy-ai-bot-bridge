#!/usr/bin/env node
/**
 * Register the Lambda Function URL with Telegram setWebhook.
 *
 *   export TELEGRAM_BOT_TOKEN='...'
 *   export WEBHOOK_URL='https://....lambda-url....on.aws/'
 *   export TELEGRAM_WEBHOOK_SECRET='...'   # same value as TELEGRAM_WEBHOOK_SECRET in Secrets Manager
 *   npm run set-webhook
 */

const token = process.env.TELEGRAM_BOT_TOKEN;
const url = process.env.WEBHOOK_URL;
const secretToken = process.env.TELEGRAM_WEBHOOK_SECRET;

if (!token) {
  console.error("Set TELEGRAM_BOT_TOKEN");
  process.exit(1);
}
if (!url) {
  console.error("Set WEBHOOK_URL to the deployed Function URL");
  process.exit(1);
}
if (!secretToken) {
  console.error("Set TELEGRAM_WEBHOOK_SECRET (must match the relay secret)");
  process.exit(1);
}

const apiUrl = `https://api.telegram.org/bot${token}/setWebhook`;

async function main(): Promise<void> {
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      url,
      secret_token: secretToken,
      allowed_updates: ["message", "edited_message"],
    }),
  });
  const body = await response.text();
  if (!response.ok) {
    console.error(`setWebhook failed: HTTP ${response.status}`);
    console.error(body);
    process.exit(1);
  }
  console.log(body);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});