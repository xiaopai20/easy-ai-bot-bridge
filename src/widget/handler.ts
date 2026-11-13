import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import type { AppContext } from "../context";
import { handleError, HttpError, json, parseJsonBody, queryParam, rawBody } from "../lib/http";
import { newId } from "../lib/keys";
import { enqueueInbound } from "../lib/pipeline";
import { createRuntimeContext } from "../runtime";
import { widgetEmbedScript } from "./embed";

export function createWidgetHandler(ctx: AppContext) {
  return async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> => {
    try {
      const method = event.requestContext.http.method.toUpperCase();
      const path = event.rawPath ?? "";
      if (method === "OPTIONS") {
        return json(204, {}, "*");
      }
      if (method === "GET" && path.endsWith("/widget.js")) {
        return {
          statusCode: 200,
          headers: {
            "content-type": "application/javascript; charset=utf-8",
            "cache-control": "public, max-age=300",
          },
          body: widgetEmbedScript(ctx.config.apiUrl),
        };
      }
      if (method === "GET" && path.endsWith("/widget/messages")) {
        return await listMessages(ctx, event);
      }
      if (method === "POST" && path.endsWith("/widget/events")) {
        return await ingestWidget(ctx, event);
      }
      throw new HttpError(404, "Not found");
    } catch (err) {
      return handleError(err, "*");
    }
  };
}

async function ingestWidget(
  ctx: AppContext,
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const body = parseJsonBody(rawBody(event));
  if (!body || typeof body !== "object") {
    throw new HttpError(400, "Invalid JSON body");
  }
  const record = body as Record<string, unknown>;
  const token = typeof record.token === "string" ? record.token : "";
  const text = typeof record.text === "string" ? record.text.trim() : "";
  const senderId = typeof record.sender_id === "string" ? record.sender_id : "visitor";
  const clientThread =
    typeof record.thread === "string" && record.thread.length > 0 ? record.thread : newId("wt");
  if (!token) throw new HttpError(400, "Missing widget token");
  if (!text) throw new HttpError(400, "Missing text");

  const mapping = await ctx.stores.getWidgetTokenMapping(token);
  if (!mapping) {
    throw new HttpError(401, "Unknown widget token");
  }
  const channel = await ctx.stores.getChannel(mapping.tenantId, mapping.channelId);
  if (!channel || !channel.enabled || channel.platform !== "widget") {
    throw new HttpError(404, "Widget channel not found");
  }

  const nowIso = new Date(ctx.now()).toISOString();
  const result = await enqueueInbound(ctx, mapping.tenantId, {
    platform: "widget",
    eventId: typeof record.event_id === "string" ? record.event_id : newId("we"),
    threadId: `widget:${channel.channelId}:${clientThread}`,
    text,
    sentAt: nowIso,
    sender: { id: senderId },
    conversation: {
      workspaceId: channel.channelId,
      channelId: channel.channelId,
      threadTs: clientThread,
    },
  });

  await ctx.stores.putInboxMessage({
    tenantId: mapping.tenantId,
    threadId: `${mapping.tenantId}:widget:${channel.channelId}:${clientThread}`,
    messageId: newId("m"),
    role: "user",
    text,
    sentAt: nowIso,
    expiresAt: Math.floor(ctx.now() / 1000) + ctx.config.threadTtlSeconds,
  });

  return json(200, { ...result, thread: clientThread }, "*");
}

async function listMessages(
  ctx: AppContext,
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const token = queryParam(event, "token") ?? "";
  const clientThread = queryParam(event, "thread") ?? "";
  if (!token || !clientThread) {
    throw new HttpError(400, "Missing token or thread");
  }
  const mapping = await ctx.stores.getWidgetTokenMapping(token);
  if (!mapping) {
    throw new HttpError(401, "Unknown widget token");
  }
  const threadId = `${mapping.tenantId}:widget:${mapping.channelId}:${clientThread}`;
  const messages = await ctx.stores.listInboxMessages(mapping.tenantId, threadId);
  return json(
    200,
    {
      thread: clientThread,
      messages: messages.map((m) => ({
        id: m.messageId,
        role: m.role,
        text: m.text,
        sent_at: m.sentAt,
      })),
    },
    "*",
  );
}

export const handler = createWidgetHandler(createRuntimeContext());
