import type { RuntimeConfig } from "./types";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

function optionalEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${name}: ${raw}`);
  }
  return parsed;
}

export function loadConfigFromEnv(): RuntimeConfig {
  return {
    eventsTable: requiredEnv("EVENTS_TABLE"),
    threadsTable: requiredEnv("THREADS_TABLE"),
    routesTable: requiredEnv("ROUTES_TABLE"),
    directoryTable: requiredEnv("DIRECTORY_TABLE"),
    inboxTable: requiredEnv("INBOX_TABLE"),
    queueUrl: requiredEnv("QUEUE_URL"),
    secretArn: requiredEnv("SECRET_ARN"),
    replyUrl: process.env.REPLY_URL ?? "",
    apiUrl: process.env.API_URL ?? "",
    dashboardUrl: process.env.DASHBOARD_URL ?? "",
    tenantSecretPrefix: process.env.TENANT_SECRET_PREFIX ?? "easy-ai-bot-bridge",
    tenantKmsKeyId: optionalEnv("TENANT_KMS_KEY_ID"),
    corsOrigin: process.env.CORS_ORIGIN ?? "*",
    slackBotUserId: optionalEnv("SLACK_BOT_USER_ID"),
    eventTtlSeconds: intEnv("EVENT_TTL_SECONDS", 2 * 24 * 60 * 60),
    threadTtlSeconds: intEnv("THREAD_TTL_SECONDS", 90 * 24 * 60 * 60),
  };
}
