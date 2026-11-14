import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { createHandler } from "../src/handler";
import { slackSignature } from "../src/slack";
import type { RelayConfig } from "../src/config";

const NOW_MS = Date.parse("2026-11-12T22:00:00.000Z");
const NOW_UNIX = Math.floor(NOW_MS / 1000);
const CONFIG: RelayConfig = {
  slackSigningSecret: "slack-signing-secret-test",
  webhookUrl: "https://grok.example/routine",
  webhookKey: "webhook-key-test",
};

function signedEvent(
  body: unknown,
  args?: { timestamp?: string; headers?: Record<string, string>; secret?: string },
): APIGatewayProxyEventV2 {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  const timestamp = args?.timestamp ?? String(NOW_UNIX);
  const secret = args?.secret ?? CONFIG.slackSigningSecret;
  return {
    version: "2.0",
    routeKey: "$default",
    rawPath: "/",
    rawQueryString: "",
    headers: {
      "content-type": "application/json",
      "x-slack-request-timestamp": timestamp,
      "x-slack-signature": slackSignature(secret, timestamp, raw),
      ...(args?.headers ?? {}),
    },
    isBase64Encoded: false,
    body: raw,
    requestContext: {
      accountId: "test",
      apiId: "url",
      domainName: "url.lambda-url.us-east-1.on.aws",
      domainPrefix: "url",
      http: {
        method: "POST",
        path: "/",
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: "Slackbot",
      },
      requestId: "req-1",
      routeKey: "$default",
      stage: "$default",
      time: "12/Nov/2026:22:00:00 +0000",
      timeEpoch: NOW_MS,
    },
  } as APIGatewayProxyEventV2;
}

function mention(overrides?: Record<string, unknown>) {
  return {
    token: "legacy",
    team_id: "T0123456789",
    type: "event_callback",
    event_id: "Ev01ABC",
    event: {
      type: "app_mention",
      user: "U111",
      text: "<@UBOT> What is the weather today?",
      ts: "1731448800.000100",
      channel: "C999",
      ...overrides,
    },
  };
}

function handlerWithFetch(fetchFn: typeof fetch) {
  return createHandler({
    getConfig: async () => CONFIG,
    fetchFn,
    now: () => NOW_MS,
  });
}

describe("slack webhook relay", () => {
  it("accepts a valid signature and returns the url_verification challenge", async () => {
    const handler = handlerWithFetch(async () => {
      throw new Error("fetch should not run");
    });
    const result = await handler(
      signedEvent({ type: "url_verification", challenge: "abc-challenge" }),
    );
    expect(result.statusCode).toBe(200);
    expect(result.body).toBe("abc-challenge");
    expect(result.headers?.["content-type"]).toContain("text/plain");
  });

  it("rejects an invalid signature", async () => {
    const handler = handlerWithFetch(async () => {
      throw new Error("fetch should not run");
    });
    const event = signedEvent({ type: "url_verification", challenge: "abc" });
    event.headers["x-slack-signature"] = "v0=deadbeef";
    const result = await handler(event);
    expect(result.statusCode).toBe(401);
    expect(JSON.parse(result.body ?? "{}").error).toMatch(/Invalid Slack signature/);
  });

  it("rejects a stale timestamp", async () => {
    const handler = handlerWithFetch(async () => {
      throw new Error("fetch should not run");
    });
    const result = await handler(
      signedEvent({ type: "url_verification", challenge: "abc" }, { timestamp: String(NOW_UNIX - 301) }),
    );
    expect(result.statusCode).toBe(401);
    expect(JSON.parse(result.body ?? "{}").error).toMatch(/too old/);
  });

  it("skips Slack retries without forwarding", async () => {
    const calls: string[] = [];
    const handler = handlerWithFetch(async (input) => {
      calls.push(String(input));
      return { ok: true, status: 200 } as Response;
    });
    const result = await handler(
      signedEvent(mention(), { headers: { "x-slack-retry-num": "1" } }),
    );
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body ?? "{}")).toEqual({ ok: true, ignored: true, reason: "retry" });
    expect(calls).toHaveLength(0);
  });

  it("skips bot_id messages", async () => {
    const calls: string[] = [];
    const handler = handlerWithFetch(async (input) => {
      calls.push(String(input));
      return { ok: true, status: 200 } as Response;
    });
    const result = await handler(signedEvent(mention({ bot_id: "B123" })));
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body ?? "{}").reason).toBe("bot message");
    expect(calls).toHaveLength(0);
  });

  it("skips bot_message subtype", async () => {
    const calls: string[] = [];
    const handler = handlerWithFetch(async (input) => {
      calls.push(String(input));
      return { ok: true, status: 200 } as Response;
    });
    const result = await handler(signedEvent(mention({ subtype: "bot_message" })));
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body ?? "{}").reason).toBe("bot_message subtype");
    expect(calls).toHaveLength(0);
  });

  it("forwards app_mention with the expected payload shape", async () => {
    const calls: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
    const handler = handlerWithFetch(async (input, init) => {
      const headers: Record<string, string> = {};
      const raw = init?.headers as Record<string, string>;
      for (const [key, value] of Object.entries(raw ?? {})) {
        headers[key.toLowerCase()] = value;
      }
      calls.push({ url: String(input), headers, body: String(init?.body ?? "") });
      return { ok: true, status: 200 } as Response;
    });
    const result = await handler(signedEvent(mention()));
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body ?? "{}")).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(CONFIG.webhookUrl);
    expect(calls[0].headers.authorization).toBe(`Bearer ${CONFIG.webhookKey}`);
    expect(JSON.parse(calls[0].body)).toEqual({
      source: "slack",
      team: "T0123456789",
      channel: "C999",
      user: "U111",
      text: "What is the weather today?",
      ts: "1731448800.000100",
      thread_ts: "1731448800.000100",
      event_id: "Ev01ABC",
    });
  });

  it("forwards message.im and uses thread_ts when present", async () => {
    const calls: string[] = [];
    const handler = handlerWithFetch(async (_input, init) => {
      calls.push(String(init?.body ?? ""));
      return { ok: true, status: 200 } as Response;
    });
    const result = await handler(
      signedEvent({
        team_id: "T0123456789",
        type: "event_callback",
        event_id: "EvIM",
        event: {
          type: "message",
          channel_type: "im",
          user: "U111",
          text: "hello in dm",
          ts: "1731448800.000200",
          thread_ts: "1731448800.000100",
          channel: "D123",
        },
      }),
    );
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(calls[0])).toMatchObject({
      source: "slack",
      channel: "D123",
      text: "hello in dm",
      ts: "1731448800.000200",
      thread_ts: "1731448800.000100",
      event_id: "EvIM",
    });
  });

  it("returns 200 when the webhook times out", async () => {
    const handler = createHandler({
      getConfig: async () => CONFIG,
      now: () => NOW_MS,
      webhookTimeoutMs: 20,
      fetchFn: (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        }),
    });
    const result = await handler(signedEvent(mention({ text: "<@UBOT> ping" })));
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body ?? "{}")).toEqual({ ok: true });
  });
});
