#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { TelegramWebhookRelayStack } from "../lib/relay-stack";

const app = new cdk.App();
const stackNameContext = app.node.tryGetContext("stackName");
const stackProps: cdk.StackProps = {
  description: "Telegram Bot API webhook relay to an AI bot routine webhook",
};
if (typeof stackNameContext === "string" && stackNameContext.trim().length > 0) {
  stackProps.stackName = stackNameContext.trim();
}
new TelegramWebhookRelayStack(app, "TelegramWebhookRelay", stackProps);