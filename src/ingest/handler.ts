import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { getAdapter } from "../adapters/registry";
import type { AppContext } from "../context";
import { handleError, json, parseJsonBody, rawBody, text } from "../lib/http";
import { lookupRoute } from "../lib/routing";
import type { ForwardJob } from "../lib/types";
import { createRuntimeContext } from "../runtime";

export function createIngestHandler(ctx: AppContext, platform = "slack") {
  return async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> => {
    try {
      return await ingest(ctx, event, platform);
    } catch (err) {
      return handleError(err);
    }
  };
}

async function ingest(
  ctx: AppContext,
  event: APIGatewayProxyEventV2,
  platform: string,
): Promise<APIGatewayProxyStructuredResultV2> {
  const adapter = getAdapter(platform);
  const body = rawBody(event);
  const secrets = await ctx.getSecrets();
  adapter.verifyRequest({
    headers: event.headers ?? {},
    rawBody: body,
    signingSecret: secrets.slackSigningSecret,
    nowMs: ctx.now(),
  });

  const parsed = adapter.parseInbound(parseJsonBody(body), {
    botUserId: ctx.config.slackBotUserId,
  });

  if (parsed.kind === "challenge") {
    return text(200, parsed.challenge);
  }
  if (parsed.kind === "ignore") {
    console.log(JSON.stringify({ msg: "ingest_ignore", platform, reason: parsed.reason }));
    return json(200, { ok: true, ignored: true, reason: parsed.reason });
  }

  const message = parsed.message;
  const route = await lookupRoute(ctx.stores, {
    platform: message.platform,
    workspaceId: message.conversation.workspaceId,
    channelId: message.conversation.channelId,
    defaultTargetWebhookUrl: ctx.config.defaultTargetWebhookUrl,
  });
  if (!route) {
    console.log(
      JSON.stringify({
        msg: "ingest_no_route",
        platform: message.platform,
        workspaceId: message.conversation.workspaceId,
        channelId: message.conversation.channelId,
        eventId: message.eventId,
      }),
    );
    return json(200, { ok: true, ignored: true, reason: "no route" });
  }

  const isNew = await ctx.stores.tryRecordEvent(
    message.platform,
    message.eventId,
    ctx.config.eventTtlSeconds,
    ctx.now(),
  );
  if (!isNew) {
    console.log(JSON.stringify({ msg: "ingest_duplicate", eventId: message.eventId }));
    return json(200, { ok: true, duplicate: true });
  }

  const job: ForwardJob = {
    message,
    targetWebhookUrl: route.targetWebhookUrl,
    targetId: route.targetId,
  };

  try {
    await ctx.stores.putThread({
      threadId: message.threadId,
      platform: message.platform,
      workspaceId: message.conversation.workspaceId,
      channelId: message.conversation.channelId,
      threadTs: message.conversation.threadTs,
      targetId: route.targetId,
      createdAt: new Date(ctx.now()).toISOString(),
      expiresAt: Math.floor(ctx.now() / 1000) + ctx.config.threadTtlSeconds,
    });
    await ctx.enqueue(job);
  } catch (err) {
    await ctx.stores.deleteEvent(message.platform, message.eventId);
    throw err;
  }

  console.log(
    JSON.stringify({
      msg: "ingest_enqueued",
      eventId: message.eventId,
      threadId: message.threadId,
      targetId: route.targetId ?? null,
    }),
  );
  return json(200, { ok: true });
}

export const handler = createIngestHandler(createRuntimeContext());
