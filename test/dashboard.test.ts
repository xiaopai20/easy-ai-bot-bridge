import { createDashboardHandler } from "../src/dashboard/handler";
import { createSlackOAuthHandler } from "../src/slack-oauth/handler";
import { USER_A, authedApiEvent, createFetchRecorder, createTestContext } from "./helpers";

describe("dashboard API", () => {
  it("rejects requests without a Google/Cognito JWT", async () => {
    const { ctx } = createTestContext({ seedDefaultSlack: false });
    const handler = createDashboardHandler(ctx);
    const event = authedApiEvent({ method: "GET", path: "/api/me", userId: USER_A });
    delete (event.requestContext as { authorizer?: unknown }).authorizer;
    const result = await handler(event);
    expect(result.statusCode).toBe(401);
  });

  it("creates a bot and a widget channel, then links them", async () => {
    const { ctx } = createTestContext({ seedDefaultSlack: false });
    const handler = createDashboardHandler(ctx);
    const me = await handler(authedApiEvent({ method: "GET", path: "/api/me", userId: USER_A }));
    const tenantId = JSON.parse(me.body ?? "{}").tenant.tenantId as string;

    const createdBot = await handler(
      authedApiEvent({
        method: "POST",
        path: "/api/bots",
        userId: USER_A,
        body: {
          name: "Grok routine",
          webhookUrl: "https://grok.example/routine",
          webhookKey: "bot-secret",
        },
      }),
    );
    expect(createdBot.statusCode).toBe(201);
    const bot = JSON.parse(createdBot.body ?? "{}").bot;
    expect(bot.tenantId).toBe(tenantId);
    expect(bot.webhookKey).toBeUndefined();

    const createdChannel = await handler(
      authedApiEvent({
        method: "POST",
        path: "/api/channels",
        userId: USER_A,
        body: { platform: "widget", name: "Docs site", botId: bot.botId },
      }),
    );
    expect(createdChannel.statusCode).toBe(201);
    const channel = JSON.parse(createdChannel.body ?? "{}").channel;
    expect(channel.widgetToken).toMatch(/^wgt_/);

    const embed = await handler(
      authedApiEvent({ method: "GET", path: `/api/channels/${channel.channelId}/embed`, userId: USER_A }),
    );
    expect(JSON.parse(embed.body ?? "{}").snippet).toContain(channel.widgetToken);

    const telegram = await handler(
      authedApiEvent({
        method: "POST",
        path: "/api/channels",
        userId: USER_A,
        body: { platform: "telegram", name: "Later", botId: bot.botId },
      }),
    );
    expect(telegram.statusCode).toBe(201);
    expect(JSON.parse(telegram.body ?? "{}").channel.platform).toBe("telegram");
  });

  it("returns a Slack Add to Slack URL with signed state", async () => {
    const { ctx } = createTestContext({ seedDefaultSlack: false });
    const handler = createDashboardHandler(ctx);
    await handler(authedApiEvent({ method: "GET", path: "/api/me", userId: USER_A }));
    const result = await handler(
      authedApiEvent({ method: "GET", path: "/api/slack/install-url", userId: USER_A }),
    );
    expect(result.statusCode).toBe(200);
    const url = JSON.parse(result.body ?? "{}").url as string;
    expect(url).toContain("https://slack.com/oauth/v2/authorize");
    expect(url).toContain("client_id=slack-client-id");
    expect(url).toContain("app_mentions%3Aread");
  });

  it("stores a Slack install on the tenant from the OAuth callback", async () => {
    const { fetchFn, calls } = createFetchRecorder((call) => {
      if (call.url.includes("oauth.v2.access")) {
        return {
          status: 200,
          json: {
            ok: true,
            access_token: "xoxb-workspace",
            bot_user_id: "UBOT",
            team: { id: "TNEW", name: "New Workspace" },
          },
        };
      }
      return { status: 200, json: { ok: true } };
    });
    const { ctx, stores, tenantSecrets } = createTestContext({ fetchFn, seedDefaultSlack: false });
    const dash = createDashboardHandler(ctx);
    await dash(authedApiEvent({ method: "GET", path: "/api/me", userId: USER_A }));
    await dash(
      authedApiEvent({
        method: "POST",
        path: "/api/bots",
        userId: USER_A,
        body: { name: "Bot", webhookUrl: "https://bot.example", webhookKey: "k" },
      }),
    );
    const install = await dash(authedApiEvent({ method: "GET", path: "/api/slack/install-url", userId: USER_A }));
    const url = new URL(JSON.parse(install.body ?? "{}").url);
    const state = url.searchParams.get("state") ?? "";

    const oauth = createSlackOAuthHandler(ctx);
    const result = await oauth({
      version: "2.0",
      routeKey: "GET /slack/oauth/callback",
      rawPath: "/slack/oauth/callback",
      rawQueryString: `code=abc&state=${encodeURIComponent(state)}`,
      headers: {},
      isBase64Encoded: false,
      queryStringParameters: { code: "abc", state },
      requestContext: {
        accountId: "test",
        apiId: "api",
        domainName: "bridge.example",
        domainPrefix: "bridge",
        http: {
          method: "GET",
          path: "/slack/oauth/callback",
          protocol: "HTTP/1.1",
          sourceIp: "127.0.0.1",
          userAgent: "test",
        },
        requestId: "oauth",
        routeKey: "GET /slack/oauth/callback",
        stage: "$default",
        time: "now",
        timeEpoch: Date.now(),
      },
    } as never);
    expect(result.statusCode).toBe(302);
    expect(calls.some((call) => call.url.includes("oauth.v2.access"))).toBe(true);
    const mapping = await stores.getSlackTeamMapping("TNEW");
    expect(mapping?.tenantId).toBe((await stores.getUserTenantId(USER_A)));
    expect(await tenantSecrets.getSlackToken(mapping!.tenantId, "TNEW")).toBe("xoxb-workspace");
  });
});
