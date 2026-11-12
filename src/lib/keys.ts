export function eventPk(platform: string, eventId: string): string {
  return `event#${platform}#${eventId}`;
}

export function threadPk(threadId: string): string {
  return `thread#${threadId}`;
}

export function routePk(platform: string, workspaceId: string): string {
  return `${platform}#${workspaceId}`;
}

export function routeSk(channelId: string): string {
  return `channel#${channelId}`;
}
