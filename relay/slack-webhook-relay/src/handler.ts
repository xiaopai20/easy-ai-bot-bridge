import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { loadConfig, type RelayConfig } from "./config";
import {
  getHeader,
  parseSlackEvent,
  SlackAuthError,
  verifySlackRequest,
  WEBHOOK_TIMEOUT_MS,
} from "./slack";

export interface HandlerDeps {
  getConfig: () => Promise<RelayConfig>;
  fetchFn: typeof fetch;
  now: () => number;
  webhookTimeoutMs?: number;
}

function json(statusCode: number, body: unknown): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  };
}

function text(statusCode: number, body: string): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: { "content-type": "text/plain; charset=utf-8" },
    body,
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

export function createHandler(deps: HandlerDeps) {
  const timeoutMs = deps.webhookTimeoutMs ?? WEBHOOK_TIMEOUT_MS;

  return async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> => {
    try {
      const config = await deps.getConfig();
      const body = rawBody(event);
      verifySlackRequest({
        headers: event.headers,
        rawBody: body,
        signingSecret: config.slackSigningSecret,
        nowMs: deps.now(),
      });

      let parsedJson: unknown = {};
      if (body) {
        try {
          parsedJson = JSON.parse(body);
        } catch {
          return json(200, { ok: true, ignored: true, reason: "invalid json" });
        }
      }

      const parsed = parseSlackEvent(parsedJson);
      if (parsed.kind === "challenge") {
        return text(200, parsed.challenge);
      }

      const retryNum = getHeader(event.headers, "x-slack-retry-num");
      if (retryNum) {
        console.log(JSON.stringify({ msg: "slack_retry_skipped", retryNum }));
        return json(200, { ok: true, ignored: true, reason: "retry" });
      }

      if (parsed.kind === "ignore") {
        console.log(JSON.stringify({ msg: "ignored", reason: parsed.reason }));
        return json(200, { ok: true, ignored: true, reason: parsed.reason });
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
          body: JSON.stringify(parsed.payload),
          signal: controller.signal,
        });
        if (!response.ok) {
          console.error(
            JSON.stringify({
              msg: "webhook_failed",
              status: response.status,
              event_id: parsed.payload.event_id,
            }),
          );
        }
      } catch (err) {
        console.error(
          JSON.stringify({
            msg: isAbortError(err) ? "webhook_timeout" : "webhook_error",
            event_id: parsed.payload.event_id,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      } finally {
        clearTimeout(timer);
      }

      return json(200, { ok: true });
    } catch (err) {
      if (err instanceof SlackAuthError) {
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
  now: () => Date.now(),
});
