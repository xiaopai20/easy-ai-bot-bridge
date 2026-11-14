import type { AppContext } from "../context";
import { HttpError } from "./http";
import type { TenantLimits, TenantLimitsOverride, TenantLimitsRecord } from "./types";

export const DEFAULT_LIMITS: TenantLimits = {
  maxBots: 5,
  maxChannels: 5,
  maxRoutes: 20,
  messagesPerMinute: 120,
  messagesPerDay: 10_000,
  loopMessagesPerThreadPerMinute: 20,
};

export const LIMIT_FIELDS: Array<keyof TenantLimits> = [
  "maxBots",
  "maxChannels",
  "maxRoutes",
  "messagesPerMinute",
  "messagesPerDay",
  "loopMessagesPerThreadPerMinute",
];

export function mergeLimits(
  defaults: TenantLimits,
  override?: TenantLimitsOverride | null,
): TenantLimits {
  const merged = { ...defaults };
  if (!override) return merged;
  for (const field of LIMIT_FIELDS) {
    const value = override[field];
    if (typeof value === "number" && Number.isFinite(value) && value >= 1) {
      merged[field] = Math.floor(value);
    }
  }
  return merged;
}

export function parseLimitsOverride(body: Record<string, unknown>): TenantLimitsOverride {
  const override: TenantLimitsOverride = {};
  for (const field of LIMIT_FIELDS) {
    if (!(field in body) || body[field] === null || body[field] === "") {
      continue;
    }
    const raw = body[field];
    const value = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(value) || value < 1 || !Number.isInteger(value)) {
      throw new HttpError(400, `${field} must be a positive integer`);
    }
    override[field] = value;
  }
  return override;
}

export function isAdminEmail(email: string, allowlist: string[]): boolean {
  if (!email || allowlist.length === 0) return false;
  return allowlist.includes(email.trim().toLowerCase());
}

export function parseAdminEmails(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length > 0);
}

export async function getEffectiveLimits(ctx: AppContext, tenantId: string): Promise<TenantLimits> {
  return ctx.cache.getOrLoad(`limits:${tenantId}`, ctx.now(), async () => {
    const record = await ctx.stores.getLimitsRecord(tenantId);
    return mergeLimits(ctx.config.defaultLimits, record?.override);
  });
}

export async function getLimitsSnapshot(
  ctx: AppContext,
  tenantId: string,
): Promise<{ limits: TenantLimits; override: TenantLimitsOverride; configVersion: number }> {
  const record = await ctx.stores.getLimitsRecord(tenantId);
  return {
    limits: mergeLimits(ctx.config.defaultLimits, record?.override),
    override: record?.override ?? {},
    configVersion: record?.configVersion ?? 0,
  };
}

export async function usageCounts(
  ctx: AppContext,
  tenantId: string,
): Promise<{ bots: number; channels: number; routes: number }> {
  const [bots, channels, routes] = await Promise.all([
    ctx.stores.listBots(tenantId),
    ctx.stores.listChannels(tenantId),
    ctx.stores.listRoutes(tenantId),
  ]);
  return { bots: bots.length, channels: channels.length, routes: routes.length };
}

export async function assertCanCreateBot(ctx: AppContext, tenantId: string): Promise<TenantLimits> {
  const limits = await getEffectiveLimits(ctx, tenantId);
  const bots = await ctx.stores.listBots(tenantId);
  if (bots.length >= limits.maxBots) {
    throw new HttpError(400, `Bot limit reached (${limits.maxBots})`);
  }
  return limits;
}

export async function assertCanCreateChannel(ctx: AppContext, tenantId: string): Promise<TenantLimits> {
  const limits = await getEffectiveLimits(ctx, tenantId);
  const channels = await ctx.stores.listChannels(tenantId);
  if (channels.length >= limits.maxChannels) {
    throw new HttpError(400, `Channel limit reached (${limits.maxChannels})`);
  }
  return limits;
}

export async function assertCanCreateRoute(
  ctx: AppContext,
  tenantId: string,
  args: { platform: string; workspaceId: string; channelId: string },
): Promise<void> {
  const existing = await ctx.stores.getRouteRecord(
    tenantId,
    args.platform,
    args.workspaceId,
    args.channelId,
  );
  if (existing) return;
  const limits = await getEffectiveLimits(ctx, tenantId);
  const routes = await ctx.stores.listRoutes(tenantId);
  if (routes.length >= limits.maxRoutes) {
    throw new HttpError(400, `Route limit reached (${limits.maxRoutes})`);
  }
}

export async function bumpTenantConfig(ctx: AppContext, tenantId: string): Promise<void> {
  await ctx.stores.bumpConfigVersion(tenantId, ctx.now());
  ctx.cache.invalidate(`limits:${tenantId}`);
  ctx.cache.invalidatePrefix(`route:${tenantId}:`);
  ctx.cache.invalidatePrefix(`channel:${tenantId}:`);
}

export function emptyLimitsRecord(tenantId: string, nowMs: number): TenantLimitsRecord {
  return {
    tenantId,
    configVersion: 1,
    override: {},
    updatedAt: new Date(nowMs).toISOString(),
  };
}
