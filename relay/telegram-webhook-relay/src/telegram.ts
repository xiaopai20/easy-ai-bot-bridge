import crypto from "crypto";

export const WEBHOOK_TIMEOUT_MS = 2500;

export const REPLY_INSTRUCTION =
  "Reply using the Telegram Bot API sendMessage method with chat_id from this payload. " +
  "Store the Telegram bot token in your AI bot, not in this relay.";

export class TelegramAuthError extends Error {
  readonly statusCode = 401;
  constructor(message: string) {
    super(message);
    this.name = "TelegramAuthError";
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

export function verifyTelegramSecret(args: {
  headers: Record<string, string | undefined> | undefined;
  expectedSecret: string;
}): void {
  const header = getHeader(args.headers, "x-telegram-bot-api-secret-token");
  if (!header) {
    throw new TelegramAuthError("Missing Telegram secret token header");
  }
  const a = Buffer.from(header, "utf8");
  const b = Buffer.from(args.expectedSecret, "utf8");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new TelegramAuthError("Invalid Telegram secret token");
  }
}

export interface TelegramAttachment {
  kind: "photo" | "document";
  file_id: string;
  file_name?: string;
  caption?: string;
}

export interface TelegramForwardPayload {
  source: "telegram";
  chat_id: number;
  user_id: number;
  username: string | null;
  first_name: string | null;
  message_id: number;
  date: number;
  text: string;
  reply_to_message_id?: number;
  attachments?: TelegramAttachment[];
  instruction: string;
  update_id: number;
}

export type TelegramParseResult =
  | { kind: "ignore"; reason: string; update_id?: number; user_id?: number }
  | { kind: "forward"; payload: TelegramForwardPayload };

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") return undefined;
  return value as Record<string, unknown>;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function largestPhotoFileId(photos: unknown): string | undefined {
  if (!Array.isArray(photos) || photos.length === 0) return undefined;
  const last = photos[photos.length - 1];
  const rec = asRecord(last);
  return rec ? asString(rec.file_id) : undefined;
}

function extractAttachments(msg: Record<string, unknown>): TelegramAttachment[] | undefined {
  const out: TelegramAttachment[] = [];
  const caption = asString(msg.caption);

  const photoId = largestPhotoFileId(msg.photo);
  if (photoId) {
    const item: TelegramAttachment = { kind: "photo", file_id: photoId };
    if (caption) item.caption = caption;
    out.push(item);
  }

  const doc = asRecord(msg.document);
  if (doc) {
    const fileId = asString(doc.file_id);
    if (fileId) {
      const item: TelegramAttachment = { kind: "document", file_id: fileId };
      const fileName = asString(doc.file_name);
      if (fileName) item.file_name = fileName;
      if (caption && !photoId) item.caption = caption;
      out.push(item);
    }
  }

  return out.length > 0 ? out : undefined;
}

function parseMessageBlock(
  updateId: number,
  msg: Record<string, unknown>,
): TelegramParseResult {
  const from = asRecord(msg.from);
  if (!from) {
    return { kind: "ignore", reason: "missing from", update_id: updateId };
  }

  const userId = asNumber(from.id);
  if (userId === undefined) {
    return { kind: "ignore", reason: "missing user id", update_id: updateId };
  }

  if (from.is_bot === true) {
    return { kind: "ignore", reason: "bot sender", update_id: updateId, user_id: userId };
  }

  const chat = asRecord(msg.chat);
  const chatId = chat ? asNumber(chat.id) : undefined;
  const messageId = asNumber(msg.message_id);
  const date = asNumber(msg.date);
  if (chatId === undefined || messageId === undefined || date === undefined) {
    return { kind: "ignore", reason: "missing chat_id, message_id, or date", update_id: updateId, user_id: userId };
  }

  const text = asString(msg.text) ?? asString(msg.caption) ?? "";
  const attachments = extractAttachments(msg);
  if (!text && !attachments) {
    return { kind: "ignore", reason: "no text or supported attachment", update_id: updateId, user_id: userId };
  }

  const replyTo = asRecord(msg.reply_to_message);
  const replyToMessageId = replyTo ? asNumber(replyTo.message_id) : undefined;

  const payload: TelegramForwardPayload = {
    source: "telegram",
    chat_id: chatId,
    user_id: userId,
    username: asString(from.username) ?? null,
    first_name: asString(from.first_name) ?? null,
    message_id: messageId,
    date,
    text,
    instruction: REPLY_INSTRUCTION,
    update_id: updateId,
  };
  if (replyToMessageId !== undefined) {
    payload.reply_to_message_id = replyToMessageId;
  }
  if (attachments) {
    payload.attachments = attachments;
  }

  return { kind: "forward", payload };
}

export function parseTelegramUpdate(body: unknown): TelegramParseResult {
  const update = asRecord(body);
  if (!update) {
    return { kind: "ignore", reason: "invalid json" };
  }

  const updateId = asNumber(update.update_id);
  if (updateId === undefined) {
    return { kind: "ignore", reason: "missing update_id" };
  }

  const message = asRecord(update.message);
  if (message) {
    return parseMessageBlock(updateId, message);
  }

  const edited = asRecord(update.edited_message);
  if (edited) {
    return parseMessageBlock(updateId, edited);
  }

  return { kind: "ignore", reason: "unsupported update type", update_id: updateId };
}