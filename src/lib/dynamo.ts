import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  botSk,
  channelSk,
  eventPk,
  inboxPk,
  limitsSk,
  mapSk,
  minuteBucket,
  RATE_DAY_TTL_SECONDS,
  rateDayPk,
  routePk,
  routeSk,
  slackTeamPk,
  tenantMetaSk,
  tenantPk,
  threadPk,
  utcDayKey,
  userPk,
  userTenantSk,
  widgetTokenPk,
} from "./keys";
import { emptyLimitsRecord } from "./limits";
import type { Stores } from "./stores";
import type {
  BotRecord,
  ChannelRecord,
  ChannelPlatform,
  InboxMessage,
  RouteRecord,
  SlackTeamMapping,
  TenantLimitsOverride,
  TenantLimitsRecord,
  TenantRecord,
  ThreadRecord,
  WidgetTokenMapping,
} from "./types";

export interface TableNames {
  events: string;
  threads: string;
  routes: string;
  directory: string;
  inbox: string;
}

export class DynamoStores implements Stores {
  constructor(
    private readonly doc: DynamoDBDocumentClient,
    private readonly tables: TableNames,
  ) {}

  async tryRecordEvent(
    tenantId: string,
    platform: string,
    eventId: string,
    ttlSeconds: number,
    nowMs: number,
  ): Promise<boolean> {
    try {
      await this.doc.send(
        new PutCommand({
          TableName: this.tables.events,
          Item: {
            pk: eventPk(tenantId, platform, eventId),
            tenantId,
            platform,
            eventId,
            createdAt: new Date(nowMs).toISOString(),
            expiresAt: Math.floor(nowMs / 1000) + ttlSeconds,
          },
          ConditionExpression: "attribute_not_exists(pk)",
        }),
      );
      return true;
    } catch (err) {
      if (
        err instanceof ConditionalCheckFailedException ||
        (err as { name?: string }).name === "ConditionalCheckFailedException"
      ) {
        return false;
      }
      throw err;
    }
  }

  async deleteEvent(tenantId: string, platform: string, eventId: string): Promise<void> {
    await this.doc.send(
      new DeleteCommand({
        TableName: this.tables.events,
        Key: { pk: eventPk(tenantId, platform, eventId) },
      }),
    );
  }

  async getRouteRecord(
    tenantId: string,
    platform: string,
    workspaceId: string,
    channelId: string,
  ): Promise<RouteRecord | null> {
    const result = await this.doc.send(
      new GetCommand({
        TableName: this.tables.routes,
        Key: { pk: routePk(tenantId, platform, workspaceId), sk: routeSk(channelId) },
      }),
    );
    if (!result.Item) return null;
    const item = result.Item;
    return {
      tenantId: String(item.tenantId ?? tenantId),
      platform: String(item.platform ?? platform),
      workspaceId: String(item.workspaceId ?? workspaceId),
      channelId: String(item.channelId ?? channelId),
      targetWebhookUrl: String(item.targetWebhookUrl ?? ""),
      targetId: typeof item.targetId === "string" ? item.targetId : undefined,
      enabled: item.enabled !== false,
    };
  }

  async putRoute(record: RouteRecord): Promise<void> {
    await this.doc.send(
      new PutCommand({
        TableName: this.tables.routes,
        Item: {
          pk: routePk(record.tenantId, record.platform, record.workspaceId),
          sk: routeSk(record.channelId),
          ...record,
        },
      }),
    );
  }

  async deleteRoute(
    tenantId: string,
    platform: string,
    workspaceId: string,
    channelId: string,
  ): Promise<void> {
    await this.doc.send(
      new DeleteCommand({
        TableName: this.tables.routes,
        Key: { pk: routePk(tenantId, platform, workspaceId), sk: routeSk(channelId) },
      }),
    );
  }

  async putThread(record: ThreadRecord): Promise<void> {
    await this.doc.send(
      new PutCommand({
        TableName: this.tables.threads,
        Item: {
          pk: threadPk(record.tenantId, record.threadId),
          ...record,
        },
      }),
    );
  }

  async upsertThreadAndConsumeLoop(
    record: ThreadRecord,
    loopLimit: number,
    nowMs: number,
  ): Promise<boolean> {
    const key = { pk: threadPk(record.tenantId, record.threadId) };
    const minute = minuteBucket(nowMs);
    const mapping = {
      ":tenantId": record.tenantId,
      ":threadId": record.threadId,
      ":platform": record.platform,
      ":workspaceId": record.workspaceId,
      ":channelId": record.channelId,
      ":threadTs": record.threadTs,
      ":createdAt": record.createdAt,
      ":expiresAt": record.expiresAt,
      ":m": minute,
      ":one": 1,
      ":limit": loopLimit,
    };
    const names = { "#lm": "loopMinute", "#lc": "loopCount" };
    const setMapping =
      "SET tenantId = :tenantId, threadId = :threadId, platform = :platform, workspaceId = :workspaceId, channelId = :channelId, threadTs = :threadTs, createdAt = if_not_exists(createdAt, :createdAt), expiresAt = :expiresAt, #lm = :m";
    if (record.targetId) {
      (mapping as Record<string, unknown>)[":targetId"] = record.targetId;
    }
    const targetSet = record.targetId ? ", targetId = :targetId" : "";

    const sameMinute = async () => {
      await this.doc.send(
        new UpdateCommand({
          TableName: this.tables.threads,
          Key: key,
          UpdateExpression: `${setMapping}${targetSet} ADD #lc :one`,
          ConditionExpression:
            "(attribute_not_exists(#lm) OR #lm = :m) AND (attribute_not_exists(#lc) OR #lc < :limit)",
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: mapping,
        }),
      );
    };
    const rollover = async () => {
      await this.doc.send(
        new UpdateCommand({
          TableName: this.tables.threads,
          Key: key,
          UpdateExpression: `${setMapping}${targetSet}, #lc = :one`,
          ConditionExpression: "attribute_exists(#lm) AND #lm <> :m",
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: mapping,
        }),
      );
    };
    return twoAttemptMinuteUpdate(sameMinute, rollover);
  }

  async getThread(tenantId: string, threadId: string): Promise<ThreadRecord | null> {
    const result = await this.doc.send(
      new GetCommand({
        TableName: this.tables.threads,
        Key: { pk: threadPk(tenantId, threadId) },
      }),
    );
    if (!result.Item) return null;
    const item = result.Item;
    if (String(item.tenantId ?? "") !== tenantId) return null;
    return {
      tenantId,
      threadId: String(item.threadId ?? threadId),
      platform: String(item.platform ?? ""),
      workspaceId: String(item.workspaceId ?? ""),
      channelId: String(item.channelId ?? ""),
      threadTs: String(item.threadTs ?? ""),
      targetId: typeof item.targetId === "string" ? item.targetId : undefined,
      createdAt: String(item.createdAt ?? ""),
      expiresAt: Number(item.expiresAt ?? 0),
    };
  }

  async getTenant(tenantId: string): Promise<TenantRecord | null> {
    const result = await this.doc.send(
      new GetCommand({
        TableName: this.tables.directory,
        Key: { pk: tenantPk(tenantId), sk: tenantMetaSk() },
      }),
    );
    if (!result.Item) return null;
    return {
      tenantId: String(result.Item.tenantId ?? tenantId),
      ownerUserId: String(result.Item.ownerUserId ?? ""),
      ownerEmail: String(result.Item.ownerEmail ?? ""),
      createdAt: String(result.Item.createdAt ?? ""),
    };
  }

  async putTenant(record: TenantRecord): Promise<void> {
    await this.doc.send(
      new PutCommand({
        TableName: this.tables.directory,
        Item: { pk: tenantPk(record.tenantId), sk: tenantMetaSk(), ...record },
      }),
    );
  }

  async getUserTenantId(userId: string): Promise<string | null> {
    const result = await this.doc.send(
      new GetCommand({
        TableName: this.tables.directory,
        Key: { pk: userPk(userId), sk: userTenantSk() },
      }),
    );
    if (!result.Item || typeof result.Item.tenantId !== "string") return null;
    return result.Item.tenantId;
  }

  async putUserTenant(userId: string, tenantId: string): Promise<void> {
    await this.doc.send(
      new PutCommand({
        TableName: this.tables.directory,
        Item: { pk: userPk(userId), sk: userTenantSk(), userId, tenantId },
      }),
    );
  }

  async putBot(record: BotRecord): Promise<void> {
    await this.doc.send(
      new PutCommand({
        TableName: this.tables.directory,
        Item: { pk: tenantPk(record.tenantId), sk: botSk(record.botId), ...record },
      }),
    );
  }

  async getBot(tenantId: string, botId: string): Promise<BotRecord | null> {
    const result = await this.doc.send(
      new GetCommand({
        TableName: this.tables.directory,
        Key: { pk: tenantPk(tenantId), sk: botSk(botId) },
      }),
    );
    if (!result.Item) return null;
    if (String(result.Item.tenantId ?? "") !== tenantId) return null;
    return itemToBot(result.Item, tenantId);
  }

  async listBots(tenantId: string): Promise<BotRecord[]> {
    const result = await this.doc.send(
      new QueryCommand({
        TableName: this.tables.directory,
        KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)",
        ExpressionAttributeValues: { ":pk": tenantPk(tenantId), ":sk": "BOT#" },
      }),
    );
    return (result.Items ?? [])
      .filter((item) => String(item.tenantId ?? "") === tenantId)
      .map((item) => itemToBot(item, tenantId));
  }

  async deleteBot(tenantId: string, botId: string): Promise<void> {
    await this.doc.send(
      new DeleteCommand({
        TableName: this.tables.directory,
        Key: { pk: tenantPk(tenantId), sk: botSk(botId) },
      }),
    );
  }

  async putChannel(record: ChannelRecord): Promise<void> {
    await this.doc.send(
      new PutCommand({
        TableName: this.tables.directory,
        Item: { pk: tenantPk(record.tenantId), sk: channelSk(record.channelId), ...record },
      }),
    );
  }

  async getChannel(tenantId: string, channelId: string): Promise<ChannelRecord | null> {
    const result = await this.doc.send(
      new GetCommand({
        TableName: this.tables.directory,
        Key: { pk: tenantPk(tenantId), sk: channelSk(channelId) },
      }),
    );
    if (!result.Item) return null;
    if (String(result.Item.tenantId ?? "") !== tenantId) return null;
    return itemToChannel(result.Item, tenantId);
  }

  async listChannels(tenantId: string): Promise<ChannelRecord[]> {
    const result = await this.doc.send(
      new QueryCommand({
        TableName: this.tables.directory,
        KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)",
        ExpressionAttributeValues: { ":pk": tenantPk(tenantId), ":sk": "CHANNEL#" },
      }),
    );
    return (result.Items ?? [])
      .filter((item) => String(item.tenantId ?? "") === tenantId)
      .map((item) => itemToChannel(item, tenantId));
  }

  async deleteChannel(tenantId: string, channelId: string): Promise<void> {
    await this.doc.send(
      new DeleteCommand({
        TableName: this.tables.directory,
        Key: { pk: tenantPk(tenantId), sk: channelSk(channelId) },
      }),
    );
  }

  async getSlackTeamMapping(teamId: string): Promise<SlackTeamMapping | null> {
    const result = await this.doc.send(
      new GetCommand({
        TableName: this.tables.directory,
        Key: { pk: slackTeamPk(teamId), sk: mapSk() },
      }),
    );
    if (!result.Item) return null;
    return {
      teamId: String(result.Item.teamId ?? teamId),
      tenantId: String(result.Item.tenantId ?? ""),
      channelId: String(result.Item.channelId ?? ""),
      slackBotUserId:
        typeof result.Item.slackBotUserId === "string" ? result.Item.slackBotUserId : undefined,
    };
  }

  async putSlackTeamMapping(mapping: SlackTeamMapping): Promise<void> {
    await this.doc.send(
      new PutCommand({
        TableName: this.tables.directory,
        Item: { pk: slackTeamPk(mapping.teamId), sk: mapSk(), ...mapping },
        ConditionExpression: "attribute_not_exists(pk) OR tenantId = :tid",
        ExpressionAttributeValues: { ":tid": mapping.tenantId },
      }),
    );
  }

  async deleteSlackTeamMapping(teamId: string): Promise<void> {
    await this.doc.send(
      new DeleteCommand({
        TableName: this.tables.directory,
        Key: { pk: slackTeamPk(teamId), sk: mapSk() },
      }),
    );
  }

  async getWidgetTokenMapping(token: string): Promise<WidgetTokenMapping | null> {
    const result = await this.doc.send(
      new GetCommand({
        TableName: this.tables.directory,
        Key: { pk: widgetTokenPk(token), sk: mapSk() },
      }),
    );
    if (!result.Item) return null;
    return {
      token: String(result.Item.token ?? token),
      tenantId: String(result.Item.tenantId ?? ""),
      channelId: String(result.Item.channelId ?? ""),
    };
  }

  async putWidgetTokenMapping(mapping: WidgetTokenMapping): Promise<void> {
    await this.doc.send(
      new PutCommand({
        TableName: this.tables.directory,
        Item: { pk: widgetTokenPk(mapping.token), sk: mapSk(), ...mapping },
      }),
    );
  }

  async deleteWidgetTokenMapping(token: string): Promise<void> {
    await this.doc.send(
      new DeleteCommand({
        TableName: this.tables.directory,
        Key: { pk: widgetTokenPk(token), sk: mapSk() },
      }),
    );
  }

  async putInboxMessage(message: InboxMessage): Promise<void> {
    await this.doc.send(
      new PutCommand({
        TableName: this.tables.inbox,
        Item: {
          pk: inboxPk(message.tenantId, message.threadId),
          sk: `${message.sentAt}#${message.messageId}`,
          ...message,
        },
      }),
    );
  }

  async listInboxMessages(tenantId: string, threadId: string): Promise<InboxMessage[]> {
    const result = await this.doc.send(
      new QueryCommand({
        TableName: this.tables.inbox,
        KeyConditionExpression: "pk = :pk",
        ExpressionAttributeValues: { ":pk": inboxPk(tenantId, threadId) },
      }),
    );
    return (result.Items ?? [])
      .filter((item) => String(item.tenantId ?? "") === tenantId)
      .map((item) => ({
        tenantId,
        threadId: String(item.threadId ?? threadId),
        messageId: String(item.messageId ?? ""),
        role: item.role === "bot" ? "bot" : "user",
        text: String(item.text ?? ""),
        sentAt: String(item.sentAt ?? ""),
        expiresAt: Number(item.expiresAt ?? 0),
      }));
  }

  async listRoutes(tenantId: string): Promise<RouteRecord[]> {
    const result = await this.doc.send(
      new QueryCommand({
        TableName: this.tables.routes,
        IndexName: "byTenant",
        KeyConditionExpression: "tenantId = :tid",
        ExpressionAttributeValues: { ":tid": tenantId },
      }),
    );
    return (result.Items ?? [])
      .filter((item) => String(item.tenantId ?? "") === tenantId)
      .map((item) => ({
        tenantId,
        platform: String(item.platform ?? ""),
        workspaceId: String(item.workspaceId ?? ""),
        channelId: String(item.channelId ?? ""),
        targetWebhookUrl: String(item.targetWebhookUrl ?? ""),
        targetId: typeof item.targetId === "string" ? item.targetId : undefined,
        enabled: item.enabled !== false,
      }));
  }

  async getLimitsRecord(tenantId: string): Promise<TenantLimitsRecord | null> {
    const result = await this.doc.send(
      new GetCommand({
        TableName: this.tables.directory,
        Key: { pk: tenantPk(tenantId), sk: limitsSk() },
      }),
    );
    if (!result.Item) return null;
    return itemToLimits(result.Item, tenantId);
  }

  async putLimitsRecord(record: TenantLimitsRecord): Promise<void> {
    await this.doc.send(
      new PutCommand({
        TableName: this.tables.directory,
        Item: {
          pk: tenantPk(record.tenantId),
          sk: limitsSk(),
          tenantId: record.tenantId,
          configVersion: record.configVersion,
          override: record.override,
          updatedAt: record.updatedAt,
        },
      }),
    );
  }

  async bumpConfigVersion(tenantId: string, nowMs: number): Promise<number> {
    const existing = await this.getLimitsRecord(tenantId);
    const next: TenantLimitsRecord = existing
      ? {
          ...existing,
          configVersion: existing.configVersion + 1,
          updatedAt: new Date(nowMs).toISOString(),
        }
      : emptyLimitsRecord(tenantId, nowMs);
    await this.putLimitsRecord(next);
    return next.configVersion;
  }

  async tryClaimFlag(pk: string, ttlSeconds: number, nowMs: number): Promise<boolean> {
    try {
      await this.doc.send(
        new PutCommand({
          TableName: this.tables.events,
          Item: {
            pk,
            claimed: true,
            createdAt: new Date(nowMs).toISOString(),
            expiresAt: Math.floor(nowMs / 1000) + ttlSeconds,
          },
          ConditionExpression: "attribute_not_exists(pk)",
        }),
      );
      return true;
    } catch (err) {
      if (
        err instanceof ConditionalCheckFailedException ||
        (err as { name?: string }).name === "ConditionalCheckFailedException"
      ) {
        return false;
      }
      throw err;
    }
  }

  async tryConsumeMessageQuota(
    tenantId: string,
    minuteLimit: number,
    dayLimit: number,
    nowMs: number,
  ): Promise<boolean> {
    const pk = { pk: rateDayPk(tenantId, utcDayKey(nowMs)) };
    const minute = minuteBucket(nowMs);
    const ttl = Math.floor(nowMs / 1000) + RATE_DAY_TTL_SECONDS;
    const values = {
      ":one": 1,
      ":m": minute,
      ":dayLimit": dayLimit,
      ":minuteLimit": minuteLimit,
      ":ttl": ttl,
    };
    const names = { "#d": "dayCount", "#mb": "minuteBucket", "#mc": "minuteCount" };

    const sameMinute = async () => {
      await this.doc.send(
        new UpdateCommand({
          TableName: this.tables.events,
          Key: pk,
          UpdateExpression:
            "ADD #d :one, #mc :one SET #mb = :m, expiresAt = if_not_exists(expiresAt, :ttl)",
          ConditionExpression:
            "(attribute_not_exists(#mb) OR #mb = :m) AND (attribute_not_exists(#d) OR #d < :dayLimit) AND (attribute_not_exists(#mc) OR #mc < :minuteLimit)",
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: values,
        }),
      );
    };
    const rollover = async () => {
      await this.doc.send(
        new UpdateCommand({
          TableName: this.tables.events,
          Key: pk,
          UpdateExpression:
            "ADD #d :one SET #mb = :m, #mc = :one, expiresAt = if_not_exists(expiresAt, :ttl)",
          ConditionExpression: "attribute_exists(#mb) AND #mb <> :m AND #d < :dayLimit",
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: values,
        }),
      );
    };
    return twoAttemptMinuteUpdate(sameMinute, rollover);
  }

  async getMessageQuotaUsage(
    tenantId: string,
    nowMs: number,
  ): Promise<{ dayCount: number; minuteCount: number; minuteBucket: number | null }> {
    const result = await this.doc.send(
      new GetCommand({
        TableName: this.tables.events,
        Key: { pk: rateDayPk(tenantId, utcDayKey(nowMs)) },
      }),
    );
    if (!result.Item) {
      return { dayCount: 0, minuteCount: 0, minuteBucket: null };
    }
    const minute = minuteBucket(nowMs);
    const bucket = typeof result.Item.minuteBucket === "number" ? result.Item.minuteBucket : null;
    return {
      dayCount: Number(result.Item.dayCount ?? 0),
      minuteCount: bucket === minute ? Number(result.Item.minuteCount ?? 0) : 0,
      minuteBucket: bucket,
    };
  }
}

function itemToBot(item: Record<string, unknown>, tenantId: string): BotRecord {
  return {
    tenantId,
    botId: String(item.botId ?? ""),
    name: String(item.name ?? ""),
    webhookUrl: String(item.webhookUrl ?? ""),
    createdAt: String(item.createdAt ?? ""),
  };
}

function isConditionalFail(err: unknown): boolean {
  return (
    err instanceof ConditionalCheckFailedException ||
    (err as { name?: string }).name === "ConditionalCheckFailedException"
  );
}

async function twoAttemptMinuteUpdate(
  sameMinute: () => Promise<void>,
  rollover: () => Promise<void>,
): Promise<boolean> {
  try {
    await sameMinute();
    return true;
  } catch (err) {
    if (!isConditionalFail(err)) throw err;
  }
  try {
    await rollover();
    return true;
  } catch (err) {
    if (!isConditionalFail(err)) throw err;
  }
  try {
    await sameMinute();
    return true;
  } catch (err) {
    if (isConditionalFail(err)) return false;
    throw err;
  }
}

function itemToLimits(item: Record<string, unknown>, tenantId: string): TenantLimitsRecord {
  const raw = item.override;
  const override: TenantLimitsOverride =
    raw && typeof raw === "object" && !Array.isArray(raw) ? { ...(raw as TenantLimitsOverride) } : {};
  return {
    tenantId,
    configVersion: Number(item.configVersion ?? 0),
    override,
    updatedAt: String(item.updatedAt ?? ""),
  };
}

function itemToChannel(item: Record<string, unknown>, tenantId: string): ChannelRecord {
  const platform = String(item.platform ?? "widget") as ChannelPlatform;
  return {
    tenantId,
    channelId: String(item.channelId ?? ""),
    platform: platform === "slack" || platform === "telegram" ? platform : "widget",
    name: String(item.name ?? ""),
    botId: String(item.botId ?? ""),
    enabled: item.enabled !== false,
    slackTeamId: typeof item.slackTeamId === "string" ? item.slackTeamId : undefined,
    slackTeamName: typeof item.slackTeamName === "string" ? item.slackTeamName : undefined,
    slackBotUserId: typeof item.slackBotUserId === "string" ? item.slackBotUserId : undefined,
    widgetToken: typeof item.widgetToken === "string" ? item.widgetToken : undefined,
    createdAt: String(item.createdAt ?? ""),
  };
}
