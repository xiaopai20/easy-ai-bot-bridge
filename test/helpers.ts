import type { APIGatewayProxyEventV2 } from "aws-lambda";
import type { AppContext } from "../src/context";
import {
  botSk,
  channelSk,
  eventPk,
  inboxPk,
  routePk,
  routeSk,
  slackTeamPk,
  tenantPk,
  threadPk,
  userPk,
  widgetTokenPk,
} from "../src/lib/keys";
import type { EnqueueFn, Stores } from "../src/lib/stores";
import { MemoryTenantSecrets } from "../src/lib/tenant-secrets";
import type {
  BotRecord,
  BridgeSecrets,
  ChannelRecord,
  ForwardJob,
  InboxMessage,
  RouteRecord,
  SlackTeamMapping,
  TenantRecord,
  ThreadRecord,
  WidgetTokenMapping,
} from "../src/lib/types";
import { slackSignature } from "../src/adapters/slack";

export const NOW_MS = Date.parse("2026-11-12T22:00:00.000Z");
export const NOW_UNIX = Math.floor(NOW_MS / 1000);
export const TENANT_A = "t-tenant-a";
export const TENANT_B = "t-tenant-b";
export const USER_A = "user-a";
export const USER_B = "user-b";

export const TEST_SECRETS: BridgeSecrets = {
  slackSigningSecret: "slack-signing-secret-test",
  slackBotToken: "xoxb-test-token",
  targetWebhookKey: "target-webhook-key-test",
  callbackSigningSecret: "callback-signing-secret-test",
  slackClientId: "slack-client-id",
  slackClientSecret: "slack-client-secret",
};

export class MemoryStores implements Stores {
  events = new Map<string, { expiresAt: number }>();
  threads = new Map<string, ThreadRecord>();
  routes = new Map<string, RouteRecord>();
  tenants = new Map<string, TenantRecord>();
  userTenants = new Map<string, string>();
  bots = new Map<string, BotRecord>();
  channels = new Map<string, ChannelRecord>();
  slackTeams = new Map<string, SlackTeamMapping>();
  widgets = new Map<string, WidgetTokenMapping>();
  inbox = new Map<string, InboxMessage[]>();

  seedRoute(route: RouteRecord): void {
    this.routes.set(
      `${routePk(route.tenantId, route.platform, route.workspaceId)}|${routeSk(route.channelId)}`,
      route,
    );
  }

  seedTenant(tenant: TenantRecord, userId: string): void {
    this.tenants.set(tenant.tenantId, tenant);
    this.userTenants.set(userId, tenant.tenantId);
  }

  async tryRecordEvent(
    tenantId: string,
    platform: string,
    eventId: string,
    ttlSeconds: number,
    nowMs: number,
  ): Promise<boolean> {
    const pk = eventPk(tenantId, platform, eventId);
    if (this.events.has(pk)) return false;
    this.events.set(pk, { expiresAt: Math.floor(nowMs / 1000) + ttlSeconds });
    return true;
  }

  async deleteEvent(tenantId: string, platform: string, eventId: string): Promise<void> {
    this.events.delete(eventPk(tenantId, platform, eventId));
  }

  async getRouteRecord(
    tenantId: string,
    platform: string,
    workspaceId: string,
    channelId: string,
  ): Promise<RouteRecord | null> {
    return (
      this.routes.get(`${routePk(tenantId, platform, workspaceId)}|${routeSk(channelId)}`) ?? null
    );
  }

  async putRoute(record: RouteRecord): Promise<void> {
    this.seedRoute(record);
  }

  async deleteRoute(
    tenantId: string,
    platform: string,
    workspaceId: string,
    channelId: string,
  ): Promise<void> {
    this.routes.delete(`${routePk(tenantId, platform, workspaceId)}|${routeSk(channelId)}`);
  }

  async putThread(record: ThreadRecord): Promise<void> {
    this.threads.set(threadPk(record.tenantId, record.threadId), record);
  }

  async getThread(tenantId: string, threadId: string): Promise<ThreadRecord | null> {
    const record = this.threads.get(threadPk(tenantId, threadId));
    if (!record || record.tenantId !== tenantId) return null;
    return record;
  }

  async getTenant(tenantId: string): Promise<TenantRecord | null> {
    return this.tenants.get(tenantId) ?? null;
  }
  async putTenant(record: TenantRecord): Promise<void> {
    this.tenants.set(record.tenantId, record);
  }
  async getUserTenantId(userId: string): Promise<string | null> {
    return this.userTenants.get(userId) ?? null;
  }
  async putUserTenant(userId: string, tenantId: string): Promise<void> {
    this.userTenants.set(userId, tenantId);
  }

  async putBot(record: BotRecord): Promise<void> {
    this.bots.set(`${record.tenantId}|${botSk(record.botId)}`, record);
  }
  async getBot(tenantId: string, botId: string): Promise<BotRecord | null> {
    const bot = this.bots.get(`${tenantId}|${botSk(botId)}`);
    return bot && bot.tenantId === tenantId ? bot : null;
  }
  async listBots(tenantId: string): Promise<BotRecord[]> {
    return [...this.bots.values()].filter((bot) => bot.tenantId === tenantId);
  }
  async deleteBot(tenantId: string, botId: string): Promise<void> {
    this.bots.delete(`${tenantId}|${botSk(botId)}`);
  }

  async putChannel(record: ChannelRecord): Promise<void> {
    this.channels.set(`${record.tenantId}|${channelSk(record.channelId)}`, record);
  }
  async getChannel(tenantId: string, channelId: string): Promise<ChannelRecord | null> {
    const channel = this.channels.get(`${tenantId}|${channelSk(channelId)}`);
    return channel && channel.tenantId === tenantId ? channel : null;
  }
  async listChannels(tenantId: string): Promise<ChannelRecord[]> {
    return [...this.channels.values()].filter((channel) => channel.tenantId === tenantId);
  }
  async deleteChannel(tenantId: string, channelId: string): Promise<void> {
    this.channels.delete(`${tenantId}|${channelSk(channelId)}`);
  }

  async getSlackTeamMapping(teamId: string): Promise<SlackTeamMapping | null> {
    return this.slackTeams.get(slackTeamPk(teamId)) ?? null;
  }
  async putSlackTeamMapping(mapping: SlackTeamMapping): Promise<void> {
    const existing = this.slackTeams.get(slackTeamPk(mapping.teamId));
    if (existing && existing.tenantId !== mapping.tenantId) {
      const err = new Error("ConditionalCheckFailedException");
      err.name = "ConditionalCheckFailedException";
      throw err;
    }
    this.slackTeams.set(slackTeamPk(mapping.teamId), mapping);
  }
  async deleteSlackTeamMapping(teamId: string): Promise<void> {
    this.slackTeams.delete(slackTeamPk(teamId));
  }

  async getWidgetTokenMapping(token: string): Promise<WidgetTokenMapping | null> {
    return this.widgets.get(widgetTokenPk(token)) ?? null;
  }
  async putWidgetTokenMapping(mapping: WidgetTokenMapping): Promise<void> {
    this.widgets.set(widgetTokenPk(mapping.token), mapping);
  }
  async deleteWidgetTokenMapping(token: string): Promise<void> {
    this.widgets.delete(widgetTokenPk(token));
  }

  async putInboxMessage(message: InboxMessage): Promise<void> {
    const key = inboxPk(message.tenantId, message.threadId);
    const list = this.inbox.get(key) ?? [];
    list.push(message);
    this.inbox.set(key, list);
  }
  async listInboxMessages(tenantId: string, threadId: string): Promise<InboxMessage[]> {
    return (this.inbox.get(inboxPk(tenantId, threadId)) ?? []).filter((m) => m.tenantId === tenantId);
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
  tenantSecrets?: MemoryTenantSecrets;
  fetchFn?: typeof fetch;
  secrets?: BridgeSecrets;
  slackBotUserId?: string;
  replyUrl?: string;
  apiUrl?: string;
  dashboardUrl?: string;
  nowMs?: number;
  seedDefaultSlack?: boolean;
}): { ctx: AppContext; stores: MemoryStores; queue: MemoryQueue; tenantSecrets: MemoryTenantSecrets } {
  const stores = args?.stores ?? new MemoryStores();
  const queue = args?.queue ?? new MemoryQueue();
  const tenantSecrets = args?.tenantSecrets ?? new MemoryTenantSecrets();
  const secrets = args?.secrets ?? TEST_SECRETS;
  if (args?.seedDefaultSlack !== false) {
    stores.slackTeams.set(slackTeamPk("T0123456789"), {
      teamId: "T0123456789",
      tenantId: TENANT_A,
      channelId: "ch-slack-a",
    });
    stores.seedTenant(
      {
        tenantId: TENANT_A,
        ownerUserId: USER_A,
        ownerEmail: "a@example.com",
        createdAt: new Date(NOW_MS).toISOString(),
      },
      USER_A,
    );
  }
  return {
    stores,
    queue,
    tenantSecrets,
    ctx: {
      stores,
      tenantSecrets,
      enqueue: queue.enqueue,
      getSecrets: async () => secrets,
      fetch:
        args?.fetchFn ??
        (async () => {
          throw new Error("fetch not mocked");
        }),
      now: () => args?.nowMs ?? NOW_MS,
      config: {
        replyUrl: args?.replyUrl ?? "https://bridge.example/reply",
        apiUrl: args?.apiUrl ?? "https://bridge.example",
        dashboardUrl: args?.dashboardUrl ?? "https://app.example",
        corsOrigin: "https://app.example",
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

export function signedSlackApiEvent(
  body: unknown,
  args?: { timestamp?: string; secret?: string },
): APIGatewayProxyEventV2 {
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

export function authedApiEvent(args: {
  method: string;
  path: string;
  userId: string;
  email?: string;
  body?: unknown;
}): APIGatewayProxyEventV2 {
  return {
    version: "2.0",
    routeKey: `${args.method} ${args.path}`,
    rawPath: args.path,
    rawQueryString: "",
    headers: { "content-type": "application/json", authorization: "Bearer test" },
    isBase64Encoded: false,
    body: args.body ? JSON.stringify(args.body) : undefined,
    requestContext: {
      accountId: "test",
      apiId: "api",
      domainName: "bridge.example",
      domainPrefix: "bridge",
      http: {
        method: args.method,
        path: args.path,
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: "test",
      },
      requestId: "req-dash",
      routeKey: `${args.method} ${args.path}`,
      stage: "$default",
      time: "12/Nov/2026:22:00:00 +0000",
      timeEpoch: NOW_MS,
      authorizer: {
        jwt: {
          claims: {
            sub: args.userId,
            email: args.email ?? `${args.userId}@example.com`,
            name: args.userId,
          },
        },
      },
    },
  } as unknown as APIGatewayProxyEventV2;
}

void tenantPk;
void userPk;
