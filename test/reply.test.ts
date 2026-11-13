import { createReplyHandler } from "../src/reply/handler";
import { issueReplyToken } from "../src/lib/reply-token";
import {
  NOW_MS,
  TEST_SECRETS,
  createFetchRecorder,
  createTestContext,
  replyApiEvent,
} from "./helpers";

const THREAD_ID = "slack:T0123456789:C999:1731448800.000100";

function tokenFor(threadId = THREAD_ID, nowMs = NOW_MS): string {
  return issueReplyToken({
    threadId,
    secret: TEST_SECRETS.callbackSigningSecret,
    nowMs,
  });
}

function seedThread() {
  const { fetchFn, calls } = createFetchRecorder();
  const setup = createTestContext({ fetchFn });
  setup.stores.threads.set(THREAD_ID, {
    threadId: THREAD_ID,
    platform: "slack",
    workspaceId: "T0123456789",
    channelId: "C999",
    threadTs: "1731448800.000100",
    createdAt: new Date(NOW_MS).toISOString(),
    expiresAt: Math.floor(NOW_MS / 1000) + 86400,
  });
  return { ...setup, calls };
}

describe("reply path", () => {
  it("posts chat.postMessage to the mapped channel and thread_ts", async () => {
    const { ctx, calls } = seedThread();
    const handler = createReplyHandler(ctx);
    const result = await handler(
      replyApiEvent({ thread: THREAD_ID, text: "Sunny, good day to go out.", token: tokenFor() }),
    );
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body ?? "{}")).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://slack.com/api/chat.postMessage");
    expect(calls[0].headers.authorization).toBe(`Bearer ${TEST_SECRETS.slackBotToken}`);
    expect(JSON.parse(calls[0].body)).toEqual({
      channel: "C999",
      thread_ts: "1731448800.000100",
      text: "Sunny, good day to go out.",
    });
  });

  it("returns 401 when the bearer token is missing", async () => {
    const { ctx } = seedThread();
    const handler = createReplyHandler(ctx);
    const result = await handler(replyApiEvent({ thread: THREAD_ID, text: "hi" }));
    expect(result.statusCode).toBe(401);
  });

  it("returns 401 when the HMAC token is invalid", async () => {
    const { ctx, calls } = seedThread();
    const handler = createReplyHandler(ctx);
    const result = await handler(
      replyApiEvent({ thread: THREAD_ID, text: "hi", token: "not-a-real-token" }),
    );
    expect(result.statusCode).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("returns 401 when the token does not match the thread", async () => {
    const { ctx } = seedThread();
    const handler = createReplyHandler(ctx);
    const result = await handler(
      replyApiEvent({
        thread: THREAD_ID,
        text: "hi",
        token: tokenFor("slack:T0123456789:C999:other"),
      }),
    );
    expect(result.statusCode).toBe(401);
  });

  it("returns 401 when the token has expired", async () => {
    const { ctx } = seedThread();
    const handler = createReplyHandler(ctx);
    const expired = issueReplyToken({
      threadId: THREAD_ID,
      secret: TEST_SECRETS.callbackSigningSecret,
      nowMs: NOW_MS - 8 * 24 * 60 * 60 * 1000,
      ttlSeconds: 60,
    });
    const result = await handler(replyApiEvent({ thread: THREAD_ID, text: "hi", token: expired }));
    expect(result.statusCode).toBe(401);
  });

  it("returns 404 when the thread mapping is missing", async () => {
    const { fetchFn, calls } = createFetchRecorder();
    const { ctx } = createTestContext({ fetchFn });
    const handler = createReplyHandler(ctx);
    const result = await handler(replyApiEvent({ thread: THREAD_ID, text: "hi", token: tokenFor() }));
    expect(result.statusCode).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it("returns 400 when text is empty", async () => {
    const { ctx } = seedThread();
    const handler = createReplyHandler(ctx);
    const result = await handler(replyApiEvent({ thread: THREAD_ID, text: "  ", token: tokenFor() }));
    expect(result.statusCode).toBe(400);
  });
});
