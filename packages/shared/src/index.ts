import { z } from "zod";

export const roleSchema = z.enum(["SUPER_ADMIN", "ADMIN", "TEACHER", "STUDENT"]);
export const questionTypeSchema = z.enum([
  "SHORT_TEXT",
  "PARAGRAPH",
  "NUMBER",
  "SINGLE_CHOICE",
  "MULTIPLE_CHOICE",
  "DROPDOWN",
  "MATRIX",
]);

export const matrixColumnTypeSchema = z.enum([
  "SHORT_TEXT",
  "PARAGRAPH",
  "SINGLE_CHOICE",
  "MULTIPLE_CHOICE",
  "DROPDOWN",
]);

export const matrixColumnSchema = z.union([
  z.string().trim().min(1).max(200),
  z.object({
    label: z.string().trim().min(1).max(200),
    type: matrixColumnTypeSchema.default("SHORT_TEXT"),
    options: z.array(z.string().trim().min(1).max(200)).default([]),
  }),
]);

export const questionMediaSchema = z.object({
  kind: z.enum(["IMAGE", "VIDEO"]),
  url: z.string().url().max(2048).optional(),
  dataUrl: z.string().max(10_000_000).optional(),
  name: z.string().trim().min(1).max(255).optional(),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp", "video/mp4", "video/webm"]).optional(),
  sizeBytes: z.number().int().positive().max(7 * 1024 * 1024).optional(),
}).refine((media) => Boolean(media.url || media.dataUrl), "Media harus berupa tautan atau berkas lokal.")
  .refine((media) => {
    if (!media.url) return true;
    try {
      return ["http:", "https:"].includes(new URL(media.url).protocol);
    } catch {
      return false;
    }
  }, "Tautan media harus menggunakan HTTP atau HTTPS.")
  .refine((media) => !media.dataUrl || /^data:(image\/(jpeg|png|webp)|video\/(mp4|webm));base64,[A-Za-z0-9+/]+={0,2}$/.test(media.dataUrl), "Format media lokal tidak valid.")
  .refine((media) => !media.dataUrl || (media.kind === "IMAGE" ? media.dataUrl.startsWith("data:image/") : media.dataUrl.startsWith("data:video/")), "Jenis media tidak sesuai dengan berkas.")
  .refine((media) => !media.mimeType || (media.kind === "IMAGE" ? media.mimeType.startsWith("image/") : media.mimeType.startsWith("video/")), "Jenis media tidak sesuai dengan format berkas.")
  .refine((media) => !media.sizeBytes || Boolean(media.dataUrl), "Ukuran berkas hanya berlaku untuk media yang diunggah.");

export const questionSchema = z.object({
  id: z.string().uuid(),
  type: questionTypeSchema,
  title: z.string().trim().min(1).max(500),
  required: z.boolean().default(true),
  options: z.array(z.string().trim().min(1).max(200)).max(50).default([]),
  matrixRows: z.array(z.string().trim().min(1).max(200)).max(50).optional(),
  matrixColumns: z.array(matrixColumnSchema).max(50).optional(),
  scoreWeight: z.number().min(0).max(1000).optional(),
  answerKey: z.union([z.string(), z.array(z.string()), z.number()]).optional(),
  media: questionMediaSchema.optional(),
}).superRefine((question, context) => {
  if (question.type !== "MATRIX") return;
  if (!question.matrixColumns?.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["matrixColumns"], message: "Tabel harus memiliki setidaknya satu kolom." });
  }
  const columnLabels = question.matrixColumns?.map((column) => typeof column === "string" ? column : column.label);
  if (columnLabels && new Set(columnLabels.map((column) => column.toLocaleLowerCase())).size !== columnLabels.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["matrixColumns"], message: "Header kolom tabel tidak boleh duplikat." });
  }
  question.matrixColumns?.forEach((column, index) => {
    if (typeof column !== "string" &&
      ["SINGLE_CHOICE", "MULTIPLE_CHOICE", "DROPDOWN"].includes(column.type) &&
      column.options.length < 2) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["matrixColumns", index, "options"],
        message: "Kolom pilihan harus memiliki setidaknya dua opsi.",
      });
    }
  });
});

export const createFormSchema = z.object({
  title: z.string().trim().min(3).max(160),
  description: z.string().max(2000).default(""),
  quizMode: z.boolean().default(false),
  passingGrade: z.number().min(0).max(100).optional(),
  questions: z.array(questionSchema).min(1).max(100),
});

export const formAssignmentSchema = z.object({
  classIds: z.array(z.string().uuid()).max(100).default([]),
  studentIds: z.array(z.string().uuid()).max(500).default([]),
}).refine(
  (assignment) => assignment.classIds.length > 0 || assignment.studentIds.length > 0,
  "Pilih setidaknya satu kelas atau murid.",
).refine(
  (assignment) =>
    new Set(assignment.classIds).size === assignment.classIds.length &&
    new Set(assignment.studentIds).size === assignment.studentIds.length,
  "Daftar penugasan tidak boleh berisi duplikat.",
);

export const createFormRequestSchema = createFormSchema.extend({
  assignments: formAssignmentSchema.optional(),
});

export const studentLoginSchema = z.object({
  username: z.string().trim().min(1).max(120),
  password: z.string().min(1).max(128),
});

export const studentCreateSchema = z.object({
  name: z.string().trim().min(2).max(160),
  nisn: z.string().regex(/^\d{10}$/, "NISN harus terdiri dari 10 angka."),
  classId: z.string().uuid().nullable().optional(),
  status: z.enum(["ACTIVE", "INACTIVE", "SUSPENDED"]).default("ACTIVE"),
});

export const studentUpdateSchema = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  classId: z.string().uuid().nullable().optional(),
  status: z.enum(["ACTIVE", "INACTIVE", "SUSPENDED"]).optional(),
  recordVersion: z.number().int().positive().optional(),
}).refine(
  (value) => value.name !== undefined || value.classId !== undefined || value.status !== undefined,
  "Pilih setidaknya satu data untuk diubah.",
);

export const studentBulkSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(100).refine((ids) => new Set(ids).size === ids.length),
});

const matrixAttachmentSchema = z.object({
  name: z.string().trim().min(1).max(255),
  mimeType: z.enum(["image/jpeg", "image/png", "application/pdf"]),
  dataUrl: z.string().max(6 * 1024 * 1024).regex(/^data:(image\/jpeg|image\/png|application\/pdf);base64,/),
});

const matrixCellSchema = z.union([
  z.string().max(10000),
  z.array(z.string().max(1000)),
  z.null(),
]);

const matrixResponseRowSchema = z.object({
  cells: z.array(matrixCellSchema).max(50),
  attachment: matrixAttachmentSchema.nullable().optional(),
});

export const submitSchema = z.object({
  formVersionId: z.string().uuid(),
  answers: z.record(
    z.string().uuid(),
    z.union([
      z.string().max(10000),
      z.number().finite(),
      z.boolean(),
      z.array(z.string().max(1000)).max(2500),
      z.object({ rows: z.array(matrixResponseRowSchema).max(50) }),
      z.null(),
    ]),
  ),
  clientMutationId: z.string().uuid(),
});

export type AppRole = z.infer<typeof roleSchema>;
export type QuestionType = z.infer<typeof questionTypeSchema>;
export type FormQuestion = z.infer<typeof questionSchema>;
export type CreateFormInput = z.infer<typeof createFormSchema>;
export type SubmitInput = z.infer<typeof submitSchema>;

export function validateMatrixAnswer(
  columns: Array<string | { label: string; type: string; options: string[] }>,
  answer: unknown,
  required: boolean,
): "INVALID" | "MISSING" | null {
  if (answer === undefined || answer === null) return required ? "MISSING" : null;
  if (columns.length === 0) return "INVALID";
  if (Array.isArray(answer)) {
    if (answer.length > 50 * columns.length ||
      (answer.length > 0 && answer.length % columns.length !== 0) ||
      answer.some((value) => typeof value !== "string" || value.length > 1000)) {
      return "INVALID";
    }
    if (required && (answer.length === 0 || answer.some((value) => !value.trim()))) return "MISSING";
    return null;
  }
  if (typeof answer !== "object" || !("rows" in answer) || !Array.isArray(answer.rows) || answer.rows.length > 50) {
    return "INVALID";
  }
  const rows = answer.rows as Array<{ cells?: unknown[]; attachment?: { dataUrl?: string } | null }>;
  let attachmentSize = 0;
  for (const row of rows) {
    if (!Array.isArray(row.cells) || row.cells.length !== columns.length) return "INVALID";
    for (const [index, rawColumn] of columns.entries()) {
      const column: { type: string; options: string[] } = typeof rawColumn === "string"
        ? { type: "SHORT_TEXT", options: [] }
        : rawColumn;
      const cell = row.cells[index];
      if (column.type === "MULTIPLE_CHOICE") {
        if (!Array.isArray(cell) || cell.some((value) => typeof value !== "string" || !column.options.includes(value))) return "INVALID";
      } else {
        if (typeof cell !== "string" || cell.length > 10000) return "INVALID";
        if (["SINGLE_CHOICE", "DROPDOWN"].includes(column.type) && cell !== "" && !column.options.includes(cell)) return "INVALID";
      }
    }
    if (row.attachment !== undefined && row.attachment !== null) {
      const { mimeType, dataUrl, name } = row.attachment as { mimeType?: string; dataUrl?: string; name?: string };
      if (typeof dataUrl !== "string" || dataUrl.length > 6 * 1024 * 1024 ||
        typeof name !== "string" || !name.trim() || name.length > 255 ||
        !["image/jpeg", "image/png", "application/pdf"].includes(mimeType ?? "")) return "INVALID";
      const prefix = `data:${mimeType};base64,`;
      if (!dataUrl.startsWith(prefix)) return "INVALID";
      try {
        const bytes = atob(dataUrl.slice(prefix.length));
        if (bytes.length > 2 * 1024 * 1024) return "INVALID";
        const signatureMatches = mimeType === "image/png"
          ? bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes.charCodeAt(index) === byte)
          : mimeType === "image/jpeg"
            ? bytes.length >= 3 && bytes.charCodeAt(0) === 255 && bytes.charCodeAt(1) === 216 && bytes.charCodeAt(2) === 255
            : bytes.startsWith("%PDF-");
        if (!signatureMatches) return "INVALID";
      } catch {
        return "INVALID";
      }
      attachmentSize += dataUrl.length;
      if (attachmentSize > 12 * 1024 * 1024) return "INVALID";
    }
  }
  if (required && (rows.length === 0 || rows.some((row) =>
    row.cells?.some((cell) => Array.isArray(cell) ? cell.length === 0 : typeof cell !== "string" || !cell.trim()),
  ))) return "MISSING";
  return null;
}

export function normalizeStudentLoginId(value: string): string {
  return value.trim().toLocaleLowerCase("id-ID").replace(/\s+/g, " ");
}

export function gradeAnswers(
  questions: FormQuestion[],
  answers: Record<string, unknown>,
): { earnedScore: number; maximumScore: number; needsReview: boolean } {
  let earnedScore = 0;
  let maximumScore = 0;
  let needsReview = false;

  for (const question of questions) {
    const weight = question.scoreWeight ?? 0;
    maximumScore += weight;
    if (weight === 0) continue;
    if (question.answerKey === undefined) {
      needsReview = true;
      continue;
    }

    const response = answers[question.id];
    if (question.type === "PARAGRAPH" || question.type === "MATRIX") {
      needsReview = true;
      continue;
    }
    const normalize = (value: unknown) =>
      String(value ?? "").trim().toLocaleLowerCase("id-ID");
    const correct = Array.isArray(question.answerKey)
      ? Array.isArray(response) &&
        response.length === question.answerKey.length &&
        response.every((value) =>
          (question.answerKey as string[]).some((key) => normalize(key) === normalize(value)),
        )
      : normalize(question.answerKey) === normalize(response);
    if (correct) earnedScore += weight;
  }

  return { earnedScore, maximumScore, needsReview };
}
