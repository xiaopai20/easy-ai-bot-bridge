export type ChannelPlatform = "slack" | "widget" | "telegram";

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
  tenantId: string;
  botId?: string;
  message: NormalizedMessage;
  targetWebhookUrl: string;
  targetId?: string;
}

export interface RouteRecord {
  tenantId: string;
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
  tenantId: string;
  threadId: string;
  platform: string;
  workspaceId: string;
  channelId: string;
  threadTs: string;
  targetId?: string;
  createdAt: string;
  expiresAt: number;
}

export interface TenantRecord {
  tenantId: string;
  ownerUserId: string;
  ownerEmail: string;
  createdAt: string;
}

export interface TenantLimits {
  maxBots: number;
  maxChannels: number;
  maxRoutes: number;
  messagesPerMinute: number;
  messagesPerDay: number;
  loopMessagesPerThreadPerMinute: number;
}

export type TenantLimitsOverride = Partial<TenantLimits>;

export interface TenantLimitsRecord {
  tenantId: string;
  configVersion: number;
  override: TenantLimitsOverride;
  updatedAt: string;
}

export interface TenantUsage {
  bots: number;
  channels: number;
  routes: number;
}

export interface BotRecord {
  tenantId: string;
  botId: string;
  name: string;
  webhookUrl: string;
  createdAt: string;
}

export interface ChannelRecord {
  tenantId: string;
  channelId: string;
  platform: ChannelPlatform;
  name: string;
  botId: string;
  enabled: boolean;
  slackTeamId?: string;
  slackTeamName?: string;
  slackBotUserId?: string;
  widgetToken?: string;
  createdAt: string;
}

export interface SlackTeamMapping {
  teamId: string;
  tenantId: string;
  channelId: string;
  slackBotUserId?: string;
}

export interface WidgetTokenMapping {
  token: string;
  tenantId: string;
  channelId: string;
}

export interface InboxMessage {
  tenantId: string;
  threadId: string;
  messageId: string;
  role: "user" | "bot";
  text: string;
  sentAt: string;
  expiresAt: number;
}

export interface BridgeSecrets {
  slackSigningSecret: string;
  callbackSigningSecret: string;
  slackBotToken?: string;
  targetWebhookKey?: string;
  slackClientId?: string;
  slackClientSecret?: string;
  targetWebhookKeys?: Record<string, string>;
}

export interface RuntimeConfig {
  eventsTable: string;
  threadsTable: string;
  routesTable: string;
  directoryTable: string;
  inboxTable: string;
  queueUrl: string;
  secretArn: string;
  replyUrl: string;
  apiUrl: string;
  dashboardUrl: string;
  tenantSecretPrefix: string;
  tenantKmsKeyId?: string;
  corsOrigin: string;
  slackBotUserId?: string;
  eventTtlSeconds: number;
  threadTtlSeconds: number;
  defaultLimits: TenantLimits;
  adminEmails: string[];
  settingsCacheTtlSeconds: number;
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

export interface Actor {
  userId: string;
  email: string;
  name: string;
}
