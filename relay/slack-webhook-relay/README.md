# slack-webhook-relay

Minimal AWS Lambda that accepts Slack Events API POSTs and forwards mentions
(and DMs) to a Grok Bot routine webhook. One workspace. No API Gateway, no
DynamoDB, no SQS. The bot replies to Slack itself with `chat.postMessage`.

Cost at idle is about **$0.40/month** (one Secrets Manager secret). Lambda,
Function URL, and logs are inside the free tier at low volume. To get closer
to $0, skip the secret and set the three values as Lambda environment
variables instead (see below).

## Slack app setup

1. [Create a Slack app](https://api.slack.com/apps) from scratch for the one
   workspace you want.
2. **OAuth & Permissions** -- Bot Token Scopes:
   - `app_mentions:read`
   - `chat:write`
   - `im:history`
3. Install the app to the workspace. Copy the **Bot User OAuth Token**
   (`xoxb-...`). The Grok Bot uses this token to post replies; this relay
   does not.
4. **Basic Information** -- copy the **Signing Secret**.
5. Deploy this stack (next section). Copy CloudFormation output `FunctionUrl`.
6. Put the signing secret and Grok webhook into the secret (output `SecretArn`)
   **before** you set the Slack Request URL.
7. **Event Subscriptions**
   - Enable events.
   - Request URL = `FunctionUrl` (the Lambda Function URL, HTTPS).
   - Bot events: `app_mention`, `message.im`
8. Invite the app to channels (`/invite @YourBot`). DMs work without invite.

Slack will POST `url_verification`; the Lambda echoes the `challenge` as
plaintext. Put the signing secret in place first or verification fails.

## Deploy

You need Node 22+ and AWS credentials that can create Lambda, Function URL,
Secrets Manager, IAM, and CloudWatch Logs.

```bash
cd relay/slack-webhook-relay
npm ci
npm test
npx cdk synth
export CDK_DEFAULT_REGION=us-east-1
npx cdk bootstrap aws://$AWS_ACCOUNT_ID/$CDK_DEFAULT_REGION
npx cdk deploy
```

Outputs:

| Name | Use |
| --- | --- |
| `FunctionUrl` | Slack Event Subscriptions Request URL |
| `SecretArn` | Store `SLACK_SIGNING_SECRET`, `WEBHOOK_URL`, `WEBHOOK_KEY` |

Fill the secret (replace the placeholders):

```bash
aws secretsmanager put-secret-value --secret-id "$SECRET_ARN" --secret-string "$(cat <<'EOF'
{
  "SLACK_SIGNING_SECRET": "your-slack-signing-secret",
  "WEBHOOK_URL": "https://your-grok-bot.example/routine",
  "WEBHOOK_KEY": "your-routine-bearer-key"
}
EOF
)"
```

The Lambda reads the secret **once per container** and caches it. After you
change the secret, wait for a cold start or bump the function (publish a new
version / update an env var) so it reloads.

### Env vars instead of Secrets Manager

If you would rather not pay for a secret, set Lambda environment variables
`SLACK_SIGNING_SECRET`, `WEBHOOK_URL`, and `WEBHOOK_KEY`, and remove
`SECRET_ARN`. Env vars win when all three are set. They are visible in the
Lambda console; the secret is the better default.

## What the Lambda does

- Verifies `X-Slack-Signature` + `X-Slack-Request-Timestamp` (5-minute window,
  timing-safe compare).
- Responds to `url_verification`.
- Ignores retries (`X-Slack-Retry-Num`) so Slack does not double-forward.
- Ignores bot messages (`bot_id` or subtype `bot_message`) to avoid loops.
- Handles `app_mention` and `message.im` only.
- POSTs to `WEBHOOK_URL` with `Authorization: Bearer WEBHOOK_KEY` and waits
  up to ~2.5s. On timeout or HTTP error it logs and still returns **200** to
  Slack within 3s.

Forwarded JSON:

```json
{
  "source": "slack",
  "team": "T0123456789",
  "channel": "C0LAN2Q65",
  "user": "U111",
  "text": "What is the weather today?",
  "ts": "1731448800.000100",
  "thread_ts": "1731448800.000100",
  "event_id": "Ev01ABC"
}
```

`text` has a leading `<@UBOT>` mention stripped. `thread_ts` is the Slack
thread id, or `ts` when the mention started a new thread.

## Grok Bot routine prompt

Point the Grok Bot routine webhook at the URL you put in `WEBHOOK_URL`. The
bot must respond HTTP 200 quickly; this relay will not wait more than ~2.5s.
The bot then calls Slack itself (the relay does not post replies).

Use this as the routine guidance:

```
You receive JSON from a Slack relay:

{
  "source": "slack",
  "team": "<workspace id>",
  "channel": "<channel or DM id>",
  "user": "<user id>",
  "text": "<user message, bot mention already stripped>",
  "ts": "<message ts>",
  "thread_ts": "<thread ts, or ts if this started the thread>",
  "event_id": "<slack event id>"
}

Answer the user's text. Then post the answer to Slack with the bot token
(xoxb-..., stored in the Grok Bot, not in this relay):

POST https://slack.com/api/chat.postMessage
Authorization: Bearer xoxb-...
Content-Type: application/json; charset=utf-8

{
  "channel": "<channel from the JSON>",
  "thread_ts": "<thread_ts from the JSON>",
  "text": "<your reply>"
}

Always set both channel and thread_ts so the reply stays in the same thread.
Do not mention the relay. Ignore messages that are not source=slack.
```

Exact curl the bot should run (fill in token, channel, thread_ts, text):

```bash
SLACK_BOT_TOKEN="xoxb-..."
CHANNEL="C0LAN2Q65"
THREAD_TS="1731448800.000100"

curl -sS -X POST https://slack.com/api/chat.postMessage \
  -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
  -H "Content-Type: application/json; charset=utf-8" \
  -d "$(jq -n --arg channel "$CHANNEL" --arg thread_ts "$THREAD_TS" --arg text "Sunny, 20C." \
    '{channel:$channel, thread_ts:$thread_ts, text:$text}')"
```

Expected Slack response includes `"ok":true`.

## Tests

```bash
npm test
```

Covers: valid/invalid/stale signature, challenge, retry skip, bot-message skip,
forward payload shape, timeout still returns 200.

```bash
npx cdk synth
npx tsc --noEmit
```

must complete cleanly.

## Layout

```
bin/app.ts         CDK app
lib/relay-stack.ts Lambda + Function URL + one secret
src/handler.ts     Function URL entry
src/slack.ts       Signature + event parse
src/config.ts      Secret / env, cached per container
test/              vitest
```
