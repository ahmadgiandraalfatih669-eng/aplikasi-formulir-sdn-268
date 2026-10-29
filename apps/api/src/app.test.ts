import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { Prisma } from "@prisma/client";

const dbMocks = vi.hoisted(() => ({
  userFindFirst: vi.fn(),
  submissionFindUnique: vi.fn(),
  queryRaw: vi.fn().mockResolvedValue([]),
}));

vi.mock("./db.js", () => ({
  prisma: {
    $queryRaw: dbMocks.queryRaw,
    user: { findFirst: dbMocks.userFindFirst },
    submission: { findUnique: dbMocks.submissionFindUnique },
  },
}));

import { app } from "./app.js";

describe("health endpoint", () => {
  it("returns the documented success envelope", async () => {
    const response = await request(app).get("/api/v1/health");
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      data: { status: "ok", database: "ok" },
      error: null,
      meta: {},
    });
  });

  it("reports database connection failures as service unavailable", async () => {
    dbMocks.queryRaw.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("database authentication failed", {
        code: "P1000",
        clientVersion: "6.19.3",
      }),
    );

    const response = await request(app).get("/api/v1/health");

    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe("DATABASE_UNAVAILABLE");
    expect(response.body.error.message).not.toContain("authentication failed");
  });

  describe("student administration authorization", () => {
    it("requires authentication before listing students", async () => {
      const response = await request(app).get("/api/v1/students");
      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe("UNAUTHORIZED");
    });

    it("requires authentication before deleting a form", async () => {
      const response = await request(app).delete("/api/v1/forms/10000000-0000-4000-8000-000000000001");
      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe("UNAUTHORIZED");
    });

    it("requires authentication before reading a form completion report", async () => {
      const response = await request(app).get("/api/v1/forms/10000000-0000-4000-8000-000000000001/report");
      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe("UNAUTHORIZED");
    });

    it("does not reveal another student's submission when an idempotency key is reused", async () => {
      const secret = "audit-test-access-secret-at-least-32";
      process.env.JWT_ACCESS_SECRET = secret;
      const studentId = "10000000-0000-4000-8000-000000000001";
      dbMocks.userFindFirst.mockResolvedValue({
        id: studentId,
        role: "STUDENT",
        name: "Murid Uji",
        studentProfile: { firstLogin: false, deletedAt: null },
      });
      dbMocks.submissionFindUnique.mockResolvedValue({
        id: "20000000-0000-4000-8000-000000000001",
        studentId: "10000000-0000-4000-8000-000000000002",
        status: "SUBMITTED",
      });
      const token = jwt.sign(
        { id: studentId, role: "STUDENT", name: "Murid Uji", firstLogin: false },
        secret,
        { issuer: "sdn268-api", expiresIn: "15m" },
      );

      const response = await request(app)
        .post("/api/v1/submissions/sync")
        .set("Authorization", `Bearer ${token}`)
        .send({
          formVersionId: "30000000-0000-4000-8000-000000000001",
          answers: {},
          clientMutationId: "40000000-0000-4000-8000-000000000001",
        });

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe("IDEMPOTENCY_KEY_REUSED");
    });

    it("requires authentication before creating a student", async () => {
      const response = await request(app)
        .post("/api/v1/students")
        .send({ name: "Murid Contoh", nisn: "1234567890" });
      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe("UNAUTHORIZED");
    });

    it("requires authentication before importing an Excel workbook", async () => {
      const response = await request(app)
        .post("/api/v1/students/import")
        .set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        .send(Buffer.from("not-an-xlsx-file"));
      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe("UNAUTHORIZED");
    });

    it("requires authentication before deleting all students", async () => {
      const response = await request(app)
        .post("/api/v1/students/bulk-delete-all")
        .send({ confirmation: "HAPUS SEMUA" });
      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe("UNAUTHORIZED");
    });
  });

  it("rejects cross-origin requests outside the configured origin", async () => {
    const response = await request(app).get("/api/v1/health").set("Origin", "https://not-school.example");
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("ORIGIN_REJECTED");
  });

  it("reports incomplete Google OAuth configuration instead of starting a broken flow", async () => {
    const previous = {
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackUrl: process.env.GOOGLE_CALLBACK_URL,
    };
    process.env.GOOGLE_CLIENT_ID = "configured-client";
    process.env.GOOGLE_CALLBACK_URL = "http://localhost:4000/api/v1/auth/google/callback";
    delete process.env.GOOGLE_CLIENT_SECRET;

    try {
      const response = await request(app).get("/api/v1/auth/google");
      expect(response.status).toBe(503);
      expect(response.body.error.code).toBe("OAUTH_NOT_CONFIGURED");
    } finally {
      if (previous.clientId === undefined) delete process.env.GOOGLE_CLIENT_ID;
      else process.env.GOOGLE_CLIENT_ID = previous.clientId;
      if (previous.clientSecret === undefined) delete process.env.GOOGLE_CLIENT_SECRET;
      else process.env.GOOGLE_CLIENT_SECRET = previous.clientSecret;
      if (previous.callbackUrl === undefined) delete process.env.GOOGLE_CALLBACK_URL;
      else process.env.GOOGLE_CALLBACK_URL = previous.callbackUrl;
    }
  });

  it("keeps local admin password login disabled outside development", async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "test";
    try {
      const response = await request(app)
        .post("/api/v1/auth/local-admin/login")
        .send({ email: "admin@example.test", password: "example-password" });
      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe("NOT_FOUND");
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }
  });
});
