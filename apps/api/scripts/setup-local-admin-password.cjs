const argon2 = require("argon2");
const fs = require("node:fs");
const path = require("node:path");

function readSecret(prompt) {
  return new Promise((resolve, reject) => {
    const input = process.stdin;
    if (!input.isTTY || typeof input.setRawMode !== "function") {
      reject(new Error("Jalankan perintah ini di terminal interaktif."));
      return;
    }

    process.stdout.write(prompt);
    input.setEncoding("utf8");
    input.setRawMode(true);
    input.resume();
    let value = "";
    const onData = (chunk) => {
      for (const character of chunk) {
        if (character === "\u0003") {
          input.setRawMode(false);
          input.pause();
          input.off("data", onData);
          reject(new Error("Pengaturan dibatalkan."));
          return;
        }
        if (character === "\r" || character === "\n") {
          input.setRawMode(false);
          input.pause();
          input.off("data", onData);
          process.stdout.write("\n");
          resolve(value);
          return;
        }
        if (character === "\u007f" || character === "\b") {
          value = value.slice(0, -1);
        } else {
          value += character;
        }
      }
    };
    input.on("data", onData);
  });
}

function setEnvValue(contents, key, value) {
  const line = `${key}=${value}`;
  const matcher = new RegExp(`^${key}=.*$`, "m");
  return matcher.test(contents) ? contents.replace(matcher, line) : `${contents.trimEnd()}\n${line}\n`;
}

async function main() {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) {
    throw new Error("File apps/api/.env belum ada. Salin .env.example dan lengkapi konfigurasi terlebih dahulu.");
  }
  let contents = fs.readFileSync(envPath, "utf8");
  const allowlist = contents.match(/^ALLOWED_GOOGLE_ADMIN_EMAILS=(.*)$/m)?.[1]
    ?.split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean) ?? [];
  const existingEmail = contents.match(/^LOCAL_ADMIN_EMAIL=(.*)$/m)?.[1]?.trim().toLowerCase();
  const existingHash = contents.match(/^LOCAL_ADMIN_PASSWORD_HASH=(.*)$/m)?.[1]?.trim();
  if (process.argv.includes("--check")) {
    process.stdout.write(JSON.stringify({
      emailConfigured: Boolean(existingEmail),
      emailAllowed: Boolean(existingEmail && allowlist.includes(existingEmail)),
      argon2HashConfigured: Boolean(existingHash?.startsWith("$argon2")),
    }) + "\n");
    return;
  }
  if (allowlist.length === 0) {
    throw new Error("Tambahkan email admin ke ALLOWED_GOOGLE_ADMIN_EMAILS sebelum mengatur login lokal.");
  }

  const email = existingEmail || allowlist[0];
  if (!allowlist.includes(email)) {
    throw new Error("LOCAL_ADMIN_EMAIL harus termasuk dalam ALLOWED_GOOGLE_ADMIN_EMAILS.");
  }
  const password = await readSecret("Masukkan kata sandi admin lokal (tidak ditampilkan): ");
  if (password.length < 12 || password.length > 128) {
    throw new Error("Kata sandi harus terdiri dari 12–128 karakter.");
  }

  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  contents = setEnvValue(contents, "LOCAL_ADMIN_EMAIL", email);
  contents = setEnvValue(contents, "LOCAL_ADMIN_PASSWORD_HASH", passwordHash);
  fs.writeFileSync(envPath, contents, { mode: 0o600 });
  process.stdout.write(`Hash kata sandi lokal tersimpan untuk ${email}. Jangan bagikan file .env.\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
