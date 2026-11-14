import { createDashboardHandler } from "../src/dashboard/handler";
import { DEFAULT_LIMITS, mergeLimits, parseLimitsOverride } from "../src/lib/limits";
import { HttpError } from "../src/lib/http";
import { USER_A, authedApiEvent, createTestContext } from "./helpers";

describe("limits model", () => {
  it("merges per-tenant overrides onto defaults", () => {
    const merged = mergeLimits(DEFAULT_LIMITS, { messagesPerMinute: 10, maxBots: 2 });
    expect(merged.messagesPerMinute).toBe(10);
    expect(merged.maxBots).toBe(2);
    expect(merged.messagesPerDay).toBe(DEFAULT_LIMITS.messagesPerDay);
    expect(merged.maxChannels).toBe(DEFAULT_LIMITS.maxChannels);
    expect(merged.loopMessagesPerThreadPerMinute).toBe(DEFAULT_LIMITS.loopMessagesPerThreadPerMinute);
  });

  it("rejects invalid override values", () => {
    expect(() => parseLimitsOverride({ messagesPerMinute: 0 })).toThrow(HttpError);
    expect(() => parseLimitsOverride({ maxBots: 1.5 })).toThrow(HttpError);
  });

  it("enforces maxBots on create", async () => {
    const { ctx } = createTestContext({
      seedDefaultSlack: false,
      defaultLimits: { ...DEFAULT_LIMITS, maxBots: 2 },
    });
    const handler = createDashboardHandler(ctx);
    await handler(authedApiEvent({ method: "GET", path: "/api/me", userId: USER_A }));
    for (let i = 0; i < 2; i += 1) {
      const created = await handler(
        authedApiEvent({
          method: "POST",
          path: "/api/bots",
          userId: USER_A,
          body: { name: `Bot ${i}`, webhookUrl: "https://bot.example/hook", webhookKey: "k" },
        }),
      );
      expect(created.statusCode).toBe(201);
    }
    const denied = await handler(
      authedApiEvent({
        method: "POST",
        path: "/api/bots",
        userId: USER_A,
        body: { name: "Bot extra", webhookUrl: "https://bot.example/hook", webhookKey: "k" },
      }),
    );
    expect(denied.statusCode).toBe(400);
    expect(JSON.parse(denied.body ?? "{}").error).toMatch(/Bot limit reached/);
  });

  it("enforces maxChannels on widget create", async () => {
    const { ctx } = createTestContext({
      seedDefaultSlack: false,
      defaultLimits: { ...DEFAULT_LIMITS, maxChannels: 1 },
    });
    const handler = createDashboardHandler(ctx);
    await handler(authedApiEvent({ method: "GET", path: "/api/me", userId: USER_A }));
    const botRes = await handler(
      authedApiEvent({
        method: "POST",
        path: "/api/bots",
        userId: USER_A,
        body: { name: "Bot", webhookUrl: "https://bot.example/hook", webhookKey: "k" },
      }),
    );
    const botId = JSON.parse(botRes.body ?? "{}").bot.botId as string;
    const first = await handler(
      authedApiEvent({
        method: "POST",
        path: "/api/channels",
        userId: USER_A,
        body: { platform: "widget", name: "One", botId },
      }),
    );
    expect(first.statusCode).toBe(201);
    const second = await handler(
      authedApiEvent({
        method: "POST",
        path: "/api/channels",
        userId: USER_A,
        body: { platform: "widget", name: "Two", botId },
      }),
    );
    expect(second.statusCode).toBe(400);
    expect(JSON.parse(second.body ?? "{}").error).toMatch(/Channel limit reached/);
  });

  it("returns usage on GET /api/me and GET /api/usage", async () => {
    const { ctx } = createTestContext({ seedDefaultSlack: false });
    const handler = createDashboardHandler(ctx);
    const me = await handler(authedApiEvent({ method: "GET", path: "/api/me", userId: USER_A }));
    const meBody = JSON.parse(me.body ?? "{}");
    expect(meBody.limits.maxBots).toBe(DEFAULT_LIMITS.maxBots);
    expect(meBody.limits.messagesPerMinute).toBe(120);
    expect(meBody.limits.messagesPerDay).toBe(10_000);
    expect(meBody.usage).toEqual({ bots: 0, channels: 0, routes: 0 });
    expect(meBody.isAdmin).toBe(false);

    const usage = await handler(authedApiEvent({ method: "GET", path: "/api/usage", userId: USER_A }));
    expect(usage.statusCode).toBe(200);
    expect(JSON.parse(usage.body ?? "{}").limits.loopMessagesPerThreadPerMinute).toBe(20);
  });

  it("lets an allowlisted admin set and merge a tenant override", async () => {
    const { ctx } = createTestContext({
      seedDefaultSlack: false,
      adminEmails: ["admin@example.com"],
    });
    const handler = createDashboardHandler(ctx);
    const me = await handler(
      authedApiEvent({ method: "GET", path: "/api/me", userId: USER_A, email: "a@example.com" }),
    );
    const tenantId = JSON.parse(me.body ?? "{}").tenant.tenantId as string;

    const forbidden = await handler(
      authedApiEvent({
        method: "GET",
        path: `/api/admin/tenants/${tenantId}`,
        userId: USER_A,
        email: "a@example.com",
      }),
    );
    expect(forbidden.statusCode).toBe(403);

    const loaded = await handler(
      authedApiEvent({
        method: "GET",
        path: `/api/admin/tenants/${tenantId}`,
        userId: "admin-1",
        email: "admin@example.com",
      }),
    );
    expect(loaded.statusCode).toBe(200);

    const patched = await handler(
      authedApiEvent({
        method: "PATCH",
        path: `/api/admin/tenants/${tenantId}/limits`,
        userId: "admin-1",
        email: "admin@example.com",
        body: { messagesPerMinute: 15, maxBots: 3 },
      }),
    );
    expect(patched.statusCode).toBe(200);
    const body = JSON.parse(patched.body ?? "{}");
    expect(body.limits.messagesPerMinute).toBe(15);
    expect(body.limits.maxBots).toBe(3);
    expect(body.limits.messagesPerDay).toBe(10_000);
    expect(body.override).toEqual({ messagesPerMinute: 15, maxBots: 3 });

    const merged = await handler(
      authedApiEvent({
        method: "PATCH",
        path: `/api/admin/tenants/${tenantId}/limits`,
        userId: "admin-1",
        email: "admin@example.com",
        body: { messagesPerDay: 50 },
      }),
    );
    const mergedBody = JSON.parse(merged.body ?? "{}");
    expect(mergedBody.override).toEqual({ messagesPerMinute: 15, maxBots: 3, messagesPerDay: 50 });
  });

  it("returns 403 for admin routes when ADMIN_EMAILS is empty", async () => {
    const { ctx } = createTestContext({ seedDefaultSlack: false });
    const handler = createDashboardHandler(ctx);
    const me = await handler(authedApiEvent({ method: "GET", path: "/api/me", userId: USER_A }));
    const tenantId = JSON.parse(me.body ?? "{}").tenant.tenantId as string;
    const result = await handler(
      authedApiEvent({
        method: "GET",
        path: `/api/admin/tenants/${tenantId}`,
        userId: USER_A,
        email: "a@example.com",
      }),
    );
    expect(result.statusCode).toBe(403);
  });
});
