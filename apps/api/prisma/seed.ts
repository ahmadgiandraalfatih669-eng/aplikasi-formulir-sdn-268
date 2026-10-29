import { createHmac } from "node:crypto";
import dotenv from "dotenv";
import { resolve } from "node:path";
import argon2 from "argon2";
import { PrismaClient } from "@prisma/client";

dotenv.config({ path: resolve(process.cwd(), ".env") });
dotenv.config({ path: resolve(process.cwd(), "../../.env") });

const prisma = new PrismaClient();
const nisnSecret = process.env.NISN_HASH_SECRET;
if (!nisnSecret || nisnSecret.length < 32) {
  throw new Error("NISN_HASH_SECRET harus diisi dan minimal 32 karakter untuk seed.");
}

function hashNisn(value: string): string {
  return createHmac("sha256", nisnSecret!).update(value).digest("hex");
}

async function main() {
  const year = await prisma.academicYear.upsert({
    where: { name: "2026/2027" },
    update: { active: true },
    create: { name: "2026/2027", active: true },
  });
  for (const name of ["4A", "5A", "6A"]) {
    await prisma.schoolClass.upsert({
      where: { name_academicYearId: { name, academicYearId: year.id } },
      update: {},
      create: { name, academicYearId: year.id },
    });
  }

  const admin = await prisma.user.upsert({
    where: { email: "admin@contoh.sch.id" },
    update: { name: "Admin Sekolah", role: "SUPER_ADMIN", status: "ACTIVE" },
    create: { email: "admin@contoh.sch.id", name: "Admin Sekolah", role: "SUPER_ADMIN" },
  });
  const teacher = await prisma.user.upsert({
    where: { email: "guru1@contoh.sch.id" },
    update: { name: "Guru Contoh", role: "TEACHER", status: "ACTIVE" },
    create: { email: "guru1@contoh.sch.id", name: "Guru Contoh", role: "TEACHER" },
  });
  await prisma.allowedGoogleAccount.upsert({
    where: { email: "admin@contoh.sch.id" },
    update: { role: "SUPER_ADMIN" },
    create: { email: "admin@contoh.sch.id", role: "SUPER_ADMIN" },
  });
  await prisma.allowedGoogleAccount.upsert({
    where: { email: "guru1@contoh.sch.id" },
    update: { role: "TEACHER" },
    create: { email: "guru1@contoh.sch.id", role: "TEACHER" },
  });
  await prisma.teacherProfile.upsert({
    where: { userId: teacher.id },
    update: {},
    create: { userId: teacher.id },
  });

  const names = [
    ["Aditya Pratama", "4A"], ["Alya Safitri", "4A"], ["Bima Nugraha", "4A"], ["Citra Lestari", "4A"],
    ["Daffa Ramadhan", "5A"], ["Dewi Anggraini", "5A"], ["Fajar Hidayat", "5A"], ["Intan Permata", "5A"],
    ["Kevin Maulana", "6A"], ["Laila Nursyam", "6A"], ["Rizky Firmansyah", "6A"], ["Salsa Maharani", "6A"],
  ] as const;
  for (const [index, [name, className]] of names.entries()) {
    const username = `${name.toLocaleLowerCase("id-ID").replace(/\s+/g, " ")} ${className.toLowerCase()}`;
    const nisn = `9000000${String(index + 1).padStart(3, "0")}`;
    const schoolClass = await prisma.schoolClass.findUniqueOrThrow({
      where: { name_academicYearId: { name: className, academicYearId: year.id } },
    });
    const user = await prisma.user.upsert({
      where: { email: `${username.replace(/\s/g, ".")}@murid.local` },
      update: { name, role: "STUDENT", status: "ACTIVE" },
      create: {
        email: `${username.replace(/\s/g, ".")}@murid.local`,
        name,
        role: "STUDENT",
        passwordHash: await argon2.hash(nisn, { type: argon2.argon2id }),
      },
    });
    await prisma.studentProfile.upsert({
      where: { userId: user.id },
      update: { studentLoginId: username, nisnHash: hashNisn(nisn), nisnMasked: `******${nisn.slice(-4)}`, classId: schoolClass.id },
      create: {
        userId: user.id,
        studentLoginId: username,
        nisnHash: hashNisn(nisn),
        nisnMasked: `******${nisn.slice(-4)}`,
        classId: schoolClass.id,
      },
    });
  }

  const quiz = await prisma.form.upsert({
    where: { id: "10000000-0000-4000-8000-000000000001" },
    update: {},
    create: {
      id: "10000000-0000-4000-8000-000000000001",
      authorId: teacher.id,
      title: "Kuis Matematika Dasar",
      description: "Latihan operasi hitung sederhana.",
      quizMode: true,
      passingGrade: 70,
      status: "PUBLISHED",
    },
  });
  await prisma.formVersion.upsert({
    where: { formId_versionNumber: { formId: quiz.id, versionNumber: 1 } },
    update: {},
    create: {
      formId: quiz.id,
      versionNumber: 1,
      status: "PUBLISHED",
      schema: { questions: [
        { id: "20000000-0000-4000-8000-000000000001", type: "NUMBER", title: "Berapakah 7 × 8?", required: true, options: [], scoreWeight: 1, answerKey: 56 },
        { id: "20000000-0000-4000-8000-000000000002", type: "SINGLE_CHOICE", title: "Hasil 25 + 17 adalah…", required: true, options: ["32", "42", "52"], scoreWeight: 1, answerKey: "42" },
      ] },
    },
  });
  const reflection = await prisma.form.upsert({
    where: { id: "10000000-0000-4000-8000-000000000002" },
    update: {},
    create: {
      id: "10000000-0000-4000-8000-000000000002",
      authorId: teacher.id,
      title: "Refleksi Pembelajaran",
      description: "Ceritakan hal baru yang kamu pelajari hari ini.",
      status: "PUBLISHED",
    },
  });
  await prisma.formVersion.upsert({
    where: { formId_versionNumber: { formId: reflection.id, versionNumber: 1 } },
    update: {},
    create: {
      formId: reflection.id,
      versionNumber: 1,
      status: "PUBLISHED",
      schema: { questions: [
        { id: "20000000-0000-4000-8000-000000000003", type: "PARAGRAPH", title: "Apa yang paling kamu sukai dari pelajaran hari ini?", required: true, options: [] },
      ] },
    },
  });
  await prisma.formAssignment.upsert({
    where: { id: "30000000-0000-4000-8000-000000000001" },
    update: {},
    create: { id: "30000000-0000-4000-8000-000000000001", formId: quiz.id, classId: (await prisma.schoolClass.findUniqueOrThrow({ where: { name_academicYearId: { name: "4A", academicYearId: year.id } } })).id },
  });

  await prisma.auditLog.create({
    data: { actorId: admin.id, action: "DEVELOPMENT_SEED_APPLIED", resourceType: "App" },
  });
  console.log("Seed selesai: akun admin/guru, kelas, 12 murid sintetis, dan 2 formulir contoh.");
}

main().finally(async () => {
  await prisma.$disconnect();
});
