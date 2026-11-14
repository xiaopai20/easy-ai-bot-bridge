import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import type { AppContext } from "../context";
import { handleError, HttpError, queryParam } from "../lib/http";
import { newId } from "../lib/keys";
import { assertCanCreateChannel } from "../lib/limits";
import { verifyOAuthState } from "../lib/oauth-state";
import { invalidateSlackTeamCache } from "../lib/settings";
import { publishChannelRoute } from "../lib/tenancy";
import { createRuntimeContext } from "../runtime";

export function createSlackOAuthHandler(ctx: AppContext) {
  return async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> => {
    try {
      return await completeInstall(ctx, event);
    } catch (err) {
      return handleError(err);
    }
  };
}

async function completeInstall(
  ctx: AppContext,
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const code = queryParam(event, "code") ?? "";
  const state = queryParam(event, "state") ?? "";
  const dashboard = ctx.config.dashboardUrl.replace(/\/+$/, "") || "/";
  if (!code || !state) {
    throw new HttpError(400, "Missing code or state");
  }
  const secrets = await ctx.getSecrets();
  if (!secrets.slackClientId || !secrets.slackClientSecret) {
    throw new HttpError(400, "Slack OAuth is not configured");
  }
  const claims = verifyOAuthState({
    state,
    secret: secrets.callbackSigningSecret,
    nowMs: ctx.now(),
  });
  const tenant = await ctx.stores.getTenant(claims.tenantId);
  if (!tenant || tenant.ownerUserId !== claims.userId) {
    throw new HttpError(403, "OAuth state does not match tenant");
  }

  const redirectUri = `${ctx.config.apiUrl.replace(/\/+$/, "")}/slack/oauth/callback`;
  const body = new URLSearchParams({
    client_id: secrets.slackClientId,
    client_secret: secrets.slackClientSecret,
    code,
    redirect_uri: redirectUri,
  });
  const response = await ctx.fetch("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const payload = (await response.json()) as {
    ok?: boolean;
    error?: string;
    access_token?: string;
    bot_user_id?: string;
    team?: { id?: string; name?: string };
  };
  if (!payload.ok || !payload.access_token || !payload.team?.id) {
    throw new HttpError(400, `Slack OAuth failed: ${payload.error ?? "unknown"}`);
  }

  const existing = await ctx.stores.getSlackTeamMapping(payload.team.id);
  if (existing && existing.tenantId !== claims.tenantId) {
    throw new HttpError(409, "This Slack workspace is already connected to another tenant");
  }

  const bots = await ctx.stores.listBots(claims.tenantId);
  if (bots.length === 0) {
    throw new HttpError(400, "Create a bot before connecting Slack");
  }
  const bot = bots[0];
  if (!existing?.channelId) {
    await assertCanCreateChannel(ctx, claims.tenantId);
  }
  const channelId = existing?.channelId ?? newId("ch");
  const channel = {
    tenantId: claims.tenantId,
    channelId,
    platform: "slack" as const,
    name: payload.team.name ?? payload.team.id,
    botId: bot.botId,
    enabled: true,
    slackTeamId: payload.team.id,
    slackTeamName: payload.team.name,
    slackBotUserId: payload.bot_user_id,
    createdAt: new Date(ctx.now()).toISOString(),
  };
  await ctx.stores.putChannel(channel);
  try {
    await ctx.stores.putSlackTeamMapping({
      teamId: payload.team.id,
      tenantId: claims.tenantId,
      channelId,
      slackBotUserId: payload.bot_user_id,
    });
  } catch (err) {
    if ((err as { name?: string }).name === "ConditionalCheckFailedException") {
      throw new HttpError(409, "This Slack workspace is already connected to another tenant");
    }
    throw err;
  }
  await ctx.tenantSecrets.putSlackToken(claims.tenantId, payload.team.id, payload.access_token);
  invalidateSlackTeamCache(ctx, payload.team.id);
  await publishChannelRoute(ctx, channel, bot);

  const location = `${dashboard}/app?slack=connected`;
  return {
    statusCode: 302,
    headers: { location },
    body: "",
  };
}

export const handler = createSlackOAuthHandler(createRuntimeContext());
