import { lookupRoute, resolveRoute } from "../src/lib/routing";
import { createIngestHandler } from "../src/ingest/handler";
import { MemoryStores, createTestContext, slackEventEnvelope, signedSlackApiEvent } from "./helpers";
import type { RouteRecord } from "../src/lib/types";

function route(partial: Partial<RouteRecord> & Pick<RouteRecord, "channelId">): RouteRecord {
  return {
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
      defaultTargetWebhookUrl: "https://env.example",
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

  it("treats a disabled channel row as a mute (no wildcard/env fallback)", () => {
    const picked = resolveRoute({
      specific: route({ channelId: "C999", enabled: false }),
      wildcard: route({ channelId: "*" }),
      defaultTargetWebhookUrl: "https://env.example",
    });
    expect(picked).toBeNull();
  });

  it("uses the env default when no DynamoDB row exists", () => {
    const picked = resolveRoute({
      specific: null,
      wildcard: null,
      defaultTargetWebhookUrl: "https://env.example",
    });
    expect(picked).toEqual({ targetWebhookUrl: "https://env.example", targetId: "default" });
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
  });

  it("ingest returns 200 and does not enqueue when no route matches", async () => {
    const { ctx, queue } = createTestContext();
    const handler = createIngestHandler(ctx);
    const result = await handler(signedSlackApiEvent(slackEventEnvelope()));
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body ?? "{}")).toMatchObject({ ignored: true, reason: "no route" });
    expect(queue.jobs).toHaveLength(0);
  });

  it("ingest uses DEFAULT_TARGET_WEBHOOK_URL when the table is empty", async () => {
    const { ctx, queue } = createTestContext({
      defaultTargetWebhookUrl: "https://env.example/hook",
    });
    const handler = createIngestHandler(ctx);
    await handler(signedSlackApiEvent(slackEventEnvelope()));
    expect(queue.jobs[0].targetWebhookUrl).toBe("https://env.example/hook");
  });
});
