import { createIngestHandler } from "../src/ingest/handler";
import { createReplyHandler } from "../src/reply/handler";
import { composeThreadId, slackTeamPk } from "../src/lib/keys";
import { issueReplyToken } from "../src/lib/reply-token";
import { DEFAULT_LIMITS } from "../src/lib/limits";
import { RATE_LIMIT_NOTICE } from "../src/lib/rate-limit";
import {
  NOW_MS,
  TENANT_A,
  TENANT_B,
  TEST_SECRETS,
  createFetchRecorder,
  createTestContext,
  replyApiEvent,
  slackEventEnvelope,
  signedSlackApiEvent,
} from "./helpers";

const PLATFORM_THREAD = "slack:T0123456789:C999:1731448800.000100";
const THREAD_ID = composeThreadId(TENANT_A, PLATFORM_THREAD);

function seedRoute(tenantId = TENANT_A) {
  const { fetchFn, calls } = createFetchRecorder();
  const setup = createTestContext({ fetchFn });
  setup.stores.seedRoute({
    tenantId,
    platform: "slack",
    workspaceId: "T0123456789",
    channelId: "*",
    targetWebhookUrl: "https://bot.example/hook",
    targetId: "bot-1",
    enabled: true,
  });
  return { ...setup, calls };
}

describe("message rate limits", () => {
  it("forwards under the limit with three DynamoDB writes and no settings Get", async () => {
    const { ctx, stores, queue } = seedRoute();
    stores.reads.limits = 0;
    stores.reads.routes = 0;
    stores.writes.events = 0;
    stores.writes.quota = 0;
    stores.writes.threads = 0;
    const handler = createIngestHandler(ctx);
    const result = await handler(signedSlackApiEvent(slackEventEnvelope({ eventId: "EvRL1" })));
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body ?? "{}")).toEqual({ ok: true });
    expect(queue.jobs).toHaveLength(1);
    expect(stores.writes.events).toBe(1);
    expect(stores.writes.quota).toBe(1);
    expect(stores.writes.threads).toBe(1);
    expect(stores.writes.flags).toBe(0);
  });

  it("does not forward over the minute limit, posts one notice, and returns 429 on /reply", async () => {
    const { ctx, stores, queue, calls } = seedRoute();
    await stores.putLimitsRecord({
      tenantId: TENANT_A,
      configVersion: 1,
      override: { messagesPerMinute: 1 },
      updatedAt: new Date(NOW_MS).toISOString(),
    });
    const ingest = createIngestHandler(ctx);
    const first = await ingest(signedSlackApiEvent(slackEventEnvelope({ eventId: "EvA" })));
    expect(JSON.parse(first.body ?? "{}")).toEqual({ ok: true });
    expect(queue.jobs).toHaveLength(1);

    const second = await ingest(signedSlackApiEvent(slackEventEnvelope({ eventId: "EvB" })));
    expect(second.statusCode).toBe(200);
    expect(JSON.parse(second.body ?? "{}")).toEqual({
      ok: true,
      ignored: true,
      reason: "rate limited",
    });
    expect(queue.jobs).toHaveLength(1);

    const third = await ingest(signedSlackApiEvent(slackEventEnvelope({ eventId: "EvC" })));
    expect(JSON.parse(third.body ?? "{}").ignored).toBe(true);
    expect(queue.jobs).toHaveLength(1);

    const notices = calls.filter((call) => call.url === "https://slack.com/api/chat.postMessage");
    expect(notices).toHaveLength(1);
    expect(JSON.parse(notices[0].body).text).toBe(RATE_LIMIT_NOTICE);

    const reply = createReplyHandler(ctx);
    const token = issueReplyToken({
      tenantId: TENANT_A,
      threadId: THREAD_ID,
      secret: TEST_SECRETS.callbackSigningSecret,
      nowMs: NOW_MS,
    });
    const denied = await reply(replyApiEvent({ thread: THREAD_ID, text: "too many", token }));
    expect(denied.statusCode).toBe(429);
    expect(JSON.parse(denied.body ?? "{}").error).toBe("Rate limit exceeded");
  });

  it("stops a thread loop after N messages in the same minute", async () => {
    const { ctx, stores, queue } = seedRoute();
    await stores.putLimitsRecord({
      tenantId: TENANT_A,
      configVersion: 1,
      override: { loopMessagesPerThreadPerMinute: 2 },
      updatedAt: new Date(NOW_MS).toISOString(),
    });
    const ingest = createIngestHandler(ctx);
    expect((await ingest(signedSlackApiEvent(slackEventEnvelope({ eventId: "EvL1" })))).statusCode).toBe(200);
    expect((await ingest(signedSlackApiEvent(slackEventEnvelope({ eventId: "EvL2" })))).statusCode).toBe(200);
    const third = await ingest(signedSlackApiEvent(slackEventEnvelope({ eventId: "EvL3" })));
    expect(JSON.parse(third.body ?? "{}")).toEqual({
      ok: true,
      ignored: true,
      reason: "loop detected",
    });
    expect(queue.jobs).toHaveLength(2);
  });

  it("isolates quotas across tenants", async () => {
    const { fetchFn } = createFetchRecorder();
    const { ctx, stores, queue } = createTestContext({ fetchFn, seedDefaultSlack: false });
    stores.slackTeams.set(slackTeamPk("T0123456789"), {
      teamId: "T0123456789",
      tenantId: TENANT_A,
      channelId: "ch-a",
    });
    stores.slackTeams.set(slackTeamPk("T999"), {
      teamId: "T999",
      tenantId: TENANT_B,
      channelId: "ch-b",
    });
    stores.seedTenant(
      { tenantId: TENANT_A, ownerUserId: "user-a", ownerEmail: "a@example.com", createdAt: new Date(NOW_MS).toISOString() },
      "user-a",
    );
    stores.seedTenant(
      { tenantId: TENANT_B, ownerUserId: "user-b", ownerEmail: "b@example.com", createdAt: new Date(NOW_MS).toISOString() },
      "user-b",
    );
    stores.seedRoute({
      tenantId: TENANT_A,
      platform: "slack",
      workspaceId: "T0123456789",
      channelId: "*",
      targetWebhookUrl: "https://a.example/hook",
      enabled: true,
    });
    stores.seedRoute({
      tenantId: TENANT_B,
      platform: "slack",
      workspaceId: "T999",
      channelId: "*",
      targetWebhookUrl: "https://b.example/hook",
      enabled: true,
    });
    await stores.putLimitsRecord({
      tenantId: TENANT_A,
      configVersion: 1,
      override: { messagesPerMinute: 1 },
      updatedAt: new Date(NOW_MS).toISOString(),
    });

    const ingest = createIngestHandler(ctx);
    await ingest(signedSlackApiEvent(slackEventEnvelope({ eventId: "EvA1", teamId: "T0123456789" })));
    await ingest(signedSlackApiEvent(slackEventEnvelope({ eventId: "EvA2", teamId: "T0123456789" })));
    const b = await ingest(
      signedSlackApiEvent(slackEventEnvelope({ eventId: "EvB1", teamId: "T999", channel: "C1" })),
    );
    expect(b.statusCode).toBe(200);
    expect(JSON.parse(b.body ?? "{}")).toEqual({ ok: true });
    expect(queue.jobs.filter((job) => job.tenantId === TENANT_A)).toHaveLength(1);
    expect(queue.jobs.filter((job) => job.tenantId === TENANT_B)).toHaveLength(1);
  });

  it("uses the documented default limits", () => {
    expect(DEFAULT_LIMITS).toEqual({
      maxBots: 5,
      maxChannels: 5,
      maxRoutes: 20,
      messagesPerMinute: 120,
      messagesPerDay: 10_000,
      loopMessagesPerThreadPerMinute: 20,
    });
  });
});
