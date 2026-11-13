import crypto from "crypto";
import { HttpError } from "./http";

interface OAuthState {
  tenantId: string;
  userId: string;
  exp: number;
}

export function issueOAuthState(args: {
  tenantId: string;
  userId: string;
  secret: string;
  nowMs: number;
  ttlSeconds?: number;
}): string {
  const payload: OAuthState = {
    tenantId: args.tenantId,
    userId: args.userId,
    exp: Math.floor(args.nowMs / 1000) + (args.ttlSeconds ?? 600),
  };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = crypto.createHmac("sha256", args.secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyOAuthState(args: { state: string; secret: string; nowMs: number }): OAuthState {
  const parts = args.state.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new HttpError(400, "Invalid OAuth state");
  }
  const [body, sig] = parts;
  const expected = crypto.createHmac("sha256", args.secret).update(body).digest("base64url");
  const a = Buffer.from(sig, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new HttpError(400, "Invalid OAuth state");
  }
  let payload: OAuthState;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as OAuthState;
  } catch {
    throw new HttpError(400, "Invalid OAuth state");
  }
  if (!payload.tenantId || !payload.userId || Math.floor(args.nowMs / 1000) > payload.exp) {
    throw new HttpError(400, "OAuth state expired");
  }
  return payload;
}
