import { describe, expect, it } from "vitest";
import {
  createFormRequestSchema,
  formAssignmentSchema,
  gradeAnswers,
  normalizeStudentLoginId,
  studentBulkSchema,
  studentCreateSchema,
  studentUpdateSchema,
  submitSchema,
  validateMatrixAnswer,
} from "./index";

describe("shared validation helpers", () => {
  it("normalizes student login names consistently", () => {
    expect(normalizeStudentLoginId("  Siti   Aminah ")).toBe("siti aminah");
  });

  it("validates student records and bulk selection", () => {
    expect(studentCreateSchema.safeParse({ name: "Siti Aminah", nisn: "1234567890" }).success).toBe(true);
    expect(studentCreateSchema.safeParse({ name: "Siti Aminah", nisn: "1234" }).success).toBe(false);
    expect(studentUpdateSchema.safeParse({}).success).toBe(false);
    expect(studentBulkSchema.safeParse({ ids: [] }).success).toBe(false);
  });

  it("validates class or student form assignments without duplicates", () => {
    const classId = "e9c8d431-78f6-4df4-9e1e-948b72a2cabc";
    expect(formAssignmentSchema.safeParse({ classIds: [classId], studentIds: [] }).success).toBe(true);
    expect(formAssignmentSchema.safeParse({ classIds: [], studentIds: [] }).success).toBe(false);
    expect(formAssignmentSchema.safeParse({ classIds: [classId, classId], studentIds: [] }).success).toBe(false);
    expect(createFormRequestSchema.safeParse({
      title: "Kuis kelas",
      questions: [{
        id: classId,
        type: "SHORT_TEXT",
        title: "Jawab",
        required: true,
      }],
      assignments: { classIds: [classId], studentIds: [] },
    }).success).toBe(true);
  });

  it("validates quiz media links and locally uploaded images or videos", () => {
    const formQuestion = {
      id: "e9c8d431-78f6-4df4-9e1e-948b72a2cabc",
      type: "SHORT_TEXT",
      title: "Amati gambar",
      required: true,
    };
    expect(createFormRequestSchema.safeParse({
      title: "Kuis bergambar",
      quizMode: true,
      questions: [{ ...formQuestion, media: { kind: "IMAGE", url: "https://example.com/image.png" } }],
    }).success).toBe(true);
    expect(createFormRequestSchema.safeParse({
      title: "Kuis video",
      quizMode: true,
      questions: [{ ...formQuestion, media: { kind: "VIDEO", dataUrl: "data:video/mp4;base64,AAAA", mimeType: "video/mp4", sizeBytes: 4 } }],
    }).success).toBe(true);
    expect(createFormRequestSchema.safeParse({
      title: "Kuis tidak aman",
      quizMode: true,
      questions: [{ ...formQuestion, media: { kind: "IMAGE", url: "javascript:alert(1)" } }],
    }).success).toBe(false);
    expect(createFormRequestSchema.safeParse({
      title: "Kuis media tidak cocok",
      quizMode: true,
      questions: [{ ...formQuestion, media: { kind: "IMAGE", dataUrl: "data:video/mp4;base64,AAAA" } }],
    }).success).toBe(false);
  });

  it("validates table questions with legacy or configured column headers", () => {
    const tableQuestion = {
      id: "e9c8d431-78f6-4df4-9e1e-948b72a2cabc",
      type: "MATRIX" as const,
      title: "Pilih jawaban untuk setiap pernyataan",
      required: true,
      options: [],
      matrixRows: ["Pernyataan 1", "Pernyataan 2"],
      matrixColumns: ["Setuju", "Tidak setuju"],
    };
    expect(createFormRequestSchema.safeParse({
      title: "Formulir tabel",
      questions: [tableQuestion],
    }).success).toBe(true);
    expect(createFormRequestSchema.safeParse({
      title: "Formulir tabel",
      questions: [{ ...tableQuestion, matrixColumns: [] }],
    }).success).toBe(false);
    expect(createFormRequestSchema.safeParse({
      title: "Formulir tabel",
      questions: [{ ...tableQuestion, matrixColumns: ["Setuju", "setuju"] }],
    }).success).toBe(false);
    expect(createFormRequestSchema.safeParse({
      title: "Formulir tabel pilihan",
      questions: [{
        ...tableQuestion,
        matrixColumns: [
          { label: "Nama", type: "SHORT_TEXT" },
          { label: "Hobi", type: "MULTIPLE_CHOICE", options: ["Membaca", "Olahraga"] },
        ],
      }],
    }).success).toBe(true);
    expect(createFormRequestSchema.safeParse({
      title: "Formulir tabel pilihan",
      questions: [{
        ...tableQuestion,
        matrixColumns: [{ label: "Hobi", type: "DROPDOWN", options: ["Membaca"] }],
      }],
    }).success).toBe(false);
    const manyOptions = Array.from({ length: 75 }, (_, index) => `Opsi ${index + 1}`);
    expect(createFormRequestSchema.safeParse({
      title: "Formulir tabel tanpa batas opsi tetap",
      questions: [{
        ...tableQuestion,
        matrixColumns: [{ label: "Pilihan", type: "MULTIPLE_CHOICE", options: manyOptions }],
      }],
    }).success).toBe(true);
  });

  it("validates table short-answer cells against configured rows and columns", () => {
    expect(validateMatrixAnswer(["Indonesia", "Inggris"], ["Ani", "Ani", "5A", "5A"], true)).toBeNull();
    expect(validateMatrixAnswer(["Indonesia", "Inggris"], ["Ani", "", "5A", "5A"], true)).toBe("MISSING");
    expect(validateMatrixAnswer(["Indonesia", "Inggris"], ["Ani"], true)).toBe("INVALID");
    expect(validateMatrixAnswer(["Jawaban"], [" ".repeat(1001)], false)).toBe("INVALID");
    expect(validateMatrixAnswer(["Nama", "Kelas"], Array.from({ length: 102 }, () => "jawaban"), true)).toBe("INVALID");
    expect(validateMatrixAnswer(["Nama", "Kelas"], ["Ani", "Ani"], true)).toBeNull();
    expect(validateMatrixAnswer(["Nama", "Kelas"], [], true)).toBe("MISSING");
    const configuredColumns = [
      { label: "Nama", type: "SHORT_TEXT", options: [] },
      { label: "Hobi", type: "MULTIPLE_CHOICE", options: ["Membaca", "Olahraga"] },
      { label: "Kelas", type: "DROPDOWN", options: ["4A", "4B"] },
    ];
    const configuredRows = { rows: [{ cells: ["Ani", ["Membaca"], "4A"] }] };
    expect(validateMatrixAnswer(configuredColumns, configuredRows, true)).toBeNull();
    expect(validateMatrixAnswer(configuredColumns, { rows: [{ cells: ["Ani", ["Makan"], "4A"] }] }, true)).toBe("INVALID");
    expect(validateMatrixAnswer(configuredColumns, { rows: [{ cells: ["Ani", [], "4A"] }] }, true)).toBe("MISSING");
    const attachmentRows = {
      rows: [{
        cells: ["Ani", ["Membaca"], "4A"],
        attachment: { name: "bukti.png", mimeType: "image/png", dataUrl: "data:image/png;base64,iVBORw0KGgo=" },
      }],
    };
    expect(validateMatrixAnswer(configuredColumns, attachmentRows, true)).toBeNull();
    expect(validateMatrixAnswer(configuredColumns, {
      rows: [{
        cells: ["Ani", ["Membaca"], "4A"],
        attachment: { name: "bukti.png", mimeType: "image/png", dataUrl: "data:image/png;base64,SGVsbG8=" },
      }],
    }, true)).toBe("INVALID");
    const manyChoiceOptions = Array.from({ length: 75 }, (_, index) => `Opsi ${index + 1}`);
    const manyChoiceColumn = [{ label: "Pilihan", type: "MULTIPLE_CHOICE", options: manyChoiceOptions }];
    const manySelected = manyChoiceOptions.slice(0, 60);
    expect(validateMatrixAnswer(manyChoiceColumn, { rows: [{ cells: [manySelected] }] }, true)).toBeNull();

    const matrixAnswers = Array.from({ length: 2500 }, () => "jawaban");
    expect(submitSchema.safeParse({
      formVersionId: "e9c8d431-78f6-4df4-9e1e-948b72a2cabc",
      answers: { "e9c8d431-78f6-4df4-9e1e-948b72a2cabc": matrixAnswers },
      clientMutationId: "e9c8d431-78f6-4df4-9e1e-948b72a2cabc",
    }).success).toBe(true);
    expect(submitSchema.safeParse({
      formVersionId: "e9c8d431-78f6-4df4-9e1e-948b72a2cabc",
      answers: { "e9c8d431-78f6-4df4-9e1e-948b72a2cabc": attachmentRows },
      clientMutationId: "e9c8d431-78f6-4df4-9e1e-948b72a2cabc",
    }).success).toBe(true);
    expect(submitSchema.safeParse({
      formVersionId: "e9c8d431-78f6-4df4-9e1e-948b72a2cabc",
      answers: { "e9c8d431-78f6-4df4-9e1e-948b72a2cabc": { rows: [{ cells: [manySelected] }] } },
      clientMutationId: "e9c8d431-78f6-4df4-9e1e-948b72a2cabc",
    }).success).toBe(true);
  });

  it("grades exact and case-insensitive answers without exposing a zero-weight key", () => {
    const result = gradeAnswers(
      [
        {
          id: "e9c8d431-78f6-4df4-9e1e-948b72a2cabc",
          type: "SHORT_TEXT",
          title: "Ibu kota",
          required: true,
          options: [],
          answerKey: "Jakarta",
          scoreWeight: 2,
        },
      ],
      { "e9c8d431-78f6-4df4-9e1e-948b72a2cabc": " jakarta " },
    );
    expect(result).toEqual({ earnedScore: 2, maximumScore: 2, needsReview: false });
  });

  it("marks a weighted question without an answer key for manual review", () => {
    const result = gradeAnswers(
      [{
        id: "e9c8d431-78f6-4df4-9e1e-948b72a2cabc",
        type: "PARAGRAPH",
        title: "Jelaskan",
        required: true,
        options: [],
        scoreWeight: 5,
      }],
      {},
    );
    expect(result).toEqual({ earnedScore: 0, maximumScore: 5, needsReview: true });
  });
});
