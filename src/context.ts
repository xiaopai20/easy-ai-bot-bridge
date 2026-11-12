import type { BridgeSecrets, RuntimeConfig } from "./lib/types";
import type { EnqueueFn, Stores } from "./lib/stores";

export interface AppContext {
  stores: Stores;
  enqueue: EnqueueFn;
  getSecrets: () => Promise<BridgeSecrets>;
  fetch: typeof fetch;
  now: () => number;
  config: Pick<
    RuntimeConfig,
    | "replyUrl"
    | "defaultTargetWebhookUrl"
    | "slackBotUserId"
    | "eventTtlSeconds"
    | "threadTtlSeconds"
  >;
}
