import type { SQSEvent } from "aws-lambda";
import { createForwarderHandler } from "../src/forwarder/handler";
import { createIngestHandler } from "../src/ingest/handler";
import { createReplyHandler } from "../src/reply/handler";
import { telegramAdapter } from "../src/adapters/telegram";
import {
  TENANT_A,
  TEST_SECRETS,
  createFetchRecorder,
  createTestContext,
  replyApiEvent,
  slackEventEnvelope,
  signedSlackApiEvent,
} from "./helpers";
import { composeThreadId } from "../src/lib/keys";

const PLATFORM_THREAD = "slack:T0123456789:C999:1731448800.000100";
const THREAD_ID = composeThreadId(TENANT_A, PLATFORM_THREAD);

describe("mocked end-to-end Slack -> bot -> Slack thread", () => {
  it("forwards an app_mention and posts the bot reply on the same thread", async () => {
    const { fetchFn, calls } = createFetchRecorder();
    const { ctx, queue, stores } = createTestContext({ fetchFn });
    stores.seedRoute({
      tenantId: TENANT_A,
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
      text: "<@UBOT> What is the weather today?",
      ts: "1731448800.000100",
      channel: "C999",
    });
    const ingestResult = await ingest(signedSlackApiEvent(mention));
    expect(ingestResult.statusCode).toBe(200);
    expect(queue.jobs).toHaveLength(1);

    const job = queue.jobs[0];
    expect(job.message.text).toBe("What is the weather today?");
    expect(job.message.threadId).toBe(THREAD_ID);
    expect(job.tenantId).toBe(TENANT_A);
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
      thread: THREAD_ID,
      text: "What is the weather today?",
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
        text: "Sunny, 20C.",
        token: payload.reply_token,
      }),
    );
    expect(replyResult.statusCode).toBe(200);

    const slackCall = calls.find((call) => call.url === "https://slack.com/api/chat.postMessage");
    expect(slackCall).toBeDefined();
    expect(JSON.parse(slackCall?.body ?? "{}")).toEqual({
      channel: "C999",
      thread_ts: "1731448800.000100",
      text: "Sunny, 20C.",
    });
  });

  it("preserves non-ASCII UTF-8 text through ingest, forward, and reply", async () => {
    // Escaped so this source file stays ASCII. Runtime values are non-ASCII UTF-8.
    const inbound = "\u4f60\u597d";
    const outbound = "\u4f60\u597d \u{1F44B}";

    const { fetchFn, calls } = createFetchRecorder();
    const { ctx, queue, stores } = createTestContext({ fetchFn });
    stores.seedRoute({
      tenantId: TENANT_A,
      platform: "slack",
      workspaceId: "T0123456789",
      channelId: "*",
      targetWebhookUrl: "https://grok.example/routine",
      targetId: "default-grok",
      enabled: true,
    });

    const ingest = createIngestHandler(ctx);
    const ingestResult = await ingest(
      signedSlackApiEvent(
        slackEventEnvelope({
          eventId: "EvUTF8",
          text: `<@UBOT> ${inbound}`,
          ts: "1731448800.000100",
          channel: "C999",
        }),
      ),
    );
    expect(ingestResult.statusCode).toBe(200);
    expect(queue.jobs[0].message.text).toBe(inbound);

    await createForwarderHandler(ctx)({
      Records: [
        {
          messageId: "m-utf8",
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

    const webhookCall = calls.find((call) => call.url === "https://grok.example/routine");
    const payload = JSON.parse(webhookCall?.body ?? "{}") as {
      thread: string;
      text: string;
      reply_token: string;
    };
    expect(payload.text).toBe(inbound);

    const replyResult = await createReplyHandler(ctx)(
      replyApiEvent({
        thread: payload.thread,
        text: outbound,
        token: payload.reply_token,
      }),
    );
    expect(replyResult.statusCode).toBe(200);

    const slackCall = calls.find((call) => call.url === "https://slack.com/api/chat.postMessage");
    const posted = JSON.parse(slackCall?.body ?? "{}") as { text: string };
    expect(posted.text).toBe(outbound);
    expect(Buffer.byteLength(posted.text, "utf8")).toBeGreaterThan(posted.text.length);
  });

  it("threads a follow-up mention onto the parent thread_ts", async () => {
    const { fetchFn, calls } = createFetchRecorder();
    const { ctx, queue, stores } = createTestContext({ fetchFn });
    stores.seedRoute({
      tenantId: TENANT_A,
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
    expect(payload.thread).toBe(THREAD_ID);
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
