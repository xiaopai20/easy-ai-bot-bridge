"use client";

import { fetchAuthSession, getCurrentUser, signInWithRedirect, signOut } from "./amplify";

export interface User {
  userId: string;
  email: string;
  name: string;
  token?: string;
}

const AUTH_STORAGE_KEY = "easy-ai-bot-bridge-auth";

export async function resolveCurrentUser() {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await getCurrentUser();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
  throw lastError;
}

export async function resolveAuthSession() {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      const session = await fetchAuthSession();
      if (session.tokens?.idToken) {
        return session;
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
  return await fetchAuthSession();
}

function tokenString(idTokenObj: unknown): string | null {
  if (!idTokenObj) return null;
  if (typeof idTokenObj === "string") return idTokenObj;
  if (typeof idTokenObj === "object" && idTokenObj !== null) {
    const withToString = idTokenObj as { toString?: () => string; token?: string };
    if (typeof withToString.token === "string" && withToString.token.length > 0) {
      return withToString.token;
    }
    if (typeof withToString.toString === "function") {
      const value = withToString.toString();
      if (value && value !== "[object Object]") return value;
    }
  }
  return null;
}

export async function getStoredUser(): Promise<User | null> {
  if (typeof window === "undefined") return null;

  if (!process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID) {
    try {
      const stored = localStorage.getItem(AUTH_STORAGE_KEY);
      return stored ? (JSON.parse(stored) as User) : null;
    } catch {
      return null;
    }
  }

  try {
    const session = await resolveAuthSession();
    const claims = session.tokens?.idToken?.payload;
    const idToken = tokenString(session.tokens?.idToken);
    if (!claims || !idToken) return null;

    let currentUser: Awaited<ReturnType<typeof getCurrentUser>> | undefined;
    try {
      currentUser = await resolveCurrentUser();
    } catch {
      currentUser = undefined;
    }

    return {
      userId:
        (typeof claims.sub === "string" ? claims.sub : "") ||
        (typeof claims["cognito:username"] === "string" ? claims["cognito:username"] : "") ||
        currentUser?.username ||
        "",
      email: typeof claims.email === "string" ? claims.email : "",
      name:
        (typeof claims.name === "string" && claims.name) ||
        (typeof claims.email === "string" && claims.email) ||
        currentUser?.username ||
        "User",
      token: idToken,
    };
  } catch {
    return null;
  }
}

function setStoredUser(user: User | null): void {
  if (typeof window === "undefined") return;
  if (user) {
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(user));
  } else {
    localStorage.removeItem(AUTH_STORAGE_KEY);
  }
  window.dispatchEvent(new Event("storage"));
  window.dispatchEvent(new Event("auth-changed"));
}

export async function loginWithGoogle(): Promise<void> {
  const isLocalhost =
    typeof window !== "undefined" &&
    (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
  const noCognito = !process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID?.trim();

  if (noCognito || isLocalhost) {
    const mockUser: User = {
      userId: process.env.NEXT_PUBLIC_DEV_USER_ID || "dev-user-123",
      email: process.env.NEXT_PUBLIC_DEV_EMAIL || "dev@example.com",
      name: process.env.NEXT_PUBLIC_DEV_NAME || "Dev User",
    };
    setStoredUser(mockUser);
    window.dispatchEvent(new Event("auth-changed"));
    return;
  }

  await signInWithRedirect({ provider: "Google" });
}

export async function logout(): Promise<void> {
  if (!process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID) {
    setStoredUser(null);
    window.location.href = "/";
    return;
  }
  try {
    await signOut();
  } catch (error) {
    console.error("Logout failed:", error);
  }
  window.location.href = "/";
}

export async function getAuthToken(): Promise<string | null> {
  if (!process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID) {
    const user = await getStoredUser();
    return user ? "mock-token" : null;
  }
  const user = await getStoredUser();
  if (user?.token) return user.token;
  try {
    const session = await fetchAuthSession();
    return tokenString(session.tokens?.idToken);
  } catch {
    return null;
  }
}
