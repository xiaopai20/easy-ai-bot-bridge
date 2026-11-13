import crypto from "crypto";
import { HttpError } from "./http";

export const DEFAULT_REPLY_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

interface TokenPayload {
  tenantId: string;
  threadId: string;
  exp: number;
}

export function issueReplyToken(args: {
  tenantId: string;
  threadId: string;
  secret: string;
  nowMs: number;
  ttlSeconds?: number;
}): string {
  const payload: TokenPayload = {
    tenantId: args.tenantId,
    threadId: args.threadId,
    exp: Math.floor(args.nowMs / 1000) + (args.ttlSeconds ?? DEFAULT_REPLY_TOKEN_TTL_SECONDS),
  };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = crypto.createHmac("sha256", args.secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyReplyToken(args: {
  token: string;
  threadId: string;
  tenantId?: string;
  secret: string;
  nowMs: number;
}): TokenPayload {
  const parts = args.token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new HttpError(401, "Invalid reply token");
  }
  const [body, sig] = parts;
  const expected = crypto.createHmac("sha256", args.secret).update(body).digest("base64url");
  const a = Buffer.from(sig, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new HttpError(401, "Invalid reply token");
  }

  let payload: TokenPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as TokenPayload;
  } catch {
    throw new HttpError(401, "Invalid reply token");
  }
  if (!payload.tenantId || !payload.threadId || !Number.isFinite(payload.exp)) {
    throw new HttpError(401, "Invalid reply token");
  }
  if (payload.threadId !== args.threadId) {
    throw new HttpError(401, "Reply token does not match thread");
  }
  if (args.tenantId && payload.tenantId !== args.tenantId) {
    throw new HttpError(401, "Reply token does not match tenant");
  }
  if (Math.floor(args.nowMs / 1000) > payload.exp) {
    throw new HttpError(401, "Reply token expired");
  }
  return payload;
}
