import { createHmac, randomBytes } from "node:crypto";
import argon2 from "argon2";
import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import jwt from "jsonwebtoken";
import passport from "passport";
import { Prisma } from "@prisma/client";
import ExcelJS from "exceljs";
import { Strategy as GoogleStrategy, type Profile } from "passport-google-oauth20";
import { z } from "zod";
import {
  createFormSchema,
  createFormRequestSchema,
  formAssignmentSchema,
  gradeAnswers,
  normalizeStudentLoginId,
  type FormQuestion,
  studentBulkSchema,
  studentCreateSchema,
  studentLoginSchema,
  studentUpdateSchema,
  submitSchema,
  validateMatrixAnswer,
} from "@sdn268/shared";
import { authenticate, createAccessToken, hashToken, requireInitialPasswordChanged, requireRoles } from "./auth.js";
import { prisma } from "./db.js";

const app = express();
const allowedOrigin = process.env.FRONTEND_URL ?? "http://localhost:3000";
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { success: false, data: null, error: { code: "RATE_LIMITED", message: "Terlalu banyak percobaan. Coba lagi nanti." }, meta: {} },
});
const studentImportSchema = z.object({
  name: z.string().trim().min(2).max(160),
  studentLoginId: z.string().trim().max(120).optional().default(""),
  nisn: z.string().trim().optional().default(""),
  className: z.string().trim().max(80).optional().default(""),
  academicYear: z.string().trim().max(32).optional().default(""),
  status: z.enum(["ACTIVE", "INACTIVE", "SUSPENDED"]).default("ACTIVE"),
});

app.disable("x-powered-by");
app.use(helmet());
app.use(cors({ origin: allowedOrigin, credentials: true }));
app.use((req, res, next) => {
  const origin = req.get("origin");
  if (origin && origin !== allowedOrigin) return failure(res, 403, "ORIGIN_REJECTED", "Asal permintaan tidak diizinkan.");
  next();
});
app.use(express.json({ limit: "16mb" }));
app.use(cookieParser());
app.use(passport.initialize());

function success(res: Response, data: unknown, status = 200, meta: Record<string, unknown> = {}): void {
  res.status(status).json({ success: true, data, error: null, meta });
}

function failure(res: Response, status: number, code: string, message: string, fields?: unknown): void {
  res.status(status).json({
    success: false,
    data: null,
    error: { code, message, ...(fields ? { fields } : {}) },
    meta: {},
  });
}

function requireUuidParam(param: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!z.string().uuid().safeParse(req.params[param]).success) {
      failure(res, 400, "VALIDATION_ERROR", "ID murid tidak valid.");
      return;
    }
    next();
  };
}

function publicSchema(schema: unknown): unknown {
  if (!schema || typeof schema !== "object") return schema;
  const source = schema as { questions?: Array<Record<string, unknown>>; [key: string]: unknown };
  return {
    ...source,
    questions: source.questions?.map(({ answerKey: _answerKey, ...question }) => question),
  };
}

function refreshSecret(): string {
  const secret = process.env.JWT_REFRESH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("JWT_REFRESH_SECRET harus diisi dan minimal 32 karakter.");
  }
  return secret;
}

function hashNisn(nisn: string): string {
  const secret = process.env.NISN_HASH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("NISN_HASH_SECRET harus diisi dan minimal 32 karakter.");
  }
  return createHmac("sha256", secret).update(nisn).digest("hex");
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function studentRecord(profile: {
  id: string;
  userId: string;
  studentLoginId: string;
  nisnMasked: string;
  firstLogin: boolean;
  classId: string | null;
  recordVersion: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  user: { name: string; status: "ACTIVE" | "INACTIVE" | "SUSPENDED" };
  schoolClass: { name: string } | null;
}) {
  return {
    id: profile.id,
    userId: profile.userId,
    name: profile.user.name,
    studentLoginId: profile.studentLoginId,
    nisnMasked: profile.nisnMasked,
    classId: profile.classId,
    className: profile.schoolClass?.name ?? null,
    status: profile.user.status,
    firstLogin: profile.firstLogin,
    recordVersion: profile.recordVersion,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
    deletedAt: profile.deletedAt,
  };
}

async function writeAudit(
  req: Request,
  actorId: string | null,
  action: string,
  resourceType: string,
  resourceId?: string,
  metadata?: Prisma.InputJsonObject,
) {
  await prisma.auditLog.create({
    data: {
      actorId,
      action,
      resourceType,
      resourceId,
      ...(metadata ? { metadata } : {}),
      ipAddress: req.ip,
      userAgent: req.get("user-agent")?.slice(0, 300),
    },
  });
}

async function studentCanAccess(formId: string, userId: string): Promise<boolean> {
  const profile = await prisma.studentProfile.findUnique({
    where: { userId },
    select: { id: true, classId: true, deletedAt: true },
  });
  if (!profile || profile.deletedAt) return false;
  return Boolean(await prisma.formAssignment.findFirst({
    where: {
      formId,
      OR: [
        { studentId: profile.id },
        ...(profile.classId ? [{ classId: profile.classId }] : []),
      ],
    },
    select: { id: true },
  }));
}

function configureGoogleAuth(): void {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_CALLBACK_URL } = process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_CALLBACK_URL) return;
  passport.use(
    new GoogleStrategy(
      {
        clientID: GOOGLE_CLIENT_ID,
        clientSecret: GOOGLE_CLIENT_SECRET,
        callbackURL: GOOGLE_CALLBACK_URL,
        passReqToCallback: true,
      },
      async (_req, _accessToken, _refreshToken, profile: Profile, done) => {
        try {
          const email = profile.emails?.[0]?.value?.trim().toLowerCase();
          if (!email || !profile.id) return done(null, false);
          const account = await prisma.allowedGoogleAccount.findUnique({ where: { email } });
          const domain = email.split("@")[1];
          const configuredAdminEmails = new Set(
            (process.env.ALLOWED_GOOGLE_ADMIN_EMAILS ?? "")
              .split(",")
              .map((value) => value.trim().toLowerCase())
              .filter(Boolean),
          );
          const configuredAdmin = configuredAdminEmails.has(email);
          const domainAllowed = domain
            ? (process.env.ALLOWED_GOOGLE_DOMAINS ?? "").split(",").map((value) => value.trim().toLowerCase()).includes(domain)
              ? { domain }
              : await prisma.allowedGoogleDomain.findUnique({ where: { domain } })
            : null;
          if (!account && !domainAllowed && !configuredAdmin) return done(null, false);
          if (account?.role === "STUDENT") return done(null, false);
          const role = account?.role ?? (configuredAdmin ? "ADMIN" : "TEACHER");

          const user = await prisma.user.upsert({
            where: { email },
            create: {
              email,
              name: profile.displayName || email,
              role,
              googleSubjectId: profile.id,
            },
            update: {
              name: profile.displayName || email,
              role,
              googleSubjectId: profile.id,
              lastLoginAt: new Date(),
            },
          });
          if (user.status !== "ACTIVE") return done(null, false);
          done(null, { id: user.id, role: user.role, name: user.name, firstLogin: false });
        } catch (error) {
          done(error as Error);
        }
      },
    ),
  );
}

configureGoogleAuth();

app.get("/api/v1/health", async (_req, res) => {
  await prisma.$queryRaw`SELECT 1`;
  success(res, { status: "ok", database: "ok", timestamp: new Date().toISOString() });
});

app.post("/api/v1/auth/student/login", authLimiter, async (req, res) => {
  const parsed = studentLoginSchema.safeParse(req.body);
  if (!parsed.success) return failure(res, 400, "VALIDATION_ERROR", "Nama pengguna atau kata sandi tidak valid.", parsed.error.flatten());
  const studentLoginId = normalizeStudentLoginId(parsed.data.username);
  const profile = await prisma.studentProfile.findFirst({
    where: { studentLoginId, deletedAt: null, user: { status: "ACTIVE", deletedAt: null } },
    include: { user: true },
  });
  const valid = profile?.user.passwordHash
    ? await argon2.verify(profile.user.passwordHash, parsed.data.password)
    : false;
  if (!profile || !valid) {
    await writeAudit(req, profile?.userId ?? null, "STUDENT_LOGIN_FAILED", "User");
    return failure(res, 401, "LOGIN_FAILED", "Nama pengguna atau kata sandi salah.");
  }
  await prisma.user.update({ where: { id: profile.userId }, data: { lastLoginAt: new Date() } });
  await writeAudit(req, profile.userId, "STUDENT_LOGIN_SUCCEEDED", "User", profile.userId);
  const accessToken = createAccessToken({
    id: profile.userId,
    role: "STUDENT",
    name: profile.user.name,
    firstLogin: profile.firstLogin,
  });
  const refreshToken = jwt.sign({ sub: profile.userId, nonce: randomBytes(16).toString("hex") }, refreshSecret(), { expiresIn: "7d" });
  await prisma.refreshToken.create({
    data: { userId: profile.userId, tokenHash: hashToken(refreshToken), expiresAt: new Date(Date.now() + 7 * 86400000) },
  });
  res.cookie("refreshToken", refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    path: "/api/v1/auth",
    maxAge: 7 * 86400000,
  });
  success(res, {
    accessToken,
    user: { id: profile.userId, name: profile.user.name, role: "STUDENT", firstLogin: profile.firstLogin },
  });
});

app.post("/api/v1/auth/local-admin/login", authLimiter, async (req, res) => {
  if (process.env.NODE_ENV !== "development") {
    return failure(res, 404, "NOT_FOUND", "Endpoint tidak ditemukan.");
  }

  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const configuredEmail = process.env.LOCAL_ADMIN_EMAIL?.trim().toLowerCase();
  const passwordHash = process.env.LOCAL_ADMIN_PASSWORD_HASH;
  const allowedEmails = (process.env.ALLOWED_GOOGLE_ADMIN_EMAILS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (!configuredEmail || !passwordHash?.startsWith("$argon2") || !allowedEmails.includes(configuredEmail)) {
    return failure(res, 503, "LOCAL_ADMIN_NOT_CONFIGURED", "Login admin lokal belum dikonfigurasi.");
  }

  const valid = email === configuredEmail && password.length <= 128
    ? await argon2.verify(passwordHash, password)
    : false;
  if (!valid) {
    await writeAudit(req, null, "LOCAL_ADMIN_LOGIN_FAILED", "User");
    return failure(res, 401, "LOGIN_FAILED", "Email atau kata sandi salah.");
  }

  const user = await prisma.user.upsert({
    where: { email: configuredEmail },
    create: { email: configuredEmail, name: configuredEmail, role: "ADMIN" },
    update: { role: "ADMIN", lastLoginAt: new Date() },
  });
  if (user.status !== "ACTIVE" || user.deletedAt) {
    await writeAudit(req, user.id, "LOCAL_ADMIN_LOGIN_FAILED", "User", user.id);
    return failure(res, 403, "ACCOUNT_INACTIVE", "Akun tidak aktif.");
  }
  await writeAudit(req, user.id, "LOCAL_ADMIN_LOGIN_SUCCEEDED", "User", user.id);

  const accessToken = createAccessToken({
    id: user.id,
    role: user.role,
    name: user.name,
    firstLogin: false,
  });
  const refreshToken = jwt.sign(
    { sub: user.id, nonce: randomBytes(16).toString("hex") },
    refreshSecret(),
    { expiresIn: "7d" },
  );
  await prisma.refreshToken.create({
    data: { userId: user.id, tokenHash: hashToken(refreshToken), expiresAt: new Date(Date.now() + 7 * 86400000) },
  });
  res.cookie("refreshToken", refreshToken, {
    httpOnly: true,
    secure: false,
    sameSite: "lax",
    path: "/api/v1/auth",
    maxAge: 7 * 86400000,
  });
  return success(res, {
    accessToken,
    user: { id: user.id, name: user.name, role: user.role, firstLogin: false },
  });
});

app.post("/api/v1/auth/change-initial-password", authenticate, requireRoles("STUDENT"), authLimiter, async (req, res) => {
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (password.length < 8 || password.length > 128) {
    return failure(res, 400, "VALIDATION_ERROR", "PIN/kata sandi baru harus terdiri dari 8–128 karakter.");
  }
  const profile = await prisma.studentProfile.findUnique({ where: { userId: req.user!.id } });
  if (!profile?.firstLogin) return failure(res, 409, "ALREADY_CHANGED", "Kata sandi awal sudah diganti.");
  await prisma.$transaction([
    prisma.user.update({ where: { id: req.user!.id }, data: { passwordHash: await argon2.hash(password, { type: argon2.argon2id }) } }),
    prisma.studentProfile.update({ where: { userId: req.user!.id }, data: { firstLogin: false } }),
  ]);
  await writeAudit(req, req.user!.id, "STUDENT_PASSWORD_CHANGED", "User", req.user!.id);
  success(res, { changed: true });
});

app.get("/api/v1/auth/google", (req, res, next) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET || !process.env.GOOGLE_CALLBACK_URL) {
    return failure(res, 503, "OAUTH_NOT_CONFIGURED", "Login Google belum dikonfigurasi.");
  }
  const state = randomBytes(32).toString("hex");
  res.cookie("googleOauthState", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/v1/auth/google/callback",
    maxAge: 5 * 60 * 1000,
  });
  passport.authenticate("google", { scope: ["profile", "email"], state })(req, res, next);
});

app.get("/api/v1/auth/google/callback", authLimiter, (req, res, next) => {
  const storedState = req.cookies.googleOauthState as string | undefined;
  res.clearCookie("googleOauthState", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/v1/auth/google/callback",
  });
  if (!storedState || typeof req.query.state !== "string" || storedState !== req.query.state) {
    void writeAudit(req, null, "GOOGLE_LOGIN_FAILED", "User");
    return res.redirect(`${allowedOrigin}/login?error=invalid_oauth_state`);
  }
  passport.authenticate("google", { session: false }, async (error: Error | null, user: { id: string; role: string; name: string } | false) => {
    if (error || !user) {
      await writeAudit(req, null, "GOOGLE_LOGIN_FAILED", "User");
      return res.redirect(`${allowedOrigin}/login?error=google_login_failed`);
    }
    try {
      const refreshToken = jwt.sign({ sub: user.id, nonce: randomBytes(16).toString("hex") }, refreshSecret(), { expiresIn: "7d" });
      await prisma.refreshToken.create({
        data: { userId: user.id, tokenHash: hashToken(refreshToken), expiresAt: new Date(Date.now() + 7 * 86400000) },
      });
      res.cookie("refreshToken", refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
        path: "/api/v1/auth",
        maxAge: 7 * 86400000,
      });
      await writeAudit(req, user.id, "GOOGLE_LOGIN_SUCCEEDED", "User", user.id);
      res.redirect(`${allowedOrigin}/oauth/complete`);
    } catch (cause) {
      next(cause);
    }
  })(req, res, next);
});

app.post("/api/v1/auth/refresh", async (req, res) => {
  if (req.get("origin") !== allowedOrigin) return failure(res, 403, "ORIGIN_REJECTED", "Permintaan tidak diizinkan.");
  const token = req.cookies.refreshToken as string | undefined;
  if (!token) return failure(res, 401, "UNAUTHORIZED", "Sesi berakhir. Silakan masuk kembali.");
  try {
    const payload = jwt.verify(token, refreshSecret()) as jwt.JwtPayload;
    const stored = await prisma.refreshToken.findFirst({
      where: { tokenHash: hashToken(token), revokedAt: null, expiresAt: { gt: new Date() } },
      include: { user: true },
    });
    if (!stored || stored.user.id !== payload.sub || stored.user.status !== "ACTIVE") {
      return failure(res, 401, "UNAUTHORIZED", "Sesi tidak berlaku.");
    }
    const nextToken = jwt.sign({ sub: stored.user.id, nonce: randomBytes(16).toString("hex") }, refreshSecret(), { expiresIn: "7d" });
    await prisma.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } });
    await prisma.refreshToken.create({
      data: { userId: stored.user.id, tokenHash: hashToken(nextToken), expiresAt: new Date(Date.now() + 7 * 86400000) },
    });
    res.cookie("refreshToken", nextToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      path: "/api/v1/auth",
      maxAge: 7 * 86400000,
    });
    return success(res, { accessToken: createAccessToken({ id: stored.user.id, name: stored.user.name, role: stored.user.role, firstLogin: false }) });
  } catch {
    return failure(res, 401, "UNAUTHORIZED", "Sesi tidak berlaku.");
  }
});

app.post("/api/v1/auth/logout", async (req, res) => {
  const token = req.cookies.refreshToken as string | undefined;
  if (token) {
    const stored = await prisma.refreshToken.findFirst({
      where: { tokenHash: hashToken(token), revokedAt: null },
      select: { id: true, userId: true },
    });
    await prisma.refreshToken.updateMany({ where: { tokenHash: hashToken(token), revokedAt: null }, data: { revokedAt: new Date() } });
    if (stored) await writeAudit(req, stored.userId, "LOGOUT", "User", stored.userId);
  }
  res.clearCookie("refreshToken", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    path: "/api/v1/auth",
  });
  success(res, { loggedOut: true });
});

app.get("/api/v1/auth/me", authenticate, (req, res) => {
  success(res, req.user);
});

const studentQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(10).default(10),
  q: z.string().trim().max(160).optional(),
  classId: z.string().uuid().optional(),
  status: z.enum(["ACTIVE", "INACTIVE", "SUSPENDED"]).optional(),
  showDeleted: z.enum(["true", "false"]).default("false"),
  sortBy: z.enum(["name", "createdAt"]).default("name"),
  sortOrder: z.enum(["asc", "desc"]).default("asc"),
});

app.get("/api/v1/classes", authenticate, requireInitialPasswordChanged, requireRoles("SUPER_ADMIN", "ADMIN", "TEACHER"), async (_req, res) => {
  const classes = await prisma.schoolClass.findMany({
    orderBy: [{ academicYear: { active: "desc" } }, { name: "asc" }],
    select: { id: true, name: true, academicYear: { select: { name: true, active: true } } },
  });
  success(res, classes);
});

app.get("/api/v1/students", authenticate, requireInitialPasswordChanged, requireRoles("SUPER_ADMIN", "ADMIN"), async (req, res) => {
  const parsed = studentQuerySchema.safeParse(req.query);
  if (!parsed.success) return failure(res, 400, "VALIDATION_ERROR", "Filter daftar murid tidak valid.", parsed.error.flatten());
  const { page, pageSize, q, classId, status, showDeleted, sortBy, sortOrder } = parsed.data;
  const where: Prisma.StudentProfileWhereInput = {
    deletedAt: showDeleted === "true" ? { not: null } : null,
    ...(classId ? { classId } : {}),
    ...(status ? { user: { status } } : {}),
    ...(q ? {
      OR: [
        { user: { name: { contains: q, mode: "insensitive" } } },
        { studentLoginId: { contains: q, mode: "insensitive" } },
      ],
    } : {}),
  };
  const [total, profiles] = await prisma.$transaction([
    prisma.studentProfile.count({ where }),
    prisma.studentProfile.findMany({
      where,
      include: { user: { select: { name: true, status: true } }, schoolClass: { select: { name: true } } },
      orderBy: sortBy === "name" ? { user: { name: sortOrder } } : { createdAt: sortOrder },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  success(res, profiles.map(studentRecord), 200, { page, pageSize, total, totalPages: Math.ceil(total / pageSize) });
});

app.post("/api/v1/students", authenticate, requireInitialPasswordChanged, requireRoles("SUPER_ADMIN", "ADMIN"), async (req, res) => {
  const parsed = studentCreateSchema.safeParse(req.body);
  if (!parsed.success) return failure(res, 400, "VALIDATION_ERROR", "Data murid tidak valid.", parsed.error.flatten());
  const input = parsed.data;
  const schoolClass = input.classId
    ? await prisma.schoolClass.findUnique({ where: { id: input.classId }, select: { id: true, name: true } })
    : null;
  if (input.classId && !schoolClass) return failure(res, 400, "INVALID_CLASS", "Kelas tidak ditemukan.");
  const nisnHash = hashNisn(input.nisn);
  try {
    const profile = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          name: input.name,
          role: "STUDENT",
          status: input.status,
          passwordHash: await argon2.hash(input.nisn, { type: argon2.argon2id }),
        },
      });
      const studentLoginId = normalizeStudentLoginId(`${input.name} ${schoolClass?.name ?? "murid"} ${user.id.slice(0, 8)}`);
      return tx.studentProfile.create({
        data: {
          userId: user.id,
          studentLoginId,
          nisnHash,
          nisnMasked: `******${input.nisn.slice(-4)}`,
          classId: schoolClass?.id,
        },
        include: { user: { select: { name: true, status: true } }, schoolClass: { select: { name: true } } },
      });
    });
    await writeAudit(req, req.user!.id, "STUDENT_CREATED", "StudentProfile", profile.id);
    return success(res, studentRecord(profile), 201);
  } catch (error) {
    if (isUniqueConstraintError(error)) return failure(res, 409, "STUDENT_DUPLICATE", "NISN atau identitas murid sudah terdaftar.");
    throw error;
  }
});

app.get("/api/v1/students/:id", authenticate, requireInitialPasswordChanged, requireRoles("SUPER_ADMIN", "ADMIN"), requireUuidParam("id"), async (req, res) => {
  const profile = await prisma.studentProfile.findFirst({
    where: { id: String(req.params.id), deletedAt: null },
    include: { user: { select: { name: true, status: true } }, schoolClass: { select: { name: true } } },
  });
  if (!profile) return failure(res, 404, "NOT_FOUND", "Murid tidak ditemukan.");
  success(res, studentRecord(profile));
});

app.patch("/api/v1/students/:id", authenticate, requireInitialPasswordChanged, requireRoles("SUPER_ADMIN", "ADMIN"), requireUuidParam("id"), async (req, res) => {
  const parsed = studentUpdateSchema.safeParse(req.body);
  if (!parsed.success) return failure(res, 400, "VALIDATION_ERROR", "Perubahan data murid tidak valid.", parsed.error.flatten());
  const existing = await prisma.studentProfile.findFirst({
    where: { id: String(req.params.id), deletedAt: null },
    select: { id: true, userId: true, recordVersion: true },
  });
  if (!existing) return failure(res, 404, "NOT_FOUND", "Murid tidak ditemukan.");
  const schoolClass = parsed.data.classId
    ? await prisma.schoolClass.findUnique({ where: { id: parsed.data.classId }, select: { id: true } })
    : undefined;
  if (parsed.data.classId && !schoolClass) return failure(res, 400, "INVALID_CLASS", "Kelas tidak ditemukan.");

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.studentProfile.updateMany({
      where: {
        id: existing.id,
        deletedAt: null,
        recordVersion: parsed.data.recordVersion ?? existing.recordVersion,
      },
      data: {
        ...(parsed.data.classId !== undefined ? { classId: schoolClass?.id ?? null } : {}),
        recordVersion: { increment: 1 },
      },
    });
    if (!updated.count) return null;
    await tx.user.update({
      where: { id: existing.userId },
      data: {
        ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
        ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
      },
    });
    return tx.studentProfile.findUniqueOrThrow({
      where: { id: existing.id },
      include: { user: { select: { name: true, status: true } }, schoolClass: { select: { name: true } } },
    });
  });
  if (!result) return failure(res, 409, "VERSION_CONFLICT", "Data murid telah berubah. Muat ulang sebelum menyimpan.");
  await writeAudit(req, req.user!.id, "STUDENT_UPDATED", "StudentProfile", result.id);
  success(res, studentRecord(result));
});

app.delete("/api/v1/students/:id", authenticate, requireInitialPasswordChanged, requireRoles("SUPER_ADMIN", "ADMIN"), requireUuidParam("id"), async (req, res) => {
  const result = await prisma.studentProfile.updateMany({
    where: { id: String(req.params.id), deletedAt: null },
    data: { deletedAt: new Date(), recordVersion: { increment: 1 } },
  });
  if (!result.count) return failure(res, 404, "NOT_FOUND", "Murid tidak ditemukan atau sudah dihapus.");
  await writeAudit(req, req.user!.id, "STUDENT_SOFT_DELETED", "StudentProfile", String(req.params.id));
  success(res, { deleted: true });
});

app.post("/api/v1/students/:id/restore", authenticate, requireInitialPasswordChanged, requireRoles("SUPER_ADMIN", "ADMIN"), requireUuidParam("id"), async (req, res) => {
  const result = await prisma.studentProfile.updateMany({
    where: { id: String(req.params.id), deletedAt: { not: null } },
    data: { deletedAt: null, recordVersion: { increment: 1 } },
  });
  if (!result.count) return failure(res, 404, "NOT_FOUND", "Murid terhapus tidak ditemukan.");
  await writeAudit(req, req.user!.id, "STUDENT_RESTORED", "StudentProfile", String(req.params.id));
  success(res, { restored: true });
});

app.post("/api/v1/students/bulk-delete", authenticate, requireInitialPasswordChanged, requireRoles("SUPER_ADMIN", "ADMIN"), async (req, res) => {
  const parsed = studentBulkSchema.safeParse(req.body);
  if (!parsed.success) return failure(res, 400, "VALIDATION_ERROR", "Daftar murid tidak valid.", parsed.error.flatten());
  const result = await prisma.studentProfile.updateMany({
    where: { id: { in: parsed.data.ids }, deletedAt: null },
    data: { deletedAt: new Date(), recordVersion: { increment: 1 } },
  });
  await writeAudit(req, req.user!.id, "STUDENT_BULK_SOFT_DELETED", "StudentProfile", undefined, { affectedCount: result.count });
  success(res, { deletedCount: result.count });
});

app.post("/api/v1/students/bulk-restore", authenticate, requireInitialPasswordChanged, requireRoles("SUPER_ADMIN", "ADMIN"), async (req, res) => {
  const parsed = studentBulkSchema.safeParse(req.body);
  if (!parsed.success) return failure(res, 400, "VALIDATION_ERROR", "Daftar murid tidak valid.", parsed.error.flatten());
  const result = await prisma.studentProfile.updateMany({
    where: { id: { in: parsed.data.ids }, deletedAt: { not: null } },
    data: { deletedAt: null, recordVersion: { increment: 1 } },
  });
  await writeAudit(req, req.user!.id, "STUDENT_BULK_RESTORED", "StudentProfile", undefined, { affectedCount: result.count });
  success(res, { restoredCount: result.count });
});

app.post("/api/v1/students/bulk-delete-all", authenticate, requireInitialPasswordChanged, requireRoles("SUPER_ADMIN", "ADMIN"), async (req, res) => {
  if (req.body?.confirmation !== "HAPUS SEMUA") {
    return failure(res, 400, "CONFIRMATION_REQUIRED", "Kirim konfirmasi HAPUS SEMUA untuk memindahkan seluruh data murid aktif ke daftar terhapus.");
  }
  const deletedAt = new Date();
  const result = await prisma.studentProfile.updateMany({
    where: { deletedAt: null },
    data: { deletedAt, recordVersion: { increment: 1 } },
  });
  await writeAudit(req, req.user!.id, "STUDENT_ALL_SOFT_DELETED", "StudentProfile", undefined, { affectedCount: result.count });
  success(res, { deletedCount: result.count });
});

async function permanentlyDeleteStudent(tx: Prisma.TransactionClient, studentId: string): Promise<boolean> {
  const profile = await tx.studentProfile.findUnique({ where: { id: studentId }, select: { id: true, userId: true, deletedAt: true } });
  if (!profile?.deletedAt) return false;
  const submissions = await tx.submission.findMany({ where: { studentId: profile.userId }, select: { id: true } });
  const submissionIds = submissions.map((submission) => submission.id);
  await tx.formAssignment.deleteMany({ where: { studentId: profile.id } });
  await tx.classMembership.deleteMany({ where: { studentId: profile.id } });
  await tx.gradeRevision.deleteMany({ where: { submissionId: { in: submissionIds } } });
  await tx.grade.deleteMany({ where: { submissionId: { in: submissionIds } } });
  await tx.submission.deleteMany({ where: { studentId: profile.userId } });
  await tx.syncMutation.deleteMany({ where: { studentId: profile.userId } });
  await tx.refreshToken.deleteMany({ where: { userId: profile.userId } });
  await tx.auditLog.updateMany({ where: { actorId: profile.userId }, data: { actorId: null } });
  await tx.studentProfile.delete({ where: { id: profile.id } });
  await tx.user.delete({ where: { id: profile.userId } });
  return true;
}

app.delete("/api/v1/students/:id/permanent", authenticate, requireInitialPasswordChanged, requireRoles("SUPER_ADMIN", "ADMIN"), requireUuidParam("id"), async (req, res) => {
  const deleted = await prisma.$transaction((tx) => permanentlyDeleteStudent(tx, String(req.params.id)));
  if (!deleted) return failure(res, 404, "NOT_FOUND", "Murid terhapus tidak ditemukan.");
  await writeAudit(req, req.user!.id, "STUDENT_PERMANENTLY_DELETED", "StudentProfile", String(req.params.id));
  success(res, { deleted: true });
});

app.post("/api/v1/students/bulk-permanent-delete", authenticate, requireInitialPasswordChanged, requireRoles("SUPER_ADMIN", "ADMIN"), async (req, res) => {
  const parsed = studentBulkSchema.safeParse(req.body);
  if (!parsed.success) return failure(res, 400, "VALIDATION_ERROR", "Daftar murid tidak valid.", parsed.error.flatten());
  const deletedCount = await prisma.$transaction(async (tx) => {
    let count = 0;
    for (const studentId of parsed.data.ids) {
      if (await permanentlyDeleteStudent(tx, studentId)) count += 1;
    }
    return count;
  });
  await writeAudit(req, req.user!.id, "STUDENT_BULK_PERMANENTLY_DELETED", "StudentProfile", undefined, { affectedCount: deletedCount });
  success(res, { deletedCount });
});

app.post("/api/v1/students/delete-all-deleted", authenticate, requireInitialPasswordChanged, requireRoles("SUPER_ADMIN", "ADMIN"), async (req, res) => {
  if (req.body?.confirmation !== "HAPUS PERMANEN") {
    return failure(res, 400, "CONFIRMATION_REQUIRED", "Kirim konfirmasi HAPUS PERMANEN untuk menghapus seluruh data murid terhapus.");
  }
  const deletedCount = await prisma.$transaction(async (tx) => {
    const deletedStudents = await tx.studentProfile.findMany({ where: { deletedAt: { not: null } }, select: { id: true } });
    let count = 0;
    for (const student of deletedStudents) {
      if (await permanentlyDeleteStudent(tx, student.id)) count += 1;
    }
    return count;
  });
  await writeAudit(req, req.user!.id, "STUDENT_ALL_PERMANENTLY_DELETED", "StudentProfile", undefined, { affectedCount: deletedCount });
  success(res, { deletedCount });
});

app.post(
  "/api/v1/students/import",
  authenticate,
  requireInitialPasswordChanged,
  requireRoles("SUPER_ADMIN", "ADMIN"),
  express.raw({ type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", limit: "10mb" }),
  async (req, res) => {
    if (!Buffer.isBuffer(req.body)) return failure(res, 400, "INVALID_FILE", "Unggah file Excel .xlsx yang valid.");

    const workbook = new ExcelJS.Workbook();
    try {
      const workbookBuffer = new ArrayBuffer(req.body.length);
      new Uint8Array(workbookBuffer).set(req.body);
      await workbook.xlsx.load(workbookBuffer);
    } catch {
      return failure(res, 400, "INVALID_FILE", "File Excel tidak dapat dibaca. Gunakan template .xlsx yang disediakan.");
    }

    const worksheet = workbook.worksheets[0];
    if (!worksheet || worksheet.rowCount < 2) {
      return failure(res, 400, "EMPTY_FILE", "File Excel harus memiliki judul kolom dan setidaknya satu baris data.");
    }

    const headerKeys = new Map<string, number>();
    let duplicateHeader = false;
    const headerAliases: Record<string, string> = {
      "nama lengkap": "nama",
      "nama murid": "nama",
      "nama pengguna murid": "nama pengguna",
      username: "nama pengguna",
      "tahun akademik": "tahun ajaran",
      "kata sandi": "nisn",
      "nisn / kata sandi": "nisn",
    };
    worksheet.getRow(1).eachCell((cell, column) => {
      const rawKey = cell.text.replace(/^\uFEFF/, "").trim().toLocaleLowerCase("id-ID").replace(/\s+/g, " ");
      const key = headerAliases[rawKey] ?? rawKey;
      if (key && headerKeys.has(key)) duplicateHeader = true;
      else if (key) headerKeys.set(key, column);
    });
    if (duplicateHeader) return failure(res, 400, "INVALID_HEADERS", "Judul kolom tidak boleh duplikat.");
    if (!headerKeys.has("nama")) {
      return failure(res, 400, "INVALID_HEADERS", "Kolom wajib 'Nama' tidak ditemukan. Gunakan template Excel aplikasi.");
    }

    const rows: Array<{ rowNumber: number; data: z.infer<typeof studentImportSchema> }> = [];
    const rowErrors: string[] = [];
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const cellText = (key: string) => {
        const column = headerKeys.get(key);
        return column ? row.getCell(column).text.trim() : "";
      };
      const rawStatus = cellText("status").toLocaleLowerCase("id-ID");
      const status = ({ aktif: "ACTIVE", "tidak aktif": "INACTIVE", ditangguhkan: "SUSPENDED" } as Record<string, string>)[rawStatus]
        ?? rawStatus.toUpperCase();
      const values: Record<string, string | undefined> = {
        name: cellText("nama"),
        studentLoginId: cellText("nama pengguna"),
        nisn: cellText("nisn").includes("*") ? "" : cellText("nisn"),
        className: cellText("kelas"),
        academicYear: cellText("tahun ajaran"),
        status: status || undefined,
      };
      const hasStudentData = Object.entries(values)
        .filter(([key]) => key !== "status")
        .some(([, value]) => Boolean(value));
      if (!hasStudentData) return;
      const parsed = studentImportSchema.safeParse(values);
      if (!parsed.success) {
        rowErrors.push(`Baris ${rowNumber}: ${parsed.error.issues.map((issue) => issue.message).join(", ")}`);
        return;
      }
      rows.push({ rowNumber, data: parsed.data });
    });

    if (rowErrors.length) return failure(res, 400, "INVALID_ROWS", "Periksa data pada baris yang ditandai.", rowErrors.slice(0, 20));
    if (!rows.length) return failure(res, 400, "EMPTY_FILE", "Tidak ada data murid untuk diimpor.");
    if (rows.length > 500) return failure(res, 400, "TOO_MANY_ROWS", "Impor dibatasi maksimal 500 baris per file.");

    const loginIds = rows.map(({ data }) => normalizeStudentLoginId(data.studentLoginId)).filter(Boolean);
    const nisnHashes = rows.map(({ data }) => data.nisn ? hashNisn(data.nisn) : "").filter(Boolean);
    if (new Set(loginIds).size !== loginIds.length || new Set(nisnHashes).size !== nisnHashes.length) {
      return failure(res, 400, "DUPLICATE_ROWS", "Nama pengguna atau NISN duplikat di dalam file.");
    }

    const classes = await prisma.schoolClass.findMany({ include: { academicYear: { select: { name: true } } } });
    const activeAcademicYear = await prisma.academicYear.findFirst({ where: { active: true }, orderBy: { name: "desc" } });
    const resolved: Array<{ rowNumber: number; data: z.infer<typeof studentImportSchema>; classId: string | null }> = [];
    for (const { rowNumber, data } of rows) {
      if (!data.className) {
        resolved.push({ rowNumber, data, classId: null });
        continue;
      }
      const matching = classes.filter((schoolClass) =>
        schoolClass.name.toLocaleLowerCase("id-ID") === data.className.toLocaleLowerCase("id-ID") &&
        (!data.academicYear || schoolClass.academicYear.name.toLocaleLowerCase("id-ID") === data.academicYear.toLocaleLowerCase("id-ID")),
      );
      if (matching.length === 1) {
        resolved.push({ rowNumber, data, classId: matching[0].id });
        continue;
      }
      if (matching.length > 1) {
        rowErrors.push(`Baris ${rowNumber}: kelas '${data.className}' tidak ditemukan atau tahun ajaran belum jelas.`);
        continue;
      }
      const academicYearName = data.academicYear || activeAcademicYear?.name;
      if (!academicYearName) {
        rowErrors.push(`Baris ${rowNumber}: kelas '${data.className}' belum memiliki tahun ajaran dan tidak ada tahun ajaran aktif.`);
        continue;
      }
      const academicYear = await prisma.academicYear.upsert({
        where: { name: academicYearName },
        update: {},
        create: { name: academicYearName, active: false },
      });
      const schoolClass = await prisma.schoolClass.upsert({
        where: { name_academicYearId: { name: data.className, academicYearId: academicYear.id } },
        update: {},
        create: { name: data.className, academicYearId: academicYear.id },
      });
      classes.push({ ...schoolClass, academicYear: { name: academicYear.name } });
      resolved.push({ rowNumber, data, classId: schoolClass.id });
    }
    if (rowErrors.length) return failure(res, 400, "INVALID_ROWS", "Periksa data pada baris yang ditandai.", rowErrors.slice(0, 20));

    const existing = loginIds.length
      ? await prisma.studentProfile.findMany({ where: { studentLoginId: { in: loginIds } }, select: { id: true, studentLoginId: true, nisnHash: true, deletedAt: true } })
      : [];
    const existingByLoginId = new Map(existing.map((profile) => [profile.studentLoginId, profile]));
    const profilesWithNisn = nisnHashes.length
      ? await prisma.studentProfile.findMany({ where: { nisnHash: { in: nisnHashes } }, select: { id: true, nisnHash: true } })
      : [];
    const profilesByNisn = new Map(profilesWithNisn.map((profile) => [profile.nisnHash, profile]));
    for (const { rowNumber, data } of resolved) {
      const loginId = normalizeStudentLoginId(data.studentLoginId);
      const current = loginId ? existingByLoginId.get(loginId) : undefined;
      if (!current && !data.nisn) rowErrors.push(`Baris ${rowNumber}: NISN wajib diisi untuk murid baru.`);
      const duplicate = data.nisn ? profilesByNisn.get(hashNisn(data.nisn)) : undefined;
      if (duplicate && duplicate.id !== current?.id) rowErrors.push(`Baris ${rowNumber}: NISN sudah digunakan oleh akun lain.`);
    }
    if (rowErrors.length) return failure(res, 400, "INVALID_ROWS", "Periksa data pada baris yang ditandai.", rowErrors.slice(0, 20));

    const prepared: Array<(typeof resolved)[number] & { loginId: string; nisnHash: string | null; passwordHash: string | null }> = [];
    for (const row of resolved) {
      prepared.push({
        ...row,
        loginId: normalizeStudentLoginId(row.data.studentLoginId),
        nisnHash: row.data.nisn ? hashNisn(row.data.nisn) : null,
        passwordHash: row.data.nisn ? await argon2.hash(row.data.nisn, { type: argon2.argon2id }) : null,
      });
    }
    const counts = await prisma.$transaction(async (tx) => {
      let createdCount = 0;
      let updatedCount = 0;
      for (const row of prepared) {
        const current = row.loginId ? existingByLoginId.get(row.loginId) : undefined;
        if (current) {
          await tx.user.update({
            where: { id: (await tx.studentProfile.findUniqueOrThrow({ where: { id: current.id }, select: { userId: true } })).userId },
            data: { name: row.data.name, status: row.data.status, ...(row.passwordHash ? { passwordHash: row.passwordHash } : {}) },
          });
          await tx.studentProfile.update({
            where: { id: current.id },
            data: {
              classId: row.classId,
              deletedAt: null,
              ...(row.nisnHash && row.data.nisn ? { nisnHash: row.nisnHash, nisnMasked: `******${row.data.nisn.slice(-4)}`, firstLogin: true } : {}),
              recordVersion: { increment: 1 },
            },
          });
          updatedCount += 1;
        } else {
          const user = await tx.user.create({
            data: { name: row.data.name, role: "STUDENT", status: row.data.status, passwordHash: row.passwordHash! },
          });
          const studentLoginId = normalizeStudentLoginId(`${row.data.name} ${row.data.className || "murid"} ${user.id.slice(0, 8)}`);
          await tx.studentProfile.create({
            data: {
              userId: user.id,
              studentLoginId,
              nisnHash: row.nisnHash!,
              nisnMasked: `******${row.data.nisn.slice(-4)}`,
              classId: row.classId,
            },
          });
          createdCount += 1;
        }
      }
      return { createdCount, updatedCount };
    }, { maxWait: 10000, timeout: 120000 });

    await writeAudit(req, req.user!.id, "STUDENT_XLSX_IMPORTED", "StudentProfile", undefined, counts);
    success(res, counts, 200);
  },
);

app.get("/api/v1/forms", authenticate, requireInitialPasswordChanged, async (req, res) => {
  let where: Prisma.FormWhereInput = { deletedAt: null };
  if (req.user!.role === "STUDENT") {
    const profile = await prisma.studentProfile.findUnique({
      where: { userId: req.user!.id },
      select: { id: true, classId: true, deletedAt: true },
    });
    if (!profile || profile.deletedAt) return success(res, []);
    where = {
      status: "PUBLISHED",
      deletedAt: null,
      assignments: {
        some: {
          OR: [
            { studentId: profile.id },
            ...(profile.classId ? [{ classId: profile.classId }] : []),
          ],
        },
      },
    };
  } else if (req.user!.role === "TEACHER") {
    where.authorId = req.user!.id;
  }
  const forms = await prisma.form.findMany({
    where,
    include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
    orderBy: { updatedAt: "desc" },
  });

  const data = forms.map(({ versions, ...form }) => ({
    ...form,
    currentVersion: versions[0]
      ? { id: versions[0].id, versionNumber: versions[0].versionNumber, schema: req.user!.role === "STUDENT" ? publicSchema(versions[0].schema) : versions[0].schema }
      : null,
  }));
  success(res, data);
});

app.get("/api/v1/forms/:id/report", authenticate, requireInitialPasswordChanged, requireRoles("SUPER_ADMIN", "ADMIN", "TEACHER"), requireUuidParam("id"), async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(10, Math.max(1, Number(req.query.pageSize) || 10));
  const formId = String(req.params.id);
  const form = await prisma.form.findFirst({
    where: { id: formId, deletedAt: null },
    select: { id: true, title: true, quizMode: true, authorId: true },
  });
  if (!form) return failure(res, 404, "NOT_FOUND", "Formulir tidak ditemukan.");
  if (req.user!.role === "TEACHER" && form.authorId !== req.user!.id) {
    return failure(res, 403, "FORBIDDEN", "Anda tidak memiliki akses.");
  }

  const assignments = await prisma.formAssignment.findMany({
    where: { formId },
    select: { classId: true, studentId: true },
  });
  const classIds = assignments.flatMap((assignment) => assignment.classId ? [assignment.classId] : []);
  const studentIds = assignments.flatMap((assignment) => assignment.studentId ? [assignment.studentId] : []);
  const assignedStudents = await prisma.studentProfile.findMany({
    where: {
      deletedAt: null,
      user: { status: "ACTIVE", deletedAt: null },
      OR: [
        ...(classIds.length ? [{ classId: { in: classIds } }] : []),
        ...(studentIds.length ? [{ id: { in: studentIds } }] : []),
      ],
    },
    select: {
      id: true,
      user: { select: { id: true, name: true } },
      schoolClass: { select: { name: true } },
      userId: true,
    },
    orderBy: { user: { name: "asc" } },
  });
  const submissions = await prisma.submission.findMany({
    where: { formVersion: { formId }, studentId: { in: assignedStudents.map((student) => student.userId) }, status: "SUBMITTED" },
    select: {
      id: true,
      studentId: true,
      answers: true,
      submittedAt: true,
      earnedScore: true,
      maximumScore: true,
      percentage: true,
      gradeStatus: true,
    },
    orderBy: { submittedAt: "desc" },
  });
  const latestSubmissionByStudent = new Map<string, typeof submissions[number]>();
  for (const submission of submissions) {
    if (!latestSubmissionByStudent.has(submission.studentId)) latestSubmissionByStudent.set(submission.studentId, submission);
  }
  const scoreTotalsByStudent = new Map<string, { total: number; count: number }>();
  for (const submission of submissions) {
    if (submission.percentage == null) continue;
    const current = scoreTotalsByStudent.get(submission.studentId) ?? { total: 0, count: 0 };
    current.total += submission.percentage;
    current.count += 1;
    scoreTotalsByStudent.set(submission.studentId, current);
  }
  const students = assignedStudents.map((student) => {
    const submission = latestSubmissionByStudent.get(student.userId);
    const scoreSummary = scoreTotalsByStudent.get(student.userId);
    return {
      studentId: student.userId,
      name: student.user.name,
      className: student.schoolClass?.name ?? "Tanpa kelas",
      status: submission ? "SUBMITTED" as const : "NOT_SUBMITTED" as const,
      submittedAt: submission?.submittedAt ?? null,
      ...(form.quizMode ? {
        earnedScore: submission?.earnedScore ?? null,
        maximumScore: submission?.maximumScore ?? null,
        percentage: submission?.percentage ?? null,
        averagePercentage: scoreSummary ? scoreSummary.total / scoreSummary.count : null,
        gradeStatus: submission?.gradeStatus ?? null,
      } : {}),
    };
  });
  const submittedCount = students.filter((student) => student.status === "SUBMITTED").length;
  const submittedStudents = students.filter((student) => student.status === "SUBMITTED");
  const pagedStudents = students.slice((page - 1) * pageSize, page * pageSize);
  const latestSubmissionIds = new Set(pagedStudents.map((student) => latestSubmissionByStudent.get(student.studentId)?.id).filter(Boolean));
  const responseRows = submissions
    .filter((submission) => latestSubmissionIds.has(submission.id))
    .map((submission) => {
      const student = assignedStudents.find((item) => item.userId === submission.studentId);
      return {
        id: submission.id,
        studentId: submission.studentId,
        name: student?.user.name ?? "Murid",
        className: student?.schoolClass?.name ?? "Tanpa kelas",
        submittedAt: submission.submittedAt,
        answers: submission.answers,
        earnedScore: submission.earnedScore,
        maximumScore: submission.maximumScore,
        percentage: submission.percentage,
        gradeStatus: submission.gradeStatus,
      };
    });
  success(res, {
    form: { id: form.id, title: form.title, quizMode: form.quizMode },
    summary: {
      assignedCount: students.length,
      submittedCount,
      notSubmittedCount: students.length - submittedCount,
      averagePercentage: form.quizMode
        ? (() => {
          const scores = submittedStudents.flatMap((student) => student.percentage == null ? [] : [student.percentage]);
          return scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : null;
        })()
        : null,
    },
    students: pagedStudents,
    responses: responseRows,
    pagination: { page, pageSize, total: students.length, totalPages: Math.max(1, Math.ceil(students.length / pageSize)) },
  });
});

app.post("/api/v1/forms", authenticate, requireInitialPasswordChanged, requireRoles("SUPER_ADMIN", "ADMIN", "TEACHER"), async (req, res) => {
  const parsed = createFormRequestSchema.safeParse(req.body);
  if (!parsed.success) return failure(res, 400, "VALIDATION_ERROR", "Formulir tidak valid.", parsed.error.flatten());
  const { questions, assignments, ...formData } = parsed.data;
  if (assignments) {
    const [classCount, studentCount] = await Promise.all([
      assignments.classIds.length
        ? prisma.schoolClass.count({ where: { id: { in: assignments.classIds } } })
        : Promise.resolve(0),
      assignments.studentIds.length
        ? prisma.studentProfile.count({ where: { id: { in: assignments.studentIds }, deletedAt: null } })
        : Promise.resolve(0),
    ]);
    if (classCount !== assignments.classIds.length || studentCount !== assignments.studentIds.length) {
      return failure(res, 400, "INVALID_ASSIGNMENT", "Satu atau lebih kelas atau murid tidak ditemukan.");
    }
  }
  const form = await prisma.$transaction(async (tx) => {
    const created = await tx.form.create({
      data: {
        ...formData,
        authorId: req.user!.id,
        versions: { create: { versionNumber: 1, schema: { questions } } },
      },
      include: { versions: true },
    });
    if (assignments) {
      await tx.formAssignment.createMany({
        data: [
          ...assignments.classIds.map((classId) => ({ formId: created.id, classId })),
          ...assignments.studentIds.map((studentId) => ({ formId: created.id, studentId })),
        ],
      });
    }
    return created;
  });
  await writeAudit(req, req.user!.id, "FORM_CREATED", "Form", form.id);
  success(res, { ...form, currentVersion: form.versions[0] }, 201);
});

app.post("/api/v1/forms/:id/assignments", authenticate, requireInitialPasswordChanged, requireRoles("SUPER_ADMIN", "ADMIN", "TEACHER"), requireUuidParam("id"), async (req, res) => {
  const parsed = formAssignmentSchema.safeParse(req.body);
  if (!parsed.success) return failure(res, 400, "VALIDATION_ERROR", "Penugasan formulir tidak valid.", parsed.error.flatten());
  const form = await prisma.form.findFirst({
    where: { id: String(req.params.id), deletedAt: null },
    select: { id: true, authorId: true },
  });
  if (!form) return failure(res, 404, "NOT_FOUND", "Formulir tidak ditemukan.");
  if (req.user!.role === "TEACHER" && form.authorId !== req.user!.id) {
    return failure(res, 403, "FORBIDDEN", "Anda tidak memiliki akses.");
  }
  const { classIds, studentIds } = parsed.data;
  const [classCount, studentCount] = await Promise.all([
    classIds.length ? prisma.schoolClass.count({ where: { id: { in: classIds } } }) : Promise.resolve(0),
    studentIds.length ? prisma.studentProfile.count({ where: { id: { in: studentIds }, deletedAt: null } }) : Promise.resolve(0),
  ]);
  if (classCount !== classIds.length || studentCount !== studentIds.length) {
    return failure(res, 400, "INVALID_ASSIGNMENT", "Satu atau lebih kelas atau murid tidak ditemukan.");
  }
  const result = await prisma.formAssignment.createMany({
    data: [
      ...classIds.map((classId) => ({ formId: form.id, classId })),
      ...studentIds.map((studentId) => ({ formId: form.id, studentId })),
    ],
    skipDuplicates: true,
  });
  await writeAudit(req, req.user!.id, "FORM_ASSIGNMENT_CREATED", "Form", form.id, { addedCount: result.count });
  success(res, { addedCount: result.count });
});

app.delete("/api/v1/forms/:id", authenticate, requireInitialPasswordChanged, requireRoles("SUPER_ADMIN", "ADMIN", "TEACHER"), requireUuidParam("id"), async (req, res) => {
  const formId = String(req.params.id);
  const form = await prisma.form.findFirst({
    where: { id: formId, deletedAt: null },
    select: { id: true, authorId: true },
  });
  if (!form) return failure(res, 404, "NOT_FOUND", "Formulir tidak ditemukan atau sudah dihapus.");
  if (req.user!.role === "TEACHER" && form.authorId !== req.user!.id) {
    return failure(res, 403, "FORBIDDEN", "Anda tidak memiliki akses.");
  }
  const deletedAt = new Date();
  const result = await prisma.form.updateMany({
    where: { id: form.id, deletedAt: null },
    data: { deletedAt },
  });
  if (!result.count) return failure(res, 404, "NOT_FOUND", "Formulir tidak ditemukan atau sudah dihapus.");
  await writeAudit(req, req.user!.id, "FORM_SOFT_DELETED", "Form", form.id);
  success(res, { deleted: true });
});

app.get("/api/v1/forms/:id", authenticate, requireInitialPasswordChanged, async (req, res) => {
  const form = await prisma.form.findFirst({
    where: { id: String(req.params.id), deletedAt: null },
    include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
  });
  if (!form) return failure(res, 404, "NOT_FOUND", "Formulir tidak ditemukan.");
  if (req.user!.role === "TEACHER" && form.authorId !== req.user!.id) return failure(res, 403, "FORBIDDEN", "Anda tidak memiliki akses.");
  if (req.user!.role === "STUDENT" && form.status !== "PUBLISHED") return failure(res, 404, "NOT_FOUND", "Formulir tidak ditemukan.");
  if (req.user!.role === "STUDENT" && !(await studentCanAccess(form.id, req.user!.id))) return failure(res, 403, "FORBIDDEN", "Formulir ini tidak ditugaskan kepada Anda.");
  const version = form.versions[0];
  success(res, {
    ...form,
    versions: undefined,
    currentVersion: version ? { ...version, schema: req.user!.role === "STUDENT" ? publicSchema(version.schema) : version.schema } : null,
  });
});

app.get("/api/v1/student/forms/:id/submission", authenticate, requireInitialPasswordChanged, requireRoles("STUDENT"), requireUuidParam("id"), async (req, res) => {
  const formId = String(req.params.id);
  const form = await prisma.form.findFirst({
    where: { id: formId, deletedAt: null, status: "PUBLISHED" },
    select: { id: true, quizMode: true },
  });
  if (!form) return failure(res, 404, "NOT_FOUND", "Formulir tidak ditemukan.");
  if (!(await studentCanAccess(form.id, req.user!.id))) return failure(res, 403, "FORBIDDEN", "Formulir ini tidak ditugaskan kepada Anda.");

  const submission = await prisma.submission.findFirst({
    where: { studentId: req.user!.id, status: "SUBMITTED", formVersion: { formId: form.id } },
    orderBy: { submittedAt: "desc" },
    select: { id: true, submittedAt: true, earnedScore: true, maximumScore: true, percentage: true, gradeStatus: true },
  });
  success(res, {
    submitted: Boolean(submission),
    ...(submission ? {
      id: submission.id,
      submittedAt: submission.submittedAt,
      ...(form.quizMode ? {
        earnedScore: submission.earnedScore,
        maximumScore: submission.maximumScore,
        percentage: submission.percentage,
        gradeStatus: submission.gradeStatus,
      } : {}),
    } : {}),
  });
});

app.patch("/api/v1/forms/:id", authenticate, requireInitialPasswordChanged, requireRoles("SUPER_ADMIN", "ADMIN", "TEACHER"), async (req, res) => {
  const parsed = createFormSchema.safeParse(req.body);
  if (!parsed.success) return failure(res, 400, "VALIDATION_ERROR", "Formulir tidak valid.", parsed.error.flatten());
  const existing = await prisma.form.findFirst({ where: { id: String(req.params.id), deletedAt: null }, include: { versions: true } });
  if (!existing) return failure(res, 404, "NOT_FOUND", "Formulir tidak ditemukan.");
  if (req.user!.role === "TEACHER" && existing.authorId !== req.user!.id) return failure(res, 403, "FORBIDDEN", "Anda tidak memiliki akses.");
  const { questions, ...formData } = parsed.data;
  const versionNumber = Math.max(0, ...existing.versions.map((item) => item.versionNumber)) + 1;
  const updated = await prisma.$transaction(async (tx) => {
    const form = await tx.form.update({ where: { id: existing.id }, data: { ...formData, status: "DRAFT" } });
    const version = await tx.formVersion.create({ data: { formId: form.id, versionNumber, schema: { questions } } });
    return { ...form, currentVersion: version };
  });
  await writeAudit(req, req.user!.id, "FORM_VERSION_CREATED", "Form", existing.id);
  success(res, updated);
});

app.post("/api/v1/forms/:id/publish", authenticate, requireInitialPasswordChanged, requireRoles("SUPER_ADMIN", "ADMIN", "TEACHER"), async (req, res) => {
  const form = await prisma.form.findFirst({
    where: { id: String(req.params.id), deletedAt: null },
    include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
  });
  if (!form) return failure(res, 404, "NOT_FOUND", "Formulir tidak ditemukan.");
  if (req.user!.role === "TEACHER" && form.authorId !== req.user!.id) return failure(res, 403, "FORBIDDEN", "Anda tidak memiliki akses.");
  if (!form.versions[0] || !form.title.trim()) return failure(res, 400, "PUBLISH_INVALID", "Formulir harus memiliki pertanyaan sebelum dipublikasikan.");
  const versionSchema = form.versions[0].schema as { questions?: Array<{
    type: string;
    scoreWeight?: number;
    answerKey?: unknown;
  }> };
  if (form.quizMode && versionSchema.questions?.some((question) =>
    question.type !== "PARAGRAPH" && question.type !== "MATRIX" &&
    (question.scoreWeight ?? 0) > 0 &&
    (question.answerKey === undefined || question.answerKey === "" || (Array.isArray(question.answerKey) && question.answerKey.length === 0)),
  )) {
    return failure(res, 400, "PUBLISH_INVALID", "Kunci jawaban perlu diisi untuk semua pertanyaan kuis yang dinilai otomatis.");
  }
  const assignmentCount = await prisma.formAssignment.count({ where: { formId: form.id } });
  if (!assignmentCount) return failure(res, 400, "PUBLISH_ASSIGNMENT_REQUIRED", "Tugaskan formulir ke setidaknya satu kelas atau murid sebelum dipublikasikan.");
  await prisma.$transaction([
    prisma.form.update({ where: { id: form.id }, data: { status: "PUBLISHED" } }),
    prisma.formVersion.update({ where: { id: form.versions[0].id }, data: { status: "PUBLISHED" } }),
  ]);
  await writeAudit(req, req.user!.id, "FORM_PUBLISHED", "Form", form.id);
  success(res, { published: true });
});

app.post("/api/v1/submissions/sync", authenticate, requireInitialPasswordChanged, requireRoles("STUDENT"), async (req, res) => {
  const parsed = submitSchema.safeParse(req.body);
  if (!parsed.success) return failure(res, 400, "VALIDATION_ERROR", "Jawaban tidak valid.", parsed.error.flatten());
  const input = parsed.data;
  const prior = await prisma.submission.findUnique({ where: { clientMutationId: input.clientMutationId } });
  if (prior) {
    if (prior.studentId !== req.user!.id) return failure(res, 409, "IDEMPOTENCY_KEY_REUSED", "Kunci pengiriman sudah digunakan oleh akun lain.");
    return success(res, {
      id: prior.id,
      status: prior.status,
      duplicate: true,
      earnedScore: prior.earnedScore,
      maximumScore: prior.maximumScore,
      percentage: prior.percentage,
      gradeStatus: prior.gradeStatus,
    });
  }

  const version = await prisma.formVersion.findFirst({
    where: { id: input.formVersionId, status: "PUBLISHED", form: { status: "PUBLISHED", deletedAt: null } },
    include: { form: true },
  });
  if (!version) return failure(res, 404, "FORM_NOT_AVAILABLE", "Formulir tidak tersedia.");
  if (!(await studentCanAccess(version.formId, req.user!.id))) return failure(res, 403, "FORBIDDEN", "Formulir ini tidak ditugaskan kepada Anda.");
  const submittedForm = await prisma.submission.findFirst({
    where: { studentId: req.user!.id, status: "SUBMITTED", formVersion: { formId: version.formId } },
    select: { id: true },
  });
  if (submittedForm) return failure(res, 409, "FORM_ALREADY_SUBMITTED", "Jawaban formulir ini sudah terkirim dan tidak dapat diubah.");
  const schema = version.schema as { questions?: FormQuestion[] };
  const questions = schema.questions ?? [];
  const knownQuestionIds = new Set(questions.map((question) => question.id));
  if (Object.keys(input.answers).some((questionId) => !knownQuestionIds.has(questionId))) {
    return failure(res, 400, "INVALID_ANSWER", "Jawaban memuat pertanyaan yang tidak dikenal.");
  }
  for (const question of questions) {
    const answer = input.answers[question.id];
    if (question.type === "MATRIX") {
      const answerValidation = validateMatrixAnswer(
        question.matrixColumns ?? [],
        answer,
        question.required,
      );
      if (answerValidation === "INVALID") {
        return failure(res, 400, "INVALID_ANSWER", "Format jawaban atau lampiran pada tabel tidak valid.");
      }
      if (answerValidation === "MISSING") {
        return failure(res, 400, "REQUIRED_ANSWER_MISSING", `Tambahkan setidaknya satu baris dan lengkapi semua kolom pada tabel "${question.title}".`);
      }
      continue;
    }
    if (question.required && (
      answer === undefined ||
      answer === null ||
      answer === "" ||
      (Array.isArray(answer) && answer.length === 0)
    )) {
      return failure(res, 400, "REQUIRED_ANSWER_MISSING", `Jawaban untuk "${question.title}" wajib diisi.`);
    }
    if (answer !== undefined && answer !== null) {
      if ((question.type === "SHORT_TEXT" || question.type === "PARAGRAPH") && typeof answer !== "string") {
        return failure(res, 400, "INVALID_ANSWER", "Format jawaban teks tidak valid.");
      }
      if (question.type === "NUMBER" && typeof answer !== "number") {
        return failure(res, 400, "INVALID_ANSWER", "Jawaban harus berupa angka.");
      }
    }
    if ((question.type === "SINGLE_CHOICE" || question.type === "DROPDOWN") && answer !== undefined && !question.options.includes(String(answer))) {
      return failure(res, 400, "INVALID_ANSWER", "Pilihan jawaban tidak valid.");
    }
    if (question.type === "MULTIPLE_CHOICE" && answer !== undefined && (!Array.isArray(answer) || answer.some((value) => !question.options.includes(String(value)))) ) {
      return failure(res, 400, "INVALID_ANSWER", "Pilihan jawaban tidak valid.");
    }
  }
  const grading = version.form.quizMode
    ? gradeAnswers(questions, input.answers)
    : { earnedScore: 0, maximumScore: 0, needsReview: true };
  try {
    const submission = await prisma.$transaction(async (tx) => {
      const created = await tx.submission.create({
        data: {
          formVersionId: version.id,
          studentId: req.user!.id,
          clientMutationId: input.clientMutationId,
          answers: input.answers as Prisma.InputJsonObject,
          status: "SUBMITTED",
          submittedAt: new Date(),
          earnedScore: grading.earnedScore,
          maximumScore: grading.maximumScore,
          percentage: grading.maximumScore > 0 ? grading.earnedScore / grading.maximumScore * 100 : null,
          gradeStatus: grading.needsReview ? "NEEDS_REVIEW" : "AUTO_GRADED",
        },
      });
      await tx.syncMutation.create({
        data: { clientMutationId: input.clientMutationId, studentId: req.user!.id, status: "SYNCED", result: { submissionId: created.id } },
      });
      await tx.auditLog.create({
        data: { actorId: req.user!.id, action: "SUBMISSION_SYNCED", resourceType: "Submission", resourceId: created.id },
      });
      return created;
    });
    return success(res, {
      id: submission.id,
      status: submission.status,
      syncStatus: "SYNCED",
      ...(version.form.quizMode ? {
        earnedScore: grading.earnedScore,
        maximumScore: grading.maximumScore,
        percentage: grading.maximumScore > 0 ? grading.earnedScore / grading.maximumScore * 100 : null,
        gradeStatus: grading.needsReview ? "NEEDS_REVIEW" : "AUTO_GRADED",
      } : {}),
    }, 201);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      const duplicate = await prisma.submission.findUnique({ where: { clientMutationId: input.clientMutationId } });
      if (duplicate) {
        if (duplicate.studentId !== req.user!.id) return failure(res, 409, "IDEMPOTENCY_KEY_REUSED", "Kunci pengiriman sudah digunakan oleh akun lain.");
        return success(res, {
          id: duplicate.id,
          status: duplicate.status,
          duplicate: true,
          earnedScore: duplicate.earnedScore,
          maximumScore: duplicate.maximumScore,
          percentage: duplicate.percentage,
          gradeStatus: duplicate.gradeStatus,
        });
      }
      const existingAttempt = await prisma.submission.findUnique({
        where: {
          formVersionId_studentId_attemptNumber: {
            formVersionId: input.formVersionId,
            studentId: req.user!.id,
            attemptNumber: 1,
          },
        },
        select: { id: true, status: true },
      });
      if (existingAttempt) return failure(res, 409, "SUBMISSION_EXISTS", "Jawaban untuk formulir ini sudah pernah dikirim.");
    }
    throw error;
  }
});

app.post("/api/v1/submissions/:id/grade", authenticate, requireInitialPasswordChanged, requireRoles("SUPER_ADMIN", "ADMIN", "TEACHER"), async (req, res) => {
  const earnedScore = Number(req.body?.earnedScore);
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
  if (!Number.isFinite(earnedScore) || earnedScore < 0 || earnedScore > 10000 || reason.length < 3) {
    return failure(res, 400, "VALIDATION_ERROR", "Nilai dan alasan perubahan harus valid.");
  }
  const submission = await prisma.submission.findUnique({
    where: { id: String(req.params.id) },
    include: { formVersion: { include: { form: true } } },
  });
  if (!submission) return failure(res, 404, "NOT_FOUND", "Jawaban tidak ditemukan.");
  if (req.user!.role === "TEACHER" && submission.formVersion.form.authorId !== req.user!.id) {
    return failure(res, 403, "FORBIDDEN", "Anda tidak memiliki akses.");
  }
  const maximumScore = submission.maximumScore ?? 0;
  if (earnedScore > maximumScore) return failure(res, 400, "INVALID_GRADE", "Nilai tidak boleh melebihi nilai maksimum.");
  await prisma.$transaction(async (tx) => {
    await tx.gradeRevision.create({
      data: {
        submissionId: submission.id,
        actorId: req.user!.id,
        previous: { earnedScore: submission.earnedScore, gradeStatus: submission.gradeStatus },
        next: { earnedScore, gradeStatus: "GRADED" },
        reason,
      },
    });
    await tx.grade.upsert({
      where: { submissionId: submission.id },
      create: { submissionId: submission.id, earnedScore, maximumScore, gradedById: req.user!.id },
      update: { earnedScore, maximumScore, gradedById: req.user!.id },
    });
    await tx.submission.update({
      where: { id: submission.id },
      data: { earnedScore, percentage: maximumScore ? earnedScore / maximumScore * 100 : null, gradeStatus: "GRADED" },
    });
  });
  await writeAudit(req, req.user!.id, "GRADE_OVERRIDDEN", "Submission", submission.id);
  success(res, { earnedScore, maximumScore });
});

app.get("/api/v1/student/grades", authenticate, requireInitialPasswordChanged, requireRoles("STUDENT"), async (req, res) => {
  const grades = await prisma.submission.findMany({
    where: { studentId: req.user!.id, status: "SUBMITTED", grade: { is: { releasedAt: { not: null } } } },
    include: { formVersion: { include: { form: { select: { title: true } } } }, grade: true },
    orderBy: { submittedAt: "desc" },
  });
  success(res, grades.map((item) => ({
    id: item.id,
    title: item.formVersion.form.title,
    earnedScore: item.grade?.earnedScore,
    maximumScore: item.grade?.maximumScore,
    feedback: item.grade?.feedback,
    releasedAt: item.grade?.releasedAt,
  })));
});

app.post("/api/v1/submissions/:id/release-grade", authenticate, requireInitialPasswordChanged, requireRoles("SUPER_ADMIN", "ADMIN", "TEACHER"), async (req, res) => {
  const submission = await prisma.submission.findUnique({
    where: { id: String(req.params.id) },
    include: { grade: true, formVersion: { include: { form: true } } },
  });
  if (!submission?.grade) return failure(res, 404, "NOT_FOUND", "Nilai belum tersedia.");
  if (req.user!.role === "TEACHER" && submission.formVersion.form.authorId !== req.user!.id) return failure(res, 403, "FORBIDDEN", "Anda tidak memiliki akses.");
  await prisma.grade.update({ where: { submissionId: submission.id }, data: { releasedAt: new Date() } });
  await writeAudit(req, req.user!.id, "GRADE_RELEASED", "Submission", submission.id);
  success(res, { released: true });
});

app.use((err: unknown, _req: Request, res: Response, _next: express.NextFunction) => {
  const isInitializationError =
    err instanceof Prisma.PrismaClientInitializationError ||
    (err instanceof Error && err.name === "PrismaClientInitializationError");
  const prismaErrorCode =
    err instanceof Prisma.PrismaClientKnownRequestError
      ? err.code
      : typeof err === "object" && err !== null && "errorCode" in err && typeof err.errorCode === "string"
        ? err.errorCode
        : undefined;
  if (isInitializationError || ["P1000", "P1001", "P1002", "P1010"].includes(prismaErrorCode ?? "")) {
    console.error("Koneksi database gagal:", prismaErrorCode ?? (err instanceof Error ? err.name : "DatabaseError"));
    failure(res, 503, "DATABASE_UNAVAILABLE", "Database tidak dapat diakses. Periksa layanan PostgreSQL dan konfigurasi koneksi lokal.");
    return;
  }
  console.error(
    "Permintaan API gagal:",
    err instanceof Error ? err.name : "UnknownError",
    prismaErrorCode ?? "",
  );
  const developmentMessage = process.env.NODE_ENV === "development" && err instanceof Error
    ? `Terjadi kesalahan pada server: ${err.message}`
    : "Terjadi kesalahan pada server.";
  failure(res, 500, "INTERNAL_ERROR", developmentMessage);
});

export { app };
