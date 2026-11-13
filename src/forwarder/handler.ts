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
  if (!job.tenantId) {
    throw new Error("Forward job missing tenantId");
  }
  const secrets = await ctx.getSecrets();
  const replyToken = issueReplyToken({
    tenantId: job.tenantId,
    threadId: job.message.threadId,
    secret: secrets.callbackSigningSecret,
    nowMs: ctx.now(),
  });
  const payload = buildBotPayload({
    message: job.message,
    replyUrl: ctx.config.replyUrl,
    replyToken,
  });

  const tenantKey = job.botId
    ? await ctx.tenantSecrets.getBotKey(job.tenantId, job.botId)
    : job.targetId
      ? await ctx.tenantSecrets.getBotKey(job.tenantId, job.targetId)
      : null;
  const bearer = tenantKey ?? webhookKeyForTarget(secrets, job.targetId);
  if (!bearer) {
    throw new Error(`No webhook key for tenant ${job.tenantId} bot ${job.botId ?? job.targetId ?? ""}`);
  }

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
      tenantId: job.tenantId,
      threadId: job.message.threadId,
      eventId: job.message.eventId,
      targetId: job.targetId ?? null,
      status: response.status,
    }),
  );
}

export const handler = createForwarderHandler(createRuntimeContext());
