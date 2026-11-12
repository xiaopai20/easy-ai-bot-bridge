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
  verifyReplyToken({
    token,
    threadId,
    secret: secrets.callbackSigningSecret,
    nowMs: ctx.now(),
  });

  const mapping = await ctx.stores.getThread(threadId);
  if (!mapping) {
    throw new HttpError(404, "Unknown thread");
  }

  const adapter = getAdapter(mapping.platform);
  await adapter.postReply({
    target: {
      workspaceId: mapping.workspaceId,
      channelId: mapping.channelId,
      threadTs: mapping.threadTs,
    },
    text,
    credentials: {
      slackBotToken: secrets.slackBotToken,
    },
    fetchFn: ctx.fetch,
  });

  console.log(
    JSON.stringify({
      msg: "reply_posted",
      threadId,
      platform: mapping.platform,
      channelId: mapping.channelId,
    }),
  );
  return json(200, { ok: true });
}

export const handler = createReplyHandler(createRuntimeContext());
