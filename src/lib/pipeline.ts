import type { AppContext } from "../context";
import { composeThreadId } from "./keys";
import { consumeInboundQuota, maybeNotifyRateLimited } from "./rate-limit";
import { lookupRouteCached } from "./settings";
import type { NormalizedMessage } from "./types";

export async function enqueueInbound(
  ctx: AppContext,
  tenantId: string,
  message: NormalizedMessage,
): Promise<{ ok: true; duplicate?: boolean; ignored?: boolean; reason?: string }> {
  const scoped: NormalizedMessage = {
    ...message,
    threadId: message.threadId.startsWith(`${tenantId}:`)
      ? message.threadId
      : composeThreadId(tenantId, message.threadId),
  };

  const route = await lookupRouteCached(ctx, {
    tenantId,
    platform: scoped.platform,
    workspaceId: scoped.conversation.workspaceId,
    channelId: scoped.conversation.channelId,
  });
  if (!route) {
    console.log(
      JSON.stringify({
        msg: "ingest_no_route",
        tenantId,
        platform: scoped.platform,
        workspaceId: scoped.conversation.workspaceId,
        channelId: scoped.conversation.channelId,
        eventId: scoped.eventId,
      }),
    );
    return { ok: true, ignored: true, reason: "no route" };
  }

  const isNew = await ctx.stores.tryRecordEvent(
    tenantId,
    scoped.platform,
    scoped.eventId,
    ctx.config.eventTtlSeconds,
    ctx.now(),
  );
  if (!isNew) {
    console.log(JSON.stringify({ msg: "ingest_duplicate", tenantId, eventId: scoped.eventId }));
    return { ok: true, duplicate: true };
  }

  try {
    const quota = await consumeInboundQuota(ctx, tenantId, {
      tenantId,
      threadId: scoped.threadId,
      platform: scoped.platform,
      workspaceId: scoped.conversation.workspaceId,
      channelId: scoped.conversation.channelId,
      threadTs: scoped.conversation.threadTs,
      targetId: route.targetId,
      createdAt: new Date(ctx.now()).toISOString(),
      expiresAt: Math.floor(ctx.now() / 1000) + ctx.config.threadTtlSeconds,
    });
    if (!quota.ok) {
      if (quota.reason === "rate_limited") {
        await maybeNotifyRateLimited(ctx, tenantId, scoped);
      }
      return { ok: true, ignored: true, reason: quota.reason === "loop_detected" ? "loop detected" : "rate limited" };
    }

    await ctx.enqueue({
      tenantId,
      botId: route.targetId,
      message: scoped,
      targetWebhookUrl: route.targetWebhookUrl,
      targetId: route.targetId,
    });
  } catch (err) {
    await ctx.stores.deleteEvent(tenantId, scoped.platform, scoped.eventId);
    throw err;
  }

  console.log(
    JSON.stringify({
      msg: "ingest_enqueued",
      tenantId,
      eventId: scoped.eventId,
      threadId: scoped.threadId,
      targetId: route.targetId ?? null,
    }),
  );
  return { ok: true };
}
