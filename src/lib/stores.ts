import type { ForwardJob, RouteRecord, ThreadRecord } from "./types";

export interface Stores {
  tryRecordEvent(
    platform: string,
    eventId: string,
    ttlSeconds: number,
    nowMs: number,
  ): Promise<boolean>;
  deleteEvent(platform: string, eventId: string): Promise<void>;
  getRouteRecord(
    platform: string,
    workspaceId: string,
    channelId: string,
  ): Promise<RouteRecord | null>;
  putThread(record: ThreadRecord): Promise<void>;
  getThread(threadId: string): Promise<ThreadRecord | null>;
}

export type EnqueueFn = (job: ForwardJob) => Promise<void>;
