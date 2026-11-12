import type { SQSEvent } from "aws-lambda";
import { createForwarderHandler } from "../src/forwarder/handler";
import { createIngestHandler } from "../src/ingest/handler";
import { createReplyHandler } from "../src/reply/handler";
import { telegramAdapter } from "../src/adapters/telegram";
import {
  TEST_SECRETS,
  createFetchRecorder,
  createTestContext,
  replyApiEvent,
  slackEventEnvelope,
  signedSlackApiEvent,
} from "./helpers";

describe("mocked end-to-end Slack -> bot -> Slack thread", () => {
  it("forwards an app_mention and posts the bot reply on the same thread", async () => {
    const { fetchFn, calls } = createFetchRecorder();
    const { ctx, queue, stores } = createTestContext({ fetchFn });
    stores.seedRoute({
      platform: "slack",
      workspaceId: "T0123456789",
      channelId: "*",
      targetWebhookUrl: "https://grok.example/routine",
      targetId: "default-grok",
      enabled: true,
    });

    const ingest = createIngestHandler(ctx);
    const mention = slackEventEnvelope({
      eventId: "EvE2E1",
      text: "<@UBOT> 今天天气怎么样？",
      ts: "1731448800.000100",
      channel: "C999",
    });
    const ingestResult = await ingest(signedSlackApiEvent(mention));
    expect(ingestResult.statusCode).toBe(200);
    expect(queue.jobs).toHaveLength(1);

    const job = queue.jobs[0];
    expect(job.message.text).toBe("今天天气怎么样？");
    expect(job.message.threadId).toBe("slack:T0123456789:C999:1731448800.000100");
    expect(job.message.sentAt).toBe(new Date(1731448800 * 1000).toISOString());
    expect(job.targetWebhookUrl).toBe("https://grok.example/routine");

    const forwarder = createForwarderHandler(ctx);
    const sqsEvent: SQSEvent = {
      Records: [
        {
          messageId: "m1",
          receiptHandle: "rh",
          body: JSON.stringify(job),
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
    };
    await forwarder(sqsEvent);

    const webhookCall = calls.find((call) => call.url === "https://grok.example/routine");
    expect(webhookCall).toBeDefined();
    expect(webhookCall?.headers.authorization).toBe(`Bearer ${TEST_SECRETS.targetWebhookKey}`);
    const payload = JSON.parse(webhookCall?.body ?? "{}") as {
      thread: string;
      text: string;
      sent_at: string;
      platform: string;
      reply_url: string;
      reply_token: string;
      sender: { id: string };
    };
    expect(payload).toMatchObject({
      thread: "slack:T0123456789:C999:1731448800.000100",
      text: "今天天气怎么样？",
      sent_at: new Date(1731448800 * 1000).toISOString(),
      platform: "slack",
      reply_url: "https://bridge.example/reply",
    });
    expect(payload.reply_token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(payload.sender.id).toBe("U111");

    const reply = createReplyHandler(ctx);
    const replyResult = await reply(
      replyApiEvent({
        thread: payload.thread,
        text: "今天晴，20°C。",
        token: payload.reply_token,
      }),
    );
    expect(replyResult.statusCode).toBe(200);

    const slackCall = calls.find((call) => call.url === "https://slack.com/api/chat.postMessage");
    expect(slackCall).toBeDefined();
    expect(JSON.parse(slackCall?.body ?? "{}")).toEqual({
      channel: "C999",
      thread_ts: "1731448800.000100",
      text: "今天晴，20°C。",
    });
  });

  it("threads a follow-up mention onto the parent thread_ts", async () => {
    const { fetchFn, calls } = createFetchRecorder();
    const { ctx, queue, stores } = createTestContext({ fetchFn });
    stores.seedRoute({
      platform: "slack",
      workspaceId: "T0123456789",
      channelId: "C999",
      targetWebhookUrl: "https://grok.example/routine",
      enabled: true,
    });

    const ingest = createIngestHandler(ctx);
    await ingest(
      signedSlackApiEvent(
        slackEventEnvelope({
          eventId: "EvTHREAD",
          text: "<@UBOT> follow up",
          ts: "1731448900.000200",
          threadTs: "1731448800.000100",
          channel: "C999",
        }),
      ),
    );
    await createForwarderHandler(ctx)({
      Records: [
        {
          messageId: "m2",
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
    expect(payload.thread).toBe("slack:T0123456789:C999:1731448800.000100");
    expect(payload.conversation.thread_ts).toBe("1731448800.000100");
  });
});

describe("Telegram adapter stub", () => {
  it("exposes the adapter interface but is not implemented", () => {
    expect(telegramAdapter.platform).toBe("telegram");
    expect(() => telegramAdapter.verifyRequest({ headers: {}, rawBody: "", signingSecret: "", nowMs: 0 })).toThrow(
      /not implemented/,
    );
  });
});
