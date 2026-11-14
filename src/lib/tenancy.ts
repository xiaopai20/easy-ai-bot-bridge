import type { AppContext } from "../context";
import { HttpError } from "./http";
import { newId } from "./keys";
import { assertCanCreateRoute, bumpTenantConfig } from "./limits";
import { invalidateSlackTeamCache, invalidateWidgetTokenCache } from "./settings";
import type { Stores, TenantSecrets } from "./stores";
import type { Actor, BotRecord, ChannelRecord, TenantRecord } from "./types";

export async function ensureTenantForUser(
  stores: Stores,
  actor: Actor,
  nowMs: number,
): Promise<TenantRecord> {
  const existingId = await stores.getUserTenantId(actor.userId);
  if (existingId) {
    const tenant = await stores.getTenant(existingId);
    if (tenant) return tenant;
  }
  const tenant: TenantRecord = {
    tenantId: newId("t"),
    ownerUserId: actor.userId,
    ownerEmail: actor.email,
    createdAt: new Date(nowMs).toISOString(),
  };
  await stores.putTenant(tenant);
  await stores.putUserTenant(actor.userId, tenant.tenantId);
  return tenant;
}

export async function requireOwnedBot(
  stores: Stores,
  tenantId: string,
  botId: string,
): Promise<BotRecord> {
  const bot = await stores.getBot(tenantId, botId);
  if (!bot) {
    throw new HttpError(404, "Bot not found");
  }
  return bot;
}

export async function requireOwnedChannel(
  stores: Stores,
  tenantId: string,
  channelId: string,
): Promise<ChannelRecord> {
  const channel = await stores.getChannel(tenantId, channelId);
  if (!channel) {
    throw new HttpError(404, "Channel not found");
  }
  return channel;
}

export function routeCoords(
  channel: ChannelRecord,
): { platform: string; workspaceId: string; channelId: string } | null {
  if (channel.platform === "telegram") {
    return null;
  }
  const workspaceId =
    channel.platform === "slack" ? (channel.slackTeamId ?? channel.channelId) : channel.channelId;
  const channelId = channel.platform === "slack" ? "*" : channel.channelId;
  return { platform: channel.platform, workspaceId, channelId };
}

export async function writeChannelRoute(
  stores: Stores,
  channel: ChannelRecord,
  bot: BotRecord,
): Promise<void> {
  const coords = routeCoords(channel);
  if (!coords) {
    return;
  }
  await stores.putRoute({
    tenantId: channel.tenantId,
    platform: coords.platform,
    workspaceId: coords.workspaceId,
    channelId: coords.channelId,
    targetWebhookUrl: bot.webhookUrl,
    targetId: bot.botId,
    enabled: channel.enabled,
  });
}

export async function publishChannelRoute(
  ctx: AppContext,
  channel: ChannelRecord,
  bot: BotRecord,
): Promise<void> {
  const coords = routeCoords(channel);
  if (coords) {
    await assertCanCreateRoute(ctx, channel.tenantId, coords);
  }
  await writeChannelRoute(ctx.stores, channel, bot);
  await bumpTenantConfig(ctx, channel.tenantId);
  if (channel.platform === "slack" && channel.slackTeamId) {
    invalidateSlackTeamCache(ctx, channel.slackTeamId);
  }
  if (channel.widgetToken) {
    invalidateWidgetTokenCache(ctx, channel.widgetToken);
  }
}

export async function removeChannelSideEffects(
  stores: Stores,
  secrets: TenantSecrets,
  channel: ChannelRecord,
): Promise<void> {
  if (channel.platform === "slack" && channel.slackTeamId) {
    const mapping = await stores.getSlackTeamMapping(channel.slackTeamId);
    if (mapping && mapping.tenantId === channel.tenantId) {
      await stores.deleteSlackTeamMapping(channel.slackTeamId);
      await secrets.deleteSlackToken(channel.tenantId, channel.slackTeamId);
      await stores.deleteRoute(channel.tenantId, "slack", channel.slackTeamId, "*");
    }
  }
  if (channel.platform === "widget" && channel.widgetToken) {
    await stores.deleteWidgetTokenMapping(channel.widgetToken);
    await stores.deleteRoute(channel.tenantId, "widget", channel.channelId, channel.channelId);
  }
}
