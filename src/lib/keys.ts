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

export function limitsSk(): string {
  return "LIMITS";
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

export function minuteBucket(nowMs: number): number {
  return Math.floor(nowMs / 60_000);
}

export function utcDayKey(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

export function rateDayPk(tenantId: string, day: string): string {
  return `rate#${tenantId}#d#${day}`;
}

export function rateNoticePk(tenantId: string, minute: number): string {
  return `rate#${tenantId}#n#${minute}`;
}

export const RATE_MINUTE_TTL_SECONDS = 120;
export const RATE_DAY_TTL_SECONDS = 2 * 24 * 60 * 60;

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}
