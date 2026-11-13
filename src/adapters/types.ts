/**
 * Thin per-platform adapter. The ingest / forwarder / reply Lambdas stay
 * platform-agnostic; a new chat network (Telegram, Discord, ...) only needs
 * to implement this interface and register itself.
 */
export interface VerifyRequestArgs {
  headers: Record<string, string | undefined>;
  rawBody: string;
  signingSecret: string;
  nowMs: number;
}

export interface ReplyTarget {
  workspaceId: string;
  channelId: string;
  threadTs: string;
}

export interface PlatformCredentials {
  slackBotToken?: string;
  telegramBotToken?: string;
}

export type InboundResult =
  | { kind: "challenge"; challenge: string }
  | { kind: "ignore"; reason: string }
  | { kind: "message"; message: import("../lib/types").NormalizedMessage };

export interface PlatformAdapter {
  readonly platform: string;
  /** Throws HttpError(401) if the request is not authentic. */
  verifyRequest(args: VerifyRequestArgs): void;
  parseInbound(
    body: unknown,
    options?: { botUserId?: string },
  ): InboundResult;
  postReply(args: {
    target: ReplyTarget;
    text: string;
    credentials: PlatformCredentials;
    fetchFn: typeof fetch;
  }): Promise<void>;
}
