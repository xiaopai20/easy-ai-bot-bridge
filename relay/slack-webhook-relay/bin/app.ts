#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { SlackWebhookRelayStack } from "../lib/relay-stack";

const app = new cdk.App();
const stackNameContext = app.node.tryGetContext("stackName");
const stackProps: cdk.StackProps = {
  description: "Minimal Slack Events API relay to a Grok Bot routine webhook",
};
if (typeof stackNameContext === "string" && stackNameContext.trim().length > 0) {
  stackProps.stackName = stackNameContext.trim();
}
new SlackWebhookRelayStack(app, "SlackWebhookRelay", stackProps);
