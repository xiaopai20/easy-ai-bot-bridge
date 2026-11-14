import type {
  BotRecord,
  ChannelRecord,
  ForwardJob,
  InboxMessage,
  RouteRecord,
  SlackTeamMapping,
  TenantLimitsRecord,
  TenantRecord,
  ThreadRecord,
  WidgetTokenMapping,
} from "./types";

export interface Stores {
  tryRecordEvent(
    tenantId: string,
    platform: string,
    eventId: string,
    ttlSeconds: number,
    nowMs: number,
  ): Promise<boolean>;
  deleteEvent(tenantId: string, platform: string, eventId: string): Promise<void>;
  getRouteRecord(
    tenantId: string,
    platform: string,
    workspaceId: string,
    channelId: string,
  ): Promise<RouteRecord | null>;
  putRoute(record: RouteRecord): Promise<void>;
  deleteRoute(tenantId: string, platform: string, workspaceId: string, channelId: string): Promise<void>;
  putThread(record: ThreadRecord): Promise<void>;
  getThread(tenantId: string, threadId: string): Promise<ThreadRecord | null>;
  /**
   * Upsert the thread mapping and increment the per-thread loop counter in the
   * same write. Returns false when the loop limit is exceeded.
   */
  upsertThreadAndConsumeLoop(
    record: ThreadRecord,
    loopLimit: number,
    nowMs: number,
  ): Promise<boolean>;

  getTenant(tenantId: string): Promise<TenantRecord | null>;
  putTenant(record: TenantRecord): Promise<void>;
  getUserTenantId(userId: string): Promise<string | null>;
  putUserTenant(userId: string, tenantId: string): Promise<void>;

  putBot(record: BotRecord): Promise<void>;
  getBot(tenantId: string, botId: string): Promise<BotRecord | null>;
  listBots(tenantId: string): Promise<BotRecord[]>;
  deleteBot(tenantId: string, botId: string): Promise<void>;

  putChannel(record: ChannelRecord): Promise<void>;
  getChannel(tenantId: string, channelId: string): Promise<ChannelRecord | null>;
  listChannels(tenantId: string): Promise<ChannelRecord[]>;
  deleteChannel(tenantId: string, channelId: string): Promise<void>;

  getSlackTeamMapping(teamId: string): Promise<SlackTeamMapping | null>;
  putSlackTeamMapping(mapping: SlackTeamMapping): Promise<void>;
  deleteSlackTeamMapping(teamId: string): Promise<void>;

  getWidgetTokenMapping(token: string): Promise<WidgetTokenMapping | null>;
  putWidgetTokenMapping(mapping: WidgetTokenMapping): Promise<void>;
  deleteWidgetTokenMapping(token: string): Promise<void>;

  putInboxMessage(message: InboxMessage): Promise<void>;
  listInboxMessages(tenantId: string, threadId: string): Promise<InboxMessage[]>;

  listRoutes(tenantId: string): Promise<RouteRecord[]>;
  getLimitsRecord(tenantId: string): Promise<TenantLimitsRecord | null>;
  putLimitsRecord(record: TenantLimitsRecord): Promise<void>;
  bumpConfigVersion(tenantId: string, nowMs: number): Promise<number>;
  tryClaimFlag(pk: string, ttlSeconds: number, nowMs: number): Promise<boolean>;
  /** One UpdateItem: per-tenant day item holding dayCount + current minute bucket. */
  tryConsumeMessageQuota(
    tenantId: string,
    minuteLimit: number,
    dayLimit: number,
    nowMs: number,
  ): Promise<boolean>;
  getMessageQuotaUsage(
    tenantId: string,
    nowMs: number,
  ): Promise<{ dayCount: number; minuteCount: number; minuteBucket: number | null }>;
}

export type EnqueueFn = (job: ForwardJob) => Promise<void>;

export interface TenantSecrets {
  putBotKey(tenantId: string, botId: string, key: string): Promise<void>;
  getBotKey(tenantId: string, botId: string): Promise<string | null>;
  deleteBotKey(tenantId: string, botId: string): Promise<void>;
  putSlackToken(tenantId: string, teamId: string, token: string): Promise<void>;
  getSlackToken(tenantId: string, teamId: string): Promise<string | null>;
  deleteSlackToken(tenantId: string, teamId: string): Promise<void>;
}
