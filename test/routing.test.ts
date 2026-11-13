import { lookupRoute, resolveRoute } from "../src/lib/routing";
import { createIngestHandler } from "../src/ingest/handler";
import {
  MemoryStores,
  TENANT_A,
  createTestContext,
  slackEventEnvelope,
  signedSlackApiEvent,
} from "./helpers";
import type { RouteRecord } from "../src/lib/types";

function route(partial: Partial<RouteRecord> & Pick<RouteRecord, "channelId">): RouteRecord {
  return {
    tenantId: TENANT_A,
    platform: "slack",
    workspaceId: "T0123456789",
    targetWebhookUrl: "https://bot.example/hook",
    targetId: "default-grok",
    enabled: true,
    ...partial,
  };
}

describe("resolveRoute", () => {
  it("prefers a channel-specific row over the workspace wildcard", () => {
    const picked = resolveRoute({
      specific: route({ channelId: "C999", targetWebhookUrl: "https://channel.example", targetId: "channel" }),
      wildcard: route({ channelId: "*", targetWebhookUrl: "https://workspace.example", targetId: "ws" }),
    });
    expect(picked).toEqual({ targetWebhookUrl: "https://channel.example", targetId: "channel" });
  });

  it("falls back to the workspace wildcard", () => {
    const picked = resolveRoute({
      specific: null,
      wildcard: route({ channelId: "*" }),
    });
    expect(picked?.targetWebhookUrl).toBe("https://bot.example/hook");
  });

  it("treats a disabled channel row as a mute (no wildcard fallback)", () => {
    const picked = resolveRoute({
      specific: route({ channelId: "C999", enabled: false }),
      wildcard: route({ channelId: "*" }),
    });
    expect(picked).toBeNull();
  });

  it("returns null when nothing is configured", () => {
    expect(resolveRoute({ specific: null, wildcard: null })).toBeNull();
  });
});

describe("lookupRoute + ingest", () => {
  it("looks up channel then wildcard from the store", async () => {
    const stores = new MemoryStores();
    stores.seedRoute(route({ channelId: "*" }));
    stores.seedRoute(
      route({ channelId: "C999", targetWebhookUrl: "https://channel.example", targetId: "channel" }),
    );
    const found = await lookupRoute(stores, {
      tenantId: TENANT_A,
      platform: "slack",
      workspaceId: "T0123456789",
      channelId: "C999",
    });
    expect(found?.targetId).toBe("channel");
  });

  it("ingest enqueues using the matched route URL", async () => {
    const { ctx, queue, stores } = createTestContext();
    stores.seedRoute(
      route({ channelId: "C999", targetWebhookUrl: "https://channel.example/hook", targetId: "ops" }),
    );
    const handler = createIngestHandler(ctx);
    await handler(signedSlackApiEvent(slackEventEnvelope()));
    expect(queue.jobs).toHaveLength(1);
    expect(queue.jobs[0].targetWebhookUrl).toBe("https://channel.example/hook");
    expect(queue.jobs[0].targetId).toBe("ops");
    expect(queue.jobs[0].tenantId).toBe(TENANT_A);
  });

  it("ingest returns 200 and does not enqueue when no route matches", async () => {
    const { ctx, queue } = createTestContext();
    const handler = createIngestHandler(ctx);
    const result = await handler(signedSlackApiEvent(slackEventEnvelope()));
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body ?? "{}")).toMatchObject({ ignored: true, reason: "no route" });
    expect(queue.jobs).toHaveLength(0);
  });

  it("does not use another tenant's route for the same Slack team id", async () => {
    const { ctx, queue, stores } = createTestContext();
    stores.seedRoute({
      tenantId: "t-other",
      platform: "slack",
      workspaceId: "T0123456789",
      channelId: "*",
      targetWebhookUrl: "https://other.example/hook",
      enabled: true,
    });
    const handler = createIngestHandler(ctx);
    const result = await handler(signedSlackApiEvent(slackEventEnvelope()));
    expect(JSON.parse(result.body ?? "{}").reason).toBe("no route");
    expect(queue.jobs).toHaveLength(0);
  });
});
