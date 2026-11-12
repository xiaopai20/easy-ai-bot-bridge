export interface Sender {
  id: string;
  displayName?: string;
  username?: string;
}

export interface Conversation {
  workspaceId: string;
  channelId: string;
  threadTs: string;
}

export interface NormalizedMessage {
  platform: string;
  eventId: string;
  threadId: string;
  text: string;
  sentAt: string;
  sender: Sender;
  conversation: Conversation;
}

export interface ForwardJob {
  message: NormalizedMessage;
  targetWebhookUrl: string;
  targetId?: string;
}

export interface RouteRecord {
  platform: string;
  workspaceId: string;
  /** Channel id, or "*" for a workspace-wide default. */
  channelId: string;
  targetWebhookUrl: string;
  targetId?: string;
  enabled: boolean;
}

export interface Route {
  targetWebhookUrl: string;
  targetId?: string;
}

export interface ThreadRecord {
  threadId: string;
  platform: string;
  workspaceId: string;
  channelId: string;
  threadTs: string;
  targetId?: string;
  createdAt: string;
  expiresAt: number;
}

export interface BridgeSecrets {
  slackSigningSecret: string;
  slackBotToken: string;
  targetWebhookKey: string;
  callbackSigningSecret: string;
  targetWebhookKeys?: Record<string, string>;
}

export interface RuntimeConfig {
  eventsTable: string;
  threadsTable: string;
  routesTable: string;
  queueUrl: string;
  secretArn: string;
  replyUrl: string;
  defaultTargetWebhookUrl?: string;
  slackBotUserId?: string;
  eventTtlSeconds: number;
  threadTtlSeconds: number;
}

export interface BotWebhookPayload {
  thread: string;
  text: string;
  sent_at: string;
  platform: string;
  sender: {
    id: string;
    display_name: string | null;
    username: string | null;
  };
  conversation: {
    workspace_id: string;
    channel_id: string;
    thread_ts: string;
  };
  reply_url: string;
  reply_token: string;
}
