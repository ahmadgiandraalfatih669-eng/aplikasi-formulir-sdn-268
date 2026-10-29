"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

type Theme = "dark" | "light";
const storageKey = "sdn268-theme";

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    const stored = window.localStorage.getItem(storageKey);
    const nextTheme: Theme = stored === "light" ? "light" : "dark";
    setTheme(nextTheme);
    applyTheme(nextTheme);
  }, []);

  function toggleTheme() {
    const nextTheme: Theme = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    window.localStorage.setItem(storageKey, nextTheme);
    applyTheme(nextTheme);
  }

  const isLight = theme === "light";
  return (
    <button
      type="button"
      className="ds-theme-toggle"
      onClick={toggleTheme}
      aria-label={isLight ? "Aktifkan mode gelap" : "Aktifkan mode terang"}
      title={isLight ? "Mode terang aktif" : "Mode gelap aktif"}
    >
      {isLight ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
      <span>{isLight ? "Terang" : "Gelap"}</span>
    </button>
  );
}
