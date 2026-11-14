#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { TelegramWebhookRelayStack } from "../lib/relay-stack";

const app = new cdk.App();
new TelegramWebhookRelayStack(app, "TelegramWebhookRelay", {
  description: "Telegram Bot API webhook relay to an AI bot routine webhook",
});