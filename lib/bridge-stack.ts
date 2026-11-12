import * as path from "path";
import * as cdk from "aws-cdk-lib";
import { CfnOutput, Duration, RemovalPolicy } from "aws-cdk-lib";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import * as lambdaNodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as sqs from "aws-cdk-lib/aws-sqs";
import { Construct } from "constructs";

export class BridgeStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const defaultTargetWebhookUrl =
      this.node.tryGetContext("defaultTargetWebhookUrl") ??
      process.env.DEFAULT_TARGET_WEBHOOK_URL ??
      "";
    const slackBotUserId =
      this.node.tryGetContext("slackBotUserId") ?? process.env.SLACK_BOT_USER_ID ?? "";

    const eventsTable = new dynamodb.Table(this, "Events", {
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: "expiresAt",
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const threadsTable = new dynamodb.Table(this, "Threads", {
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: "expiresAt",
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const routesTable = new dynamodb.Table(this, "Routes", {
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const secret = new secretsmanager.Secret(this, "Credentials", {
      description:
        "easy-ai-bot-bridge credentials: Slack signing secret, bot token, target webhook key, callback signing secret",
      generateSecretString: {
        secretStringTemplate: JSON.stringify({
          slackSigningSecret: "REPLACE_ME",
          slackBotToken: "REPLACE_ME",
          targetWebhookKey: "REPLACE_ME",
        }),
        generateStringKey: "callbackSigningSecret",
        passwordLength: 48,
        excludePunctuation: true,
      },
    });

    const dlq = new sqs.Queue(this, "ForwarderDlq", {
      retentionPeriod: Duration.days(14),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
    });

    const queue = new sqs.Queue(this, "ForwarderQueue", {
      visibilityTimeout: Duration.seconds(60),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      deadLetterQueue: {
        queue: dlq,
        maxReceiveCount: 5,
      },
    });

    const commonEnv: Record<string, string> = {
      EVENTS_TABLE: eventsTable.tableName,
      THREADS_TABLE: threadsTable.tableName,
      ROUTES_TABLE: routesTable.tableName,
      QUEUE_URL: queue.queueUrl,
      SECRET_ARN: secret.secretArn,
      EVENT_TTL_SECONDS: String(2 * 24 * 60 * 60),
      THREAD_TTL_SECONDS: String(90 * 24 * 60 * 60),
    };

    const bundling: lambdaNodejs.BundlingOptions = {
      minify: true,
      sourceMap: true,
      target: "node22",
      format: lambdaNodejs.OutputFormat.CJS,
    };

    const lambdaDefaults: Omit<lambdaNodejs.NodejsFunctionProps, "entry" | "logGroup"> = {
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      bundling,
      depsLockFilePath: path.join(__dirname, "..", "package-lock.json"),
      projectRoot: path.join(__dirname, ".."),
    };

    const logGroupFor = (id: string) =>
      new logs.LogGroup(this, `${id}Logs`, {
        retention: logs.RetentionDays.TWO_WEEKS,
        removalPolicy: RemovalPolicy.DESTROY,
      });

    const ingestFn = new lambdaNodejs.NodejsFunction(this, "IngestFn", {
      ...lambdaDefaults,
      logGroup: logGroupFor("IngestFn"),
      entry: path.join(__dirname, "..", "src", "ingest", "handler.ts"),
      handler: "handler",
      timeout: Duration.seconds(5),
      description: "Verify Slack events, dedupe, enqueue for forwarding",
      environment: {
        ...commonEnv,
        ...(defaultTargetWebhookUrl
          ? { DEFAULT_TARGET_WEBHOOK_URL: String(defaultTargetWebhookUrl) }
          : {}),
        ...(slackBotUserId ? { SLACK_BOT_USER_ID: String(slackBotUserId) } : {}),
      },
    });

    const forwarderFn = new lambdaNodejs.NodejsFunction(this, "ForwarderFn", {
      ...lambdaDefaults,
      logGroup: logGroupFor("ForwarderFn"),
      entry: path.join(__dirname, "..", "src", "forwarder", "handler.ts"),
      handler: "handler",
      timeout: Duration.seconds(30),
      description: "POST normalised messages to the target bot webhook",
      environment: { ...commonEnv },
    });

    const replyFn = new lambdaNodejs.NodejsFunction(this, "ReplyFn", {
      ...lambdaDefaults,
      logGroup: logGroupFor("ReplyFn"),
      entry: path.join(__dirname, "..", "src", "reply", "handler.ts"),
      handler: "handler",
      timeout: Duration.seconds(15),
      description: "Accept bot callbacks and post Slack thread replies",
      environment: { ...commonEnv },
    });

    eventsTable.grantReadWriteData(ingestFn);
    threadsTable.grantReadWriteData(ingestFn);
    threadsTable.grantReadData(replyFn);
    routesTable.grantReadData(ingestFn);
    queue.grantSendMessages(ingestFn);
    secret.grantRead(ingestFn);
    secret.grantRead(forwarderFn);
    secret.grantRead(replyFn);

    forwarderFn.addEventSource(
      new SqsEventSource(queue, {
        batchSize: 1,
      }),
    );

    const api = new apigwv2.HttpApi(this, "Api", {
      apiName: "easy-ai-bot-bridge",
      description: "Webhook bridge between chat platforms and bots",
    });

    api.addRoutes({
      path: "/slack/events",
      methods: [apigwv2.HttpMethod.POST],
      integration: new HttpLambdaIntegration("IngestIntegration", ingestFn),
    });
    api.addRoutes({
      path: "/reply",
      methods: [apigwv2.HttpMethod.POST],
      integration: new HttpLambdaIntegration("ReplyIntegration", replyFn),
    });

    forwarderFn.addEnvironment("REPLY_URL", `${api.apiEndpoint}/reply`);

    new CfnOutput(this, "ApiUrl", { value: api.apiEndpoint ?? "" });
    new CfnOutput(this, "SlackEventsUrl", { value: `${api.apiEndpoint}/slack/events` });
    new CfnOutput(this, "ReplyUrl", { value: `${api.apiEndpoint}/reply` });
    new CfnOutput(this, "SecretArn", { value: secret.secretArn });
    new CfnOutput(this, "EventsTableName", { value: eventsTable.tableName });
    new CfnOutput(this, "ThreadsTableName", { value: threadsTable.tableName });
    new CfnOutput(this, "RoutesTableName", { value: routesTable.tableName });
    new CfnOutput(this, "QueueUrl", { value: queue.queueUrl });
    new CfnOutput(this, "DlqUrl", { value: dlq.queueUrl });
  }
}
