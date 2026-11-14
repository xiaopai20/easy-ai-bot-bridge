import * as path from "path";
import * as cdk from "aws-cdk-lib";
import { CfnOutput, Duration, RemovalPolicy } from "aws-cdk-lib";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import { HttpUserPoolAuthorizer } from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as kms from "aws-cdk-lib/aws-kms";
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

    const envName = this.node.tryGetContext("env") ?? process.env.ENV ?? "dev";
    const googleClientId =
      this.node.tryGetContext("googleClientId") ?? process.env.GOOGLE_CLIENT_ID ?? "";
    const googleClientSecret =
      this.node.tryGetContext("googleClientSecret") ?? process.env.GOOGLE_CLIENT_SECRET ?? "";
    const callbackUrl =
      this.node.tryGetContext("callbackUrl") ?? process.env.CALLBACK_URL ?? "http://localhost:3002";
    const corsOrigin =
      this.node.tryGetContext("corsOrigin") ?? process.env.CORS_ORIGIN ?? callbackUrl;
    const adminEmails =
      this.node.tryGetContext("adminEmails") ?? process.env.ADMIN_EMAILS ?? "";

    const tenantKey = new kms.Key(this, "TenantSecretKey", {
      description: "Encrypts per-tenant bot webhook keys and Slack bot tokens",
      enableKeyRotation: true,
      removalPolicy: RemovalPolicy.DESTROY,
    });

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
    routesTable.addGlobalSecondaryIndex({
      indexName: "byTenant",
      partitionKey: { name: "tenantId", type: dynamodb.AttributeType.STRING },
    });
    const directoryTable = new dynamodb.Table(this, "Directory", {
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const inboxTable = new dynamodb.Table(this, "Inbox", {
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: "expiresAt",
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const secret = new secretsmanager.Secret(this, "Credentials", {
      description:
        "Platform credentials: Slack signing secret, Slack OAuth client, callback signing secret",
      encryptionKey: tenantKey,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({
          slackSigningSecret: "REPLACE_ME",
          slackClientId: "REPLACE_ME",
          slackClientSecret: "REPLACE_ME",
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
      deadLetterQueue: { queue: dlq, maxReceiveCount: 5 },
    });

    // Google is the only login. No email/password sign-up. Federated users are
    // still created by Cognito on first Google login; /api/me then creates a tenant.
    const userPool = new cognito.UserPool(this, "UserPool", {
      userPoolName: `easy-ai-bot-bridge-${envName}`,
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      autoVerify: { email: true },
      accountRecovery: cognito.AccountRecovery.NONE,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const domain = userPool.addDomain("CognitoDomain", {
      cognitoDomain: {
        domainPrefix: `eabb-${envName}-${this.account}`.substring(0, 53),
      },
    });

    let googleProvider: cognito.UserPoolIdentityProviderGoogle | undefined;
    if (googleClientId && googleClientSecret) {
      googleProvider = new cognito.UserPoolIdentityProviderGoogle(this, "GoogleProvider", {
        userPool,
        clientId: String(googleClientId),
        clientSecret: String(googleClientSecret),
        scopes: ["openid", "email", "profile"],
        attributeMapping: {
          email: cognito.ProviderAttribute.GOOGLE_EMAIL,
          fullname: cognito.ProviderAttribute.GOOGLE_NAME,
        },
      });
    }

    const supportedProviders = googleProvider
      ? [cognito.UserPoolClientIdentityProvider.GOOGLE]
      : [cognito.UserPoolClientIdentityProvider.COGNITO];

    const userPoolClient = userPool.addClient("WebClient", {
      userPoolClientName: `easy-ai-bot-bridge-web-${envName}`,
      generateSecret: false,
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL, cognito.OAuthScope.PROFILE],
        callbackUrls: [`${callbackUrl}/auth/callback`, String(callbackUrl), `${callbackUrl}/`],
        logoutUrls: [String(callbackUrl), `${callbackUrl}/`],
      },
      supportedIdentityProviders: supportedProviders,
    });
    if (googleProvider) {
      userPoolClient.node.addDependency(googleProvider);
    }

    const tenantSecretPrefix = `easy-ai-bot-bridge/${envName}`;
    const commonEnv: Record<string, string> = {
      EVENTS_TABLE: eventsTable.tableName,
      THREADS_TABLE: threadsTable.tableName,
      ROUTES_TABLE: routesTable.tableName,
      DIRECTORY_TABLE: directoryTable.tableName,
      INBOX_TABLE: inboxTable.tableName,
      QUEUE_URL: queue.queueUrl,
      SECRET_ARN: secret.secretArn,
      EVENT_TTL_SECONDS: String(2 * 24 * 60 * 60),
      THREAD_TTL_SECONDS: String(90 * 24 * 60 * 60),
      TENANT_SECRET_PREFIX: tenantSecretPrefix,
      TENANT_KMS_KEY_ID: tenantKey.keyId,
      CORS_ORIGIN: String(corsOrigin),
      DASHBOARD_URL: String(callbackUrl),
      ADMIN_EMAILS: String(adminEmails),
      SETTINGS_CACHE_TTL_SECONDS: "60",
      MAX_BOTS: "5",
      MAX_CHANNELS: "5",
      MAX_ROUTES: "20",
      MESSAGES_PER_MINUTE: "120",
      MESSAGES_PER_DAY: "10000",
      LOOP_MESSAGES_PER_THREAD_PER_MINUTE: "20",
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
    const logGroupFor = (fnId: string) =>
      new logs.LogGroup(this, `${fnId}Logs`, {
        retention: logs.RetentionDays.TWO_WEEKS,
        removalPolicy: RemovalPolicy.DESTROY,
      });

    const ingestFn = new lambdaNodejs.NodejsFunction(this, "IngestFn", {
      ...lambdaDefaults,
      logGroup: logGroupFor("IngestFn"),
      entry: path.join(__dirname, "..", "src", "ingest", "handler.ts"),
      handler: "handler",
      timeout: Duration.seconds(5),
      description: "Verify Slack events, resolve tenant, enqueue",
      environment: { ...commonEnv },
    });
    const forwarderFn = new lambdaNodejs.NodejsFunction(this, "ForwarderFn", {
      ...lambdaDefaults,
      logGroup: logGroupFor("ForwarderFn"),
      entry: path.join(__dirname, "..", "src", "forwarder", "handler.ts"),
      handler: "handler",
      timeout: Duration.seconds(30),
      description: "POST tenant-scoped messages to the linked bot webhook",
      environment: { ...commonEnv },
    });
    const replyFn = new lambdaNodejs.NodejsFunction(this, "ReplyFn", {
      ...lambdaDefaults,
      logGroup: logGroupFor("ReplyFn"),
      entry: path.join(__dirname, "..", "src", "reply", "handler.ts"),
      handler: "handler",
      timeout: Duration.seconds(15),
      description: "Accept bot callbacks and post tenant-scoped replies",
      environment: { ...commonEnv },
    });
    const dashboardFn = new lambdaNodejs.NodejsFunction(this, "DashboardFn", {
      ...lambdaDefaults,
      logGroup: logGroupFor("DashboardFn"),
      entry: path.join(__dirname, "..", "src", "dashboard", "handler.ts"),
      handler: "handler",
      timeout: Duration.seconds(15),
      description: "Authenticated tenant dashboard API",
      environment: { ...commonEnv },
    });
    const widgetFn = new lambdaNodejs.NodejsFunction(this, "WidgetFn", {
      ...lambdaDefaults,
      logGroup: logGroupFor("WidgetFn"),
      entry: path.join(__dirname, "..", "src", "widget", "handler.ts"),
      handler: "handler",
      timeout: Duration.seconds(10),
      description: "Website chat widget ingest and polling",
      environment: { ...commonEnv },
    });
    const slackOAuthFn = new lambdaNodejs.NodejsFunction(this, "SlackOAuthFn", {
      ...lambdaDefaults,
      logGroup: logGroupFor("SlackOAuthFn"),
      entry: path.join(__dirname, "..", "src", "slack-oauth", "handler.ts"),
      handler: "handler",
      timeout: Duration.seconds(15),
      description: "Slack Add to Slack OAuth callback",
      environment: { ...commonEnv },
    });

    const dataFns = [ingestFn, forwarderFn, replyFn, dashboardFn, widgetFn, slackOAuthFn];
    for (const fn of dataFns) {
      eventsTable.grantReadWriteData(fn);
      threadsTable.grantReadWriteData(fn);
      routesTable.grantReadWriteData(fn);
      directoryTable.grantReadWriteData(fn);
      inboxTable.grantReadWriteData(fn);
      secret.grantRead(fn);
      tenantKey.grantEncryptDecrypt(fn);
      fn.addToRolePolicy(
        new iam.PolicyStatement({
          actions: [
            "secretsmanager:CreateSecret",
            "secretsmanager:PutSecretValue",
            "secretsmanager:GetSecretValue",
            "secretsmanager:DeleteSecret",
            "secretsmanager:DescribeSecret",
          ],
          resources: [
            `arn:aws:secretsmanager:${this.region}:${this.account}:secret:${tenantSecretPrefix}/*`,
          ],
        }),
      );
    }
    queue.grantSendMessages(ingestFn);
    queue.grantSendMessages(widgetFn);
    eventsTable.grantReadWriteData(ingestFn);

    forwarderFn.addEventSource(new SqsEventSource(queue, { batchSize: 1 }));

    const api = new apigwv2.HttpApi(this, "Api", {
      apiName: "easy-ai-bot-bridge",
      description: "Multi-tenant webhook bridge between chat platforms and bots",
      corsPreflight: {
        // * so website widgets can POST from any origin. Dashboard uses Bearer JWT, not cookies.
        allowOrigins: ["*"],
        allowMethods: [apigwv2.CorsHttpMethod.ANY],
        allowHeaders: ["content-type", "authorization"],
      },
    });
    const defaultStage = api.defaultStage?.node.defaultChild as apigwv2.CfnStage | undefined;
    if (defaultStage) {
      defaultStage.defaultRouteSettings = {
        throttlingBurstLimit: 100,
        throttlingRateLimit: 50,
      };
    }

    const jwtAuthorizer = new HttpUserPoolAuthorizer("CognitoAuthorizer", userPool, {
      userPoolClients: [userPoolClient],
    });

    api.addRoutes({
      path: "/slack/events",
      methods: [apigwv2.HttpMethod.POST],
      integration: new HttpLambdaIntegration("IngestIntegration", ingestFn),
    });
    api.addRoutes({
      path: "/slack/oauth/callback",
      methods: [apigwv2.HttpMethod.GET],
      integration: new HttpLambdaIntegration("SlackOAuthIntegration", slackOAuthFn),
    });
    api.addRoutes({
      path: "/reply",
      methods: [apigwv2.HttpMethod.POST],
      integration: new HttpLambdaIntegration("ReplyIntegration", replyFn),
    });
    api.addRoutes({
      path: "/widget/events",
      methods: [apigwv2.HttpMethod.POST],
      integration: new HttpLambdaIntegration("WidgetEventsIntegration", widgetFn),
    });
    api.addRoutes({
      path: "/widget/messages",
      methods: [apigwv2.HttpMethod.GET],
      integration: new HttpLambdaIntegration("WidgetMessagesIntegration", widgetFn),
    });
    api.addRoutes({
      path: "/widget.js",
      methods: [apigwv2.HttpMethod.GET],
      integration: new HttpLambdaIntegration("WidgetScriptIntegration", widgetFn),
    });
    api.addRoutes({
      path: "/api/{proxy+}",
      methods: [
        apigwv2.HttpMethod.GET,
        apigwv2.HttpMethod.POST,
        apigwv2.HttpMethod.PATCH,
        apigwv2.HttpMethod.DELETE,
      ],
      integration: new HttpLambdaIntegration("DashboardIntegration", dashboardFn),
      authorizer: jwtAuthorizer,
    });

    const apiUrl = api.apiEndpoint ?? "";
    for (const fn of [forwarderFn, ingestFn, replyFn, dashboardFn, widgetFn, slackOAuthFn]) {
      fn.addEnvironment("REPLY_URL", `${apiUrl}/reply`);
      fn.addEnvironment("API_URL", apiUrl);
    }

    new CfnOutput(this, "ApiUrl", { value: apiUrl });
    new CfnOutput(this, "SlackEventsUrl", { value: `${apiUrl}/slack/events` });
    new CfnOutput(this, "SlackOAuthCallbackUrl", { value: `${apiUrl}/slack/oauth/callback` });
    new CfnOutput(this, "ReplyUrl", { value: `${apiUrl}/reply` });
    new CfnOutput(this, "SecretArn", { value: secret.secretArn });
    new CfnOutput(this, "DirectoryTableName", { value: directoryTable.tableName });
    new CfnOutput(this, "UserPoolId", { value: userPool.userPoolId });
    new CfnOutput(this, "UserPoolClientId", { value: userPoolClient.userPoolClientId });
    new CfnOutput(this, "CognitoDomain", { value: domain.domainName });
    new CfnOutput(this, "CognitoHostedUiUrl", { value: domain.baseUrl() });
    new CfnOutput(this, "RoutesTableName", { value: routesTable.tableName });
    new CfnOutput(this, "DlqUrl", { value: dlq.queueUrl });
    new CfnOutput(this, "TenantKmsKeyId", { value: tenantKey.keyId });
  }
}
