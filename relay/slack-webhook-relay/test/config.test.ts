import { vi } from "vitest";
import type { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { loadConfig, resetConfigCache } from "../src/config";

beforeEach(() => {
  resetConfigCache();
});

describe("loadConfig with SECRET_ARN", () => {
  it("loads all fields from Secrets Manager when only SECRET_ARN is set", async () => {
    const send = vi.fn().mockResolvedValue({
      SecretString: JSON.stringify({
        SLACK_SIGNING_SECRET: "slack-signing",
        WEBHOOK_URL: "https://grok.example/routine",
        WEBHOOK_KEY: "bearer-from-sm",
      }),
    });
    const client = { send } as unknown as SecretsManagerClient;

    const cfg = await loadConfig({
      env: {
        SECRET_ARN: "arn:aws:secretsmanager:us-east-1:123456789012:secret:test",
      },
      client,
    });

    expect(cfg.slackSigningSecret).toBe("slack-signing");
    expect(cfg.webhookUrl).toBe("https://grok.example/routine");
    expect(cfg.webhookKey).toBe("bearer-from-sm");
  });

  it("does not treat WEBHOOK_URL in env alone as a full env config", async () => {
    const send = vi.fn().mockResolvedValue({
      SecretString: JSON.stringify({
        SLACK_SIGNING_SECRET: "slack-signing",
        WEBHOOK_URL: "https://from-sm.example/routine",
        WEBHOOK_KEY: "bearer-from-sm",
      }),
    });
    const client = { send } as unknown as SecretsManagerClient;

    const cfg = await loadConfig({
      env: {
        SECRET_ARN: "arn:aws:secretsmanager:us-east-1:123456789012:secret:test",
        WEBHOOK_URL: "https://override.example/routine",
      },
      client,
    });

    expect(send).toHaveBeenCalled();
    expect(cfg.slackSigningSecret).toBe("slack-signing");
    expect(cfg.webhookUrl).toBe("https://override.example/routine");
  });
});