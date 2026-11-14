import { getAdapter } from "../adapters/registry";
import type { AppContext } from "../context";
import { getEffectiveLimits } from "./limits";
import { minuteBucket, newId, RATE_MINUTE_TTL_SECONDS, rateNoticePk } from "./keys";
import type { NormalizedMessage, ThreadRecord } from "./types";

export const RATE_LIMIT_NOTICE = "This workspace is rate limited. Try again later.";

export type QuotaDenial = "rate_limited" | "loop_detected";
export type QuotaResult = { ok: true } | { ok: false; reason: QuotaDenial };

/**
 * Tenant quota is one UpdateItem (day item with current minute count).
 * Loop count piggybacks on the thread upsert. Limits/routes come from the
 * in-memory cache when warm (no DynamoDB read).
 */
export async function consumeInboundQuota(
  ctx: AppContext,
  tenantId: string,
  thread: ThreadRecord,
): Promise<QuotaResult> {
  const limits = await getEffectiveLimits(ctx, tenantId);
  const quotaOk = await ctx.stores.tryConsumeMessageQuota(
    tenantId,
    limits.messagesPerMinute,
    limits.messagesPerDay,
    ctx.now(),
  );
  if (!quotaOk) {
    console.log(
      JSON.stringify({
        msg: "rate_limited",
        tenantId,
        threadId: thread.threadId,
        messagesPerMinute: limits.messagesPerMinute,
        messagesPerDay: limits.messagesPerDay,
      }),
    );
    return { ok: false, reason: "rate_limited" };
  }

  const loopOk = await ctx.stores.upsertThreadAndConsumeLoop(
    thread,
    limits.loopMessagesPerThreadPerMinute,
    ctx.now(),
  );
  if (!loopOk) {
    console.log(
      JSON.stringify({
        msg: "loop_detected",
        tenantId,
        threadId: thread.threadId,
        limit: limits.loopMessagesPerThreadPerMinute,
        window: "minute",
      }),
    );
    return { ok: false, reason: "loop_detected" };
  }
  return { ok: true };
}

export async function consumeOutboundQuota(
  ctx: AppContext,
  tenantId: string,
  thread: ThreadRecord,
): Promise<QuotaResult> {
  return consumeInboundQuota(ctx, tenantId, thread);
}

export async function maybeNotifyRateLimited(
  ctx: AppContext,
  tenantId: string,
  message: NormalizedMessage,
): Promise<void> {
  const nowMs = ctx.now();
  const claimed = await ctx.stores.tryClaimFlag(
    rateNoticePk(tenantId, minuteBucket(nowMs)),
    RATE_MINUTE_TTL_SECONDS,
    nowMs,
  );
  if (!claimed) {
    return;
  }

  if (message.platform === "widget") {
    await ctx.stores.putInboxMessage({
      tenantId,
      threadId: message.threadId,
      messageId: newId("m"),
      role: "bot",
      text: RATE_LIMIT_NOTICE,
      sentAt: new Date(nowMs).toISOString(),
      expiresAt: Math.floor(nowMs / 1000) + ctx.config.threadTtlSeconds,
    });
    return;
  }

  if (message.platform !== "slack") {
    return;
  }

  try {
    const secrets = await ctx.getSecrets();
    const token =
      (await ctx.tenantSecrets.getSlackToken(tenantId, message.conversation.workspaceId)) ??
      secrets.slackBotToken;
    if (!token) {
      return;
    }
    const adapter = getAdapter("slack");
    await adapter.postReply({
      target: {
        workspaceId: message.conversation.workspaceId,
        channelId: message.conversation.channelId,
        threadTs: message.conversation.threadTs,
      },
      text: RATE_LIMIT_NOTICE,
      credentials: { slackBotToken: token },
      fetchFn: ctx.fetch,
    });
  } catch (err) {
    console.error(
      JSON.stringify({
        msg: "rate_limit_notice_failed",
        tenantId,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}
