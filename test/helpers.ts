import type { APIGatewayProxyEventV2 } from "aws-lambda";
import type { AppContext } from "../src/context";
import { eventPk, routePk, routeSk } from "../src/lib/keys";
import type { EnqueueFn, Stores } from "../src/lib/stores";
import type { BridgeSecrets, ForwardJob, RouteRecord, ThreadRecord } from "../src/lib/types";
import { slackSignature } from "../src/adapters/slack";

export const NOW_MS = Date.parse("2026-11-12T22:00:00.000Z");
export const NOW_UNIX = Math.floor(NOW_MS / 1000);

export const TEST_SECRETS: BridgeSecrets = {
  slackSigningSecret: "slack-signing-secret-test",
  slackBotToken: "xoxb-test-token",
  targetWebhookKey: "target-webhook-key-test",
  callbackSigningSecret: "callback-signing-secret-test",
};

export class MemoryStores implements Stores {
  events = new Map<string, { expiresAt: number }>();
  threads = new Map<string, ThreadRecord>();
  routes = new Map<string, RouteRecord>();

  seedRoute(route: RouteRecord): void {
    this.routes.set(`${routePk(route.platform, route.workspaceId)}|${routeSk(route.channelId)}`, route);
  }

  async tryRecordEvent(
    platform: string,
    eventId: string,
    ttlSeconds: number,
    nowMs: number,
  ): Promise<boolean> {
    const pk = eventPk(platform, eventId);
    if (this.events.has(pk)) return false;
    this.events.set(pk, { expiresAt: Math.floor(nowMs / 1000) + ttlSeconds });
    return true;
  }

  async deleteEvent(platform: string, eventId: string): Promise<void> {
    this.events.delete(eventPk(platform, eventId));
  }

  async getRouteRecord(
    platform: string,
    workspaceId: string,
    channelId: string,
  ): Promise<RouteRecord | null> {
    return this.routes.get(`${routePk(platform, workspaceId)}|${routeSk(channelId)}`) ?? null;
  }

  async putThread(record: ThreadRecord): Promise<void> {
    this.threads.set(record.threadId, record);
  }

  async getThread(threadId: string): Promise<ThreadRecord | null> {
    return this.threads.get(threadId) ?? null;
  }
}

export class MemoryQueue {
  jobs: ForwardJob[] = [];
  failNext = false;
  enqueue: EnqueueFn = async (job) => {
    if (this.failNext) {
      this.failNext = false;
      throw new Error("SQS unavailable");
    }
    this.jobs.push(job);
  };
}

export interface FetchCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

export function createFetchRecorder(handler?: (call: FetchCall) => { status: number; json?: unknown; text?: string }) {
  const calls: FetchCall[] = [];
  const fetchFn: typeof fetch = async (input, init) => {
    const headers: Record<string, string> = {};
    const rawHeaders = init?.headers;
    if (rawHeaders && typeof rawHeaders === "object" && !Array.isArray(rawHeaders) && !(rawHeaders instanceof Headers)) {
      for (const [key, value] of Object.entries(rawHeaders as Record<string, string>)) {
        headers[key.toLowerCase()] = value;
      }
    }
    const call: FetchCall = {
      url: String(input),
      method: init?.method ?? "GET",
      headers,
      body: typeof init?.body === "string" ? init.body : "",
    };
    calls.push(call);
    const result = handler
      ? handler(call)
      : call.url.includes("slack.com")
        ? { status: 200, json: { ok: true } }
        : { status: 200, text: "ok" };
    return {
      ok: result.status >= 200 && result.status < 300,
      status: result.status,
      json: async () => result.json ?? {},
      text: async () => result.text ?? JSON.stringify(result.json ?? {}),
    } as Response;
  };
  return { fetchFn, calls };
}

export function createTestContext(args?: {
  stores?: MemoryStores;
  queue?: MemoryQueue;
  fetchFn?: typeof fetch;
  secrets?: BridgeSecrets;
  defaultTargetWebhookUrl?: string;
  slackBotUserId?: string;
  replyUrl?: string;
  nowMs?: number;
}): { ctx: AppContext; stores: MemoryStores; queue: MemoryQueue } {
  const stores = args?.stores ?? new MemoryStores();
  const queue = args?.queue ?? new MemoryQueue();
  const secrets = args?.secrets ?? TEST_SECRETS;
  return {
    stores,
    queue,
    ctx: {
      stores,
      enqueue: queue.enqueue,
      getSecrets: async () => secrets,
      fetch: args?.fetchFn ?? (async () => {
        throw new Error("fetch not mocked");
      }),
      now: () => args?.nowMs ?? NOW_MS,
      config: {
        replyUrl: args?.replyUrl ?? "https://bridge.example/reply",
        defaultTargetWebhookUrl: args?.defaultTargetWebhookUrl,
        slackBotUserId: args?.slackBotUserId,
        eventTtlSeconds: 172800,
        threadTtlSeconds: 7776000,
      },
    },
  };
}

export function slackEventEnvelope(overrides?: {
  eventId?: string;
  teamId?: string;
  type?: string;
  user?: string;
  text?: string;
  ts?: string;
  threadTs?: string;
  channel?: string;
  botId?: string;
  subtype?: string;
  channelType?: string;
  eventType?: string;
}): Record<string, unknown> {
  return {
    token: "legacy-token",
    team_id: overrides?.teamId ?? "T0123456789",
    api_app_id: "A01",
    type: "event_callback",
    event_id: overrides?.eventId ?? "Ev01ABC",
    event_time: NOW_UNIX,
    event: {
      type: overrides?.eventType ?? "app_mention",
      user: overrides?.user ?? "U111",
      text: overrides?.text ?? "<@UBOT> hello from Slack",
      ts: overrides?.ts ?? "1731448800.000100",
      thread_ts: overrides?.threadTs,
      channel: overrides?.channel ?? "C999",
      channel_type: overrides?.channelType,
      bot_id: overrides?.botId,
      subtype: overrides?.subtype,
    },
  };
}

export function signedSlackApiEvent(body: unknown, args?: { timestamp?: string; secret?: string; skew?: boolean }): APIGatewayProxyEventV2 {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  const timestamp = args?.timestamp ?? String(NOW_UNIX);
  const secret = args?.secret ?? TEST_SECRETS.slackSigningSecret;
  const signature = slackSignature(secret, timestamp, raw);
  return {
    version: "2.0",
    routeKey: "POST /slack/events",
    rawPath: "/slack/events",
    rawQueryString: "",
    headers: {
      "content-type": "application/json",
      "x-slack-request-timestamp": timestamp,
      "x-slack-signature": signature,
    },
    isBase64Encoded: false,
    body: raw,
    requestContext: {
      accountId: "test",
      apiId: "api",
      domainName: "bridge.example",
      domainPrefix: "bridge",
      http: {
        method: "POST",
        path: "/slack/events",
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: "Slackbot",
      },
      requestId: "req-1",
      routeKey: "POST /slack/events",
      stage: "$default",
      time: "12/Nov/2026:22:00:00 +0000",
      timeEpoch: NOW_MS,
    },
  } as APIGatewayProxyEventV2;
}

export function replyApiEvent(args: { thread: string; text: string; token?: string }): APIGatewayProxyEventV2 {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (args.token) {
    headers.authorization = `Bearer ${args.token}`;
  }
  return {
    version: "2.0",
    routeKey: "POST /reply",
    rawPath: "/reply",
    rawQueryString: "",
    headers,
    isBase64Encoded: false,
    body: JSON.stringify({ thread: args.thread, text: args.text }),
    requestContext: {
      accountId: "test",
      apiId: "api",
      domainName: "bridge.example",
      domainPrefix: "bridge",
      http: {
        method: "POST",
        path: "/reply",
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: "grok-bot",
      },
      requestId: "req-2",
      routeKey: "POST /reply",
      stage: "$default",
      time: "12/Nov/2026:22:00:05 +0000",
      timeEpoch: NOW_MS + 5000,
    },
  } as APIGatewayProxyEventV2;
}
