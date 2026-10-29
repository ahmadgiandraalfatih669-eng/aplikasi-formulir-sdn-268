import { createHash } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import type { AppRole } from "@sdn268/shared";
import { prisma } from "./db.js";

export interface AuthUser {
  id: string;
  role: AppRole;
  name: string;
  firstLogin: boolean;
}

declare global {
  namespace Express {
    interface User {
      id: string;
      role: AppRole;
      name: string;
      firstLogin: boolean;
    }
  }
}

function accessSecret(): string {
  const secret = process.env.JWT_ACCESS_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("JWT_ACCESS_SECRET harus diisi dan minimal 32 karakter.");
  }
  return secret;
}

export function createAccessToken(user: AuthUser): string {
  return jwt.sign(user, accessSecret(), { expiresIn: "15m", issuer: "sdn268-api" });
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function authenticate(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const header = req.header("authorization");
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ success: false, data: null, error: { code: "UNAUTHORIZED", message: "Silakan masuk kembali." }, meta: {} });
    return;
  }
  try {
    const payload = jwt.verify(header.slice(7), accessSecret(), { issuer: "sdn268-api" }) as AuthUser;
    const user = await prisma.user.findFirst({
      where: { id: payload.id, status: "ACTIVE", deletedAt: null },
      select: { id: true, role: true, name: true, studentProfile: { select: { firstLogin: true, deletedAt: true } } },
    });
    if (!user || (user.role === "STUDENT" && (!user.studentProfile || user.studentProfile.deletedAt))) {
      res.status(401).json({ success: false, data: null, error: { code: "UNAUTHORIZED", message: "Akun tidak aktif." }, meta: {} });
      return;
    }
    req.user = {
      id: user.id,
      role: user.role,
      name: user.name,
      firstLogin: user.studentProfile?.firstLogin ?? false,
    };
    next();
  } catch {
    res.status(401).json({ success: false, data: null, error: { code: "UNAUTHORIZED", message: "Sesi tidak berlaku." }, meta: {} });
  }
}

export function requireRoles(...roles: AppRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message: "Anda tidak memiliki akses." }, meta: {} });
      return;
    }
    next();
  };
}

export function requireInitialPasswordChanged(req: Request, res: Response, next: NextFunction): void {
  if (req.user?.role === "STUDENT" && req.user.firstLogin) {
    res.status(403).json({
      success: false,
      data: null,
      error: { code: "INITIAL_PASSWORD_CHANGE_REQUIRED", message: "Ganti kata sandi awal sebelum melanjutkan." },
      meta: {},
    });
    return;
  }
  next();
}
