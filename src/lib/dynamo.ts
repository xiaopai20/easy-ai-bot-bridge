import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";
import { eventPk, routePk, routeSk, threadPk } from "./keys";
import type { Stores } from "./stores";
import type { RouteRecord, ThreadRecord } from "./types";

export interface TableNames {
  events: string;
  threads: string;
  routes: string;
}

export class DynamoStores implements Stores {
  constructor(
    private readonly doc: DynamoDBDocumentClient,
    private readonly tables: TableNames,
  ) {}

  async tryRecordEvent(
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
            pk: eventPk(platform, eventId),
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
      if (err instanceof ConditionalCheckFailedException || (err as { name?: string }).name === "ConditionalCheckFailedException") {
        return false;
      }
      throw err;
    }
  }

  async deleteEvent(platform: string, eventId: string): Promise<void> {
    await this.doc.send(
      new DeleteCommand({
        TableName: this.tables.events,
        Key: { pk: eventPk(platform, eventId) },
      }),
    );
  }

  async getRouteRecord(
    platform: string,
    workspaceId: string,
    channelId: string,
  ): Promise<RouteRecord | null> {
    const result = await this.doc.send(
      new GetCommand({
        TableName: this.tables.routes,
        Key: { pk: routePk(platform, workspaceId), sk: routeSk(channelId) },
      }),
    );
    if (!result.Item) return null;
    const item = result.Item;
    return {
      platform: String(item.platform ?? platform),
      workspaceId: String(item.workspaceId ?? workspaceId),
      channelId: String(item.channelId ?? channelId),
      targetWebhookUrl: String(item.targetWebhookUrl ?? ""),
      targetId: typeof item.targetId === "string" ? item.targetId : undefined,
      enabled: item.enabled !== false,
    };
  }

  async putThread(record: ThreadRecord): Promise<void> {
    await this.doc.send(
      new PutCommand({
        TableName: this.tables.threads,
        Item: {
          pk: threadPk(record.threadId),
          ...record,
        },
      }),
    );
  }

  async getThread(threadId: string): Promise<ThreadRecord | null> {
    const result = await this.doc.send(
      new GetCommand({
        TableName: this.tables.threads,
        Key: { pk: threadPk(threadId) },
      }),
    );
    if (!result.Item) return null;
    const item = result.Item;
    return {
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
}
