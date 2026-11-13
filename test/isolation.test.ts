import { createDashboardHandler } from "../src/dashboard/handler";
import { createIngestHandler } from "../src/ingest/handler";
import { createReplyHandler } from "../src/reply/handler";
import { createWidgetHandler } from "../src/widget/handler";
import { composeThreadId } from "../src/lib/keys";
import { issueReplyToken } from "../src/lib/reply-token";
import { MemoryTenantSecrets } from "../src/lib/tenant-secrets";
import {
  NOW_MS,
  TENANT_A,
  TENANT_B,
  TEST_SECRETS,
  USER_A,
  USER_B,
  authedApiEvent,
  createFetchRecorder,
  createTestContext,
  replyApiEvent,
  slackEventEnvelope,
  signedSlackApiEvent,
} from "./helpers";

function seedTwoTenants() {
  const { fetchFn } = createFetchRecorder();
  const setup = createTestContext({ fetchFn, seedDefaultSlack: false });
  setup.stores.seedTenant(
    { tenantId: TENANT_A, ownerUserId: USER_A, ownerEmail: "a@example.com", createdAt: "2026-01-01T00:00:00.000Z" },
    USER_A,
  );
  setup.stores.seedTenant(
    { tenantId: TENANT_B, ownerUserId: USER_B, ownerEmail: "b@example.com", createdAt: "2026-01-01T00:00:00.000Z" },
    USER_B,
  );
  return setup;
}

describe("tenant isolation", () => {
  it("creates a tenant automatically on first Google login (/api/me)", async () => {
    const { ctx, stores } = createTestContext({ seedDefaultSlack: false });
    const handler = createDashboardHandler(ctx);
    const result = await handler(
      authedApiEvent({ method: "GET", path: "/api/me", userId: "google-sub-1", email: "new@example.com" }),
    );
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body ?? "{}");
    expect(body.user.userId).toBe("google-sub-1");
    expect(body.tenant.tenantId).toMatch(/^t_/);
    expect(body.tenant.ownerEmail).toBe("new@example.com");
    expect(await stores.getUserTenantId("google-sub-1")).toBe(body.tenant.tenantId);
    const again = await handler(
      authedApiEvent({ method: "GET", path: "/api/me", userId: "google-sub-1", email: "new@example.com" }),
    );
    expect(JSON.parse(again.body ?? "{}").tenant.tenantId).toBe(body.tenant.tenantId);
  });

  it("does not list or fetch another tenant's bots", async () => {
    const { ctx, stores } = seedTwoTenants();
    await stores.putBot({
      tenantId: TENANT_A,
      botId: "bot-a",
      name: "Alpha",
      webhookUrl: "https://a.example/hook",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const handler = createDashboardHandler(ctx);
    const list = await handler(authedApiEvent({ method: "GET", path: "/api/bots", userId: USER_B }));
    expect(JSON.parse(list.body ?? "{}").bots).toEqual([]);
    const get = await handler(authedApiEvent({ method: "GET", path: "/api/bots/bot-a", userId: USER_B }));
    expect(get.statusCode).toBe(404);
    const del = await handler(authedApiEvent({ method: "DELETE", path: "/api/bots/bot-a", userId: USER_B }));
    expect(del.statusCode).toBe(404);
    expect(await stores.getBot(TENANT_A, "bot-a")).not.toBeNull();
  });

  it("rejects linking a channel that belongs to another tenant", async () => {
    const { ctx, stores } = seedTwoTenants();
    await stores.putBot({
      tenantId: TENANT_B,
      botId: "bot-b",
      name: "Beta",
      webhookUrl: "https://b.example/hook",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    await stores.putChannel({
      tenantId: TENANT_A,
      channelId: "ch-a",
      platform: "widget",
      name: "Site A",
      botId: "bot-a",
      enabled: true,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const handler = createDashboardHandler(ctx);
    const result = await handler(
      authedApiEvent({
        method: "POST",
        path: "/api/channels/ch-a/link",
        userId: USER_B,
        body: { botId: "bot-b" },
      }),
    );
    expect(result.statusCode).toBe(404);
  });

  it("does not apply tenant B routes to a Slack workspace owned by tenant A", async () => {
    const { ctx, queue, stores } = createTestContext();
    stores.seedRoute({
      tenantId: TENANT_B,
      platform: "slack",
      workspaceId: "T0123456789",
      channelId: "*",
      targetWebhookUrl: "https://b.example/hook",
      targetId: "bot-b",
      enabled: true,
    });
    const result = await createIngestHandler(ctx)(signedSlackApiEvent(slackEventEnvelope()));
    expect(JSON.parse(result.body ?? "{}").reason).toBe("no route");
    expect(queue.jobs).toHaveLength(0);
  });

  it("scopes event_id dedupe per tenant so the same id can process twice", async () => {
    const { ctx, queue, stores } = createTestContext();
    stores.slackTeams.set("SLACKTEAM#T-B", {
      teamId: "T-B",
      tenantId: TENANT_B,
      channelId: "ch-b",
    });
    stores.seedTenant(
      { tenantId: TENANT_B, ownerUserId: USER_B, ownerEmail: "b@example.com", createdAt: "2026-01-01T00:00:00.000Z" },
      USER_B,
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
      workspaceId: "T-B",
      channelId: "*",
      targetWebhookUrl: "https://b.example/hook",
      enabled: true,
    });
    const ingest = createIngestHandler(ctx);
    await ingest(signedSlackApiEvent(slackEventEnvelope({ eventId: "EvSAME", teamId: "T0123456789" })));
    await ingest(signedSlackApiEvent(slackEventEnvelope({ eventId: "EvSAME", teamId: "T-B" })));
    expect(queue.jobs).toHaveLength(2);
    expect(queue.jobs.map((job) => job.tenantId).sort()).toEqual([TENANT_A, TENANT_B]);
  });

  it("rejects a reply token issued for tenant A when posting to tenant B's thread", async () => {
    const { fetchFn, calls } = createFetchRecorder();
    const { ctx, stores } = createTestContext({ fetchFn });
    const threadB = composeThreadId(TENANT_B, "slack:T-B:C1:1.0");
    await stores.putThread({
      tenantId: TENANT_B,
      threadId: threadB,
      platform: "slack",
      workspaceId: "T-B",
      channelId: "C1",
      threadTs: "1.0",
      createdAt: new Date(NOW_MS).toISOString(),
      expiresAt: Math.floor(NOW_MS / 1000) + 86400,
    });
    const tokenA = issueReplyToken({
      tenantId: TENANT_A,
      threadId: threadB,
      secret: TEST_SECRETS.callbackSigningSecret,
      nowMs: NOW_MS,
    });
    const result = await createReplyHandler(ctx)(
      replyApiEvent({ thread: threadB, text: "cross tenant", token: tokenA }),
    );
    expect(result.statusCode).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("does not let a widget token from tenant A read tenant B messages", async () => {
    const { ctx, stores } = seedTwoTenants();
    await stores.putWidgetTokenMapping({ token: "wgt-a", tenantId: TENANT_A, channelId: "ch-a" });
    await stores.putWidgetTokenMapping({ token: "wgt-b", tenantId: TENANT_B, channelId: "ch-b" });
    const threadB = `${TENANT_B}:widget:ch-b:sess`;
    await stores.putInboxMessage({
      tenantId: TENANT_B,
      threadId: threadB,
      messageId: "m1",
      role: "bot",
      text: "secret from B",
      sentAt: new Date(NOW_MS).toISOString(),
      expiresAt: Math.floor(NOW_MS / 1000) + 86400,
    });
    const handler = createWidgetHandler(ctx);
    const result = await handler({
      version: "2.0",
      routeKey: "GET /widget/messages",
      rawPath: "/widget/messages",
      rawQueryString: "token=wgt-a&thread=sess",
      headers: {},
      isBase64Encoded: false,
      queryStringParameters: { token: "wgt-a", thread: "sess" },
      requestContext: {
        accountId: "test",
        apiId: "api",
        domainName: "bridge.example",
        domainPrefix: "bridge",
        http: {
          method: "GET",
          path: "/widget/messages",
          protocol: "HTTP/1.1",
          sourceIp: "127.0.0.1",
          userAgent: "test",
        },
        requestId: "w1",
        routeKey: "GET /widget/messages",
        stage: "$default",
        time: "now",
        timeEpoch: NOW_MS,
      },
    } as never);
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body ?? "{}");
    expect(body.messages).toEqual([]);
  });

  it("uses per-tenant webhook keys when forwarding", async () => {
    const { fetchFn, calls } = createFetchRecorder();
    const tenantSecrets = new MemoryTenantSecrets();
    await tenantSecrets.putBotKey(TENANT_A, "bot-a", "key-a");
    const { ctx, queue, stores } = createTestContext({ fetchFn, tenantSecrets });
    stores.seedRoute({
      tenantId: TENANT_A,
      platform: "slack",
      workspaceId: "T0123456789",
      channelId: "*",
      targetWebhookUrl: "https://a.example/hook",
      targetId: "bot-a",
      enabled: true,
    });
    await createIngestHandler(ctx)(signedSlackApiEvent(slackEventEnvelope({ eventId: "EvKEY" })));
    const { createForwarderHandler } = await import("../src/forwarder/handler");
    await createForwarderHandler(ctx)({
      Records: [
        {
          messageId: "m",
          receiptHandle: "rh",
          body: JSON.stringify(queue.jobs[0]),
          attributes: {
            ApproximateReceiveCount: "1",
            SentTimestamp: "0",
            SenderId: "test",
            ApproximateFirstReceiveTimestamp: "0",
          },
          messageAttributes: {},
          md5OfBody: "",
          eventSource: "aws:sqs",
          eventSourceARN: "arn:aws:sqs:us-east-1:123:queue",
          awsRegion: "us-east-1",
        },
      ],
    });
    expect(calls[0].headers.authorization).toBe("Bearer key-a");
    expect(calls[0].headers.authorization).not.toBe(`Bearer ${TEST_SECRETS.targetWebhookKey}`);
  });
});
