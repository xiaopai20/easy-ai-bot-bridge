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
 * (no fallback). Workspace "*" is next, then the optional env default.
 */
export function resolveRoute(args: {
  specific?: RouteRecord | null;
  wildcard?: RouteRecord | null;
  defaultTargetWebhookUrl?: string;
}): Route | null {
  if (args.specific) {
    return args.specific.enabled ? toRoute(args.specific) : null;
  }
  if (args.wildcard) {
    return args.wildcard.enabled ? toRoute(args.wildcard) : null;
  }
  if (args.defaultTargetWebhookUrl) {
    return { targetWebhookUrl: args.defaultTargetWebhookUrl, targetId: "default" };
  }
  return null;
}

export async function lookupRoute(
  stores: Stores,
  args: {
    platform: string;
    workspaceId: string;
    channelId: string;
    defaultTargetWebhookUrl?: string;
  },
): Promise<Route | null> {
  const specific = await stores.getRouteRecord(args.platform, args.workspaceId, args.channelId);
  const wildcard =
    specific === null
      ? await stores.getRouteRecord(args.platform, args.workspaceId, "*")
      : null;
  return resolveRoute({
    specific,
    wildcard,
    defaultTargetWebhookUrl: args.defaultTargetWebhookUrl,
  });
}
