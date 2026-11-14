import crypto from "crypto";

export const MAX_SKEW_SECONDS = 5 * 60;
export const WEBHOOK_TIMEOUT_MS = 2500;

export class SlackAuthError extends Error {
  readonly statusCode = 401;
  constructor(message: string) {
    super(message);
    this.name = "SlackAuthError";
  }
}

export function getHeader(
  headers: Record<string, string | undefined> | undefined,
  name: string,
): string | undefined {
  if (!headers) return undefined;
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) return value;
  }
  return undefined;
}

export function slackSignature(secret: string, timestamp: string, rawBody: string): string {
  const digest = crypto.createHmac("sha256", secret).update(`v0:${timestamp}:${rawBody}`).digest("hex");
  return `v0=${digest}`;
}

export function verifySlackRequest(args: {
  headers: Record<string, string | undefined> | undefined;
  rawBody: string;
  signingSecret: string;
  nowMs: number;
}): void {
  const timestamp = getHeader(args.headers, "x-slack-request-timestamp");
  const signature = getHeader(args.headers, "x-slack-signature");
  if (!timestamp || !signature) {
    throw new SlackAuthError("Missing Slack signature headers");
  }
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) {
    throw new SlackAuthError("Invalid Slack timestamp");
  }
  if (Math.abs(args.nowMs / 1000 - ts) > MAX_SKEW_SECONDS) {
    throw new SlackAuthError("Slack request timestamp too old");
  }
  const expected = slackSignature(args.signingSecret, timestamp, args.rawBody);
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new SlackAuthError("Invalid Slack signature");
  }
}

export function stripLeadingMentions(text: string): string {
  return text.replace(/^(<@[A-Z0-9]+>\s*)+/g, "").trim();
}

export interface SlackForwardPayload {
  source: "slack";
  team: string;
  channel: string;
  user: string;
  text: string;
  ts: string;
  thread_ts: string;
  event_id: string;
}

export type SlackParseResult =
  | { kind: "challenge"; challenge: string }
  | { kind: "ignore"; reason: string }
  | { kind: "forward"; payload: SlackForwardPayload };

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") return undefined;
  return value as Record<string, unknown>;
}

export function parseSlackEvent(body: unknown): SlackParseResult {
  const envelope = asRecord(body);
  if (!envelope) {
    return { kind: "ignore", reason: "invalid json" };
  }

  if (envelope.type === "url_verification") {
    if (typeof envelope.challenge !== "string") {
      return { kind: "ignore", reason: "missing challenge" };
    }
    return { kind: "challenge", challenge: envelope.challenge };
  }

  if (envelope.type !== "event_callback") {
    return { kind: "ignore", reason: `unsupported envelope type: ${String(envelope.type)}` };
  }

  const eventId = typeof envelope.event_id === "string" ? envelope.event_id : "";
  const event = asRecord(envelope.event);
  if (!event) {
    return { kind: "ignore", reason: "missing event" };
  }

  if (typeof event.bot_id === "string" && event.bot_id.length > 0) {
    return { kind: "ignore", reason: "bot message" };
  }
  if (event.subtype === "bot_message") {
    return { kind: "ignore", reason: "bot_message subtype" };
  }

  const type = event.type;
  const isMention = type === "app_mention";
  const isIm = type === "message" && event.channel_type === "im";
  if (!isMention && !isIm) {
    return { kind: "ignore", reason: `unsupported event type: ${String(type)}` };
  }

  const team =
    (typeof envelope.team_id === "string" && envelope.team_id) ||
    (typeof event.team === "string" && event.team) ||
    "";
  const channel = typeof event.channel === "string" ? event.channel : "";
  const user = typeof event.user === "string" ? event.user : "";
  const ts = typeof event.ts === "string" ? event.ts : "";
  if (!team || !channel || !ts) {
    return { kind: "ignore", reason: "missing team, channel, or ts" };
  }

  const text = stripLeadingMentions(typeof event.text === "string" ? event.text : "");
  const threadTs = typeof event.thread_ts === "string" ? event.thread_ts : ts;

  return {
    kind: "forward",
    payload: {
      source: "slack",
      team,
      channel,
      user,
      text,
      ts,
      thread_ts: threadTs,
      event_id: eventId,
    },
  };
}
