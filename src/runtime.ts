import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { SQSClient } from "@aws-sdk/client-sqs";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { AppContext } from "./context";
import { loadConfigFromEnv } from "./lib/config";
import { DynamoStores } from "./lib/dynamo";
import { createSecretsLoader } from "./lib/secrets";
import { createSqsEnqueue } from "./lib/sqs";

let cached: AppContext | undefined;

export function createRuntimeContext(): AppContext {
  if (cached) return cached;
  // Lambdas constructed at module load in tests without env should not
  // connect to AWS until invoked. We still bind config lazily.
  cached = buildRuntimeContext();
  return cached;
}

function buildRuntimeContext(): AppContext {
  const hasAwsEnv = Boolean(process.env.SECRET_ARN || process.env.EVENTS_TABLE);
  if (!hasAwsEnv) {
    return {
      stores: missingStores(),
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
    }),
    enqueue: createSqsEnqueue(sqs, config.queueUrl),
    getSecrets: createSecretsLoader(secrets, config.secretArn),
    fetch,
    now: () => Date.now(),
    config: {
      replyUrl: config.replyUrl,
      defaultTargetWebhookUrl: config.defaultTargetWebhookUrl,
      slackBotUserId: config.slackBotUserId,
      eventTtlSeconds: config.eventTtlSeconds,
      threadTtlSeconds: config.threadTtlSeconds,
    },
  };
}

function missingStores() {
  const fail = async () => {
    throw new Error("Runtime context is not configured");
  };
  return {
    tryRecordEvent: fail,
    deleteEvent: fail,
    getRouteRecord: fail,
    putThread: fail,
    getThread: fail,
  } as unknown as AppContext["stores"];
}
