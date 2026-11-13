export function eventPk(tenantId: string, platform: string, eventId: string): string {
  return `event#${tenantId}#${platform}#${eventId}`;
}

export function threadPk(tenantId: string, threadId: string): string {
  return `thread#${tenantId}#${threadId}`;
}

export function routePk(tenantId: string, platform: string, workspaceId: string): string {
  return `${tenantId}#${platform}#${workspaceId}`;
}

export function routeSk(channelId: string): string {
  return `channel#${channelId}`;
}

export function tenantPk(tenantId: string): string {
  return `TENANT#${tenantId}`;
}

export function tenantMetaSk(): string {
  return "META";
}

export function botSk(botId: string): string {
  return `BOT#${botId}`;
}

export function channelSk(channelId: string): string {
  return `CHANNEL#${channelId}`;
}

export function userPk(userId: string): string {
  return `USER#${userId}`;
}

export function userTenantSk(): string {
  return "TENANT";
}

export function slackTeamPk(teamId: string): string {
  return `SLACKTEAM#${teamId}`;
}

export function widgetTokenPk(token: string): string {
  return `WIDGET#${token}`;
}

export function mapSk(): string {
  return "MAP";
}

export function inboxPk(tenantId: string, threadId: string): string {
  return `inbox#${tenantId}#${threadId}`;
}

export function composeThreadId(tenantId: string, platformThreadId: string): string {
  return `${tenantId}:${platformThreadId}`;
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}
