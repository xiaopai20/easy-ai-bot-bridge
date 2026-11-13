import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { getAdapter } from "../adapters/registry";
import type { AppContext } from "../context";
import {
  getBearerToken,
  handleError,
  HttpError,
  json,
  parseJsonBody,
  rawBody,
} from "../lib/http";
import { newId } from "../lib/keys";
import { verifyReplyToken } from "../lib/reply-token";
import { createRuntimeContext } from "../runtime";

const SLACK_TEXT_LIMIT = 40_000;

export function createReplyHandler(ctx: AppContext) {
  return async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> => {
    try {
      return await reply(ctx, event);
    } catch (err) {
      return handleError(err);
    }
  };
}

async function reply(ctx: AppContext, event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  const token = getBearerToken(event.headers);
  if (!token) {
    throw new HttpError(401, "Missing bearer token");
  }

  const body = parseJsonBody(rawBody(event));
  if (!body || typeof body !== "object") {
    throw new HttpError(400, "Invalid JSON body");
  }
  const record = body as Record<string, unknown>;
  const threadId = typeof record.thread === "string" ? record.thread : "";
  const text = typeof record.text === "string" ? record.text : "";
  if (!threadId) {
    throw new HttpError(400, "Missing thread");
  }
  if (!text.trim()) {
    throw new HttpError(400, "Missing text");
  }
  if (text.length > SLACK_TEXT_LIMIT) {
    throw new HttpError(400, "text too long");
  }

  const secrets = await ctx.getSecrets();
  const claims = verifyReplyToken({
    token,
    threadId,
    secret: secrets.callbackSigningSecret,
    nowMs: ctx.now(),
  });
  if (!threadId.startsWith(`${claims.tenantId}:`)) {
    throw new HttpError(401, "Reply token does not match tenant");
  }

  const mapping = await ctx.stores.getThread(claims.tenantId, threadId);
  if (!mapping || mapping.tenantId !== claims.tenantId) {
    throw new HttpError(404, "Unknown thread");
  }

  if (mapping.platform === "widget") {
    await ctx.stores.putInboxMessage({
      tenantId: claims.tenantId,
      threadId,
      messageId: newId("m"),
      role: "bot",
      text,
      sentAt: new Date(ctx.now()).toISOString(),
      expiresAt: Math.floor(ctx.now() / 1000) + ctx.config.threadTtlSeconds,
    });
  } else {
    const slackToken =
      (await ctx.tenantSecrets.getSlackToken(claims.tenantId, mapping.workspaceId)) ??
      secrets.slackBotToken;
    const adapter = getAdapter(mapping.platform);
    await adapter.postReply({
      target: {
        workspaceId: mapping.workspaceId,
        channelId: mapping.channelId,
        threadTs: mapping.threadTs,
      },
      text,
      credentials: { slackBotToken: slackToken },
      fetchFn: ctx.fetch,
    });
  }

  console.log(
    JSON.stringify({
      msg: "reply_posted",
      tenantId: claims.tenantId,
      threadId,
      platform: mapping.platform,
      channelId: mapping.channelId,
    }),
  );
  return json(200, { ok: true });
}

export const handler = createReplyHandler(createRuntimeContext());
