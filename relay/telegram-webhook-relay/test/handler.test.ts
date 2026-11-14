import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { createHandler } from "../src/handler";
import type { RelayConfig } from "../src/config";

const CONFIG: RelayConfig = {
  telegramWebhookSecret: "telegram-secret-test",
  webhookUrl: "https://grok.example/routine",
  webhookKey: "webhook-key-test",
  allowedUserIds: new Set([1001, 1002]),
};

function telegramEvent(
  body: unknown,
  args?: { headers?: Record<string, string>; secret?: string },
): APIGatewayProxyEventV2 {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  const secret = args?.secret ?? CONFIG.telegramWebhookSecret;
  return {
    version: "2.0",
    routeKey: "$default",
    rawPath: "/",
    rawQueryString: "",
    headers: {
      "content-type": "application/json",
      "x-telegram-bot-api-secret-token": secret,
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
        userAgent: "TelegramBot",
      },
      requestId: "req-1",
      routeKey: "$default",
      stage: "$default",
      time: "12/Nov/2026:22:00:00 +0000",
      timeEpoch: Date.parse("2026-11-12T22:00:00.000Z"),
    },
  } as APIGatewayProxyEventV2;
}

function textMessage(overrides?: {
  updateId?: number;
  userId?: number;
  text?: string;
  isBot?: boolean;
}) {
  const userId = overrides?.userId ?? 1001;
  return {
    update_id: overrides?.updateId ?? 42,
    message: {
      message_id: 7,
      date: 1731448800,
      chat: { id: 9001, type: "private" },
      from: {
        id: userId,
        is_bot: overrides?.isBot ?? false,
        first_name: "Test",
        username: "testuser",
      },
      text: overrides?.text ?? "Hello bot",
    },
  };
}

function handlerWithFetch(fetchFn: typeof fetch, seen = new Set<number>()) {
  return createHandler({
    getConfig: async () => CONFIG,
    fetchFn,
    seenUpdateIds: seen,
  });
}

describe("telegram webhook relay", () => {
  it("rejects a missing secret header with 401", async () => {
    const handler = handlerWithFetch(fetch);
    const event = telegramEvent(textMessage());
    delete (event.headers as Record<string, string>)["x-telegram-bot-api-secret-token"];
    const result = await handler(event);
    expect(result.statusCode).toBe(401);
  });

  it("rejects a wrong secret with 401", async () => {
    const handler = handlerWithFetch(fetch);
    const result = await handler(telegramEvent(textMessage(), { secret: "wrong" }));
    expect(result.statusCode).toBe(401);
  });

  it("drops a non-allowlisted user with 200 and does not forward", async () => {
    const calls: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
    const handler = handlerWithFetch(async (url, init) => {
      calls.push({
        url: String(url),
        headers: (init?.headers as Record<string, string>) ?? {},
        body: String(init?.body),
      });
      return new Response("ok", { status: 200 });
    });
    const result = await handler(telegramEvent(textMessage({ userId: 9999 })));
    expect(result.statusCode).toBe(200);
    expect(calls).toHaveLength(0);
  });

  it("forwards an allowlisted user with Bearer auth and normalized payload", async () => {
    const calls: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
    const handler = handlerWithFetch(async (url, init) => {
      calls.push({
        url: String(url),
        headers: (init?.headers as Record<string, string>) ?? {},
        body: String(init?.body),
      });
      return new Response("ok", { status: 200 });
    });
    const result = await handler(telegramEvent(textMessage({ updateId: 99, userId: 1002, text: "Ping" })));
    expect(result.statusCode).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(CONFIG.webhookUrl);
    expect(calls[0].headers.authorization).toBe(`Bearer ${CONFIG.webhookKey}`);
    const payload = JSON.parse(calls[0].body) as {
      source: string;
      chat_id: number;
      user_id: number;
      username: string;
      text: string;
      instruction: string;
      update_id: number;
    };
    expect(payload.source).toBe("telegram");
    expect(payload.chat_id).toBe(9001);
    expect(payload.user_id).toBe(1002);
    expect(payload.username).toBe("testuser");
    expect(payload.text).toBe("Ping");
    expect(payload.update_id).toBe(99);
    expect(payload.instruction).toContain("sendMessage");
  });

  it("drops messages from bots", async () => {
    const calls: unknown[] = [];
    const handler = handlerWithFetch(async () => {
      calls.push(1);
      return new Response("ok", { status: 200 });
    });
    const result = await handler(telegramEvent(textMessage({ isBot: true })));
    expect(result.statusCode).toBe(200);
    expect(calls).toHaveLength(0);
  });

  it("forwards a duplicate update_id only once", async () => {
    const calls: unknown[] = [];
    const seen = new Set<number>();
    const handler = handlerWithFetch(async () => {
      calls.push(1);
      return new Response("ok", { status: 200 });
    }, seen);
    const body = textMessage({ updateId: 555 });
    await handler(telegramEvent(body));
    await handler(telegramEvent(body));
    expect(calls).toHaveLength(1);
  });
});