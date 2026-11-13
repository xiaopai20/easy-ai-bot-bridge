import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { SQSClient } from "@aws-sdk/client-sqs";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { AppContext } from "./context";
import { loadConfigFromEnv } from "./lib/config";
import { DynamoStores } from "./lib/dynamo";
import { createSecretsLoader } from "./lib/secrets";
import { createSqsEnqueue } from "./lib/sqs";
import { MemoryTenantSecrets, SecretsManagerTenantSecrets } from "./lib/tenant-secrets";
import type { Stores } from "./lib/stores";

let cached: AppContext | undefined;

export function createRuntimeContext(): AppContext {
  if (cached) return cached;
  cached = buildRuntimeContext();
  return cached;
}

function buildRuntimeContext(): AppContext {
  const hasAwsEnv = Boolean(process.env.SECRET_ARN || process.env.EVENTS_TABLE);
  if (!hasAwsEnv) {
    return {
      stores: missingStores(),
      tenantSecrets: new MemoryTenantSecrets(),
      enqueue: async () => {
        throw new Error("Runtime context is not configured");
      },
      getSecrets: async () => {
        throw new Error("Runtime context is not configured");
      },
      fetch,
      now: () => Date.now(),
      config: {
        replyUrl: "",
        apiUrl: "",
        dashboardUrl: "",
        corsOrigin: "*",
        eventTtlSeconds: 172800,
        threadTtlSeconds: 7776000,
      },
    };
  }

  const config = loadConfigFromEnv();
  const region = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? "us-east-1";
  const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region }), {
    marshallOptions: { removeUndefinedValues: true },
  });
  const sqs = new SQSClient({ region });
  const secrets = new SecretsManagerClient({ region });

  return {
    stores: new DynamoStores(ddb, {
      events: config.eventsTable,
      threads: config.threadsTable,
      routes: config.routesTable,
      directory: config.directoryTable,
      inbox: config.inboxTable,
    }),
    tenantSecrets: new SecretsManagerTenantSecrets(
      secrets,
      config.tenantSecretPrefix,
      config.tenantKmsKeyId,
    ),
    enqueue: createSqsEnqueue(sqs, config.queueUrl),
    getSecrets: createSecretsLoader(secrets, config.secretArn),
    fetch,
    now: () => Date.now(),
    config: {
      replyUrl: config.replyUrl,
      apiUrl: config.apiUrl,
      dashboardUrl: config.dashboardUrl,
      corsOrigin: config.corsOrigin,
      slackBotUserId: config.slackBotUserId,
      eventTtlSeconds: config.eventTtlSeconds,
      threadTtlSeconds: config.threadTtlSeconds,
    },
  };
}

function missingStores(): Stores {
  const fail = async () => {
    throw new Error("Runtime context is not configured");
  };
  return {
    tryRecordEvent: fail,
    deleteEvent: fail,
    getRouteRecord: fail,
    putRoute: fail,
    deleteRoute: fail,
    putThread: fail,
    getThread: fail,
    getTenant: fail,
    putTenant: fail,
    getUserTenantId: fail,
    putUserTenant: fail,
    putBot: fail,
    getBot: fail,
    listBots: fail,
    deleteBot: fail,
    putChannel: fail,
    getChannel: fail,
    listChannels: fail,
    deleteChannel: fail,
    getSlackTeamMapping: fail,
    putSlackTeamMapping: fail,
    deleteSlackTeamMapping: fail,
    getWidgetTokenMapping: fail,
    putWidgetTokenMapping: fail,
    deleteWidgetTokenMapping: fail,
    putInboxMessage: fail,
    listInboxMessages: fail,
  } as unknown as Stores;
}
