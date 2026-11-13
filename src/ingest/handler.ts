import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { getAdapter } from "../adapters/registry";
import type { AppContext } from "../context";
import { handleError, json, parseJsonBody, rawBody, text } from "../lib/http";
import { enqueueInbound } from "../lib/pipeline";
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

  const parsedPreview = adapter.parseInbound(parseJsonBody(body), {
    botUserId: ctx.config.slackBotUserId,
  });
  if (parsedPreview.kind === "challenge") {
    return text(200, parsedPreview.challenge);
  }
  if (parsedPreview.kind === "ignore") {
    console.log(JSON.stringify({ msg: "ingest_ignore", platform, reason: parsedPreview.reason }));
    return json(200, { ok: true, ignored: true, reason: parsedPreview.reason });
  }

  const workspaceId = parsedPreview.message.conversation.workspaceId;
  const mapping = await ctx.stores.getSlackTeamMapping(workspaceId);
  if (!mapping) {
    console.log(JSON.stringify({ msg: "ingest_no_tenant", platform, workspaceId }));
    return json(200, { ok: true, ignored: true, reason: "no tenant mapping" });
  }

  const parsed = adapter.parseInbound(parseJsonBody(body), {
    botUserId: mapping.slackBotUserId ?? ctx.config.slackBotUserId,
  });
  if (parsed.kind !== "message") {
    return json(200, { ok: true, ignored: true, reason: parsed.kind === "ignore" ? parsed.reason : "not a message" });
  }

  const result = await enqueueInbound(ctx, mapping.tenantId, parsed.message);
  return json(200, result);
}

export const handler = createIngestHandler(createRuntimeContext());
