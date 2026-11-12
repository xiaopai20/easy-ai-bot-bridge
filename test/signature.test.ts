import { slackAdapter, verifySlackRequest } from "../src/adapters/slack";
import { HttpError } from "../src/lib/http";
import { createIngestHandler } from "../src/ingest/handler";
import { NOW_MS, NOW_UNIX, TEST_SECRETS, createTestContext, signedSlackApiEvent } from "./helpers";

describe("Slack signature verification", () => {
  const rawBody = '{"type":"url_verification","challenge":"abc"}';
  const timestamp = String(NOW_UNIX);

  it("accepts a valid v0 signature", () => {
    const event = signedSlackApiEvent(JSON.parse(rawBody));
    expect(() =>
      verifySlackRequest({
        headers: event.headers,
        rawBody: event.body ?? "",
        signingSecret: TEST_SECRETS.slackSigningSecret,
        nowMs: NOW_MS,
      }),
    ).not.toThrow();
  });

  it("rejects a tampered body", () => {
    const event = signedSlackApiEvent({ type: "url_verification", challenge: "abc" });
    expect(() =>
      verifySlackRequest({
        headers: event.headers,
        rawBody: '{"type":"url_verification","challenge":"tampered"}',
        signingSecret: TEST_SECRETS.slackSigningSecret,
        nowMs: NOW_MS,
      }),
    ).toThrow(HttpError);
  });

  it("rejects a wrong signing secret", () => {
    const event = signedSlackApiEvent({ type: "url_verification", challenge: "abc" });
    expect(() =>
      verifySlackRequest({
        headers: event.headers,
        rawBody: event.body ?? "",
        signingSecret: "other-secret",
        nowMs: NOW_MS,
      }),
    ).toThrow(/Invalid Slack signature/);
  });

  it("rejects timestamps older than 5 minutes", () => {
    const event = signedSlackApiEvent(
      { type: "url_verification", challenge: "abc" },
      { timestamp: String(NOW_UNIX - 301) },
    );
    expect(() =>
      verifySlackRequest({
        headers: event.headers,
        rawBody: event.body ?? "",
        signingSecret: TEST_SECRETS.slackSigningSecret,
        nowMs: NOW_MS,
      }),
    ).toThrow(/too old/);
  });

  it("rejects missing signature headers", () => {
    expect(() =>
      verifySlackRequest({
        headers: { "x-slack-request-timestamp": timestamp },
        rawBody,
        signingSecret: TEST_SECRETS.slackSigningSecret,
        nowMs: NOW_MS,
      }),
    ).toThrow(/Missing Slack signature headers/);
  });

  it("ingest returns 401 when the signature is invalid", async () => {
    const { ctx } = createTestContext();
    const handler = createIngestHandler(ctx);
    const event = signedSlackApiEvent({ type: "url_verification", challenge: "abc" });
    event.headers["x-slack-signature"] = "v0=deadbeef";
    const result = await handler(event);
    expect(result.statusCode).toBe(401);
  });

  it("ingest returns the Slack url_verification challenge as plaintext", async () => {
    const { ctx } = createTestContext();
    const handler = createIngestHandler(ctx);
    const result = await handler(
      signedSlackApiEvent({ type: "url_verification", challenge: "3eZbrw1aBm2rZgRNFdxV2595E9CY3gmdALWMmHkvFXO7tYXAYM8P" }),
    );
    expect(result.statusCode).toBe(200);
    expect(result.headers?.["content-type"]).toMatch(/text\/plain/);
    expect(result.body).toBe("3eZbrw1aBm2rZgRNFdxV2595E9CY3gmdALWMmHkvFXO7tYXAYM8P");
  });

  it("adapter.platform is slack", () => {
    expect(slackAdapter.platform).toBe("slack");
  });
});
