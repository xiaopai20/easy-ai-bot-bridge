"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { LoginDialog } from "@/components/LoginDialog";
import {
  getAdminTenant,
  getMe,
  patchAdminLimits,
  type TenantLimits,
  type TenantLimitsOverride,
} from "@/lib/api";
import { getStoredUser, logout, type User } from "@/lib/auth";

const FIELDS: Array<{ key: keyof TenantLimits; label: string }> = [
  { key: "maxBots", label: "Max bots" },
  { key: "maxChannels", label: "Max channels" },
  { key: "maxRoutes", label: "Max routes" },
  { key: "messagesPerMinute", label: "Messages per minute" },
  { key: "messagesPerDay", label: "Messages per day" },
  { key: "loopMessagesPerThreadPerMinute", label: "Loop messages per thread per minute" },
];

export default function AdminPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [tenantId, setTenantId] = useState("");
  const [defaults, setDefaults] = useState<TenantLimits | null>(null);
  const [override, setOverride] = useState<TenantLimitsOverride>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const stored = await getStoredUser();
      if (!stored) {
        setLoginOpen(true);
        return;
      }
      setUser(stored);
      try {
        const me = await getMe();
        setIsAdmin(Boolean(me.isAdmin));
        if (!me.isAdmin) {
          setError("Admin only. Your Google email is not in ADMIN_EMAILS.");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load");
      }
    })();
  }, []);

  async function onLoad(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const loaded = await getAdminTenant(tenantId.trim());
      setDefaults(loaded.limits);
      setOverride(loaded.override ?? {});
      setNotice(`Loaded ${loaded.tenant.ownerEmail} (${loaded.tenant.tenantId})`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load tenant");
    } finally {
      setBusy(false);
    }
  }

  async function onSave(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const body: Partial<Record<keyof TenantLimits, number | null>> = {};
      for (const field of FIELDS) {
        const value = override[field.key];
        body[field.key] = typeof value === "number" && Number.isFinite(value) ? value : null;
      }
      const saved = await patchAdminLimits(tenantId.trim(), body);
      setDefaults(saved.limits);
      setOverride(saved.override ?? {});
      setNotice("Override saved. Hot-path Lambdas pick it up within the settings cache TTL.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save override");
    } finally {
      setBusy(false);
    }
  }

  async function onReset() {
    setBusy(true);
    setError(null);
    try {
      const saved = await patchAdminLimits(tenantId.trim(), { reset: true });
      setDefaults(saved.limits);
      setOverride({});
      setNotice("Override cleared. Tenant uses deployment defaults.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reset");
    } finally {
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
          }}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900">
      <AppHeader user={user} isAdmin={isAdmin} onLogout={() => void logout()} />
      <main className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Admin</h1>
          <p className="mt-1 text-sm text-stone-600">
            Look up a tenant id from that user&apos;s dashboard and set a per-tenant override.
          </p>
        </div>
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
        )}
        {notice && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{notice}</div>
        )}
        {isAdmin && (
          <>
            <form onSubmit={onLoad} className="flex gap-3">
              <input
                required
                value={tenantId}
                onChange={(e) => setTenantId(e.target.value)}
                placeholder="t_..."
                className="flex-1 rounded-lg border border-stone-200 px-3 py-2 text-sm"
              />
              <button
                type="submit"
                disabled={busy}
                className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                Load
              </button>
            </form>
            {defaults && (
              <form onSubmit={onSave} className="rounded-2xl border border-stone-200 bg-white p-6 space-y-4">
                {FIELDS.map((field) => (
                  <label key={field.key} className="block text-sm">
                    <span className="font-medium">{field.label}</span>
                    <span className="ml-2 text-stone-500">default {defaults[field.key]}</span>
                    <input
                      type="number"
                      min={1}
                      step={1}
                      value={override[field.key] ?? ""}
                      placeholder={`Inherit ${defaults[field.key]}`}
                      onChange={(e) => {
                        const raw = e.target.value;
                        setOverride((current) => {
                          const next = { ...current };
                          if (raw === "") {
                            delete next[field.key];
                          } else {
                            next[field.key] = Number(raw);
                          }
                          return next;
                        });
                      }}
                      className="mt-1 w-full rounded-lg border border-stone-200 px-3 py-2 text-sm"
                    />
                  </label>
                ))}
                <div className="flex gap-3">
                  <button
                    type="submit"
                    disabled={busy}
                    className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-stone-900 disabled:opacity-60"
                  >
                    Save override
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void onReset()}
                    className="rounded-lg border border-stone-200 px-4 py-2 text-sm font-medium"
                  >
                    Reset to defaults
                  </button>
                </div>
              </form>
            )}
          </>
        )}
      </main>
    </div>
  );
}
