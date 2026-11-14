import { vi } from "vitest";
import type { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { loadConfig, resetConfigCache, resolveAllowlistFromEnv } from "../src/config";

beforeEach(() => {
  resetConfigCache();
});

describe("resolveAllowlistFromEnv", () => {
  it("allow all when ALLOWED_USER_IDS is unset or empty", () => {
    expect(resolveAllowlistFromEnv({})).toEqual({ allowAllUsers: true, allowedUserIds: new Set() });
    expect(resolveAllowlistFromEnv({ ALLOWED_USER_IDS: "" })).toEqual({
      allowAllUsers: true,
      allowedUserIds: new Set(),
    });
  });

  it("allow all for ALLOW_ALL_USERS, *, or REPLACE_ME", () => {
    expect(resolveAllowlistFromEnv({ ALLOW_ALL_USERS: "true" }).allowAllUsers).toBe(true);
    expect(resolveAllowlistFromEnv({ ALLOWED_USER_IDS: "*" }).allowAllUsers).toBe(true);
    expect(resolveAllowlistFromEnv({ ALLOWED_USER_IDS: "REPLACE_ME" }).allowAllUsers).toBe(true);
  });

  it("allowlists numeric ids when set", () => {
    const result = resolveAllowlistFromEnv({ ALLOWED_USER_IDS: "1001, 1002" });
    expect(result.allowAllUsers).toBe(false);
    expect(result.allowedUserIds).toEqual(new Set([1001, 1002]));
  });
});

describe("loadConfig with SECRET_ARN", () => {
  it("loads webhook URL from env and secrets from Secrets Manager", async () => {
    const send = vi.fn().mockResolvedValue({
      SecretString: JSON.stringify({
        TELEGRAM_WEBHOOK_SECRET: "tg-webhook-secret",
        WEBHOOK_KEY: "bearer-from-sm",
      }),
    });
    const client = { send } as unknown as SecretsManagerClient;

    const cfg = await loadConfig({
      env: {
        SECRET_ARN: "arn:aws:secretsmanager:us-east-1:123456789012:secret:test",
        WEBHOOK_URL: "https://grok.example/routine",
      },
      client,
    });

    expect(send).toHaveBeenCalled();
    expect(cfg.telegramWebhookSecret).toBe("tg-webhook-secret");
    expect(cfg.webhookKey).toBe("bearer-from-sm");
    expect(cfg.webhookUrl).toBe("https://grok.example/routine");
  });
});