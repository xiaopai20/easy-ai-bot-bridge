"use client";

import { Suspense, useCallback, useEffect, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { LoginDialog } from "@/components/LoginDialog";
import {
  createBot,
  createChannel,
  deleteBot,
  deleteChannel,
  getEmbed,
  getMe,
  getSlackInstallUrl,
  linkChannel,
  listBots,
  listChannels,
  type Bot,
  type Channel,
  type Tenant,
} from "@/lib/api";
import { getStoredUser, logout, type User } from "@/lib/auth";

export default function DashboardPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-stone-50" />}>
      <DashboardInner />
    </Suspense>
  );
}

function DashboardInner() {
  const router = useRouter();
  const search = useSearchParams();
  const [user, setUser] = useState<User | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [bots, setBots] = useState<Bot[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [botName, setBotName] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookKey, setWebhookKey] = useState("");
  const [widgetName, setWidgetName] = useState("Website chat");
  const [widgetBotId, setWidgetBotId] = useState("");
  const [embed, setEmbed] = useState<string>("");

  const refresh = useCallback(async () => {
    const me = await getMe();
    setTenant(me.tenant);
    const [botRes, channelRes] = await Promise.all([listBots(), listChannels()]);
    setBots(botRes.bots);
    setChannels(channelRes.channels);
    setWidgetBotId((current) => current || botRes.bots[0]?.botId || "");
  }, []);

  useEffect(() => {
    void (async () => {
      const stored = await getStoredUser();
      if (!stored) {
        setLoginOpen(true);
        return;
      }
      setUser(stored);
      try {
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load dashboard");
      }
    })();
  }, [refresh]);

  useEffect(() => {
    if (search.get("slack") === "connected") {
      setNotice("Slack workspace connected.");
    }
  }, [search]);

  async function onCreateBot(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await createBot({ name: botName, webhookUrl, webhookKey });
      setBotName("");
      setWebhookUrl("");
      setWebhookKey("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create bot");
    } finally {
      setBusy(false);
    }
  }

  async function onCreateWidget(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await createChannel({
        platform: "widget",
        name: widgetName,
        botId: widgetBotId,
      });
      const snippet = await getEmbed(created.channel.channelId);
      setEmbed(snippet.snippet);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create widget");
    } finally {
      setBusy(false);
    }
  }

  async function onAddSlack() {
    setBusy(true);
    setError(null);
    try {
      if (bots.length === 0) {
        throw new Error("Create a bot before connecting Slack");
      }
      const { url } = await getSlackInstallUrl();
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start Slack install");
      setBusy(false);
    }
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-stone-50">
        <AppHeader onLogin={() => setLoginOpen(true)} />
        <LoginDialog
          isOpen={loginOpen}
          onClose={() => {
            setLoginOpen(false);
            router.push("/");
          }}
          onSuccess={(next) => {
            setUser(next);
            setLoginOpen(false);
            void refresh();
          }}
        />
        <p className="max-w-xl mx-auto mt-16 text-center text-stone-600">
          Sign in with Google to open your workspace.
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900">
      <AppHeader user={user} onLogout={() => void logout()} />
      <main className="max-w-6xl mx-auto px-4 py-8 space-y-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="mt-1 text-sm text-stone-600">
            Tenant {tenant?.tenantId ?? "..."} -- bots and channels stay inside this workspace.
          </p>
        </div>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
        )}
        {notice && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{notice}</div>
        )}

        <section className="rounded-2xl border border-stone-200 bg-white shadow-sm p-6 space-y-4">
          <h2 className="text-lg font-semibold">Bots</h2>
          <p className="text-sm text-stone-600">
            A bot is a webhook URL plus a bearer key. The key is stored in Secrets Manager, not shown again.
          </p>
          <form onSubmit={onCreateBot} className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <input
              required
              value={botName}
              onChange={(e) => setBotName(e.target.value)}
              placeholder="Name"
              className="rounded-lg border border-stone-200 px-3 py-2 text-sm"
            />
            <input
              required
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              placeholder="https://.../routine"
              className="rounded-lg border border-stone-200 px-3 py-2 text-sm md:col-span-2"
            />
            <input
              required
              type="password"
              value={webhookKey}
              onChange={(e) => setWebhookKey(e.target.value)}
              placeholder="Webhook bearer key"
              className="rounded-lg border border-stone-200 px-3 py-2 text-sm"
            />
            <button
              type="submit"
              disabled={busy}
              className="md:col-span-4 rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-stone-900 hover:bg-amber-600 disabled:opacity-60"
            >
              Add bot
            </button>
          </form>
          <ul className="divide-y divide-stone-100">
            {bots.map((bot) => (
              <li key={bot.botId} className="py-3 flex items-center justify-between gap-3">
                <div>
                  <div className="font-medium">{bot.name}</div>
                  <div className="text-xs text-stone-500 truncate">{bot.webhookUrl}</div>
                </div>
                <button
                  className="text-xs text-stone-500 hover:text-red-700"
                  onClick={() => void deleteBot(bot.botId).then(refresh).catch((err) => setError(String(err)))}
                >
                  Remove
                </button>
              </li>
            ))}
            {bots.length === 0 && <li className="py-3 text-sm text-stone-500">No bots yet.</li>}
          </ul>
        </section>

        <section className="rounded-2xl border border-stone-200 bg-white shadow-sm p-6 space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h2 className="text-lg font-semibold">Channels</h2>
            <button
              onClick={() => void onAddSlack()}
              disabled={busy}
              className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-semibold text-white hover:bg-stone-800 disabled:opacity-60"
            >
              Add to Slack
            </button>
          </div>
          <form onSubmit={onCreateWidget} className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <input
              required
              value={widgetName}
              onChange={(e) => setWidgetName(e.target.value)}
              placeholder="Widget name"
              className="rounded-lg border border-stone-200 px-3 py-2 text-sm"
            />
            <select
              required
              value={widgetBotId}
              onChange={(e) => setWidgetBotId(e.target.value)}
              className="rounded-lg border border-stone-200 px-3 py-2 text-sm"
            >
              <option value="">Link to bot...</option>
              {bots.map((bot) => (
                <option key={bot.botId} value={bot.botId}>
                  {bot.name}
                </option>
              ))}
            </select>
            <button
              type="submit"
              disabled={busy || bots.length === 0}
              className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-stone-900 hover:bg-amber-600 disabled:opacity-60"
            >
              Add website widget
            </button>
          </form>
          {embed && (
            <div>
              <div className="text-xs font-semibold text-stone-500 uppercase tracking-wide">Embed snippet</div>
              <pre className="mt-2 overflow-x-auto rounded-lg bg-stone-900 text-stone-50 text-xs p-3">{embed}</pre>
            </div>
          )}
          <ul className="divide-y divide-stone-100">
            {channels.map((channel) => (
              <li key={channel.channelId} className="py-3 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="font-medium">
                      {channel.name}{" "}
                      <span className="text-xs uppercase tracking-wide text-stone-500">{channel.platform}</span>
                    </div>
                    <div className="text-xs text-stone-500">
                      Linked bot: {bots.find((bot) => bot.botId === channel.botId)?.name ?? channel.botId}
                    </div>
                  </div>
                  <button
                    className="text-xs text-stone-500 hover:text-red-700"
                    onClick={() =>
                      void deleteChannel(channel.channelId).then(refresh).catch((err) => setError(String(err)))
                    }
                  >
                    Remove
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={channel.botId}
                    onChange={(e) =>
                      void linkChannel(channel.channelId, e.target.value)
                        .then(refresh)
                        .catch((err) => setError(String(err)))
                    }
                    className="rounded-lg border border-stone-200 px-2 py-1 text-xs"
                  >
                    {bots.map((bot) => (
                      <option key={bot.botId} value={bot.botId}>
                        {bot.name}
                      </option>
                    ))}
                  </select>
                  {channel.platform === "widget" && (
                    <button
                      className="text-xs font-medium text-amber-700 hover:underline"
                      onClick={() =>
                        void getEmbed(channel.channelId)
                          .then((res) => setEmbed(res.snippet))
                          .catch((err) => setError(String(err)))
                      }
                    >
                      Show embed
                    </button>
                  )}
                </div>
              </li>
            ))}
            {channels.length === 0 && <li className="py-3 text-sm text-stone-500">No channels yet.</li>}
          </ul>
        </section>
      </main>
    </div>
  );
}
