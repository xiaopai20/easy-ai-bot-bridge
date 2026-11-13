import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import type { BridgeSecrets } from "./types";

export function parseSecrets(raw: string): BridgeSecrets {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Secret is not valid JSON");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Secret JSON must be an object");
  }
  const obj = parsed as Record<string, unknown>;
  const required = (key: string): string => {
    const value = obj[key];
    if (typeof value !== "string" || value.length === 0) {
      throw new Error(`Secret missing ${key}`);
    }
    return value;
  };
  const optional = (key: string): string | undefined => {
    const value = obj[key];
    return typeof value === "string" && value.length > 0 ? value : undefined;
  };

  let targetWebhookKeys: Record<string, string> | undefined;
  if (obj.targetWebhookKeys && typeof obj.targetWebhookKeys === "object") {
    targetWebhookKeys = {};
    for (const [key, value] of Object.entries(obj.targetWebhookKeys as Record<string, unknown>)) {
      if (typeof value === "string" && value.length > 0) {
        targetWebhookKeys[key] = value;
      }
    }
  }

  return {
    slackSigningSecret: required("slackSigningSecret"),
    callbackSigningSecret: required("callbackSigningSecret"),
    slackBotToken: optional("slackBotToken"),
    targetWebhookKey: optional("targetWebhookKey"),
    slackClientId: optional("slackClientId"),
    slackClientSecret: optional("slackClientSecret"),
    targetWebhookKeys,
  };
}

export function webhookKeyForTarget(secrets: BridgeSecrets, targetId?: string): string | undefined {
  if (targetId && secrets.targetWebhookKeys?.[targetId]) {
    return secrets.targetWebhookKeys[targetId];
  }
  return secrets.targetWebhookKey;
}

export function createSecretsLoader(
  client: SecretsManagerClient,
  secretArn: string,
  ttlMs = 5 * 60 * 1000,
): () => Promise<BridgeSecrets> {
  let cached: { value: BridgeSecrets; loadedAt: number } | null = null;
  return async () => {
    const now = Date.now();
    if (cached && now - cached.loadedAt < ttlMs) {
      return cached.value;
    }
    const result = await client.send(new GetSecretValueCommand({ SecretId: secretArn }));
    if (!result.SecretString) {
      throw new Error("SecretString is empty");
    }
    const value = parseSecrets(result.SecretString);
    cached = { value, loadedAt: now };
    return value;
  };
}
