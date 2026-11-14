#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { SlackWebhookRelayStack } from "../lib/relay-stack";

const app = new cdk.App();
new SlackWebhookRelayStack(app, "SlackWebhookRelay", {
  description: "Minimal Slack Events API relay to a Grok Bot routine webhook",
});
