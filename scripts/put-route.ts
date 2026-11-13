/**
 * Upsert a tenant-scoped routing row so a Slack workspace/channel maps to a bot webhook.
 *
 *   ROUTES_TABLE=... TENANT_ID=t_... WORKSPACE_ID=T0123 TARGET_WEBHOOK_URL=https://... \
 *     npx tsx scripts/put-route.ts
 *
 * CHANNEL_ID defaults to * (all channels in the workspace). Prefer the dashboard.
 */
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { routePk, routeSk } from "../src/lib/keys";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name}`);
  }
  return value;
}

async function main(): Promise<void> {
  const table = required("ROUTES_TABLE");
  const tenantId = required("TENANT_ID");
  const platform = process.env.ROUTE_PLATFORM ?? "slack";
  const workspaceId = required("WORKSPACE_ID");
  const channelId = process.env.CHANNEL_ID ?? "*";
  const targetWebhookUrl = required("TARGET_WEBHOOK_URL");
  const targetId = process.env.TARGET_ID ?? "default";
  const enabled = process.env.ENABLED !== "false";

  const region = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? "us-east-1";
  const doc = DynamoDBDocumentClient.from(new DynamoDBClient({ region }), {
    marshallOptions: { removeUndefinedValues: true },
  });

  const item = {
    pk: routePk(tenantId, platform, workspaceId),
    sk: routeSk(channelId),
    tenantId,
    platform,
    workspaceId,
    channelId,
    targetWebhookUrl,
    targetId,
    enabled,
  };

  await doc.send(
    new PutCommand({
      TableName: table,
      Item: item,
    }),
  );
  console.log("Wrote route", item);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
