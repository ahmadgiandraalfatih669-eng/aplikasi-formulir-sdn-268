"use client";

export const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL ?? "/api/v1";

export type SessionUser = {
  id: string;
  name: string;
  role: "SUPER_ADMIN" | "ADMIN" | "TEACHER" | "STUDENT";
  firstLogin: boolean;
};

export function getAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.sessionStorage.getItem("sdn268_access");
}

export function setSession(accessToken: string, user: SessionUser): void {
  window.sessionStorage.setItem("sdn268_access", accessToken);
  window.sessionStorage.setItem("sdn268_user", JSON.stringify(user));
}

export function getSessionUser(): SessionUser | null {
  if (typeof window === "undefined") return null;
  const value = window.sessionStorage.getItem("sdn268_user");
  if (!value) return null;
  try {
    return JSON.parse(value) as SessionUser;
  } catch {
    window.sessionStorage.removeItem("sdn268_user");
    return null;
  }
}

function accessTokenExpiresSoon(token: string): boolean {
  try {
    const payloadPart = token.split(".")[1];
    if (!payloadPart) return true;
    const payload = JSON.parse(window.atob(payloadPart.replace(/-/g, "+").replace(/_/g, "/"))) as { exp?: unknown };
    return typeof payload.exp !== "number" || payload.exp * 1000 <= Date.now() + 60_000;
  } catch {
    return true;
  }
}

export function clearSession(): void {
  window.sessionStorage.removeItem("sdn268_access");
  window.sessionStorage.removeItem("sdn268_user");
}

export type ApiResult<T> = {
  data: T;
  meta: Record<string, unknown>;
};

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

let refreshInProgress: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  if (!refreshInProgress) {
    refreshInProgress = fetch(apiBaseUrl + "/auth/refresh", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    })
      .then(async (response) => {
        if (response.status === 401 || response.status === 403) return null;
        if (!response.ok) throw new Error("Sesi tidak dapat diperbarui karena layanan autentikasi bermasalah.");
        const body = await response.json() as { success: boolean; data?: { accessToken?: string } };
        const accessToken = body.success ? body.data?.accessToken : undefined;
        const user = getSessionUser();
        if (!accessToken || !user) return null;
        setSession(accessToken, user);
        return accessToken;
      })
      .finally(() => {
        refreshInProgress = null;
      });
  }
  return refreshInProgress;
}

export async function restoreSession(): Promise<SessionUser | null> {
  const storedUser = getSessionUser();
  if (!storedUser) return null;
  const token = getAccessToken();
  if (!token || accessTokenExpiresSoon(token)) {
    const refreshedToken = await refreshAccessToken();
    if (!refreshedToken) {
      clearSession();
      return null;
    }
  }
  const currentToken = getAccessToken();
  if (!currentToken) {
    clearSession();
    return null;
  }
  try {
    const response = await fetch(apiBaseUrl + "/auth/me", {
      headers: { Authorization: "Bearer " + currentToken },
      credentials: "include",
    });
    if (response.status === 401 || response.status === 403) {
      clearSession();
      return null;
    }
    if (!response.ok) throw new Error("Sesi tidak dapat diverifikasi karena layanan autentikasi bermasalah.");
    const body = await response.json() as { success: boolean; data?: SessionUser };
    if (!body.success || !body.data) {
      clearSession();
      return null;
    }
    setSession(currentToken, body.data);
    return body.data;
  } catch (error) {
    if (!navigator.onLine) return storedUser;
    throw error;
  }
}

export async function apiWithMeta<T>(path: string, init: RequestInit = {}): Promise<ApiResult<T>> {
  const request = (token: string | null) => fetch(apiBaseUrl + path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
      ...init.headers,
    },
    credentials: "include",
  });
  let response = await request(getAccessToken());
  if (response.status === 401 && !path.startsWith("/auth/")) {
    const refreshedToken = await refreshAccessToken();
    if (refreshedToken) response = await request(refreshedToken);
    if (response.status === 401) {
      clearSession();
      window.dispatchEvent(new Event("sdn268:session-expired"));
    }
  }
  const body = await response.json() as {
    success: boolean;
    data: T;
    error: { code?: string; message: string; fields?: unknown } | null;
    meta?: Record<string, unknown>;
  };
  if (!response.ok || !body.success) {
    const code = body.error?.code ? " [" + body.error.code + "]" : "";
    const details = Array.isArray(body.error?.fields) ? " " + body.error.fields.join(" ") : "";
    throw new ApiError((body.error?.message ?? "Permintaan gagal. Silakan coba lagi.") + code + details, response.status);
  }
  return { data: body.data, meta: body.meta ?? {} };
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const result = await apiWithMeta<T>(path, init);
  return result.data;
}
