import { DEFAULT_LIMITS, parseAdminEmails } from "./limits";
import type { RuntimeConfig, TenantLimits } from "./types";

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

function intEnv(name: string, fallback: number, min = 1): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < min) {
    throw new Error(`Invalid ${name}: ${raw}`);
  }
  return Math.floor(parsed);
}

export function loadDefaultLimitsFromEnv(): TenantLimits {
  return {
    maxBots: intEnv("MAX_BOTS", DEFAULT_LIMITS.maxBots),
    maxChannels: intEnv("MAX_CHANNELS", DEFAULT_LIMITS.maxChannels),
    maxRoutes: intEnv("MAX_ROUTES", DEFAULT_LIMITS.maxRoutes),
    messagesPerMinute: intEnv("MESSAGES_PER_MINUTE", DEFAULT_LIMITS.messagesPerMinute),
    messagesPerDay: intEnv("MESSAGES_PER_DAY", DEFAULT_LIMITS.messagesPerDay),
    loopMessagesPerThreadPerMinute: intEnv(
      "LOOP_MESSAGES_PER_THREAD_PER_MINUTE",
      DEFAULT_LIMITS.loopMessagesPerThreadPerMinute,
    ),
  };
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
    defaultLimits: loadDefaultLimitsFromEnv(),
    adminEmails: parseAdminEmails(process.env.ADMIN_EMAILS),
    settingsCacheTtlSeconds: intEnv("SETTINGS_CACHE_TTL_SECONDS", 60, 0),
  };
}
