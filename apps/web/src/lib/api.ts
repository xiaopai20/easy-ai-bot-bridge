"use client";

import { getAuthToken } from "./auth";

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/+$/, "");

export interface Tenant {
  tenantId: string;
  ownerUserId: string;
  ownerEmail: string;
  createdAt: string;
}

export interface Bot {
  tenantId: string;
  botId: string;
  name: string;
  webhookUrl: string;
  createdAt: string;
}

export interface Channel {
  tenantId: string;
  channelId: string;
  platform: "slack" | "widget" | "telegram";
  name: string;
  botId: string;
  enabled: boolean;
  slackTeamId?: string;
  slackTeamName?: string;
  widgetToken?: string;
  createdAt: string;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await getAuthToken();
  if (!token) {
    throw new Error("Not signed in");
  }
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(typeof body.error === "string" ? body.error : `Request failed (${response.status})`);
  }
  return body as T;
}

export function getMe() {
  return api<{ user: { userId: string; email: string; name: string }; tenant: Tenant }>("/api/me");
}

export function listBots() {
  return api<{ bots: Bot[] }>("/api/bots");
}

export function createBot(input: { name: string; webhookUrl: string; webhookKey: string }) {
  return api<{ bot: Bot }>("/api/bots", { method: "POST", body: JSON.stringify(input) });
}

export function deleteBot(botId: string) {
  return api<{ ok: boolean }>(`/api/bots/${botId}`, { method: "DELETE" });
}

export function listChannels() {
  return api<{ channels: Channel[] }>("/api/channels");
}

export function createChannel(input: { platform: "widget" | "telegram"; name: string; botId: string }) {
  return api<{ channel: Channel }>("/api/channels", { method: "POST", body: JSON.stringify(input) });
}

export function linkChannel(channelId: string, botId: string) {
  return api<{ channel: Channel }>(`/api/channels/${channelId}/link`, {
    method: "POST",
    body: JSON.stringify({ botId }),
  });
}

export function deleteChannel(channelId: string) {
  return api<{ ok: boolean }>(`/api/channels/${channelId}`, { method: "DELETE" });
}

export function getEmbed(channelId: string) {
  return api<{ token: string; snippet: string }>(`/api/channels/${channelId}/embed`);
}

export function getSlackInstallUrl() {
  return api<{ url: string }>("/api/slack/install-url");
}
