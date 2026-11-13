import { createIngestHandler } from "../src/ingest/handler";
import { composeThreadId, eventPk, threadPk } from "../src/lib/keys";
import {
  TENANT_A,
  createTestContext,
  slackEventEnvelope,
  signedSlackApiEvent,
} from "./helpers";

function seedWorkspaceRoute() {
  const setup = createTestContext();
  setup.stores.seedRoute({
    tenantId: TENANT_A,
    platform: "slack",
    workspaceId: "T0123456789",
    channelId: "*",
    targetWebhookUrl: "https://bot.example/hook",
    targetId: "default-grok",
    enabled: true,
  });
  return setup;
}

describe("event dedupe", () => {
  it("enqueues a new event once and records it", async () => {
    const { ctx, stores, queue } = seedWorkspaceRoute();
    const handler = createIngestHandler(ctx);
    const result = await handler(signedSlackApiEvent(slackEventEnvelope({ eventId: "EvNEW" })));
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body ?? "{}")).toEqual({ ok: true });
    expect(queue.jobs).toHaveLength(1);
    expect(stores.events.has(eventPk(TENANT_A, "slack", "EvNEW"))).toBe(true);
    const threadId = composeThreadId(TENANT_A, "slack:T0123456789:C999:1731448800.000100");
    expect(stores.threads.has(threadPk(TENANT_A, threadId))).toBe(true);
  });

  it("ignores a duplicate event_id without enqueueing again", async () => {
    const { ctx, queue } = seedWorkspaceRoute();
    const handler = createIngestHandler(ctx);
    const event = signedSlackApiEvent(slackEventEnvelope({ eventId: "EvDUP" }));
    const first = await handler(event);
    const second = await handler(event);
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(JSON.parse(second.body ?? "{}")).toEqual({ ok: true, duplicate: true });
    expect(queue.jobs).toHaveLength(1);
  });

  it("clears the dedupe record when enqueue fails so Slack can retry", async () => {
    const { ctx, stores, queue } = seedWorkspaceRoute();
    queue.failNext = true;
    const handler = createIngestHandler(ctx);
    const result = await handler(signedSlackApiEvent(slackEventEnvelope({ eventId: "EvFAIL" })));
    expect(result.statusCode).toBe(500);
    expect(stores.events.has(eventPk(TENANT_A, "slack", "EvFAIL"))).toBe(false);
    expect(queue.jobs).toHaveLength(0);
  });

  it("ignores the bot's own messages without writing a dedupe record", async () => {
    const { ctx, stores, queue } = seedWorkspaceRoute();
    const handler = createIngestHandler(ctx);
    const result = await handler(
      signedSlackApiEvent(
        slackEventEnvelope({
          eventId: "EvBOT",
          botId: "B01",
          text: "I am a bot",
        }),
      ),
    );
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body ?? "{}").ignored).toBe(true);
    expect(queue.jobs).toHaveLength(0);
    expect(stores.events.size).toBe(0);
  });

  it("ignores messages from the configured Slack bot user id", async () => {
    const { ctx, queue, stores } = createTestContext({ slackBotUserId: "UBOT" });
    stores.seedRoute({
      tenantId: TENANT_A,
      platform: "slack",
      workspaceId: "T0123456789",
      channelId: "*",
      targetWebhookUrl: "https://bot.example/hook",
      enabled: true,
    });
    const handler = createIngestHandler(ctx);
    const result = await handler(
      signedSlackApiEvent(slackEventEnvelope({ user: "UBOT", text: "<@UBOT> ping" })),
    );
    expect(JSON.parse(result.body ?? "{}").reason).toBe("self message");
    expect(queue.jobs).toHaveLength(0);
  });
});
