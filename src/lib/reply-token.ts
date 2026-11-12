import crypto from "crypto";
import { HttpError } from "./http";

export const DEFAULT_REPLY_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

export function issueReplyToken(args: {
  threadId: string;
  secret: string;
  nowMs: number;
  ttlSeconds?: number;
}): string {
  const exp = Math.floor(args.nowMs / 1000) + (args.ttlSeconds ?? DEFAULT_REPLY_TOKEN_TTL_SECONDS);
  const payload = `${args.threadId}:${exp}`;
  const sig = crypto.createHmac("sha256", args.secret).update(payload).digest("base64url");
  const body = Buffer.from(payload, "utf8").toString("base64url");
  return `${body}.${sig}`;
}

export function verifyReplyToken(args: {
  token: string;
  threadId: string;
  secret: string;
  nowMs: number;
}): void {
  const parts = args.token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new HttpError(401, "Invalid reply token");
  }
  const [body, sig] = parts;
  let payload: string;
  try {
    payload = Buffer.from(body, "base64url").toString("utf8");
  } catch {
    throw new HttpError(401, "Invalid reply token");
  }

  const expected = crypto.createHmac("sha256", args.secret).update(payload).digest("base64url");
  const a = Buffer.from(sig, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new HttpError(401, "Invalid reply token");
  }

  const colon = payload.lastIndexOf(":");
  if (colon <= 0) {
    throw new HttpError(401, "Invalid reply token");
  }
  const threadId = payload.slice(0, colon);
  const exp = Number(payload.slice(colon + 1));
  if (threadId !== args.threadId) {
    throw new HttpError(401, "Reply token does not match thread");
  }
  if (!Number.isFinite(exp) || Math.floor(args.nowMs / 1000) > exp) {
    throw new HttpError(401, "Reply token expired");
  }
}
