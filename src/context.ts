import type { Actor, BridgeSecrets, RuntimeConfig } from "./lib/types";
import type { EnqueueFn, Stores, TenantSecrets } from "./lib/stores";

export interface AppContext {
  stores: Stores;
  tenantSecrets: TenantSecrets;
  enqueue: EnqueueFn;
  getSecrets: () => Promise<BridgeSecrets>;
  fetch: typeof fetch;
  now: () => number;
  config: Pick<
    RuntimeConfig,
    | "replyUrl"
    | "apiUrl"
    | "dashboardUrl"
    | "corsOrigin"
    | "slackBotUserId"
    | "eventTtlSeconds"
    | "threadTtlSeconds"
  >;
}

export interface RequestIdentity {
  actorFromEvent?: (event: { headers?: Record<string, string | undefined>; requestContext?: unknown }) => Actor | null;
}
