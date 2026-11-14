import type { AppContext } from "../context";
import { lookupRoute } from "./routing";
import type { ChannelRecord, Route, SlackTeamMapping, WidgetTokenMapping } from "./types";

export function routeCacheKey(args: {
  tenantId: string;
  platform: string;
  workspaceId: string;
  channelId: string;
}): string {
  return `route:${args.tenantId}:${args.platform}:${args.workspaceId}:${args.channelId}`;
}

export async function lookupRouteCached(
  ctx: AppContext,
  args: {
    tenantId: string;
    platform: string;
    workspaceId: string;
    channelId: string;
  },
): Promise<Route | null> {
  return ctx.cache.getOrLoad(routeCacheKey(args), ctx.now(), () => lookupRoute(ctx.stores, args));
}

export async function getSlackTeamMappingCached(
  ctx: AppContext,
  teamId: string,
): Promise<SlackTeamMapping | null> {
  return ctx.cache.getOrLoad(`slackteam:${teamId}`, ctx.now(), () =>
    ctx.stores.getSlackTeamMapping(teamId),
  );
}

export async function getWidgetTokenMappingCached(
  ctx: AppContext,
  token: string,
): Promise<WidgetTokenMapping | null> {
  return ctx.cache.getOrLoad(`widget:${token}`, ctx.now(), () =>
    ctx.stores.getWidgetTokenMapping(token),
  );
}

export async function getChannelCached(
  ctx: AppContext,
  tenantId: string,
  channelId: string,
): Promise<ChannelRecord | null> {
  return ctx.cache.getOrLoad(`channel:${tenantId}:${channelId}`, ctx.now(), () =>
    ctx.stores.getChannel(tenantId, channelId),
  );
}

export function invalidateSlackTeamCache(ctx: AppContext, teamId: string): void {
  ctx.cache.invalidate(`slackteam:${teamId}`);
}

export function invalidateWidgetTokenCache(ctx: AppContext, token: string): void {
  ctx.cache.invalidate(`widget:${token}`);
}
