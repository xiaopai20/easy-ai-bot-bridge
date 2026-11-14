import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { loadConfig, type RelayConfig } from "./config";
import {
  parseTelegramUpdate,
  TelegramAuthError,
  verifyTelegramSecret,
  WEBHOOK_TIMEOUT_MS,
} from "./telegram";

export interface HandlerDeps {
  getConfig: () => Promise<RelayConfig>;
  fetchFn: typeof fetch;
  seenUpdateIds?: Set<number>;
  webhookTimeoutMs?: number;
}

const defaultSeenUpdateIds = new Set<number>();

function json(statusCode: number, body: unknown): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  };
}

function rawBody(event: APIGatewayProxyEventV2): string {
  if (!event.body) return "";
  if (event.isBase64Encoded) {
    return Buffer.from(event.body, "base64").toString("utf8");
  }
  return event.body;
}

function isAbortError(err: unknown): boolean {
  return (
    (err instanceof Error && err.name === "AbortError") ||
    (typeof err === "object" && err !== null && (err as { name?: string }).name === "AbortError")
  );
}

function logOutcome(fields: Record<string, string | number | boolean | undefined>): void {
  console.log(JSON.stringify(fields));
}

function isAllowed(config: RelayConfig, userId: number): boolean {
  return config.allowedUserIds.has(userId);
}

export function createHandler(deps: HandlerDeps) {
  const timeoutMs = deps.webhookTimeoutMs ?? WEBHOOK_TIMEOUT_MS;
  const seen = deps.seenUpdateIds ?? defaultSeenUpdateIds;

  return async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> => {
    try {
      const config = await deps.getConfig();
      const body = rawBody(event);
      verifyTelegramSecret({
        headers: event.headers,
        expectedSecret: config.telegramWebhookSecret,
      });

      let parsedJson: unknown = {};
      if (body) {
        try {
          parsedJson = JSON.parse(body);
        } catch {
          logOutcome({ msg: "ignored", outcome: "invalid_json" });
          return json(200, { ok: true, ignored: true, reason: "invalid json" });
        }
      }

      const parsed = parseTelegramUpdate(parsedJson);
      if (parsed.kind === "ignore") {
        logOutcome({
          msg: "ignored",
          outcome: parsed.reason,
          update_id: parsed.update_id,
          user_id: parsed.user_id,
        });
        return json(200, { ok: true, ignored: true, reason: parsed.reason });
      }

      const { payload } = parsed;
      if (seen.has(payload.update_id)) {
        logOutcome({
          msg: "duplicate_update",
          outcome: "skipped",
          update_id: payload.update_id,
          user_id: payload.user_id,
        });
        return json(200, { ok: true, ignored: true, reason: "duplicate update_id" });
      }
      seen.add(payload.update_id);

      if (!isAllowed(config, payload.user_id)) {
        logOutcome({
          msg: "not_allowlisted",
          outcome: "dropped",
          update_id: payload.update_id,
          user_id: payload.user_id,
        });
        return json(200, { ok: true, ignored: true, reason: "user not allowlisted" });
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await deps.fetchFn(config.webhookUrl, {
          method: "POST",
          headers: {
            authorization: `Bearer ${config.webhookKey}`,
            "content-type": "application/json; charset=utf-8",
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
        if (!response.ok) {
          console.error(
            JSON.stringify({
              msg: "webhook_failed",
              outcome: "error",
              status: response.status,
              update_id: payload.update_id,
              user_id: payload.user_id,
            }),
          );
        } else {
          logOutcome({
            msg: "forwarded",
            outcome: "ok",
            update_id: payload.update_id,
            user_id: payload.user_id,
          });
        }
      } catch (err) {
        console.error(
          JSON.stringify({
            msg: isAbortError(err) ? "webhook_timeout" : "webhook_error",
            outcome: "error",
            update_id: payload.update_id,
            user_id: payload.user_id,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      } finally {
        clearTimeout(timer);
      }

      return json(200, { ok: true });
    } catch (err) {
      if (err instanceof TelegramAuthError) {
        return json(err.statusCode, { error: err.message });
      }
      console.error("unhandled_error", err instanceof Error ? err.message : err);
      return json(500, { error: "Internal server error" });
    }
  };
}

export const handler = createHandler({
  getConfig: () => loadConfig(),
  fetchFn: fetch,
});