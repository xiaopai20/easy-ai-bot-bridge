import * as path from "path";
import * as cdk from "aws-cdk-lib";
import { CfnOutput, Duration, RemovalPolicy } from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";

export class SlackWebhookRelayStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const secret = new secretsmanager.Secret(this, "RelaySecret", {
      description: "Slack signing secret and Grok Bot routine webhook (SLACK_SIGNING_SECRET, WEBHOOK_URL, WEBHOOK_KEY)",
      removalPolicy: RemovalPolicy.DESTROY,
      secretStringValue: cdk.SecretValue.unsafePlainText(
        JSON.stringify({
          SLACK_SIGNING_SECRET: "REPLACE_ME",
          WEBHOOK_URL: "REPLACE_ME",
          WEBHOOK_KEY: "REPLACE_ME",
        }),
      ),
    });

    const fn = new lambdaNodejs.NodejsFunction(this, "RelayFn", {
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 128,
      timeout: Duration.seconds(3),
      entry: path.join(__dirname, "..", "src", "handler.ts"),
      handler: "handler",
      description: "Slack Events API -> Grok Bot routine webhook",
      depsLockFilePath: path.join(__dirname, "..", "package-lock.json"),
      projectRoot: path.join(__dirname, ".."),
      bundling: {
        minify: true,
        sourceMap: true,
        target: "node22",
        format: lambdaNodejs.OutputFormat.CJS,
      },
      environment: {
        SECRET_ARN: secret.secretArn,
      },
      logGroup: new logs.LogGroup(this, "RelayFnLogs", {
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
    });
    secret.grantRead(fn);

    const functionUrl = fn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
    });

    new CfnOutput(this, "FunctionUrl", { value: functionUrl.url });
    new CfnOutput(this, "SecretArn", { value: secret.secretArn });
  }
}
