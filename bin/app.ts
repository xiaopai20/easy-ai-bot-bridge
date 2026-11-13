#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { BridgeStack } from "../lib/bridge-stack";

const app = new cdk.App();
new BridgeStack(app, "EasyAiBotBridge", {
  description: "Multi-tenant serverless webhook bridge between chat platforms and bots",
});
