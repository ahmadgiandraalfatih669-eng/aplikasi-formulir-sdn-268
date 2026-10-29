import { expect, test } from "@playwright/test";

test("login page shows accessible student login and staff sign-in", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Portal Formulir & Penilaian" })).toBeVisible();
  await expect(page.getByLabel("Nama pengguna murid")).toBeVisible();
  await expect(page.getByLabel("NISN / kata sandi")).toBeVisible();
  await expect(page.getByRole("link", { name: "Masuk admin / guru dengan Google" })).toBeVisible();
  await expect(page.getByText("Akses admin lokal (development)")).toBeVisible();
  await expect(page.getByLabel("Email admin")).toBeVisible();
  await expect(page.getByLabel("Kata sandi admin")).toBeVisible();
  await expect(page.getByRole("button", { name: "Masuk admin lokal" })).toBeVisible();
});
