# telegram-webhook-relay

Minimal AWS Lambda that accepts Telegram Bot API webhook POSTs and forwards
human messages to an AI bot routine webhook. One bot. Lambda Function URL only.
Your bot replies via Telegram `sendMessage` (bot token stays in the AI bot, not
here).

Cost at idle is about **$0.40/month** (one Secrets Manager secret). Lambda,
Function URL, and logs are inside the free tier at low volume.

## Security model

- Telegram sends `X-Telegram-Bot-Api-Secret-Token` on each webhook request
  (the `secret_token` you set in `setWebhook`). This relay compares it with
  **constant-time** equality against `TELEGRAM_WEBHOOK_SECRET`. Wrong or missing
  header -> **401**, no forward.
- **User allowlist (recommended):** set `ALLOWED_USER_IDS` to a comma-separated
  list of Telegram user ids. Only those senders are forwarded; others get **200**
  with no forward. For a personal bot, always use an allowlist so strangers cannot
  trigger your AI webhook.
- **Allow all (default):** if `ALLOWED_USER_IDS` is unset, empty, or `*`, or you
  set `ALLOW_ALL_USERS=true`, any human sender is forwarded. The Lambda logs a
  **warning once per cold start** in this mode.
- Bot senders and unsupported update types are always ignored with **200** (in
  both modes).
- `update_id` is deduped in memory per Lambda container so Telegram retries
  are not forwarded twice.
- Logs at info level include `update_id`, `user_id`, and outcome only (not
  message text or secrets).

Target webhook auth uses `Authorization: Bearer` with `WEBHOOK_KEY` from
Secrets Manager (Telegram cannot send that header to your bot webhook
directly).

## Configuration

| Item | Where | Keys |
| --- | --- | --- |
| Webhook secret + bearer key | Secrets Manager | `TELEGRAM_WEBHOOK_SECRET`, `WEBHOOK_KEY` |
| Target webhook URL | Lambda env / CDK context `webhookUrl` | `WEBHOOK_URL` |
| User allowlist (optional) | Lambda env / CDK `allowedUserIds` | `ALLOWED_USER_IDS` (comma-separated ids), or `*` / empty for allow-all |
| Explicit allow-all | Lambda env / CDK `allowAllUsers` | `ALLOW_ALL_USERS=true` |

Env vars override secrets for local tests: set `TELEGRAM_WEBHOOK_SECRET`,
`WEBHOOK_KEY`, `WEBHOOK_URL`, and omit `SECRET_ARN`. `ALLOWED_USER_IDS` is
optional (defaults to allow-all).

## Deploy

You need Node 22+ and AWS credentials for Lambda, Function URL, Secrets Manager,
IAM, and CloudWatch Logs.

```bash
cd relay/telegram-webhook-relay
npm ci
npm test
npx cdk synth
export CDK_DEFAULT_REGION=us-east-1
npx cdk bootstrap aws://$AWS_ACCOUNT_ID/$CDK_DEFAULT_REGION
npx cdk deploy \
  -c webhookUrl="https://your-grok-bot.example/routine" \
  -c allowedUserIds="1001,1002"
```

Outputs:

| Name | Use |
| --- | --- |
| `FunctionUrl` | Telegram `setWebhook` `url` |
| `SecretArn` | Store `TELEGRAM_WEBHOOK_SECRET` and `WEBHOOK_KEY` |

Fill the secret:

```bash
aws secretsmanager put-secret-value --secret-id "$SECRET_ARN" --secret-string "$(cat <<'EOF'
{
  "TELEGRAM_WEBHOOK_SECRET": "your-random-secret-token",
  "WEBHOOK_KEY": "your-routine-bearer-key"
}
EOF
)"
```

Redeploy or update Lambda env if you change `webhookUrl` / `allowedUserIds`
via CDK context.

## Register the webhook with Telegram

After deploy, point Telegram at the Function URL. **Never commit the bot token.**

```bash
export TELEGRAM_BOT_TOKEN='your-bot-token'
export WEBHOOK_URL='https://....lambda-url....on.aws/'
export TELEGRAM_WEBHOOK_SECRET='same-as-secrets-manager'
npm run set-webhook
```

Equivalent curl (omit the bot token from shell history on shared machines):

```bash
curl -sS -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  -H "Content-Type: application/json" \
  -d "$(jq -n \
    --arg url "$WEBHOOK_URL" \
    --arg secret "$TELEGRAM_WEBHOOK_SECRET" \
    '{url:$url, secret_token:$secret, allowed_updates:["message","edited_message"]}')"
```

## Forwarded JSON

Text message example:

```json
{
  "source": "telegram",
  "chat_id": 9001,
  "user_id": 1001,
  "username": "testuser",
  "first_name": "Test",
  "message_id": 7,
  "date": 1731448800,
  "text": "Hello bot",
  "instruction": "Reply using the Telegram Bot API sendMessage method with chat_id from this payload. Store the Telegram bot token in your AI bot, not in this relay.",
  "update_id": 42
}
```

Photos and documents add an `attachments` array (`file_id`, optional
`caption` / `file_name`). Plain text may be empty when only media is sent.

## What the Lambda does

- Verifies `X-Telegram-Bot-Api-Secret-Token`.
- Handles `message` and `edited_message` only.
- POSTs to `WEBHOOK_URL` with Bearer auth, up to ~2.5s, then always **200** to
  Telegram.

## Tests

```bash
npm test
```

Covers: bad/missing secret, allowlist drop, forward shape and Bearer header,
bot sender drop, duplicate `update_id`.

```bash
npx cdk synth
npx tsc --noEmit
```

## Layout

```
bin/app.ts
lib/relay-stack.ts
src/handler.ts
src/telegram.ts
src/config.ts
scripts/set-webhook.ts
test/
```