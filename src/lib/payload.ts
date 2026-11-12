import type { BotWebhookPayload, NormalizedMessage } from "./types";

export function buildBotPayload(args: {
  message: NormalizedMessage;
  replyUrl: string;
  replyToken: string;
}): BotWebhookPayload {
  return {
    thread: args.message.threadId,
    text: args.message.text,
    sent_at: args.message.sentAt,
    platform: args.message.platform,
    sender: {
      id: args.message.sender.id,
      display_name: args.message.sender.displayName ?? null,
      username: args.message.sender.username ?? null,
    },
    conversation: {
      workspace_id: args.message.conversation.workspaceId,
      channel_id: args.message.conversation.channelId,
      thread_ts: args.message.conversation.threadTs,
    },
    reply_url: args.replyUrl,
    reply_token: args.replyToken,
  };
}
