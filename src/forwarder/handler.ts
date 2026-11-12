import type { SQSEvent } from "aws-lambda";
import type { AppContext } from "../context";
import { buildBotPayload } from "../lib/payload";
import { issueReplyToken } from "../lib/reply-token";
import { webhookKeyForTarget } from "../lib/secrets";
import type { ForwardJob } from "../lib/types";
import { createRuntimeContext } from "../runtime";

export function createForwarderHandler(ctx: AppContext) {
  return async (event: SQSEvent): Promise<void> => {
    for (const record of event.Records) {
      const job = JSON.parse(record.body) as ForwardJob;
      await processForwardJob(ctx, job);
    }
  };
}

export async function processForwardJob(ctx: AppContext, job: ForwardJob): Promise<void> {
  if (!ctx.config.replyUrl) {
    throw new Error("REPLY_URL is not configured");
  }
  const secrets = await ctx.getSecrets();
  const replyToken = issueReplyToken({
    threadId: job.message.threadId,
    secret: secrets.callbackSigningSecret,
    nowMs: ctx.now(),
  });
  const payload = buildBotPayload({
    message: job.message,
    replyUrl: ctx.config.replyUrl,
    replyToken,
  });
  const bearer = webhookKeyForTarget(secrets, job.targetId);

  const response = await ctx.fetch(job.targetWebhookUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${bearer}`,
      "content-type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const preview = await response.text().catch(() => "");
    throw new Error(
      `Target webhook ${job.targetWebhookUrl} returned HTTP ${response.status}: ${preview.slice(0, 200)}`,
    );
  }

  console.log(
    JSON.stringify({
      msg: "forwarded",
      threadId: job.message.threadId,
      eventId: job.message.eventId,
      targetId: job.targetId ?? null,
      status: response.status,
    }),
  );
}

export const handler = createForwarderHandler(createRuntimeContext());
