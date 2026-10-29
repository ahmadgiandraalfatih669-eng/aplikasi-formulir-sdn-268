"use client";

import { useEffect, useState } from "react";
import { api, setSession, type SessionUser } from "@/lib/api";

export default function OAuthComplete() {
  const [message, setMessage] = useState("Memeriksa sesi masuk…");
  useEffect(() => {
    void api<{ accessToken: string }>("/auth/refresh", { method: "POST" })
      .then(async ({ accessToken }) => {
        const user = await api<SessionUser>("/auth/me", { headers: { Authorization: `Bearer ${accessToken}` } });
        setSession(accessToken, user);
        window.location.replace("/");
      })
      .catch(() => {
        setMessage("Sesi tidak dapat dibuat. Silakan masuk kembali.");
        window.setTimeout(() => window.location.replace("/"), 1800);
      });
  }, []);
  return <main className="flex min-h-screen items-center justify-center p-6 text-center font-semibold">{message}</main>;
}
