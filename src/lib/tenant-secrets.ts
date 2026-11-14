import {
  CreateSecretCommand,
  DeleteSecretCommand,
  GetSecretValueCommand,
  PutSecretValueCommand,
  ResourceNotFoundException,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import type { TtlCache } from "./cache";
import type { TenantSecrets } from "./stores";

export class MemoryTenantSecrets implements TenantSecrets {
  bots = new Map<string, string>();
  slack = new Map<string, string>();

  async putBotKey(tenantId: string, botId: string, key: string): Promise<void> {
    this.bots.set(`${tenantId}#${botId}`, key);
  }
  async getBotKey(tenantId: string, botId: string): Promise<string | null> {
    return this.bots.get(`${tenantId}#${botId}`) ?? null;
  }
  async deleteBotKey(tenantId: string, botId: string): Promise<void> {
    this.bots.delete(`${tenantId}#${botId}`);
  }
  async putSlackToken(tenantId: string, teamId: string, token: string): Promise<void> {
    this.slack.set(`${tenantId}#${teamId}`, token);
  }
  async getSlackToken(tenantId: string, teamId: string): Promise<string | null> {
    return this.slack.get(`${tenantId}#${teamId}`) ?? null;
  }
  async deleteSlackToken(tenantId: string, teamId: string): Promise<void> {
    this.slack.delete(`${tenantId}#${teamId}`);
  }
}

export class CachingTenantSecrets implements TenantSecrets {
  constructor(
    private readonly inner: TenantSecrets,
    private readonly cache: TtlCache,
    private readonly now: () => number,
  ) {}

  async putBotKey(tenantId: string, botId: string, key: string): Promise<void> {
    await this.inner.putBotKey(tenantId, botId, key);
    this.cache.invalidate(`secret:bot:${tenantId}:${botId}`);
  }
  async getBotKey(tenantId: string, botId: string): Promise<string | null> {
    return this.cache.getOrLoad(`secret:bot:${tenantId}:${botId}`, this.now(), () =>
      this.inner.getBotKey(tenantId, botId),
    );
  }
  async deleteBotKey(tenantId: string, botId: string): Promise<void> {
    await this.inner.deleteBotKey(tenantId, botId);
    this.cache.invalidate(`secret:bot:${tenantId}:${botId}`);
  }
  async putSlackToken(tenantId: string, teamId: string, token: string): Promise<void> {
    await this.inner.putSlackToken(tenantId, teamId, token);
    this.cache.invalidate(`secret:slack:${tenantId}:${teamId}`);
  }
  async getSlackToken(tenantId: string, teamId: string): Promise<string | null> {
    return this.cache.getOrLoad(`secret:slack:${tenantId}:${teamId}`, this.now(), () =>
      this.inner.getSlackToken(tenantId, teamId),
    );
  }
  async deleteSlackToken(tenantId: string, teamId: string): Promise<void> {
    await this.inner.deleteSlackToken(tenantId, teamId);
    this.cache.invalidate(`secret:slack:${tenantId}:${teamId}`);
  }
}

export class SecretsManagerTenantSecrets implements TenantSecrets {
  constructor(
    private readonly client: SecretsManagerClient,
    private readonly prefix: string,
    private readonly kmsKeyId?: string,
  ) {}

  private botName(tenantId: string, botId: string): string {
    return `${this.prefix}/tenants/${tenantId}/bots/${botId}`;
  }
  private slackName(tenantId: string, teamId: string): string {
    return `${this.prefix}/tenants/${tenantId}/slack/${teamId}`;
  }

  private async put(name: string, payload: Record<string, string>): Promise<void> {
    const value = JSON.stringify(payload);
    try {
      await this.client.send(
        new PutSecretValueCommand({ SecretId: name, SecretString: value }),
      );
    } catch (err) {
      if ((err as { name?: string }).name === "ResourceNotFoundException" || err instanceof ResourceNotFoundException) {
        await this.client.send(
          new CreateSecretCommand({
            Name: name,
            SecretString: value,
            KmsKeyId: this.kmsKeyId,
          }),
        );
        return;
      }
      throw err;
    }
  }

  private async get(name: string, field: string): Promise<string | null> {
    try {
      const result = await this.client.send(new GetSecretValueCommand({ SecretId: name }));
      if (!result.SecretString) return null;
      const parsed = JSON.parse(result.SecretString) as Record<string, unknown>;
      return typeof parsed[field] === "string" ? (parsed[field] as string) : null;
    } catch (err) {
      if ((err as { name?: string }).name === "ResourceNotFoundException" || err instanceof ResourceNotFoundException) {
        return null;
      }
      throw err;
    }
  }

  private async del(name: string): Promise<void> {
    try {
      await this.client.send(new DeleteSecretCommand({ SecretId: name, ForceDeleteWithoutRecovery: true }));
    } catch (err) {
      if ((err as { name?: string }).name === "ResourceNotFoundException" || err instanceof ResourceNotFoundException) {
        return;
      }
      throw err;
    }
  }

  async putBotKey(tenantId: string, botId: string, key: string): Promise<void> {
    await this.put(this.botName(tenantId, botId), { webhookKey: key });
  }
  async getBotKey(tenantId: string, botId: string): Promise<string | null> {
    return this.get(this.botName(tenantId, botId), "webhookKey");
  }
  async deleteBotKey(tenantId: string, botId: string): Promise<void> {
    await this.del(this.botName(tenantId, botId));
  }
  async putSlackToken(tenantId: string, teamId: string, token: string): Promise<void> {
    await this.put(this.slackName(tenantId, teamId), { botToken: token });
  }
  async getSlackToken(tenantId: string, teamId: string): Promise<string | null> {
    return this.get(this.slackName(tenantId, teamId), "botToken");
  }
  async deleteSlackToken(tenantId: string, teamId: string): Promise<void> {
    await this.del(this.slackName(tenantId, teamId));
  }
}
