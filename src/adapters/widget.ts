import { HttpError } from "../lib/http";
import type { InboundResult, PlatformAdapter } from "./types";

export const widgetAdapter: PlatformAdapter = {
  platform: "widget",
  verifyRequest() {
    // Widget requests are authenticated by the public channel token lookup,
    // not by an HMAC header.
  },
  parseInbound(body) {
    if (!body || typeof body !== "object") {
      throw new HttpError(400, "Invalid JSON body");
    }
    const record = body as Record<string, unknown>;
    const text = typeof record.text === "string" ? record.text.trim() : "";
    const token = typeof record.token === "string" ? record.token : "";
    const senderId = typeof record.sender_id === "string" ? record.sender_id : "visitor";
    const thread = typeof record.thread === "string" && record.thread.length > 0 ? record.thread : "";
    if (!text) {
      return { kind: "ignore", reason: "empty text" };
    }
    if (!token) {
      throw new HttpError(400, "Missing widget token");
    }
    const ts = thread || `${Date.now()}`;
    const result: InboundResult = {
      kind: "message",
      message: {
        platform: "widget",
        eventId: typeof record.event_id === "string" ? record.event_id : `w_${Date.now()}`,
        threadId: `widget:${token.slice(0, 8)}:${ts}`,
        text,
        sentAt: new Date().toISOString(),
        sender: { id: senderId },
        conversation: {
          workspaceId: token,
          channelId: token,
          threadTs: ts,
        },
      },
    };
    return result;
  },
  async postReply() {
    throw new Error("Widget replies are stored in the inbox, not posted via this adapter");
  },
};
