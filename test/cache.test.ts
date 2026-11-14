import { createDashboardHandler } from "../src/dashboard/handler";
import { createIngestHandler } from "../src/ingest/handler";
import { lookupRouteCached } from "../src/lib/settings";
import {
  NOW_MS,
  TENANT_A,
  USER_A,
  authedApiEvent,
  createFetchRecorder,
  createTestContext,
  slackEventEnvelope,
  signedSlackApiEvent,
} from "./helpers";

describe("settings cache", () => {
  it("skips DynamoDB settings reads on a warm cache", async () => {
    const { fetchFn } = createFetchRecorder();
    const { ctx, stores } = createTestContext({ fetchFn, cacheTtlMs: 60_000 });
    stores.seedRoute({
      tenantId: TENANT_A,
      platform: "slack",
      workspaceId: "T0123456789",
      channelId: "*",
      targetWebhookUrl: "https://bot.example/hook",
      enabled: true,
    });
    const ingest = createIngestHandler(ctx);
    await ingest(signedSlackApiEvent(slackEventEnvelope({ eventId: "EvC1" })));
    const afterFirst = { ...stores.reads };
    expect(afterFirst.slackTeams).toBeGreaterThan(0);
    expect(afterFirst.routes).toBeGreaterThan(0);
    expect(afterFirst.limits).toBeGreaterThan(0);

    await ingest(signedSlackApiEvent(slackEventEnvelope({ eventId: "EvC2" })));
    expect(stores.reads.slackTeams).toBe(afterFirst.slackTeams);
    expect(stores.reads.routes).toBe(afterFirst.routes);
    expect(stores.reads.limits).toBe(afterFirst.limits);
  });

  it("reloads after TTL expiry", async () => {
    const { fetchFn } = createFetchRecorder();
    let now = NOW_MS;
    const { ctx, stores } = createTestContext({
      fetchFn,
      cacheTtlMs: 60_000,
      nowMs: () => now,
    });
    stores.seedRoute({
      tenantId: TENANT_A,
      platform: "slack",
      workspaceId: "T0123456789",
      channelId: "*",
      targetWebhookUrl: "https://bot.example/hook",
      enabled: true,
    });
    const ingest = createIngestHandler(ctx);
    await ingest(signedSlackApiEvent(slackEventEnvelope({ eventId: "EvT1" })));
    const afterFirst = { ...stores.reads };
    now += 61_000;
    await ingest(signedSlackApiEvent(slackEventEnvelope({ eventId: "EvT2" })));
    expect(stores.reads.slackTeams).toBeGreaterThan(afterFirst.slackTeams);
    expect(stores.reads.routes).toBeGreaterThan(afterFirst.routes);
    expect(stores.reads.limits).toBeGreaterThan(afterFirst.limits);
  });

  it("drops route cache in the same container after a dashboard write", async () => {
    const { fetchFn } = createFetchRecorder();
    const { ctx, stores } = createTestContext({
      fetchFn,
      cacheTtlMs: 60_000,
      seedDefaultSlack: false,
    });
    const dash = createDashboardHandler(ctx);
    await dash(authedApiEvent({ method: "GET", path: "/api/me", userId: USER_A }));
    const botRes = await dash(
      authedApiEvent({
        method: "POST",
        path: "/api/bots",
        userId: USER_A,
        body: { name: "Grok", webhookUrl: "https://one.example/hook", webhookKey: "k" },
      }),
    );
    const botId = JSON.parse(botRes.body ?? "{}").bot.botId as string;
    const tenantId = JSON.parse(
      (await dash(authedApiEvent({ method: "GET", path: "/api/me", userId: USER_A }))).body ?? "{}",
    ).tenant.tenantId as string;

    const chRes = await dash(
      authedApiEvent({
        method: "POST",
        path: "/api/channels",
        userId: USER_A,
        body: { platform: "widget", name: "Site", botId },
      }),
    );
    const channel = JSON.parse(chRes.body ?? "{}").channel as { channelId: string };
    const first = await lookupRouteCached(ctx, {
      tenantId,
      platform: "widget",
      workspaceId: channel.channelId,
      channelId: channel.channelId,
    });
    expect(first?.targetWebhookUrl).toBe("https://one.example/hook");

    const bot2 = await dash(
      authedApiEvent({
        method: "POST",
        path: "/api/bots",
        userId: USER_A,
        body: { name: "Other", webhookUrl: "https://two.example/hook", webhookKey: "k2" },
      }),
    );
    const bot2Id = JSON.parse(bot2.body ?? "{}").bot.botId as string;
    await dash(
      authedApiEvent({
        method: "POST",
        path: `/api/channels/${channel.channelId}/link`,
        userId: USER_A,
        body: { botId: bot2Id },
      }),
    );
    const second = await lookupRouteCached(ctx, {
      tenantId,
      platform: "widget",
      workspaceId: channel.channelId,
      channelId: channel.channelId,
    });
    expect(second?.targetWebhookUrl).toBe("https://two.example/hook");
  });
});
