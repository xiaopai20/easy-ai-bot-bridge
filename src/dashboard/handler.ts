import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import type { AppContext } from "../context";
import { handleError, HttpError, json, parseJsonBody, pathParts, rawBody } from "../lib/http";
import { actorFromApiEvent } from "../lib/identity";
import { newId } from "../lib/keys";
import { issueOAuthState } from "../lib/oauth-state";
import {
  ensureTenantForUser,
  requireOwnedBot,
  requireOwnedChannel,
  writeChannelRoute,
  removeChannelSideEffects,
} from "../lib/tenancy";
import type { ChannelPlatform } from "../lib/types";
import { createRuntimeContext } from "../runtime";

export function createDashboardHandler(ctx: AppContext) {
  return async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> => {
    const origin = ctx.config.corsOrigin;
    try {
      const method = event.requestContext.http.method.toUpperCase();
      if (method === "OPTIONS") {
        return json(204, {}, origin);
      }
      const actor = actorFromApiEvent(event);
      const tenant = await ensureTenantForUser(ctx.stores, actor, ctx.now());
      const parts = pathParts(event);
      // /api/...
      const apiIndex = parts.indexOf("api");
      const segs = apiIndex >= 0 ? parts.slice(apiIndex + 1) : parts;

      if (method === "GET" && segs.length === 1 && segs[0] === "me") {
        return json(200, { user: actor, tenant }, origin);
      }

      if (segs[0] === "bots") {
        return await handleBots(ctx, method, segs, tenant.tenantId, event, origin);
      }
      if (segs[0] === "channels") {
        return await handleChannels(ctx, method, segs, tenant.tenantId, event, origin);
      }
      if (method === "GET" && segs[0] === "slack" && segs[1] === "install-url") {
        const secrets = await ctx.getSecrets();
        if (!secrets.slackClientId) {
          throw new HttpError(400, "Slack OAuth is not configured on this deployment");
        }
        const state = issueOAuthState({
          tenantId: tenant.tenantId,
          userId: actor.userId,
          secret: secrets.callbackSigningSecret,
          nowMs: ctx.now(),
        });
        const redirect = `${ctx.config.apiUrl.replace(/\/+$/, "")}/slack/oauth/callback`;
        const scopes = ["app_mentions:read", "chat:write", "im:history", "im:read"].join(",");
        const url =
          `https://slack.com/oauth/v2/authorize?client_id=${encodeURIComponent(secrets.slackClientId)}` +
          `&scope=${encodeURIComponent(scopes)}` +
          `&redirect_uri=${encodeURIComponent(redirect)}` +
          `&state=${encodeURIComponent(state)}`;
        return json(200, { url }, origin);
      }

      throw new HttpError(404, "Not found");
    } catch (err) {
      return handleError(err, origin);
    }
  };
}

async function handleBots(
  ctx: AppContext,
  method: string,
  segs: string[],
  tenantId: string,
  event: APIGatewayProxyEventV2,
  origin: string,
): Promise<APIGatewayProxyStructuredResultV2> {
  if (method === "GET" && segs.length === 1) {
    const bots = await ctx.stores.listBots(tenantId);
    return json(200, { bots }, origin);
  }
  if (method === "POST" && segs.length === 1) {
    const body = asObject(parseJsonBody(rawBody(event)));
    const name = stringField(body, "name");
    const webhookUrl = stringField(body, "webhookUrl");
    const webhookKey = stringField(body, "webhookKey");
    if (!name || !webhookUrl || !webhookKey) {
      throw new HttpError(400, "name, webhookUrl, and webhookKey are required");
    }
    const bot = {
      tenantId,
      botId: newId("bot"),
      name,
      webhookUrl,
      createdAt: new Date(ctx.now()).toISOString(),
    };
    await ctx.stores.putBot(bot);
    await ctx.tenantSecrets.putBotKey(tenantId, bot.botId, webhookKey);
    return json(201, { bot }, origin);
  }
  if (segs.length === 2) {
    const bot = await requireOwnedBot(ctx.stores, tenantId, segs[1]);
    if (method === "GET") {
      return json(200, { bot }, origin);
    }
    if (method === "PATCH") {
      const body = asObject(parseJsonBody(rawBody(event)));
      const next = {
        ...bot,
        name: stringField(body, "name") || bot.name,
        webhookUrl: stringField(body, "webhookUrl") || bot.webhookUrl,
      };
      await ctx.stores.putBot(next);
      const newKey = stringField(body, "webhookKey");
      if (newKey) {
        await ctx.tenantSecrets.putBotKey(tenantId, bot.botId, newKey);
      }
      const channels = await ctx.stores.listChannels(tenantId);
      for (const channel of channels) {
        if (channel.botId === bot.botId) {
          await writeChannelRoute(ctx.stores, channel, next);
        }
      }
      return json(200, { bot: next }, origin);
    }
    if (method === "DELETE") {
      const channels = await ctx.stores.listChannels(tenantId);
      if (channels.some((channel) => channel.botId === bot.botId)) {
        throw new HttpError(409, "Bot is still linked to a channel");
      }
      await ctx.stores.deleteBot(tenantId, bot.botId);
      await ctx.tenantSecrets.deleteBotKey(tenantId, bot.botId);
      return json(200, { ok: true }, origin);
    }
  }
  throw new HttpError(404, "Not found");
}

async function handleChannels(
  ctx: AppContext,
  method: string,
  segs: string[],
  tenantId: string,
  event: APIGatewayProxyEventV2,
  origin: string,
): Promise<APIGatewayProxyStructuredResultV2> {
  if (method === "GET" && segs.length === 1) {
    const channels = await ctx.stores.listChannels(tenantId);
    return json(200, { channels }, origin);
  }
  if (method === "POST" && segs.length === 1) {
    const body = asObject(parseJsonBody(rawBody(event)));
    const platform = stringField(body, "platform") as ChannelPlatform;
    const name = stringField(body, "name");
    const botId = stringField(body, "botId");
    if (!name || !botId || (platform !== "widget" && platform !== "telegram")) {
      throw new HttpError(400, "name, botId, and platform (widget|telegram) are required");
    }
    const bot = await requireOwnedBot(ctx.stores, tenantId, botId);
    const channelId = newId("ch");
    const widgetToken = platform === "widget" ? newId("wgt") : undefined;
    const channel = {
      tenantId,
      channelId,
      platform,
      name,
      botId,
      enabled: true,
      widgetToken,
      createdAt: new Date(ctx.now()).toISOString(),
    };
    await ctx.stores.putChannel(channel);
    if (widgetToken) {
      await ctx.stores.putWidgetTokenMapping({ token: widgetToken, tenantId, channelId });
    }
    await writeChannelRoute(ctx.stores, channel, bot);
    return json(201, { channel }, origin);
  }
  if (segs.length >= 2) {
    const channel = await requireOwnedChannel(ctx.stores, tenantId, segs[1]);
    if (method === "GET" && segs.length === 2) {
      return json(200, { channel }, origin);
    }
    if (method === "GET" && segs[2] === "embed") {
      if (channel.platform !== "widget" || !channel.widgetToken) {
        throw new HttpError(400, "Embed is only available for website widgets");
      }
      const api = ctx.config.apiUrl.replace(/\/+$/, "");
      const snippet = `<script src="${api}/widget.js" data-token="${channel.widgetToken}" data-api="${api}"></script>`;
      return json(200, { token: channel.widgetToken, snippet }, origin);
    }
    if (method === "POST" && segs[2] === "link") {
      const body = asObject(parseJsonBody(rawBody(event)));
      const botId = stringField(body, "botId");
      if (!botId) throw new HttpError(400, "botId is required");
      const bot = await requireOwnedBot(ctx.stores, tenantId, botId);
      const next = { ...channel, botId };
      await ctx.stores.putChannel(next);
      await writeChannelRoute(ctx.stores, next, bot);
      return json(200, { channel: next }, origin);
    }
    if (method === "DELETE" && segs.length === 2) {
      await removeChannelSideEffects(ctx.stores, ctx.tenantSecrets, channel);
      await ctx.stores.deleteChannel(tenantId, channel.channelId);
      return json(200, { ok: true }, origin);
    }
  }
  throw new HttpError(404, "Not found");
}

function asObject(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object") {
    throw new HttpError(400, "Invalid JSON body");
  }
  return body as Record<string, unknown>;
}

function stringField(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  return typeof value === "string" ? value.trim() : "";
}

export const handler = createDashboardHandler(createRuntimeContext());
