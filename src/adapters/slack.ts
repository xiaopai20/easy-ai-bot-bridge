import crypto from "crypto";
import { getHeader, HttpError } from "../lib/http";
import type { NormalizedMessage } from "../lib/types";
import type { InboundResult, PlatformAdapter, VerifyRequestArgs } from "./types";

const MAX_SKEW_SECONDS = 5 * 60;

export function slackSignature(secret: string, timestamp: string, rawBody: string): string {
  const digest = crypto.createHmac("sha256", secret).update(`v0:${timestamp}:${rawBody}`).digest("hex");
  return `v0=${digest}`;
}

export function verifySlackRequest(args: VerifyRequestArgs): void {
  const timestamp = getHeader(args.headers, "x-slack-request-timestamp");
  const signature = getHeader(args.headers, "x-slack-signature");
  if (!timestamp || !signature) {
    throw new HttpError(401, "Missing Slack signature headers");
  }
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) {
    throw new HttpError(401, "Invalid Slack timestamp");
  }
  if (Math.abs(args.nowMs / 1000 - ts) > MAX_SKEW_SECONDS) {
    throw new HttpError(401, "Slack request timestamp too old");
  }
  const expected = slackSignature(args.signingSecret, timestamp, args.rawBody);
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new HttpError(401, "Invalid Slack signature");
  }
}

export function stripLeadingMentions(text: string): string {
  return text.replace(/^(<@[A-Z0-9]+>\s*)+/g, "").trim();
}

function slackTsToIso(ts: string, nowMs: number): string {
  const seconds = Number(ts.split(".")[0]);
  if (!Number.isFinite(seconds)) return new Date(nowMs).toISOString();
  return new Date(seconds * 1000).toISOString();
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") return undefined;
  return value as Record<string, unknown>;
}

export function parseSlackInbound(
  body: unknown,
  options?: { botUserId?: string; nowMs?: number },
): InboundResult {
  const envelope = asRecord(body);
  if (!envelope) {
    throw new HttpError(400, "Invalid JSON body");
  }

  if (envelope.type === "url_verification") {
    if (typeof envelope.challenge !== "string") {
      throw new HttpError(400, "Missing challenge");
    }
    return { kind: "challenge", challenge: envelope.challenge };
  }

  if (envelope.type !== "event_callback") {
    return { kind: "ignore", reason: `unsupported envelope type: ${String(envelope.type)}` };
  }

  const eventId = typeof envelope.event_id === "string" ? envelope.event_id : undefined;
  if (!eventId) {
    throw new HttpError(400, "Missing event_id");
  }

  const event = asRecord(envelope.event);
  if (!event) {
    return { kind: "ignore", reason: "missing event" };
  }

  const type = event.type;
  if (type !== "app_mention" && type !== "message") {
    return { kind: "ignore", reason: `unsupported event type: ${String(type)}` };
  }

  if (type === "message") {
    if (typeof event.subtype === "string" && event.subtype !== "bot_message") {
      return { kind: "ignore", reason: `message subtype ${event.subtype}` };
    }
    if (event.channel_type !== "im") {
      return { kind: "ignore", reason: `channel_type ${String(event.channel_type)}` };
    }
  }

  if (typeof event.bot_id === "string" && event.bot_id.length > 0) {
    return { kind: "ignore", reason: "bot message" };
  }
  if (event.subtype === "bot_message") {
    return { kind: "ignore", reason: "bot_message subtype" };
  }

  const user = typeof event.user === "string" ? event.user : undefined;
  if (options?.botUserId && user === options.botUserId) {
    return { kind: "ignore", reason: "self message" };
  }

  const channel = typeof event.channel === "string" ? event.channel : undefined;
  const ts = typeof event.ts === "string" ? event.ts : undefined;
  if (!channel || !ts) {
    return { kind: "ignore", reason: "missing channel or ts" };
  }

  const teamId =
    (typeof envelope.team_id === "string" && envelope.team_id) ||
    (typeof event.team === "string" && event.team) ||
    "";
  if (!teamId) {
    return { kind: "ignore", reason: "missing team_id" };
  }

  const textRaw = typeof event.text === "string" ? event.text : "";
  const text = stripLeadingMentions(textRaw);
  if (!text) {
    return { kind: "ignore", reason: "empty text" };
  }

  const threadTs = typeof event.thread_ts === "string" ? event.thread_ts : ts;
  const nowMs = options?.nowMs ?? Date.now();

  let displayName: string | undefined;
  let username: string | undefined;
  const profile = asRecord(event.user_profile);
  if (profile) {
    if (typeof profile.display_name === "string" && profile.display_name) {
      displayName = profile.display_name;
    } else if (typeof profile.real_name === "string" && profile.real_name) {
      displayName = profile.real_name;
    }
    if (typeof profile.name === "string" && profile.name) {
      username = profile.name;
    }
  }

  const message: NormalizedMessage = {
    platform: "slack",
    eventId,
    threadId: `slack:${teamId}:${channel}:${threadTs}`,
    text,
    sentAt: slackTsToIso(ts, nowMs),
    sender: { id: user ?? "unknown", displayName, username },
    conversation: {
      workspaceId: teamId,
      channelId: channel,
      threadTs,
    },
  };

  return { kind: "message", message };
}

export const slackAdapter: PlatformAdapter = {
  platform: "slack",
  verifyRequest: verifySlackRequest,
  parseInbound: (body, options) => parseSlackInbound(body, options),
  async postReply(args) {
    const token = args.credentials.slackBotToken;
    if (!token) {
      throw new Error("Missing Slack bot token");
    }
    const response = await args.fetchFn("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        channel: args.target.channelId,
        thread_ts: args.target.threadTs,
        text: args.text,
      }),
    });

    let payload: { ok?: boolean; error?: string } = {};
    try {
      payload = (await response.json()) as { ok?: boolean; error?: string };
    } catch {
      throw new Error(`Slack chat.postMessage failed: HTTP ${response.status}`);
    }
    if (!response.ok || payload.ok !== true) {
      throw new Error(`Slack chat.postMessage failed: ${payload.error ?? `HTTP ${response.status}`}`);
    }
  },
};
