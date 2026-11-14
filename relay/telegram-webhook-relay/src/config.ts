import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";

export interface RelayConfig {
  telegramWebhookSecret: string;
  webhookUrl: string;
  webhookKey: string;
  allowAllUsers: boolean;
  allowedUserIds: Set<number>;
}

let cached: RelayConfig | undefined;
let allowAllWarned = false;

export function resetConfigCache(): void {
  cached = undefined;
  allowAllWarned = false;
}

function required(name: string, value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing ${name}`);
  }
  return value;
}

function optionalEnvOverride(env: NodeJS.ProcessEnv, key: string, fallback: string): string {
  const value = env[key];
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  return fallback;
}

function isTruthyEnv(value: string | undefined): boolean {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

export function resolveAllowlistFromEnv(env: NodeJS.ProcessEnv): {
  allowAllUsers: boolean;
  allowedUserIds: Set<number>;
} {
  if (isTruthyEnv(env.ALLOW_ALL_USERS)) {
    return { allowAllUsers: true, allowedUserIds: new Set() };
  }

  const raw = env.ALLOWED_USER_IDS?.trim();
  if (!raw || raw === "REPLACE_ME") {
    return { allowAllUsers: true, allowedUserIds: new Set() };
  }
  if (raw === "*") {
    return { allowAllUsers: true, allowedUserIds: new Set() };
  }

  const ids = new Set<number>();
  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const n = Number(trimmed);
    if (!Number.isInteger(n)) {
      throw new Error(`Invalid user id in ALLOWED_USER_IDS: ${trimmed}`);
    }
    ids.add(n);
  }

  if (ids.size === 0) {
    return { allowAllUsers: true, allowedUserIds: new Set() };
  }

  return { allowAllUsers: false, allowedUserIds: ids };
}

export function warnIfAllowAllUsers(config: RelayConfig): void {
  if (!config.allowAllUsers || allowAllWarned) return;
  allowAllWarned = true;
  console.warn(
    JSON.stringify({
      msg: "allow_all_users_enabled",
      warning:
        "ALLOWED_USER_IDS is unset, empty, *, or ALLOW_ALL_USERS is true; any human sender may trigger the bot",
    }),
  );
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

/** Local / tests only: all values in env and no SECRET_ARN. */
export function configFromEnv(env: NodeJS.ProcessEnv = process.env): RelayConfig | null {
  if (env.SECRET_ARN) {
    return null;
  }
  const telegramWebhookSecret = env.TELEGRAM_WEBHOOK_SECRET;
  const webhookKey = env.WEBHOOK_KEY;
  const webhookUrl = env.WEBHOOK_URL;
  if (!telegramWebhookSecret && !webhookKey && !webhookUrl) {
    return null;
  }
  const allowlist = resolveAllowlistFromEnv(env);
  return {
    telegramWebhookSecret: required("TELEGRAM_WEBHOOK_SECRET", telegramWebhookSecret),
    webhookUrl: required("WEBHOOK_URL", webhookUrl),
    webhookKey: required("WEBHOOK_KEY", webhookKey),
    ...allowlist,
  };
}

export async function loadConfig(args?: {
  env?: NodeJS.ProcessEnv;
  client?: SecretsManagerClient;
}): Promise<RelayConfig> {
  if (cached) return cached;
  const env = args?.env ?? process.env;

  if (env.SECRET_ARN) {
    const client = args?.client ?? new SecretsManagerClient({});
    const result = await client.send(new GetSecretValueCommand({ SecretId: env.SECRET_ARN }));
    if (!result.SecretString) {
      throw new Error("SecretString is empty");
    }
    const secretFields = parseSecretFields(result.SecretString);
    const allowlist = resolveAllowlistFromEnv(env);
    cached = {
      telegramWebhookSecret: optionalEnvOverride(env, "TELEGRAM_WEBHOOK_SECRET", secretFields.telegramWebhookSecret),
      webhookKey: optionalEnvOverride(env, "WEBHOOK_KEY", secretFields.webhookKey),
      webhookUrl: required("WEBHOOK_URL", env.WEBHOOK_URL),
      ...allowlist,
    };
    warnIfAllowAllUsers(cached);
    return cached;
  }

  const fromEnv = configFromEnv(env);
  if (fromEnv) {
    cached = fromEnv;
    warnIfAllowAllUsers(cached);
    return cached;
  }

  throw new Error(
    "Set SECRET_ARN or TELEGRAM_WEBHOOK_SECRET, WEBHOOK_KEY, and WEBHOOK_URL (ALLOWED_USER_IDS optional)",
  );
}