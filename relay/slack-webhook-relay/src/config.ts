import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";

export interface RelayConfig {
  slackSigningSecret: string;
  webhookUrl: string;
  webhookKey: string;
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

function optionalEnvOverride(env: NodeJS.ProcessEnv, key: string, fallback: string): string {
  const value = env[key];
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  return fallback;
}

export function parseSecretFields(raw: string): Omit<RelayConfig, never> {
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
    slackSigningSecret: required("SLACK_SIGNING_SECRET", obj.SLACK_SIGNING_SECRET),
    webhookUrl: required("WEBHOOK_URL", obj.WEBHOOK_URL),
    webhookKey: required("WEBHOOK_KEY", obj.WEBHOOK_KEY),
  };
}

/** Local / tests only: all values in env and no SECRET_ARN. */
export function configFromEnv(env: NodeJS.ProcessEnv = process.env): RelayConfig | null {
  if (env.SECRET_ARN) {
    return null;
  }
  const slackSigningSecret = env.SLACK_SIGNING_SECRET;
  const webhookUrl = env.WEBHOOK_URL;
  const webhookKey = env.WEBHOOK_KEY;
  if (!slackSigningSecret && !webhookUrl && !webhookKey) {
    return null;
  }
  return {
    slackSigningSecret: required("SLACK_SIGNING_SECRET", slackSigningSecret),
    webhookUrl: required("WEBHOOK_URL", webhookUrl),
    webhookKey: required("WEBHOOK_KEY", webhookKey),
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
    cached = {
      slackSigningSecret: optionalEnvOverride(env, "SLACK_SIGNING_SECRET", secretFields.slackSigningSecret),
      webhookKey: optionalEnvOverride(env, "WEBHOOK_KEY", secretFields.webhookKey),
      webhookUrl: optionalEnvOverride(env, "WEBHOOK_URL", secretFields.webhookUrl),
    };
    return cached;
  }

  const fromEnv = configFromEnv(env);
  if (fromEnv) {
    cached = fromEnv;
    return cached;
  }

  throw new Error("Set SECRET_ARN or SLACK_SIGNING_SECRET, WEBHOOK_URL, and WEBHOOK_KEY");
}