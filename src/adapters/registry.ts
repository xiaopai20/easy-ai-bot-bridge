import { slackAdapter } from "./slack";
import { telegramAdapter } from "./telegram";
import { widgetAdapter } from "./widget";
import type { PlatformAdapter } from "./types";

const adapters: Record<string, PlatformAdapter> = {
  slack: slackAdapter,
  telegram: telegramAdapter,
  widget: widgetAdapter,
};

export function getAdapter(platform: string): PlatformAdapter {
  const adapter = adapters[platform];
  if (!adapter) {
    throw new Error(`No adapter registered for platform: ${platform}`);
  }
  return adapter;
}

export { slackAdapter, telegramAdapter, widgetAdapter };
export type { PlatformAdapter } from "./types";
