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

export interface TenantLimits {
  maxBots: number;
  maxChannels: number;
  maxRoutes: number;
  messagesPerMinute: number;
  messagesPerDay: number;
  loopMessagesPerThreadPerMinute: number;
}

export type TenantLimitsOverride = Partial<TenantLimits>;

export interface UsageSnapshot {
  limits: TenantLimits;
  override?: TenantLimitsOverride;
  usage: { bots: number; channels: number; routes: number };
  messages: { dayCount: number; minuteCount: number };
}

export function getMe() {
  return api<{
    user: { userId: string; email: string; name: string };
    tenant: Tenant;
    isAdmin: boolean;
    limits: TenantLimits;
    usage: UsageSnapshot["usage"];
    messages: UsageSnapshot["messages"];
  }>("/api/me");
}

export function getUsage() {
  return api<UsageSnapshot>("/api/usage");
}

export function getAdminTenant(tenantId: string) {
  return api<{
    tenant: Tenant;
    limits: TenantLimits;
    override: TenantLimitsOverride;
    configVersion: number;
    usage: UsageSnapshot["usage"];
    messages: UsageSnapshot["messages"];
  }>(`/api/admin/tenants/${tenantId}`);
}

export function patchAdminLimits(
  tenantId: string,
  body: { reset?: boolean } & Partial<Record<keyof TenantLimits, number | null>>,
) {
  return api<{
    tenant: Tenant;
    limits: TenantLimits;
    override: TenantLimitsOverride;
    configVersion: number;
  }>(`/api/admin/tenants/${tenantId}/limits`, { method: "PATCH", body: JSON.stringify(body) });
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
