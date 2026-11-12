#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { BridgeStack } from "../lib/bridge-stack";

const app = new cdk.App();
new BridgeStack(app, "EasyAiBotBridge", {
  description: "Serverless webhook bridge between chat platforms and bots",
});
