import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";

export interface RelayConfig {
  telegramWebhookSecret: string;
  webhookUrl: string;
  webhookKey: string;
  allowedUserIds: Set<number>;
}

let cached: RelayConfig | undefined;

export function resetConfigCache(): void {
  cached = undefined;
}

function required(name: string, value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing ${name}`);
  }
  return value;
}

export function parseAllowedUserIds(raw: string | undefined): Set<number> {
  const ids = new Set<number>();
  if (!raw || raw === "REPLACE_ME") {
    return ids;
  }
  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const n = Number(trimmed);
    if (!Number.isInteger(n)) {
      throw new Error(`Invalid user id in ALLOWED_USER_IDS: ${trimmed}`);
    }
    ids.add(n);
  }
  return ids;
}

export function parseSecretFields(raw: string): { telegramWebhookSecret: string; webhookKey: string } {
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
  return {
    telegramWebhookSecret: required("TELEGRAM_WEBHOOK_SECRET", obj.TELEGRAM_WEBHOOK_SECRET),
    webhookKey: required("WEBHOOK_KEY", obj.WEBHOOK_KEY),
  };
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): RelayConfig | null {
  const telegramWebhookSecret = env.TELEGRAM_WEBHOOK_SECRET;
  const webhookKey = env.WEBHOOK_KEY;
  const webhookUrl = env.WEBHOOK_URL;
  if (!telegramWebhookSecret && !webhookKey && !webhookUrl) {
    return null;
  }
  return {
    telegramWebhookSecret: required("TELEGRAM_WEBHOOK_SECRET", telegramWebhookSecret),
    webhookUrl: required("WEBHOOK_URL", webhookUrl),
    webhookKey: required("WEBHOOK_KEY", webhookKey),
    allowedUserIds: parseAllowedUserIds(env.ALLOWED_USER_IDS),
  };
}

export async function loadConfig(args?: {
  env?: NodeJS.ProcessEnv;
  client?: SecretsManagerClient;
}): Promise<RelayConfig> {
  if (cached) return cached;
  const env = args?.env ?? process.env;
  const fromEnv = configFromEnv(env);
  if (fromEnv) {
    cached = fromEnv;
    return cached;
  }
  const secretArn = env.SECRET_ARN;
  if (!secretArn) {
    throw new Error(
      "Set SECRET_ARN or TELEGRAM_WEBHOOK_SECRET, WEBHOOK_KEY, and WEBHOOK_URL (plus ALLOWED_USER_IDS)",
    );
  }
  const client = args?.client ?? new SecretsManagerClient({});
  const result = await client.send(new GetSecretValueCommand({ SecretId: secretArn }));
  if (!result.SecretString) {
    throw new Error("SecretString is empty");
  }
  const secretFields = parseSecretFields(result.SecretString);
  cached = {
    ...secretFields,
    webhookUrl: required("WEBHOOK_URL", env.WEBHOOK_URL),
    allowedUserIds: parseAllowedUserIds(env.ALLOWED_USER_IDS),
  };
  return cached;
}