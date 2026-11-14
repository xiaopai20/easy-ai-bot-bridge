import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import type { AppContext } from "../context";
import { handleError, HttpError, json, parseJsonBody, pathParts, rawBody } from "../lib/http";
import { actorFromApiEvent } from "../lib/identity";
import { newId } from "../lib/keys";
import {
  assertCanCreateBot,
  assertCanCreateChannel,
  bumpTenantConfig,
  getEffectiveLimits,
  getLimitsSnapshot,
  isAdminEmail,
  LIMIT_FIELDS,
  parseLimitsOverride,
  usageCounts,
} from "../lib/limits";
import { issueOAuthState } from "../lib/oauth-state";
import { invalidateSlackTeamCache, invalidateWidgetTokenCache } from "../lib/settings";
import {
  ensureTenantForUser,
  publishChannelRoute,
  requireOwnedBot,
  requireOwnedChannel,
  removeChannelSideEffects,
  writeChannelRoute,
} from "../lib/tenancy";
import type { ChannelPlatform, TenantLimitsOverride } from "../lib/types";
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
      const parts = pathParts(event);
      const apiIndex = parts.indexOf("api");
      const segs = apiIndex >= 0 ? parts.slice(apiIndex + 1) : parts;

      if (segs[0] === "admin") {
        return await handleAdmin(ctx, method, segs, actor, event, origin);
      }

      const tenant = await ensureTenantForUser(ctx.stores, actor, ctx.now());

      if (method === "GET" && segs.length === 1 && segs[0] === "me") {
        const [snapshot, usage, messages] = await Promise.all([
          getLimitsSnapshot(ctx, tenant.tenantId),
          usageCounts(ctx, tenant.tenantId),
          ctx.stores.getMessageQuotaUsage(tenant.tenantId, ctx.now()),
        ]);
        return json(
          200,
          {
            user: actor,
            tenant,
            isAdmin: isAdminEmail(actor.email, ctx.config.adminEmails),
            limits: snapshot.limits,
            usage,
            messages: { dayCount: messages.dayCount, minuteCount: messages.minuteCount },
          },
          origin,
        );
      }

      if (method === "GET" && segs[0] === "usage") {
        const [snapshot, usage, messages] = await Promise.all([
          getLimitsSnapshot(ctx, tenant.tenantId),
          usageCounts(ctx, tenant.tenantId),
          ctx.stores.getMessageQuotaUsage(tenant.tenantId, ctx.now()),
        ]);
        return json(
          200,
          {
            limits: snapshot.limits,
            override: snapshot.override,
            usage,
            messages: { dayCount: messages.dayCount, minuteCount: messages.minuteCount },
          },
          origin,
        );
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

async function handleAdmin(
  ctx: AppContext,
  method: string,
  segs: string[],
  actor: { userId: string; email: string; name: string },
  event: APIGatewayProxyEventV2,
  origin: string,
): Promise<APIGatewayProxyStructuredResultV2> {
  if (!isAdminEmail(actor.email, ctx.config.adminEmails)) {
    throw new HttpError(403, "Admin only");
  }
  // /api/admin/tenants/:tenantId[/limits]
  if (segs[1] !== "tenants" || !segs[2]) {
    throw new HttpError(404, "Not found");
  }
  const tenantId = segs[2];
  const tenant = await ctx.stores.getTenant(tenantId);
  if (!tenant) {
    throw new HttpError(404, "Tenant not found");
  }

  if (method === "GET" && segs.length === 3) {
    const [snapshot, usage, messages] = await Promise.all([
      getLimitsSnapshot(ctx, tenantId),
      usageCounts(ctx, tenantId),
      ctx.stores.getMessageQuotaUsage(tenantId, ctx.now()),
    ]);
    return json(
      200,
      {
        tenant,
        limits: snapshot.limits,
        override: snapshot.override,
        configVersion: snapshot.configVersion,
        usage,
        messages: { dayCount: messages.dayCount, minuteCount: messages.minuteCount },
      },
      origin,
    );
  }

  if (method === "PATCH" && segs[3] === "limits") {
    const body = asObject(parseJsonBody(rawBody(event)));
    const existing = await ctx.stores.getLimitsRecord(tenantId);
    let override: TenantLimitsOverride = { ...(existing?.override ?? {}) };
    if (body.reset === true) {
      override = {};
    } else {
      const parsed = parseLimitsOverride(body);
      override = { ...override, ...parsed };
      for (const field of LIMIT_FIELDS) {
        if (body[field] === null) {
          delete override[field];
        }
      }
    }
    const record = {
      tenantId,
      configVersion: (existing?.configVersion ?? 0) + 1,
      override,
      updatedAt: new Date(ctx.now()).toISOString(),
    };
    await ctx.stores.putLimitsRecord(record);
    ctx.cache.invalidate(`limits:${tenantId}`);
    const limits = await getEffectiveLimits(ctx, tenantId);
    return json(200, { tenant, limits, override: record.override, configVersion: record.configVersion }, origin);
  }

  throw new HttpError(404, "Not found");
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
    await assertCanCreateBot(ctx, tenantId);
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
      await bumpTenantConfig(ctx, tenantId);
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
    await assertCanCreateChannel(ctx, tenantId);
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
    await publishChannelRoute(ctx, channel, bot);
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
      await publishChannelRoute(ctx, next, bot);
      return json(200, { channel: next }, origin);
    }
    if (method === "DELETE" && segs.length === 2) {
      if (channel.platform === "slack" && channel.slackTeamId) {
        invalidateSlackTeamCache(ctx, channel.slackTeamId);
      }
      if (channel.widgetToken) {
        invalidateWidgetTokenCache(ctx, channel.widgetToken);
      }
      await removeChannelSideEffects(ctx.stores, ctx.tenantSecrets, channel);
      await ctx.stores.deleteChannel(tenantId, channel.channelId);
      await bumpTenantConfig(ctx, tenantId);
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
