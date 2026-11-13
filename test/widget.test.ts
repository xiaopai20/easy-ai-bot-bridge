import { createDashboardHandler } from "../src/dashboard/handler";
import { createForwarderHandler } from "../src/forwarder/handler";
import { createReplyHandler } from "../src/reply/handler";
import { createWidgetHandler } from "../src/widget/handler";
import { USER_A, authedApiEvent, createFetchRecorder, createTestContext, replyApiEvent } from "./helpers";

describe("website chat widget", () => {
  it("round-trips a visitor message to the bot and back into the inbox", async () => {
    const { fetchFn, calls } = createFetchRecorder();
    const { ctx, queue } = createTestContext({ fetchFn, seedDefaultSlack: false });
    const dash = createDashboardHandler(ctx);
    await dash(authedApiEvent({ method: "GET", path: "/api/me", userId: USER_A }));
    const botRes = await dash(
      authedApiEvent({
        method: "POST",
        path: "/api/bots",
        userId: USER_A,
        body: { name: "Grok", webhookUrl: "https://grok.example/routine", webhookKey: "wk" },
      }),
    );
    const botId = JSON.parse(botRes.body ?? "{}").bot.botId as string;
    const chRes = await dash(
      authedApiEvent({
        method: "POST",
        path: "/api/channels",
        userId: USER_A,
        body: { platform: "widget", name: "Docs", botId },
      }),
    );
    const token = JSON.parse(chRes.body ?? "{}").channel.widgetToken as string;

    const widget = createWidgetHandler(ctx);
    const posted = await widget({
      version: "2.0",
      routeKey: "POST /widget/events",
      rawPath: "/widget/events",
      rawQueryString: "",
      headers: { "content-type": "application/json" },
      isBase64Encoded: false,
      body: JSON.stringify({ token, text: "Hello widget", thread: "sess-1", event_id: "w1" }),
      requestContext: {
        accountId: "test",
        apiId: "api",
        domainName: "bridge.example",
        domainPrefix: "bridge",
        http: {
          method: "POST",
          path: "/widget/events",
          protocol: "HTTP/1.1",
          sourceIp: "127.0.0.1",
          userAgent: "test",
        },
        requestId: "w",
        routeKey: "POST /widget/events",
        stage: "$default",
        time: "now",
        timeEpoch: Date.now(),
      },
    } as never);
    expect(posted.statusCode).toBe(200);
    expect(queue.jobs).toHaveLength(1);
    expect(queue.jobs[0].message.platform).toBe("widget");

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
    const payload = JSON.parse(calls[0].body);
    const reply = await createReplyHandler(ctx)(
      replyApiEvent({ thread: payload.thread, text: "Hi from the bot", token: payload.reply_token }),
    );
    expect(reply.statusCode).toBe(200);

    const listed = await widget({
      version: "2.0",
      routeKey: "GET /widget/messages",
      rawPath: "/widget/messages",
      rawQueryString: `token=${token}&thread=sess-1`,
      headers: {},
      isBase64Encoded: false,
      queryStringParameters: { token, thread: "sess-1" },
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
        requestId: "w2",
        routeKey: "GET /widget/messages",
        stage: "$default",
        time: "now",
        timeEpoch: Date.now(),
      },
    } as never);
    const messages = JSON.parse(listed.body ?? "{}").messages as Array<{ role: string; text: string }>;
    expect(messages.map((m) => `${m.role}:${m.text}`)).toEqual(["user:Hello widget", "bot:Hi from the bot"]);
  });
});
