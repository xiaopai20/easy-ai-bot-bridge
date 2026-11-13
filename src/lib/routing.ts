import type { Route, RouteRecord } from "./types";
import type { Stores } from "./stores";

export function toRoute(record: RouteRecord): Route {
  return {
    targetWebhookUrl: record.targetWebhookUrl,
    targetId: record.targetId,
  };
}

/**
 * Channel-specific rows win. A disabled specific row mutes that channel
 * (no fallback). Workspace "*" is next. No global default: that would mix
 * tenants onto one webhook.
 */
export function resolveRoute(args: {
  specific?: RouteRecord | null;
  wildcard?: RouteRecord | null;
}): Route | null {
  if (args.specific) {
    return args.specific.enabled ? toRoute(args.specific) : null;
  }
  if (args.wildcard) {
    return args.wildcard.enabled ? toRoute(args.wildcard) : null;
  }
  return null;
}

export async function lookupRoute(
  stores: Stores,
  args: {
    tenantId: string;
    platform: string;
    workspaceId: string;
    channelId: string;
  },
): Promise<Route | null> {
  const specific = await stores.getRouteRecord(
    args.tenantId,
    args.platform,
    args.workspaceId,
    args.channelId,
  );
  const wildcard =
    specific === null
      ? await stores.getRouteRecord(args.tenantId, args.platform, args.workspaceId, "*")
      : null;
  return resolveRoute({ specific, wildcard });
}
