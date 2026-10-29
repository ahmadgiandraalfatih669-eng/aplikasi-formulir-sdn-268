"use client";

import { useEffect } from "react";
import { initializeFirebaseAnalytics } from "@/lib/firebase";

export function FirebaseAnalytics() {
  useEffect(() => {
    void initializeFirebaseAnalytics().catch((error: unknown) => {
      if (process.env.NODE_ENV === "development") {
        console.warn("Firebase Analytics tidak tersedia.", error);
      }
    });
  }, []);

  return null;
}
