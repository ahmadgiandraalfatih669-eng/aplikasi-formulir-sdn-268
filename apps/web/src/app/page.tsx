"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import ExcelJS from "exceljs";
import { ArrowLeft, CheckCircle2, ChevronUp, CloudOff, Eye, EyeOff, FileDown, FilePlus2, FileText, FileUp, LoaderCircle, LogOut, Pencil, RefreshCw, Trash2, Upload, Users, Wifi, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@sdn268/ui";
import { api, apiBaseUrl, ApiError, clearSession, getSessionUser, restoreSession, setSession, type SessionUser } from "@/lib/api";
import { offlineDb, syncPending, type CachedForm } from "@/lib/offline";
import { StudentsPanel } from "./students-panel";

type Question = {
  id: string;
  type: "SHORT_TEXT" | "PARAGRAPH" | "NUMBER" | "SINGLE_CHOICE" | "MULTIPLE_CHOICE" | "DROPDOWN" | "MATRIX";
  title: string;
  required: boolean;
  options: string[];
  matrixRows?: string[];
  matrixColumns?: Array<string | MatrixColumn>;
  scoreWeight?: number;
  answerKey?: string | string[] | number;
  media?: QuestionMedia;
};

type QuestionMedia = {
  kind: "IMAGE" | "VIDEO";
  url?: string;
  dataUrl?: string;
  name?: string;
  mimeType?: "image/jpeg" | "image/png" | "image/webp" | "video/mp4" | "video/webm";
  sizeBytes?: number;
};

function mediaEmbedUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "youtu.be") return `https://www.youtube-nocookie.com/embed/${parsed.pathname.slice(1)}`;
    if (parsed.hostname === "youtube.com" || parsed.hostname === "www.youtube.com") {
      const videoId = parsed.searchParams.get("v");
      if (videoId) return `https://www.youtube-nocookie.com/embed/${videoId}`;
      if (parsed.pathname.startsWith("/embed/")) return `https://www.youtube-nocookie.com${parsed.pathname}`;
    }
    return url;
  } catch {
    return url;
  }
}

function QuestionMediaView({ media, compact = false }: { media: QuestionMedia; compact?: boolean }) {
  const source = media.dataUrl || media.url;
  if (!source) return null;
  const videoSource = media.url ? mediaEmbedUrl(media.url) : source;
  const isEmbeddedVideo = media.kind === "VIDEO" && media.url && videoSource.includes("youtube-nocookie.com/embed/");
  return media.kind === "IMAGE"
    ? <img src={source} alt={media.name || "Gambar pendukung"} className={`max-h-80 max-w-full rounded-xl object-contain ${compact ? "max-h-52" : ""}`} />
    : isEmbeddedVideo
      ? <iframe src={videoSource} title={media.name || "Video pendukung"} className={`aspect-video w-full rounded-xl ${compact ? "max-w-xl" : "max-w-2xl"}`} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen />
      : <video controls preload="metadata" src={videoSource} className={`max-h-96 max-w-full rounded-xl ${compact ? "max-h-64" : ""}`}>{media.name || "Video pendukung"}</video>;
}

type MatrixColumnType = "SHORT_TEXT" | "PARAGRAPH" | "SINGLE_CHOICE" | "MULTIPLE_CHOICE" | "DROPDOWN";
type MatrixColumn = { label: string; type: MatrixColumnType; options: string[] };
type MatrixAttachment = { name: string; mimeType: "image/jpeg" | "image/png" | "application/pdf"; dataUrl: string };
type MatrixResponseRow = { cells: Array<string | string[]>; attachment?: MatrixAttachment | null };

function normalizeMatrixColumn(column: string | MatrixColumn, index: number): MatrixColumn {
  return typeof column === "string"
    ? { label: column, type: "SHORT_TEXT", options: [] }
    : { label: column.label || `Kolom ${index + 1}`, type: column.type ?? "SHORT_TEXT", options: column.options ?? [] };
}

function parseOptionLines(text: string): string[] {
  return text.split(/\r?\n/).map((value) => value.trim());
}

function cleanOptionLines(options: string[]): string[] {
  return options.map((value) => value.trim()).filter(Boolean);
}

function emptyMatrixRow(columns: MatrixColumn[]): MatrixResponseRow {
  return { cells: columns.map((column) => column.type === "MULTIPLE_CHOICE" ? [] : "") };
}

function isMatrixAttachment(value: unknown): value is MatrixAttachment {
  if (!value || typeof value !== "object") return false;
  const attachment = value as Partial<MatrixAttachment>;
  return typeof attachment.name === "string" &&
    ["image/jpeg", "image/png", "application/pdf"].includes(attachment.mimeType ?? "") &&
    typeof attachment.dataUrl === "string" &&
    attachment.dataUrl.startsWith(`data:${attachment.mimeType};base64,`);
}

function DocumentPreview({ attachment, compact = false }: { attachment: MatrixAttachment; compact?: boolean }) {
  const [previewError, setPreviewError] = useState(false);

  return <div className="space-y-2">
    {previewError
      ? <p role="status" className="text-sm text-amber-800">Pratinjau tidak tersedia. Buka dokumen untuk melihat isinya.</p>
      : attachment.mimeType === "application/pdf"
        ? <iframe
          src={attachment.dataUrl}
          title={`Pratinjau ${attachment.name}`}
          onError={() => setPreviewError(true)}
          className={`w-full rounded border border-slate-300 bg-slate-100 ${compact ? "h-28 max-w-48" : "h-[55vh] min-h-80"}`}
        />
        : <img
          src={attachment.dataUrl}
          alt={`Pratinjau ${attachment.name}`}
          onError={() => setPreviewError(true)}
          className={`rounded border border-slate-300 object-contain ${compact ? "max-h-28 max-w-48" : "max-h-[55vh] max-w-full"}`}
        />}
    <a href={attachment.dataUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-9 items-center rounded-lg px-2 text-sm font-semibold text-blue-700 underline hover:bg-blue-50">
      Buka dokumen
    </a>
  </div>;
}

function matrixRowsFromAnswer(answer: unknown, columns: MatrixColumn[]): MatrixResponseRow[] {
  if (answer && typeof answer === "object" && !Array.isArray(answer) && "rows" in answer && Array.isArray(answer.rows)) {
    return answer.rows.flatMap((value): MatrixResponseRow[] => {
      if (!value || typeof value !== "object" || !("cells" in value) || !Array.isArray(value.cells)) return [];
      const row = value as { cells: unknown[]; attachment?: unknown };
      return [{
        cells: columns.map((column, index) => {
          const cell = row.cells[index];
          return column.type === "MULTIPLE_CHOICE"
            ? Array.isArray(cell) ? cell.filter((item): item is string => typeof item === "string") : []
            : typeof cell === "string" ? cell : "";
        }),
        ...(isMatrixAttachment(row.attachment) ? { attachment: row.attachment } : {}),
      }];
    });
  }
  if (!Array.isArray(answer) || columns.length === 0) return [];
  const rows: MatrixResponseRow[] = [];
  for (let index = 0; index + columns.length <= answer.length; index += columns.length) {
    const cells = answer.slice(index, index + columns.length).map((value, cellIndex) =>
      columns[cellIndex].type === "MULTIPLE_CHOICE"
        ? (typeof value === "string" && value ? [value] : [])
        : typeof value === "string" ? value : "",
    );
    rows.push({ cells });
  }
  return rows;
}

const questionTypes = ["SHORT_TEXT", "PARAGRAPH", "NUMBER", "SINGLE_CHOICE", "MULTIPLE_CHOICE", "DROPDOWN", "MATRIX"] as const;
type ImportedQuestionType = typeof questionTypes[number];

function parseFormattedQuestionDocument(text: string, quizMode: boolean): Question[] {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const questionStart = lines.findIndex((line) => line.toLocaleLowerCase() === "soal");
  const answerStart = lines.findIndex((line) => line.toLocaleLowerCase() === "kunci jawaban");
  if (questionStart < 0 || answerStart <= questionStart) throw new Error("Bagian Soal atau Kunci Jawaban tidak ditemukan.");

  const questionLines = lines.slice(questionStart + 1, answerStart);
  const answerLines = lines.slice(answerStart + 1).filter((line) => /^\d+\.\s+/.test(line));
  const parsed: Array<{ title: string; options: string[]; type: ImportedQuestionType; matrixColumns?: string[] }> = [];
  let current: { title: string; options: string[]; type: ImportedQuestionType; matrixColumns?: string[] } | null = null;

  const finish = () => {
    if (!current) return;
    parsed.push(current);
    current = null;
  };

  for (const line of questionLines) {
    const numbered = line.match(/^(\d+)\.\s+(.+)$/);
    if (numbered) {
      finish();
      current = {
        title: numbered[2].trim(),
        options: [],
        type: "SHORT_TEXT",
      };
      continue;
    }
    const matrix = line.match(/^Isian tabel:\s*(.+)$/i);
    if (matrix && current) {
      current.type = "MATRIX";
      current.matrixColumns = matrix[1].split(",").map((label) => label.trim()).filter(Boolean);
      continue;
    }
    const option = line.match(/^[A-Z]\.\s+(.+)$/);
    if (option && current) {
      current.options.push(option[1].trim());
      continue;
    }
    if (current && /^_{3,}/.test(line)) current.type = "PARAGRAPH";
  }
  finish();
  if (parsed.length === 0) throw new Error("Tidak ada soal bernomor yang dapat diimpor.");
  if (answerLines.length < parsed.length) throw new Error("Jumlah kunci jawaban tidak sesuai dengan jumlah soal.");

  return parsed.map((item, index) => {
    const answerMatch = answerLines[index].match(/^\d+\.\s+(.+)$/);
    const answer = answerMatch?.[1].trim() ?? "";
    if (item.options.length > 0) item.type = answer.includes(";") ? "MULTIPLE_CHOICE" : "SINGLE_CHOICE";
    else if (item.type !== "PARAGRAPH" && item.type !== "MATRIX" && /^-?\d+(\.\d+)?$/.test(answer)) item.type = "NUMBER";
    const answerKey: Question["answerKey"] = item.type === "MULTIPLE_CHOICE"
      ? item.options.filter((option) => answer.split(";").map((value) => value.trim()).includes(option)).join(";")
      : item.type === "SINGLE_CHOICE"
        ? item.options.find((option) => option === answer)
        : item.type === "NUMBER"
          ? Number(answer)
          : item.type === "SHORT_TEXT" && answer !== "Belum diisi" ? answer : undefined;
    return {
      id: crypto.randomUUID(),
      type: item.type,
      title: item.title,
      required: true,
      options: item.options,
      ...(item.type === "MATRIX" ? { matrixRows: [], matrixColumns: (item.matrixColumns ?? []).map((label) => ({ label, type: "SHORT_TEXT" as const, options: [] })) } : {}),
      ...(quizMode ? { scoreWeight: 1 } : {}),
      ...(answerKey === undefined ? {} : { answerKey }),
    };
  });
}

function parseQuestionDocument(text: string, quizMode: boolean): Question[] {
  if (/^Soal$/im.test(text) && /^Kunci Jawaban$/im.test(text)) return parseFormattedQuestionDocument(text, quizMode);
  const questions: Question[] = [];
  let current: {
    type: ImportedQuestionType;
    title: string;
    options: string[];
    answer: string;
    scoreWeight: number;
    required: boolean;
    matrixColumns: MatrixColumn[];
    optionTarget: "question" | number | null;
  } | null = null;

  const finishQuestion = () => {
    if (!current) return;
    if (!current.title) throw new Error(`Teks pertanyaan pada nomor ${questions.length + 1} belum diisi.`);
    const type = current.type;
    const currentTitle = current.title;
    let answerKey: Question["answerKey"];
    if (type === "MATRIX") {
      if (current.matrixColumns.length === 0) throw new Error(`Tabel "${current.title}" harus memiliki setidaknya satu baris Kolom:.`);
      const labels = current.matrixColumns.map((column) => column.label.trim().toLocaleLowerCase());
      if (new Set(labels).size !== labels.length) throw new Error(`Nama kolom pada tabel "${current.title}" tidak boleh duplikat.`);
      current.matrixColumns.forEach((column) => {
        if (new Set(column.options.map((option) => option.toLocaleLowerCase())).size !== column.options.length) {
          throw new Error(`Opsi pada kolom "${column.label}" tidak boleh duplikat.`);
        }
        if (["SINGLE_CHOICE", "MULTIPLE_CHOICE", "DROPDOWN"].includes(column.type) &&
          (column.options.length < 2 || new Set(column.options.map((option) => option.toLocaleLowerCase())).size !== column.options.length)) {
          throw new Error(`Kolom "${column.label}" pada tabel "${currentTitle}" harus memiliki minimal dua opsi yang berbeda.`);
        }
        if (!["SINGLE_CHOICE", "MULTIPLE_CHOICE", "DROPDOWN"].includes(column.type) && column.options.length > 0) {
          throw new Error(`Kolom "${column.label}" tidak menerima opsi. Pilih jenis kolom pilihan untuk menggunakan opsi.`);
        }
      });
    }
    if (type === "SINGLE_CHOICE" || type === "DROPDOWN" || type === "MULTIPLE_CHOICE") {
      if (current.options.length > 50) throw new Error(`Pertanyaan "${current.title}" melebihi batas 50 pilihan.`);
      if (new Set(current.options.map((option) => option.toLocaleLowerCase())).size !== current.options.length) {
        throw new Error(`Pilihan jawaban untuk "${current.title}" tidak boleh duplikat.`);
      }
      if (current.options.length < 2) throw new Error(`Pertanyaan "${current.title}" harus memiliki minimal dua pilihan.`);
      if (current.answer) {
        const findOption = (answer: string) => current!.options.find((option) => option.toLocaleLowerCase() === answer.toLocaleLowerCase());
        const answers = type === "MULTIPLE_CHOICE" ? current.answer.split(";").map((answer) => answer.trim()).filter(Boolean) : [current.answer];
        const resolvedAnswers = answers.map(findOption);
        if (resolvedAnswers.some((answer) => !answer)) {
          throw new Error(`Kunci jawaban untuk "${current.title}" harus sama dengan teks pilihan yang tersedia.`);
        }
        answerKey = type === "MULTIPLE_CHOICE" ? resolvedAnswers as string[] : resolvedAnswers[0];
      }
    } else if (current.answer && type === "SHORT_TEXT") {
      answerKey = current.answer;
    } else if (current.answer && type === "NUMBER") {
      const number = Number(current.answer);
      if (!Number.isFinite(number)) throw new Error(`Kunci jawaban angka untuk "${current.title}" tidak valid.`);
      answerKey = number;
    }

    questions.push({
      id: crypto.randomUUID(),
      type,
      title: current.title,
      required: current.required,
      options: current.options,
      ...(type === "MATRIX" ? { matrixRows: [], matrixColumns: current.matrixColumns } : {}),
      ...(quizMode ? { scoreWeight: current.scoreWeight } : {}),
      ...(answerKey === undefined ? {} : { answerKey }),
    });
    current = null;
  };

  for (const [index, rawLine] of text.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const questionStart = line.match(/^\[([A-Z_]+)\]\s*(.*)$/);
    if (questionStart) {
      finishQuestion();
      const questionType = questionStart[1] as ImportedQuestionType;
      if (!questionTypes.includes(questionType)) {
        throw new Error(`Tipe soal pada baris ${index + 1} tidak dikenali: ${questionStart[1]}.`);
      }
      current = {
        type: questionType,
        title: questionStart[2].trim(),
        options: [],
        answer: "",
        scoreWeight: 1,
        required: true,
        matrixColumns: [],
        optionTarget: null,
      };
      continue;
    }
    if (!current) throw new Error(`Baris ${index + 1} tidak berada di dalam blok pertanyaan.`);
    const matrixColumn = line.match(/^Kolom\s*:\s*(.*?)\s*\|\s*([A-Z_]+)$/i);
    if (matrixColumn) {
      if (current.type !== "MATRIX") throw new Error(`Baris ${index + 1}: Kolom: hanya dapat digunakan pada blok [MATRIX].`);
      const label = matrixColumn[1].trim();
      const columnType = matrixColumn[2].toLocaleUpperCase() as MatrixColumnType;
      if (!label) throw new Error(`Keterangan Kolom pada baris ${index + 1} wajib diisi.`);
      if (!["SHORT_TEXT", "PARAGRAPH", "SINGLE_CHOICE", "MULTIPLE_CHOICE", "DROPDOWN"].includes(columnType)) {
        throw new Error(`Jenis pengisian kolom pada baris ${index + 1} tidak dikenal.`);
      }
      if (current.matrixColumns.length >= 50) throw new Error(`Tabel "${current.title}" melebihi batas 50 kolom.`);
      current.matrixColumns.push({
        label,
        type: columnType,
        options: [],
      });
      current.optionTarget = null;
      continue;
    }
    if (line.toLocaleLowerCase() === "pilihan:") {
      if (!["SINGLE_CHOICE", "MULTIPLE_CHOICE", "DROPDOWN"].includes(current.type)) {
        throw new Error(`Baris ${index + 1}: Pilihan: hanya digunakan pada soal pilihan ganda atau dropdown.`);
      }
      current.optionTarget = "question";
      continue;
    }
    if (line.toLocaleLowerCase() === "opsi:") {
      const column = current.matrixColumns.at(-1);
      if (current.type !== "MATRIX" || !column || !["SINGLE_CHOICE", "MULTIPLE_CHOICE", "DROPDOWN"].includes(column.type)) {
        throw new Error(`Baris ${index + 1}: Opsi: harus mengikuti definisi kolom pilihan pada tabel.`);
      }
      current.optionTarget = current.matrixColumns.length - 1;
      continue;
    }
    if (line.startsWith("- ")) {
      const option = line.slice(2).trim();
      if (!option) throw new Error(`Opsi pada baris ${index + 1} tidak boleh kosong.`);
      if (current.optionTarget === "question") current.options.push(option);
      else if (typeof current.optionTarget === "number") current.matrixColumns[current.optionTarget].options.push(option);
      else throw new Error(`Baris ${index + 1}: Opsi harus mengikuti Pilihan: atau Opsi:.`);
      continue;
    }
    const field = line.match(/^(Jawaban|Bobot|Wajib)\s*:\s*(.*)$/i);
    if (field) {
      const [, label, value] = field;
      if (label.toLocaleLowerCase() === "jawaban") current.answer = value.trim();
      else if (label.toLocaleLowerCase() === "bobot") {
        const weight = Number(value);
        if (!Number.isFinite(weight) || weight < 0 || weight > 1000) throw new Error(`Bobot pada baris ${index + 1} harus berupa angka 0–1000.`);
        current.scoreWeight = weight;
      } else {
        const requiredValue = value.toLocaleLowerCase();
        if (!["ya", "tidak"].includes(requiredValue)) throw new Error(`Nilai Wajib pada baris ${index + 1} harus Ya atau Tidak.`);
        current.required = requiredValue === "ya";
      }
      continue;
    }
    if (current.type === "MATRIX") {
      throw new Error(`Baris ${index + 1} pada tabel tidak dikenali. Gunakan "Kolom: Keterangan | JENIS" atau "Opsi:".`);
    }
    throw new Error(`Format baris ${index + 1} tidak dikenali: ${line}`);
  }
  finishQuestion();
  if (questions.length === 0) throw new Error("Dokumen tidak berisi pertanyaan. Gunakan format [TIPE] Teks pertanyaan.");
  if (questions.length > 100) throw new Error("Maksimal 100 pertanyaan dapat diimpor sekaligus.");
  return questions;
}

type SchoolForm = CachedForm;

type FormTargetClass = {
  id: string;
  name: string;
  academicYear: { name: string; active: boolean };
};

const loginSchema = z.object({
  username: z.string().trim().min(1, "Nama pengguna wajib diisi."),
  password: z.string().min(1, "Kata sandi wajib diisi."),
});

function AppFooter() {
  return <footer className="mt-8 text-center text-xs text-[var(--ds-text-muted)]">©2026-Cepi Kunaefi SDN 268 Panyileukan</footer>;
}

function Login({ onLogin, sessionNotice }: { onLogin: (user: SessionUser) => void; sessionNotice?: string }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [localAdminEmail, setLocalAdminEmail] = useState("");
  const [localAdminPassword, setLocalAdminPassword] = useState("");
  const [localAdminError, setLocalAdminError] = useState("");
  const [localAdminBusy, setLocalAdminBusy] = useState(false);
  const [isLocalEnvironment, setIsLocalEnvironment] = useState(false);
  const [showLocalAdmin, setShowLocalAdmin] = useState(false);
  const [showStudentPassword, setShowStudentPassword] = useState(false);
  const [showLocalAdminPassword, setShowLocalAdminPassword] = useState(false);
  const form = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: { username: "", password: "" },
  });

  useEffect(() => {
    setIsLocalEnvironment(
      window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1",
    );
  }, []);

  async function submit(values: z.infer<typeof loginSchema>) {
    setError("");
    setBusy(true);
    try {
      const result = await api<{ accessToken: string; user: SessionUser }>("/auth/student/login", {
        method: "POST",
        body: JSON.stringify(values),
      });
      setSession(result.accessToken, result.user);
      onLogin(result.user);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Tidak dapat masuk.";
      setError(values.username.includes("@")
        ? `${message} Kolom ini khusus akun murid. Untuk admin lokal, gunakan formulir Akses admin lokal di bawah.`
        : message);
    } finally {
      setBusy(false);
    }
  }

  async function submitLocalAdmin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLocalAdminError("");
    setLocalAdminBusy(true);
    try {
      const result = await api<{ accessToken: string; user: SessionUser }>("/auth/local-admin/login", {
        method: "POST",
        body: JSON.stringify({ email: localAdminEmail, password: localAdminPassword }),
      });
      setSession(result.accessToken, result.user);
      onLogin(result.user);
    } catch (cause) {
      setLocalAdminError(cause instanceof Error ? cause.message : "Tidak dapat masuk sebagai admin lokal.");
    } finally {
      setLocalAdminBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <section className="w-full max-w-md rounded-3xl bg-white p-7 shadow-xl sm:p-9">
        {sessionNotice && <p role="status" className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{sessionNotice}</p>}
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center overflow-hidden rounded-2xl bg-slate-950 p-2 shadow-lg ring-1 ring-white/20"><img src="/logo-sdn-268.png" alt="Logo SDN 268 Panyileukan" className="h-full w-full object-contain" /></div>
          <p className="text-sm font-bold uppercase tracking-wider text-school-700">SDN 268 Panyileukan</p>
          <h1 className="mt-2 text-2xl font-black">Portal Formulir & Penilaian</h1>
          <p className="mt-2 text-slate-600">Silakan masuk untuk melanjutkan.</p>
        </div>
        <form className="space-y-4" onSubmit={form.handleSubmit(submit)}>
          <label className="block font-semibold" htmlFor="username">Nama pengguna murid
            <input {...form.register("username")} id="username" autoComplete="username" className="mt-1 min-h-12 w-full rounded-xl border border-slate-300 px-3" placeholder="Contoh: siti aminah 4a" />
          </label>
          {form.formState.errors.username && <p className="text-sm text-red-700">{form.formState.errors.username.message}</p>}
          <label className="block font-semibold" htmlFor="password">NISN / kata sandi
            <span className="relative mt-1 block">
              <input {...form.register("password")} id="password" type={showStudentPassword ? "text" : "password"} autoComplete="current-password" className="min-h-12 w-full rounded-xl border border-slate-300 px-3 pr-12" />
              <button type="button" aria-label={showStudentPassword ? "Sembunyikan kata sandi" : "Tampilkan kata sandi"} aria-pressed={showStudentPassword} onClick={() => setShowStudentPassword((visible) => !visible)} className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-slate-500 hover:text-slate-800">
                {showStudentPassword ? <EyeOff size={20} aria-hidden="true" /> : <Eye size={20} aria-hidden="true" />}
              </button>
            </span>
          </label>
          <p className="text-xs text-slate-600">Login ini untuk akun murid. Admin/guru gunakan login Google atau formulir akses admin lokal di bawah pada localhost.</p>
          {form.formState.errors.password && <p className="text-sm text-red-700">{form.formState.errors.password.message}</p>}
          {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm font-medium text-red-800">{error}</p>}
          <Button type="submit" disabled={busy}>
            {busy && <LoaderCircle className="animate-spin" size={18} />} Masuk sebagai murid
          </Button>
        </form>
        <div className="my-6 flex items-center gap-3 text-xs text-slate-500"><span className="h-px flex-1 bg-slate-200" />ATAU<span className="h-px flex-1 bg-slate-200" /></div>
        <a className="flex min-h-12 items-center justify-center rounded-xl border border-slate-300 font-bold hover:bg-slate-50" href={`${apiBaseUrl}/auth/google`}>
          Masuk admin / guru dengan Google
        </a>
        {isLocalEnvironment && !showLocalAdmin && <button type="button" className="mt-4 w-full text-sm font-bold text-school-700 underline underline-offset-2 hover:text-school-900" onClick={() => setShowLocalAdmin(true)}>
          Masuk sebagai admin
        </button>}
        {isLocalEnvironment && showLocalAdmin && <form className="mt-5 space-y-3 border-t border-slate-200 pt-5" onSubmit={submitLocalAdmin}>
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-bold text-slate-700">Akses admin lokal (development)</p>
            <button type="button" aria-label="Sembunyikan akses admin lokal" title="Sembunyikan akses admin lokal" onClick={() => setShowLocalAdmin(false)} className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800">
              <ChevronUp size={18} aria-hidden="true" />
            </button>
          </div>
          <label className="block text-sm font-semibold" htmlFor="local-admin-email">Email admin
            <input id="local-admin-email" type="email" autoComplete="username" required value={localAdminEmail} onChange={(event) => setLocalAdminEmail(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-3" />
          </label>
          <label className="block text-sm font-semibold" htmlFor="local-admin-password">Kata sandi admin
            <span className="relative mt-1 block">
              <input id="local-admin-password" type={showLocalAdminPassword ? "text" : "password"} autoComplete="current-password" required value={localAdminPassword} onChange={(event) => setLocalAdminPassword(event.target.value)} className="min-h-11 w-full rounded-xl border border-slate-300 px-3 pr-12" />
              <button type="button" aria-label={showLocalAdminPassword ? "Sembunyikan kata sandi" : "Tampilkan kata sandi"} aria-pressed={showLocalAdminPassword} onClick={() => setShowLocalAdminPassword((visible) => !visible)} className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-slate-500 hover:text-slate-800">
                {showLocalAdminPassword ? <EyeOff size={20} aria-hidden="true" /> : <Eye size={20} aria-hidden="true" />}
              </button>
            </span>
          </label>
          {localAdminError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{localAdminError}</p>}
          <Button type="submit" disabled={localAdminBusy}>
            {localAdminBusy && <LoaderCircle className="animate-spin" size={18} />} Masuk admin lokal
          </Button>
          <p className="text-xs text-slate-500">Hanya tersedia di mode development dan memerlukan hash kata sandi lokal.</p>
        </form>}
        <p className="mt-5 text-center text-xs text-slate-500">Gunakan akun sekolah yang telah diizinkan.</p>
        <AppFooter />
      </section>
    </main>
  );
}

function InitialPassword({ onChanged }: { onChanged: () => void }) {
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  async function changePassword(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await api("/auth/change-initial-password", { method: "POST", body: JSON.stringify({ password }) });
      const user = getSessionUser();
      if (user) {
        const updated = { ...user, firstLogin: false };
        window.sessionStorage.setItem("sdn268_user", JSON.stringify(updated));
      }
      setSaved(true);
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Tidak dapat mengganti kata sandi.");
    }
  }
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={changePassword} className="w-full max-w-md space-y-4 rounded-3xl bg-white p-8 shadow-xl">
        <h1 className="text-2xl font-black">Buat kata sandi baru</h1>
        <p className="text-slate-600">Untuk keamanan, ganti NISN awal dengan kata sandi yang mudah diingat dan dirahasiakan.</p>
        <label className="block font-semibold">Kata sandi baru (minimal 8 karakter)
          <span className="relative mt-1 block">
            <input required minLength={8} type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} className="min-h-12 w-full rounded-xl border border-slate-300 px-3 pr-12" />
            <button type="button" aria-label={showPassword ? "Sembunyikan kata sandi" : "Tampilkan kata sandi"} aria-pressed={showPassword} onClick={() => setShowPassword((visible) => !visible)} className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-slate-500 hover:text-slate-800">
              {showPassword ? <EyeOff size={20} aria-hidden="true" /> : <Eye size={20} aria-hidden="true" />}
            </button>
          </span>
        </label>
        {error && <p role="alert" className="text-red-700">{error}</p>}
        {saved && <p className="text-green-700">Kata sandi berhasil diperbarui.</p>}
        <Button type="submit">Simpan kata sandi</Button>
      </form>
    </main>
  );
}

function Builder({ onSaved, onCancel, editingForm }: { onSaved: () => void; onCancel: () => void; editingForm?: SchoolForm | null }) {
  const classesQuery = useQuery({
    queryKey: ["classes"],
    queryFn: () => api<FormTargetClass[]>("/classes"),
  });
  const [title, setTitle] = useState(editingForm?.title ?? "");
  const [description, setDescription] = useState(editingForm?.description ?? "");
  const [quizMode, setQuizMode] = useState(editingForm?.quizMode ?? false);
  const [classIds, setClassIds] = useState<string[]>([]);
  const [questions, setQuestions] = useState<Question[]>(
    editingForm?.currentVersion?.schema.questions.map((question) => ({
      ...question,
      options: question.options ?? [],
      ...(question.type === "MATRIX" ? {
        matrixRows: [],
        matrixColumns: (question.matrixColumns ?? []).map((column, index) => normalizeMatrixColumn(column, index)),
      } : {}),
    })) ?? [],
  );
  const [error, setError] = useState("");
  const [importNotice, setImportNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [mediaKinds, setMediaKinds] = useState<Record<string, QuestionMedia["kind"]>>({});
  const questionImportInput = useRef<HTMLInputElement>(null);

  function addQuestion(type: Question["type"]) {
    setQuestions((current) => [...current, {
      id: crypto.randomUUID(),
      type,
      title: "",
      required: true,
      options: type === "SINGLE_CHOICE" || type === "MULTIPLE_CHOICE" || type === "DROPDOWN" ? ["Pilihan 1", "Pilihan 2"] : [],
      ...(type === "MATRIX" ? { matrixRows: [], matrixColumns: [
        { label: "Kolom 1", type: "SHORT_TEXT" as const, options: [] },
        { label: "Kolom 2", type: "SHORT_TEXT" as const, options: [] },
      ] } : {}),
      ...(quizMode ? { scoreWeight: 1 } : {}),
    }]);
  }

  function updateQuestion(id: string, patch: Partial<Question>) {
    setQuestions((current) => current.map((question) => question.id === id ? { ...question, ...patch } : question));
  }

  function changeQuestionType(id: string, type: Question["type"]) {
    setQuestions((current) => current.map((question) => question.id === id ? {
      ...question,
      type,
      answerKey: undefined,
      ...(type === "MATRIX" ? {
        matrixRows: [],
        matrixColumns: (question.matrixColumns ?? [
          { label: "Kolom 1", type: "SHORT_TEXT" as const, options: [] },
          { label: "Kolom 2", type: "SHORT_TEXT" as const, options: [] },
        ]).map((column, index) => normalizeMatrixColumn(column, index)),
      } : {}),
    } : question));
  }

  function updateMatrixColumn(id: string, index: number, patch: Partial<MatrixColumn>) {
    setQuestions((current) => current.map((question) => {
      if (question.id !== id) return question;
      const columns = (question.matrixColumns ?? []).map((column, columnIndex) => normalizeMatrixColumn(column, columnIndex));
      columns[index] = { ...columns[index], ...patch };
      return { ...question, matrixColumns: columns };
    }));
  }

  function addMatrixColumn(id: string) {
    setQuestions((current) => current.map((question) => {
      if (question.id !== id || (question.matrixColumns?.length ?? 0) >= 50) return question;
      const columns = (question.matrixColumns ?? []).map((column, index) => normalizeMatrixColumn(column, index));
      return { ...question, matrixColumns: [...columns, { label: `Kolom ${columns.length + 1}`, type: "SHORT_TEXT", options: [] }] };
    }));
  }

  function removeMatrixColumn(id: string, index: number) {
    setQuestions((current) => current.map((question) => {
      if (question.id !== id || (question.matrixColumns?.length ?? 0) <= 1) return question;
      return { ...question, matrixColumns: (question.matrixColumns ?? []).filter((_, itemIndex) => itemIndex !== index) };
    }));
  }

  function changeOptions(id: string, text: string) {
    const options = parseOptionLines(text);
    const nonEmptyOptions = cleanOptionLines(options);
    setQuestions((current) => current.map((question) => {
      if (question.id !== id) return question;
      const validKeys = Array.isArray(question.answerKey)
        ? question.answerKey.filter((value) => nonEmptyOptions.includes(value))
        : typeof question.answerKey === "string" && nonEmptyOptions.includes(question.answerKey)
          ? question.answerKey
          : undefined;
      return { ...question, options, answerKey: validKeys };
    }));
  }

  function changeQuizMode(enabled: boolean) {
    setQuizMode(enabled);
    if (enabled) {
      setQuestions((current) => current.map((question) => ({ ...question, scoreWeight: question.scoreWeight ?? 1 })));
    }
  }

  async function uploadQuestionMedia(questionId: string, file: File | undefined) {
    if (!file) return;
    const mimeTypes = ["image/jpeg", "image/png", "image/webp", "video/mp4", "video/webm"];
    if (!mimeTypes.includes(file.type)) {
      setError("Pilih gambar JPG, PNG, WebP atau video MP4, WebM.");
      return;
    }
    if (file.size > 7 * 1024 * 1024) {
      setError("Ukuran total media lokal per formulir maksimal 7 MB.");
      return;
    }
    const existingBytes = questions.reduce((total, question) =>
      total + (question.id === questionId ? 0 : question.media?.sizeBytes ?? 0), 0);
    if (existingBytes + file.size > 7 * 1024 * 1024) {
      setError("Ukuran total media lokal per formulir maksimal 7 MB. Hapus atau kecilkan media lain terlebih dahulu.");
      return;
    }
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("Media gagal dibaca. Pilih berkas lain."));
        reader.onload = () => typeof reader.result === "string"
          ? resolve(reader.result)
          : reject(new Error("Media tidak dapat dibaca."));
        reader.readAsDataURL(file);
      });
      const kind = file.type.startsWith("image/") ? "IMAGE" : "VIDEO";
      updateQuestion(questionId, {
        media: { kind, dataUrl, name: file.name, mimeType: file.type as QuestionMedia["mimeType"], sizeBytes: file.size },
      });
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Media tidak dapat dibaca.");
    }
  }

  async function downloadQuestionTemplate() {
    setError("");
    try {
      const { Document, HeadingLevel, Packer, Paragraph } = await import("docx");
      const document = new Document({
        sections: [{
          children: [
            new Paragraph({ text: "Template impor soal formulir", heading: HeadingLevel.TITLE }),
            new Paragraph({ text: "Edit pertanyaan contoh di bawah ini, lalu impor kembali sebagai file .docx." }),
            new Paragraph({ text: "Satu blok dimulai dengan [TIPE] Judul pertanyaan. Tipe: SHORT_TEXT, PARAGRAPH, NUMBER, SINGLE_CHOICE, MULTIPLE_CHOICE, DROPDOWN, MATRIX." }),
            new Paragraph({ text: "Untuk pilihan, tulis Pilihan: lalu satu opsi per baris dengan awalan - . Isi Jawaban: dengan teks opsi yang sama; untuk MULTIPLE_CHOICE pisahkan jawaban dengan titik koma." }),
            new Paragraph({ text: "Bobot: angka 0–1000 (opsional, bawaan 1). Wajib: Ya atau Tidak (opsional, bawaan Ya)." }),
            new Paragraph({ text: "Untuk tabel [MATRIX], tambahkan satu baris per kolom: Kolom: Keterangan | JENIS. Jenis kolom: SHORT_TEXT, PARAGRAPH, SINGLE_CHOICE, MULTIPLE_CHOICE, DROPDOWN." }),
            new Paragraph({ text: "Untuk kolom pilihan SINGLE_CHOICE, MULTIPLE_CHOICE, atau DROPDOWN, tulis Opsi: tepat setelah baris Kolom, lalu satu opsi per baris dengan awalan - . Setiap kolom pilihan perlu minimal dua opsi." }),
            new Paragraph({ text: "Murid menambahkan dan mengelola baris tabel sendiri. Dokumen pendukung JPG, PNG, atau PDF diunggah murid pada baris tabel, bukan pada template." }),
            new Paragraph({ text: "[SHORT_TEXT] Siapa nama pahlawan nasional yang dikenal sebagai Bapak Pendidikan?" }),
            new Paragraph({ text: "Jawaban: Ki Hajar Dewantara" }),
            new Paragraph({ text: "Bobot: 1" }),
            new Paragraph({ text: "[PARAGRAPH] Jelaskan makna semboyan Bhinneka Tunggal Ika." }),
            new Paragraph({ text: "Wajib: Ya" }),
            new Paragraph({ text: "[NUMBER] Berapakah hasil 7 dikali 8?" }),
            new Paragraph({ text: "Jawaban: 56" }),
            new Paragraph({ text: "[SINGLE_CHOICE] Planet apakah yang paling dekat dengan Matahari?" }),
            new Paragraph({ text: "Pilihan:" }),
            new Paragraph({ text: "- Merkurius" }),
            new Paragraph({ text: "- Venus" }),
            new Paragraph({ text: "- Bumi" }),
            new Paragraph({ text: "Jawaban: Merkurius" }),
            new Paragraph({ text: "[MULTIPLE_CHOICE] Pilih contoh hewan mamalia." }),
            new Paragraph({ text: "Pilihan:" }),
            new Paragraph({ text: "- Kucing" }),
            new Paragraph({ text: "- Ayam" }),
            new Paragraph({ text: "- Paus" }),
            new Paragraph({ text: "Jawaban: Kucing; Paus" }),
            new Paragraph({ text: "[DROPDOWN] Pilih warna bendera Indonesia." }),
            new Paragraph({ text: "Pilihan:" }),
            new Paragraph({ text: "- Merah dan putih" }),
            new Paragraph({ text: "- Merah dan biru" }),
            new Paragraph({ text: "Jawaban: Merah dan putih" }),
            new Paragraph({ text: "[MATRIX] Data pengamatan tanaman" }),
            new Paragraph({ text: "Kolom: Nama tanaman | SHORT_TEXT" }),
            new Paragraph({ text: "Kolom: Kondisi daun | DROPDOWN" }),
            new Paragraph({ text: "Opsi:" }),
            new Paragraph({ text: "- Sehat" }),
            new Paragraph({ text: "- Layu" }),
            new Paragraph({ text: "Kolom: Catatan | PARAGRAPH" }),
            new Paragraph({ text: "Wajib: Ya" }),
          ],
        }],
      });
      const blob = await Packer.toBlob(document);
      const url = URL.createObjectURL(blob);
      const link = window.document.createElement("a");
      link.href = url;
      link.download = "template-pertanyaan-formulir.docx";
      link.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Template DOCX tidak dapat dibuat.");
    }
  }

  async function downloadFormattedQuestions() {
    setError("");
    if (questions.length === 0) {
      setError("Tambahkan minimal satu soal sebelum mengunduh dokumen soal.");
      return;
    }
    try {
      const { Document, HeadingLevel, Packer, Paragraph } = await import("docx");
      const paragraphs: InstanceType<typeof Paragraph>[] = [
        new Paragraph({ text: title.trim() || "Kumpulan Soal", heading: HeadingLevel.TITLE, alignment: "center" }),
        ...(description.trim() ? [new Paragraph({ text: description.trim(), alignment: "center", spacing: { after: 240 } })] : []),
        new Paragraph({ text: "Petunjuk pengerjaan", heading: HeadingLevel.HEADING_1 }),
        new Paragraph({ text: "Bacalah setiap soal dengan teliti. Pilih atau tuliskan jawaban yang paling tepat." }),
        new Paragraph({ text: "Soal", heading: HeadingLevel.HEADING_1, spacing: { before: 240 } }),
      ];
      const answerKey: string[] = [];

      questions.forEach((question, index) => {
        paragraphs.push(new Paragraph({
          text: `${index + 1}. ${question.title.trim()}`,
          spacing: { before: 160, after: 80 },
          keepNext: true,
        }));
        if (["SINGLE_CHOICE", "MULTIPLE_CHOICE", "DROPDOWN"].includes(question.type)) {
          question.options.forEach((option, optionIndex) => {
            paragraphs.push(new Paragraph({
              text: `${String.fromCharCode(65 + optionIndex)}. ${option}`,
              indent: { left: 720, hanging: 360 },
              keepNext: true,
            }));
          });
        } else if (question.type === "PARAGRAPH") {
          paragraphs.push(new Paragraph({ text: "________________________________________________________________________", indent: { left: 720 } }));
          paragraphs.push(new Paragraph({ text: "________________________________________________________________________", indent: { left: 720 } }));
        } else if (question.type === "MATRIX") {
          const columns = (question.matrixColumns ?? []).map((column, columnIndex) => normalizeMatrixColumn(column, columnIndex));
          paragraphs.push(new Paragraph({
            text: `Isian tabel: ${columns.map((column) => column.label).join(", ")}`,
            indent: { left: 720 },
          }));
        } else {
          paragraphs.push(new Paragraph({ text: "Jawaban: ______________________________________________", indent: { left: 720 } }));
        }

        const answer = Array.isArray(question.answerKey)
          ? question.answerKey.join("; ")
          : question.answerKey === undefined || question.answerKey === ""
            ? question.type === "PARAGRAPH" || question.type === "MATRIX" ? "Dinilai manual" : "Belum diisi"
            : String(question.answerKey);
        answerKey.push(`${index + 1}. ${answer}`);
      });

      paragraphs.push(new Paragraph({ text: "Kunci Jawaban", heading: HeadingLevel.HEADING_1, pageBreakBefore: true }));
      answerKey.forEach((answer) => paragraphs.push(new Paragraph({ text: answer, spacing: { after: 80 } })));

      const document = new Document({
        sections: [{
          properties: { page: { margin: { top: 1000, right: 1000, bottom: 1000, left: 1000 } } },
          children: paragraphs,
        }],
      });
      const blob = await Packer.toBlob(document);
      const url = URL.createObjectURL(blob);
      const link = window.document.createElement("a");
      link.href = url;
      const safeTitle = (title.trim() || "kumpulan-soal").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLocaleLowerCase();
      link.download = `${safeTitle || "kumpulan-soal"}.docx`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Dokumen soal tidak dapat dibuat.");
    }
  }

  async function importQuestionFile(file: File | null) {
    if (!file) return;
    setError("");
    setImportNotice("");
    if (!file.name.toLocaleLowerCase().endsWith(".docx")) {
      setError("Pilih dokumen Microsoft Word dengan format .docx.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError("Ukuran dokumen maksimal 10 MB.");
      return;
    }
    try {
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
      const imported = parseQuestionDocument(result.value, quizMode);
      if (questions.length + imported.length > 100) {
        throw new Error("Jumlah pertanyaan pada formulir tidak boleh melebihi 100.");
      }
      if (questions.length > 0 && !window.confirm(`Tambahkan ${imported.length} pertanyaan ke ${questions.length} pertanyaan yang sudah ada?`)) return;
      setQuestions((current) => [...current, ...imported]);
      setImportNotice(`${imported.length} pertanyaan berhasil ditambahkan. Periksa kembali sebelum menyimpan formulir.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Dokumen DOCX tidak dapat dibaca. Gunakan template yang disediakan.");
    }
  }

  async function save(publish: boolean) {
    setError("");
    if (!title.trim() || questions.length === 0 || questions.some((question) => !question.title.trim())) {
      setError("Isi judul dan minimal satu pertanyaan dengan teks pertanyaan.");
      return;
    }
    if (questions.some((question) => {
      if (question.type !== "MATRIX") return false;
      const columns = (question.matrixColumns ?? []).map((column, index) => ({
        ...normalizeMatrixColumn(column, index),
        options: cleanOptionLines(normalizeMatrixColumn(column, index).options),
      }));
      return columns.length === 0 ||
        columns.some((column) => !column.label.trim() ||
          (["SINGLE_CHOICE", "MULTIPLE_CHOICE", "DROPDOWN"].includes(column.type) &&
            (column.options.length < 2 || new Set(column.options.map((option) => option.toLocaleLowerCase())).size !== column.options.length))) ||
        new Set(columns.map((column) => column.label.trim().toLocaleLowerCase())).size !== columns.length;
    })) {
      setError("Lengkapi semua header kolom. Header tidak boleh duplikat dan kolom pilihan wajib memiliki dua opsi berbeda.");
      return;
    }
    const localMediaSize = questions.reduce((total, question) => total + (question.media?.sizeBytes ?? 0), 0);
    if (localMediaSize > 7 * 1024 * 1024) {
      setError("Ukuran total media lokal per formulir maksimal 7 MB.");
      return;
    }
    if (publish && !editingForm && classIds.length === 0) {
      setError("Pilih setidaknya satu kelas sebelum memublikasikan formulir.");
      return;
    }
    if (publish && quizMode && questions.some((question) =>
      question.type !== "PARAGRAPH" && question.type !== "MATRIX" &&
      (question.scoreWeight ?? 0) > 0 &&
      (question.answerKey === undefined || question.answerKey === ""),
    )) {
      setError("Isi kunci jawaban untuk semua pertanyaan kuis yang dinilai otomatis.");
      return;
    }
    if (!editingForm && classesQuery.isError) {
      setError("Daftar kelas tidak dapat dimuat. Coba lagi sebelum menyimpan formulir.");
      return;
    }
    setBusy(true);
    try {
      const requestBody = JSON.stringify({
        title,
        description,
        quizMode,
        questions: questions.map((question) => ({
          ...question,
          options: cleanOptionLines(question.options),
          ...(question.type === "MATRIX" ? {
            matrixColumns: (question.matrixColumns ?? []).map((column, index) => ({
              ...normalizeMatrixColumn(column, index),
              options: cleanOptionLines(normalizeMatrixColumn(column, index).options),
            })),
          } : {}),
        })),
        ...(!editingForm && classIds.length ? { assignments: { classIds, studentIds: [] } } : {}),
      });
      const result = editingForm
        ? await api<{ id: string }>(`/forms/${editingForm.id}`, {
          method: "PATCH",
          body: requestBody,
        })
        : await api<{ id: string }>("/forms", {
          method: "POST",
          body: requestBody,
        });
      if (publish) await api(`/forms/${result.id}/publish`, { method: "POST" });
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Formulir tidak dapat disimpan.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mx-auto max-w-3xl space-y-5 rounded-3xl bg-white p-5 shadow sm:p-8">
      <div><p className="font-bold text-school-700">{editingForm ? "EDIT FORMULIR" : "PEMBUAT FORMULIR"}</p><h2 className="text-2xl font-black">{editingForm ? "Edit formulir" : "Formulir baru"}</h2></div>
      <label className="block font-semibold">Judul formulir
        <input value={title} onChange={(event) => setTitle(event.target.value)} className="mt-1 min-h-12 w-full rounded-xl border border-slate-300 px-3" />
      </label>
      <label className="block font-semibold">Keterangan
        <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} className="mt-1 w-full rounded-xl border border-slate-300 p-3" />
      </label>
      <label className="flex items-center gap-3 rounded-xl bg-blue-50 p-3 font-semibold"><input type="checkbox" checked={quizMode} onChange={(event) => changeQuizMode(event.target.checked)} className="h-5 w-5" />Aktifkan mode kuis</label>
      {!editingForm && <fieldset className="rounded-2xl border border-slate-200 p-4">
        <legend className="px-2 font-bold">Tugaskan ke kelas</legend>
        <p className="mb-3 text-sm text-slate-600">Pilih kelas yang dapat melihat dan mengerjakan formulir ini. Publikasi memerlukan minimal satu kelas.</p>
        {classesQuery.isLoading ? <p className="text-sm text-slate-600">Memuat daftar kelas…</p>
          : classesQuery.isError ? <div role="alert" className="text-sm text-red-800">{classesQuery.error.message}<button type="button" className="ml-2 underline" onClick={() => void classesQuery.refetch()}>Coba lagi</button></div>
            : (classesQuery.data ?? []).length === 0 ? <p className="text-sm text-slate-600">Belum ada kelas. Minta admin menambahkan kelas terlebih dahulu.</p>
              : <div className="grid gap-2 sm:grid-cols-2">{(classesQuery.data ?? []).map((schoolClass) => (
                <label key={schoolClass.id} className="flex min-h-11 items-center gap-3 rounded-lg bg-slate-50 px-3">
                  <input
                    type="checkbox"
                    checked={classIds.includes(schoolClass.id)}
                    onChange={(event) => setClassIds((current) => event.target.checked
                      ? [...current, schoolClass.id]
                      : current.filter((id) => id !== schoolClass.id))}
                    className="h-5 w-5"
                  />
                  <span className="font-semibold">{schoolClass.name} · {schoolClass.academicYear.name}{schoolClass.academicYear.active ? " (aktif)" : ""}</span>
                </label>
              ))}</div>}
      </fieldset>}
      {editingForm && <p className="rounded-xl bg-blue-50 p-3 text-sm text-blue-900">Penugasan kelas yang sudah ada akan dipertahankan. Menyimpan perubahan membuat versi baru sebagai draf; pilih “Simpan & publikasikan” untuk menerbitkan versi terbaru.</p>}
      <section className="space-y-3 rounded-2xl border border-blue-200 bg-blue-50 p-4">
        <div>
          <h3 className="font-bold">Tambah soal dari dokumen Word</h3>
          <p className="mt-1 text-sm text-slate-700">Unduh template DOCX, ubah contoh pertanyaan, lalu impor. Soal akan ditambahkan ke daftar di bawah dan tetap dapat diedit sebelum formulir disimpan.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" secondary onClick={() => void downloadQuestionTemplate()}><FileDown size={18} />Template (.docx)</Button>
          <Button type="button" secondary onClick={() => questionImportInput.current?.click()}><Upload size={18} />Impor (.docx)</Button>
          <Button type="button" secondary onClick={() => void downloadFormattedQuestions()}><FileText size={18} />Unduh soal rapi (.docx)</Button>
          <input
            ref={questionImportInput}
            type="file"
            accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            className="hidden"
            onChange={(event) => {
              void importQuestionFile(event.currentTarget.files?.[0] ?? null);
              event.currentTarget.value = "";
            }}
          />
        </div>
        {importNotice && <p role="status" className="text-sm font-semibold text-green-800">{importNotice}</p>}
      </section>
      <div className="space-y-4">
        {questions.map((question, index) => (
          <fieldset key={question.id} className="space-y-3 rounded-2xl border border-slate-200 p-4">
            <legend className="px-2 font-bold">Pertanyaan {index + 1}</legend>
            <label className="block font-semibold">Pertanyaan
              <input value={question.title} onChange={(event) => updateQuestion(question.id, { title: event.target.value })} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3" />
            </label>
            {quizMode && <section className="space-y-3 rounded-xl border border-blue-100 bg-blue-50 p-3">
              <h4 className="font-bold text-blue-950">Media pendukung soal</h4>
              <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
                <label className="text-sm font-semibold">Jenis media
                  <select value={question.media?.kind ?? mediaKinds[question.id] ?? "IMAGE"} onChange={(event) => {
                    const kind = event.target.value as QuestionMedia["kind"];
                    setMediaKinds((current) => ({ ...current, [question.id]: kind }));
                    if (question.media) updateQuestion(question.id, { media: { ...question.media, kind } });
                  }} className="mt-1 min-h-10 w-full rounded-lg border border-slate-300 bg-white px-2">
                    <option value="IMAGE">Gambar</option>
                    <option value="VIDEO">Video</option>
                  </select>
                </label>
                <label className="text-sm font-semibold">Tautan gambar/video
                  <input type="url" value={question.media?.url ?? ""} onChange={(event) => {
                    const url = event.target.value.trim();
                    updateQuestion(question.id, {
                      media: url ? {
                        kind: question.media?.kind ?? mediaKinds[question.id] ?? "IMAGE",
                        url,
                      } : undefined,
                    });
                  }} placeholder="https://…" className="mt-1 min-h-10 w-full rounded-lg border border-slate-300 bg-white px-3" />
                </label>
              </div>
              <label className="inline-flex min-h-10 cursor-pointer items-center rounded-lg border border-blue-300 bg-white px-3 font-semibold text-blue-900 hover:bg-blue-100">
                <Upload size={16} className="mr-2" />Upload dari perangkat
                <input type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm" className="sr-only" onChange={(event) => {
                  void uploadQuestionMedia(question.id, event.currentTarget.files?.[0]);
                  event.currentTarget.value = "";
                }} />
              </label>
              {question.media && <div className="space-y-2 rounded-lg bg-white p-3">
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate">{question.media.name || question.media.url || "Media pendukung"}</span>
                  <button type="button" className="font-semibold text-red-700 underline" onClick={() => updateQuestion(question.id, { media: undefined })}>Hapus media</button>
                </div>
                <QuestionMediaView media={question.media} compact />
              </div>}
              <p className="text-xs text-slate-600">Berlaku saat mode kuis aktif. Gambar: JPG/PNG/WebP; video: MP4/WebM. Ukuran total unggahan lokal formulir maksimal 7 MB.</p>
            </section>}
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm font-semibold">Jenis
                <select value={question.type} onChange={(event) => changeQuestionType(question.id, event.target.value as Question["type"])} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-2">
                  <option value="SHORT_TEXT">Jawaban singkat</option><option value="PARAGRAPH">Paragraf</option><option value="NUMBER">Angka</option><option value="SINGLE_CHOICE">Pilihan ganda</option><option value="MULTIPLE_CHOICE">Kotak centang</option><option value="DROPDOWN">Dropdown</option><option value="MATRIX">Tabel</option>
                </select>
              </label>
              <label className="flex items-center gap-2 self-end pb-2 font-semibold"><input type="checkbox" checked={question.required} onChange={(event) => updateQuestion(question.id, { required: event.target.checked })} />Wajib diisi</label>
            </div>
            {["SINGLE_CHOICE", "MULTIPLE_CHOICE", "DROPDOWN"].includes(question.type) && (
              <label className="block text-sm font-semibold">Pilihan jawaban (satu pilihan per baris)
                <textarea rows={3} value={question.options.join("\n")} onChange={(event) => changeOptions(question.id, event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 p-2" />
              </label>
            )}
            {question.type === "MATRIX" && <div className="space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-sm text-slate-700">Murid dapat menambah, mengubah, dan menghapus baris tabel, lalu melampirkan dokumen JPG, PNG, atau PDF.</p>
              <div>
                <h4 className="mb-2 text-sm font-bold">Kolom tabel</h4>
                <div className="space-y-2">
                  {(question.matrixColumns ?? []).map((column, columnIndex) => (
                    (() => {
                      const normalized = normalizeMatrixColumn(column, columnIndex);
                      return <div key={columnIndex} className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
                        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                          <label className="text-xs font-bold text-slate-600">Keterangan kolom
                            <input value={normalized.label} onChange={(event) => updateMatrixColumn(question.id, columnIndex, { label: event.target.value })} aria-label={`Keterangan kolom ${columnIndex + 1}`} className="mt-1 min-h-10 w-full rounded-lg border border-slate-300 px-3 text-sm font-normal text-slate-900" />
                          </label>
                          <label className="text-xs font-bold text-slate-600">Jenis pengisian
                            <select value={normalized.type} onChange={(event) => updateMatrixColumn(question.id, columnIndex, {
                              type: event.target.value as MatrixColumnType,
                              options: ["SINGLE_CHOICE", "MULTIPLE_CHOICE", "DROPDOWN"].includes(event.target.value) ? (normalized.options.length ? normalized.options : ["Pilihan 1", "Pilihan 2"]) : [],
                            })} className="mt-1 min-h-10 w-full rounded-lg border border-slate-300 px-2 text-sm font-normal text-slate-900">
                              <option value="SINGLE_CHOICE">Tombol opsi</option><option value="MULTIPLE_CHOICE">Checklist</option><option value="DROPDOWN">Dropdown</option><option value="SHORT_TEXT">Jawaban singkat</option><option value="PARAGRAPH">Paragraf</option>
                            </select>
                          </label>
                          <button type="button" disabled={(question.matrixColumns?.length ?? 0) <= 1} onClick={() => removeMatrixColumn(question.id, columnIndex)} className="self-end rounded-lg px-3 py-2 font-bold text-red-700 disabled:opacity-40" aria-label={`Hapus kolom ${columnIndex + 1}`}>Hapus</button>
                        </div>
                        {["SINGLE_CHOICE", "MULTIPLE_CHOICE", "DROPDOWN"].includes(normalized.type) && <label className="block text-xs font-bold text-slate-600">Opsi (satu opsi per baris)
                          <textarea rows={Math.max(4, normalized.options.length)} value={normalized.options.join("\n")} onChange={(event) => updateMatrixColumn(question.id, columnIndex, { options: parseOptionLines(event.target.value) })} className="mt-1 min-h-24 w-full rounded-lg border border-slate-300 p-2 text-sm font-normal text-slate-900" placeholder={"Opsi 1\nOpsi 2\nOpsi 3"} />
                        </label>}
                      </div>;
                    })()
                  ))}
                </div>
                <Button type="button" secondary className="mt-2" disabled={(question.matrixColumns?.length ?? 0) >= 50} onClick={() => addMatrixColumn(question.id)}>Tambah kolom</Button>
              </div>
            </div>}
            {quizMode && <label className="block text-sm font-semibold">Bobot nilai
              <input type="number" min="0" value={question.scoreWeight ?? 1} onChange={(event) => updateQuestion(question.id, { scoreWeight: Number(event.target.value) })} className="mt-1 min-h-10 w-32 rounded-lg border border-slate-300 px-2" />
            </label>}
            {quizMode && question.type === "SHORT_TEXT" && <label className="block text-sm font-semibold">Kunci jawaban
              <input value={typeof question.answerKey === "string" ? question.answerKey : ""} onChange={(event) => updateQuestion(question.id, { answerKey: event.target.value || undefined })} className="mt-1 min-h-10 w-full rounded-lg border border-slate-300 px-3" placeholder="Jawaban benar" />
            </label>}
            {quizMode && question.type === "NUMBER" && <label className="block text-sm font-semibold">Kunci jawaban angka
              <input type="number" value={typeof question.answerKey === "number" ? question.answerKey : ""} onChange={(event) => updateQuestion(question.id, { answerKey: event.target.value === "" ? undefined : Number(event.target.value) })} className="mt-1 min-h-10 w-full rounded-lg border border-slate-300 px-3" />
            </label>}
            {quizMode && ["SINGLE_CHOICE", "DROPDOWN"].includes(question.type) && <label className="block text-sm font-semibold">Kunci jawaban
              <select value={typeof question.answerKey === "string" ? question.answerKey : ""} onChange={(event) => updateQuestion(question.id, { answerKey: event.target.value || undefined })} className="mt-1 min-h-10 w-full rounded-lg border border-slate-300 px-3">
                <option value="">Pilih jawaban benar</option>
                {question.options.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>}
            {quizMode && question.type === "MULTIPLE_CHOICE" && <fieldset className="rounded-xl bg-amber-50 p-3">
              <legend className="px-1 text-sm font-bold">Pilih semua jawaban yang benar</legend>
              <div className="space-y-2">{question.options.map((option) => {
                const keys = Array.isArray(question.answerKey) ? question.answerKey : [];
                return <label key={option} className="flex min-h-9 items-center gap-2 text-sm">
                  <input type="checkbox" checked={keys.includes(option)} onChange={(event) => updateQuestion(question.id, { answerKey: event.target.checked ? [...keys, option] : keys.filter((value) => value !== option) })} />
                  {option}
                </label>;
              })}</div>
            </fieldset>}
            {quizMode && question.type === "PARAGRAPH" && <p className="rounded-lg bg-blue-50 p-3 text-sm text-blue-900">Jawaban paragraf memerlukan penilaian manual oleh guru.</p>}
            <button onClick={() => setQuestions((current) => current.filter((item) => item.id !== question.id))} className="text-sm font-bold text-red-700 underline">Hapus pertanyaan</button>
          </fieldset>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button secondary onClick={() => addQuestion("SHORT_TEXT")}><FilePlus2 size={18} />Tambah pertanyaan</Button>
        <Button secondary onClick={() => addQuestion("SINGLE_CHOICE")}>Tambah pilihan ganda</Button>
      </div>
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-800">{error}</p>}
      <div className="flex flex-wrap justify-between gap-3 border-t pt-4">
        <Button secondary onClick={onCancel}>Batal</Button>
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy} secondary onClick={() => void save(false)}>Simpan draf</Button>
          <Button disabled={busy} onClick={() => void save(true)}>Simpan & publikasikan</Button>
        </div>
      </div>
    </section>
  );
}

function FormManagerPreview({ form, onBack, onEdit }: { form: SchoolForm; onBack: () => void; onEdit: () => void }) {
  const questions = form.currentVersion?.schema.questions ?? [];
  return (
    <section className="mx-auto max-w-4xl space-y-6 rounded-3xl bg-white p-5 shadow sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-bold text-school-700">PRATINJAU FORMULIR</p>
          <h2 className="mt-1 text-2xl font-black">{form.title}</h2>
          <p className="mt-2 text-sm text-slate-600">{form.description || "Tidak ada keterangan."}</p>
          <p className="mt-2 text-sm font-semibold text-slate-600">
            {form.status === "PUBLISHED" ? "Dipublikasikan" : "Draf"} · {questions.length} pertanyaan · versi {form.currentVersion?.versionNumber ?? "-"}
          </p>
        </div>
        <div className="flex gap-2">
          <Button type="button" secondary onClick={onBack}><ArrowLeft size={18} />Kembali</Button>
          <Button type="button" onClick={onEdit}><Pencil size={18} />Edit formulir</Button>
        </div>
      </div>
      {form.quizMode && <p className="rounded-xl bg-amber-50 p-3 font-semibold text-amber-900">Mode kuis aktif</p>}
      {questions.length === 0 ? <p className="rounded-xl bg-slate-50 p-5 text-slate-600">Formulir ini belum memiliki pertanyaan.</p> : (
        <div className="space-y-4">
          {questions.map((question, index) => (
            <fieldset key={question.id} className="space-y-3 rounded-2xl border border-slate-200 p-4">
              <legend className="px-2 font-bold">{index + 1}. {question.title}{question.required && <span className="text-red-700"> *</span>}</legend>
              {form.quizMode && question.media && <QuestionMediaView media={question.media} />}
              {question.type === "MATRIX" ? (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left">
                    <thead><tr className="bg-slate-100">{(question.matrixColumns ?? []).map((column, columnIndex) => <th key={columnIndex} className="p-3">{normalizeMatrixColumn(column, columnIndex).label}</th>)}<th className="p-3">Dokumen</th><th className="p-3">Aksi</th></tr></thead>
                    <tbody><tr className="border-t">{(question.matrixColumns ?? []).map((column, columnIndex) => <td key={columnIndex} className="p-3"><span className="block min-h-10 rounded-lg border border-slate-300 bg-slate-50" aria-label={normalizeMatrixColumn(column, columnIndex).label} /></td>)}<td className="p-3 text-sm text-slate-500">JPG, PNG, PDF</td><td className="p-3 text-sm text-slate-500">Tambah · Edit · Hapus</td></tr></tbody>
                  </table>
                </div>
              ) : ["SINGLE_CHOICE", "MULTIPLE_CHOICE", "DROPDOWN"].includes(question.type) ? (
                <div className="space-y-2">{(question.options ?? []).map((option, optionIndex) => <div key={optionIndex} className="rounded-lg border border-slate-200 p-3">{question.type === "MULTIPLE_CHOICE" ? "□ " : "○ "}{option}</div>)}</div>
              ) : question.type === "PARAGRAPH" ? (
                <div className="min-h-24 rounded-lg border border-slate-300 bg-slate-50" />
              ) : (
                <div className="min-h-11 rounded-lg border border-slate-300 bg-slate-50" />
              )}
            </fieldset>
          ))}
        </div>
      )}
    </section>
  );
}

type FormReportRow = {
  studentId: string;
  name: string;
  className: string;
  status: "SUBMITTED" | "NOT_SUBMITTED";
  submittedAt: string | null;
  earnedScore?: number | null;
  maximumScore?: number | null;
  percentage?: number | null;
  averagePercentage?: number | null;
  gradeStatus?: string | null;
};

type FormReportData = {
  form: { id: string; title: string; quizMode: boolean };
  summary: { assignedCount: number; submittedCount: number; notSubmittedCount: number; averagePercentage: number | null };
  students: FormReportRow[];
  responses: Array<{
    id: string;
    studentId: string;
    name: string;
    className: string;
    submittedAt: string | null;
    answers: Record<string, unknown>;
    earnedScore: number | null;
    maximumScore: number | null;
    percentage: number | null;
    gradeStatus: string;
  }>;
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};

type StudentSubmissionState = {
  submitted: boolean;
  id?: string;
  submittedAt?: string | null;
  earnedScore?: number | null;
  maximumScore?: number | null;
  percentage?: number | null;
  gradeStatus?: string | null;
};

function FormReport({ form, onBack }: { form: SchoolForm; onBack: () => void }) {
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState("");
  const reportQuery = useQuery({
    queryKey: ["form-report", form.id, page],
    queryFn: () => api<FormReportData>(`/forms/${form.id}/report?page=${page}&pageSize=10`),
  });
  const report = reportQuery.data;
  const submitted = report?.students.filter((student) => student.status === "SUBMITTED") ?? [];
  const notSubmitted = report?.students.filter((student) => student.status === "NOT_SUBMITTED") ?? [];
  const questionsById = new Map((form.currentVersion?.schema.questions ?? []).map((question) => [question.id, question]));
  async function loadAllReportRows(): Promise<{ students: FormReportRow[]; responses: FormReportData["responses"] }> {
    if (!report) return { students: [], responses: [] };
    const students: FormReportRow[] = [];
    const responses: FormReportData["responses"] = [];
    for (let exportPage = 1; exportPage <= report.pagination.totalPages; exportPage += 1) {
      const current = exportPage === page
        ? report
        : await api<FormReportData>(`/forms/${form.id}/report?page=${exportPage}&pageSize=10`);
      students.push(...current.students);
      responses.push(...current.responses);
    }
    return { students, responses };
  }
  async function downloadWorkbook(kind: "submitted" | "not-submitted" | "responses") {
    if (!report || exporting) return;
    setExporting(kind);
    try {
      const rows = await loadAllReportRows();
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet(kind === "responses" ? "Hasil Respons" : kind === "submitted" ? "Sudah Mengerjakan" : "Belum Mengerjakan");
      if (kind === "responses") {
        const answerHeaders = (form.currentVersion?.schema.questions ?? []).map((question) => question.title);
        sheet.addRow(["Nama murid", "Kelas", "Waktu kirim", ...answerHeaders, ...(form.quizMode ? ["Skor akhir", "Persentase"] : []), "File"]);
        for (const response of rows.responses) {
          const answers = (form.currentVersion?.schema.questions ?? []).map((question) => answerText(response.answers[question.id]));
          sheet.addRow([response.name, response.className, response.submittedAt ? new Date(response.submittedAt).toLocaleString("id-ID") : "", ...answers, ...(form.quizMode ? [response.earnedScore ?? "", response.percentage ?? ""] : []), attachments(response.answers).map((file) => file.name).join(", ")]);
        }
      } else {
        sheet.addRow(["Nama murid", "Kelas", "Waktu kirim", ...(form.quizMode ? ["Skor", "Persentase", "Rata-rata"] : [])]);
        for (const student of rows.students.filter((item) => kind === "submitted" ? item.status === "SUBMITTED" : item.status === "NOT_SUBMITTED")) {
          sheet.addRow([student.name, student.className, student.submittedAt ? new Date(student.submittedAt).toLocaleString("id-ID") : "", ...(form.quizMode ? [student.earnedScore ?? "", student.percentage ?? "", student.averagePercentage ?? ""] : [])]);
        }
      }
      sheet.getRow(1).font = { bold: true };
      sheet.views = [{ state: "frozen", ySplit: 1 }];
      sheet.columns.forEach((column) => { column.width = 24; });
      const output = await workbook.xlsx.writeBuffer();
      const url = URL.createObjectURL(new Blob([output], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `${form.title.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase()}-${kind}-${new Date().toISOString().slice(0, 10)}.xlsx`;
      link.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting("");
    }
  }
  function answerText(value: unknown): string {
    if (value === null || value === undefined || value === "") return "—";
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
    if (Array.isArray(value)) return value.map(answerText).join(", ");
    return typeof value === "object" ? JSON.stringify(value) : String(value);
  }
  function answerContent(questionId: string, value: unknown) {
    const question = questionsById.get(questionId);
    if (question?.type !== "MATRIX" || !value || typeof value !== "object" || !("rows" in value) || !Array.isArray(value.rows)) {
      return <span className="whitespace-pre-wrap break-words">{answerText(value)}</span>;
    }
    const columns = (question.matrixColumns ?? []).map((column, index) => normalizeMatrixColumn(column, index));
    return <div className="overflow-x-auto">
      <table className="w-full min-w-[32rem] border-collapse text-xs">
        <thead className="bg-slate-100"><tr>{columns.map((column, index) => <th key={index} className="border border-slate-200 p-2 text-left">{column.label}</th>)}</tr></thead>
        <tbody>{value.rows.map((row: unknown, rowIndex: number) => {
          const cells = row && typeof row === "object" && "cells" in row && Array.isArray(row.cells) ? row.cells : [];
          return <tr key={rowIndex}>{columns.map((column, columnIndex) => <td key={columnIndex} className="border border-slate-200 p-2 align-top whitespace-pre-wrap break-words">{answerText(cells[columnIndex])}</td>)}</tr>;
        })}</tbody>
      </table>
    </div>;
  }
  function attachments(value: unknown): Array<{ name: string; dataUrl: string }> {
    const found: Array<{ name: string; dataUrl: string }> = [];
    function visit(item: unknown) {
      if (!item || typeof item !== "object") return;
      if ("dataUrl" in item && "name" in item && typeof item.dataUrl === "string" && typeof item.name === "string") {
        found.push({ name: item.name, dataUrl: item.dataUrl });
        return;
      }
      if (Array.isArray(item)) item.forEach(visit);
      else Object.values(item).forEach(visit);
    }
    visit(value);
    return found;
  }
  function renderStudents(rows: FormReportRow[], emptyMessage: string) {
    if (!rows.length) return <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">{emptyMessage}</p>;
    return <div className="report-table-scroll overflow-x-auto rounded-xl border border-slate-200">
      <table className="w-full min-w-[36rem] border-collapse text-left text-sm">
        <thead className="bg-slate-100"><tr><th className="p-3">Nama murid</th><th className="p-3">Kelas</th><th className="p-3">Waktu kirim</th>{form.quizMode && <th className="p-3">Skor</th>}</tr></thead>
        <tbody>{rows.map((student) => <tr key={student.studentId} className="border-t border-slate-200">
          <td className="p-3 font-semibold">{student.name}</td>
          <td className="p-3">{student.className}</td>
          <td className="p-3">{student.submittedAt ? new Date(student.submittedAt).toLocaleString("id-ID") : "—"}</td>
          {form.quizMode && <td className="p-3">
            {student.earnedScore !== null && student.earnedScore !== undefined && student.maximumScore !== null && student.maximumScore !== undefined
              ? <>{student.earnedScore} / {student.maximumScore}{student.percentage !== null && student.percentage !== undefined ? ` (${student.percentage.toFixed(1)}%)` : ""}{student.averagePercentage !== null && student.averagePercentage !== undefined ? ` · rata-rata ${student.averagePercentage.toFixed(1)}%` : ""}{student.gradeStatus === "NEEDS_REVIEW" && <span className="ml-1 text-amber-800">· perlu dinilai</span>}</>
              : student.status === "SUBMITTED" ? "Belum ada skor otomatis" : "—"}
          </td>}
        </tr>)}</tbody>
      </table>
    </div>;
  }
  return <section className="mx-auto max-w-5xl space-y-5 rounded-3xl bg-white p-4 shadow sm:p-8">
    <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div><p className="font-bold text-school-700">LAPORAN REKAP MURID</p><h2 className="mt-1 text-2xl font-black">{form.title}</h2><p className="mt-1 text-sm text-slate-600">Daftar pengerjaan dan skor kuis, terpisah dari editor formulir.</p></div>
      <Button type="button" secondary className="w-full sm:w-auto" onClick={onBack}><ArrowLeft size={18} />Kembali</Button>
    </div>
    {reportQuery.isLoading ? <p className="rounded-xl bg-slate-50 p-5 text-slate-600">Memuat laporan…</p>
      : reportQuery.isError ? <div role="alert" className="rounded-xl bg-red-50 p-4 text-red-800">{reportQuery.error.message}<button type="button" className="ml-2 underline" onClick={() => void reportQuery.refetch()}>Coba lagi</button></div>
        : report && <>
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="rounded-xl bg-blue-50 p-4"><p className="text-sm text-blue-900">Murid ditugaskan</p><p className="text-2xl font-black">{report.summary.assignedCount}</p></div>
            <div className="rounded-xl bg-green-50 p-4"><p className="text-sm text-green-900">Sudah mengerjakan</p><p className="text-2xl font-black">{report.summary.submittedCount}</p></div>
            <div className="rounded-xl bg-amber-50 p-4"><p className="text-sm text-amber-900">Belum mengerjakan</p><p className="text-2xl font-black">{report.summary.notSubmittedCount}</p></div>
            {form.quizMode && <div className="rounded-xl bg-violet-50 p-4"><p className="text-sm text-violet-900">Rata-rata skor akhir</p><p className="text-2xl font-black">{report.summary.averagePercentage == null ? "—" : `${report.summary.averagePercentage.toFixed(1)}%`}</p></div>}
          </div>
          <section className="space-y-3"><div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between"><h3 className="text-lg font-black">Sudah mengerjakan ({submitted.length})</h3><Button type="button" secondary className="w-full sm:w-auto" disabled={Boolean(exporting)} onClick={() => void downloadWorkbook("submitted")}><FileDown size={16} />{exporting === "submitted" ? "Mengekspor…" : "Ekspor XLSX"}</Button></div>{renderStudents(submitted, "Belum ada murid yang mengirim jawaban.")}</section>
          <section className="space-y-3"><div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between"><h3 className="text-lg font-black">Belum mengerjakan ({notSubmitted.length})</h3><Button type="button" secondary className="w-full sm:w-auto" disabled={Boolean(exporting)} onClick={() => void downloadWorkbook("not-submitted")}><FileDown size={16} />{exporting === "not-submitted" ? "Mengekspor…" : "Ekspor XLSX"}</Button></div>{renderStudents(notSubmitted, "Semua murid yang ditugaskan sudah mengerjakan.")}</section>
          <section className="space-y-3">
            <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-start sm:justify-between"><div><h3 className="text-lg font-black">Hasil respons ({report.pagination.total})</h3><p className="text-sm text-slate-600">Setiap baris berisi respons terakhir murid dan file dari jawaban tabel yang dapat diunduh.</p></div><Button type="button" secondary className="w-full sm:w-auto" disabled={Boolean(exporting)} onClick={() => void downloadWorkbook("responses")}><FileDown size={16} />{exporting === "responses" ? "Mengekspor…" : "Ekspor XLSX"}</Button></div>
            {report.responses.length === 0 ? <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">Belum ada respons terkirim.</p> : <div className="report-table-scroll overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full min-w-[60rem] border-collapse text-left text-sm">
                <thead className="bg-slate-100"><tr><th className="p-3">Murid</th><th className="p-3">Waktu kirim</th><th className="p-3">Jawaban</th>{form.quizMode && <th className="p-3">Skor akhir</th>}<th className="p-3">File</th></tr></thead>
                <tbody>{report.responses.map((response) => <tr key={response.id} className="border-t border-slate-200 align-top">
                  <td className="p-3"><p className="font-semibold">{response.name}</p><p className="text-xs text-slate-500">{response.className}</p></td>
                  <td className="p-3 whitespace-nowrap">{response.submittedAt ? new Date(response.submittedAt).toLocaleString("id-ID") : "—"}</td>
                  <td className="max-w-[30rem] p-3"><div className="space-y-3">{Object.entries(response.answers).map(([questionId, value]) => <div key={questionId}><p className="mb-1 font-semibold">{questionsById.get(questionId)?.title ?? questionId}</p>{answerContent(questionId, value)}</div>)}</div></td>
                  {form.quizMode && <td className="p-3 whitespace-nowrap">{response.percentage == null ? "—" : `${response.percentage.toFixed(1)}%`}</td>}
                  <td className="p-3"><div className="space-y-1">{attachments(response.answers).map((file) => <a key={`${response.id}-${file.name}`} href={file.dataUrl} download={file.name} className="block text-blue-700 underline">{file.name}</a>)}{attachments(response.answers).length === 0 && "—"}</div></td>
                </tr>)}</tbody>
              </table>
            </div>}
            <div className="flex items-center justify-between rounded-xl bg-slate-50 p-3 text-sm">
              <span>Halaman {report.pagination.page} dari {report.pagination.totalPages} · maksimal 10 baris</span>
              <div className="flex gap-2"><Button type="button" secondary disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Sebelumnya</Button><Button type="button" secondary disabled={page >= report.pagination.totalPages} onClick={() => setPage((value) => value + 1)}>Berikutnya</Button></div>
            </div>
          </section>
        </>}
  </section>;
}

function FormFiller({ form, online, ownerUserId, syncRevision, onBack, onSynced }: { form: CachedForm; online: boolean; ownerUserId: string; syncRevision: number; onBack: () => void; onSynced: () => void }) {
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [scoreResult, setScoreResult] = useState<{ earnedScore: number | null; maximumScore: number | null; percentage: number | null; gradeStatus: string | null } | null>(null);
  const [submissionLocked, setSubmissionLocked] = useState(false);
  const [submissionCheckComplete, setSubmissionCheckComplete] = useState(false);
  const [submissionCheckError, setSubmissionCheckError] = useState("");
  const [submissionCheckRetry, setSubmissionCheckRetry] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [matrixDialog, setMatrixDialog] = useState<{ questionId: string; rowIndex: number | null; row: MatrixResponseRow } | null>(null);
  const [matrixDialogError, setMatrixDialogError] = useState("");
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [draftLoadRetry, setDraftLoadRetry] = useState(0);
  const [status, setStatus] = useState("Memuat draf tersimpan…");
  const [error, setError] = useState("");
  const autosaveTimer = useRef<number | undefined>(undefined);
  const submitInProgress = useRef(false);
  const questions = form.currentVersion?.schema.questions ?? [];
  const versionId = form.currentVersion?.id ?? "";

  useEffect(() => {
    let active = true;
    setDraftLoaded(false);
    setAnswers({});
    setStatus("Memuat draf tersimpan…");
    void offlineDb.draftSubmissions.get(form.id).then((draft) => {
      if (!active) return;
      if (draft) setAnswers(draft.answers);
      setStatus(draft ? "Draf sebelumnya dipulihkan" : "Belum ada jawaban tersimpan");
      setDraftLoaded(true);
    }).catch((cause: unknown) => {
      if (!active) return;
      setStatus("Draf tidak dapat dibaca dari perangkat");
      setError(cause instanceof DOMException && cause.name === "QuotaExceededError"
        ? "Penyimpanan perangkat penuh. Kosongkan ruang sebelum melanjutkan."
        : "Draf lokal tidak dapat dibaca. Jangan tutup halaman sebelum menyalin jawaban.");
    });
    return () => { active = false; };
  }, [draftLoadRetry, form.id]);

  useEffect(() => {
    let active = true;
    setSubmissionCheckComplete(false);
    setSubmissionCheckError("");
    setSubmissionLocked(false);
    setScoreResult(null);
    async function checkSubmission() {
      try {
        let submission: StudentSubmissionState;
        if (online) {
          submission = await api<StudentSubmissionState>(`/student/forms/${form.id}/submission`);
        } else {
          const local = await offlineDb.pendingMutations
            .where("formId")
            .equals(form.id)
            .filter((item) => item.ownerUserId === ownerUserId && item.syncStatus === "SYNCED")
            .first();
          submission = { submitted: Boolean(local) };
        }
        if (!active) return;
        setSubmissionLocked(submission.submitted);
        if (submission.submitted) {
          setStatus(`Jawaban untuk "${form.title}" sudah tersimpan. Formulir ini tidak dapat dikerjakan ulang.`);
        }
        if (submission.submitted && form.quizMode) {
          setScoreResult({
            earnedScore: submission.earnedScore ?? null,
            maximumScore: submission.maximumScore ?? null,
            percentage: submission.percentage ?? null,
            gradeStatus: submission.gradeStatus ?? null,
          });
        }
        setSubmissionCheckComplete(true);
      } catch (cause) {
        if (!active) return;
        setSubmissionCheckError(cause instanceof Error ? cause.message : "Status pengiriman jawaban tidak dapat diperiksa.");
        setSubmissionCheckComplete(true);
      }
    }
    void checkSubmission();
    return () => { active = false; };
  }, [form.id, form.quizMode, online, ownerUserId, submissionCheckRetry, syncRevision]);

  useEffect(() => {
    if (!versionId || !draftLoaded || submissionLocked) return;
    const timeout = window.setTimeout(() => {
      autosaveTimer.current = undefined;
      void offlineDb.draftSubmissions.put({ formId: form.id, formVersionId: versionId, answers, updatedAt: Date.now() })
        .then(() => {
          setStatus("Tersimpan di perangkat");
          setError("");
        })
        .catch((cause: unknown) => {
          setStatus("Draf belum tersimpan");
          setError(cause instanceof DOMException && cause.name === "QuotaExceededError"
            ? "Penyimpanan perangkat penuh. Jawaban terbaru belum tersimpan; kosongkan ruang lalu coba lagi."
            : "Jawaban terbaru belum tersimpan di perangkat. Jangan tutup halaman dan coba lagi.");
        });
    }, 250);
    autosaveTimer.current = timeout;
    return () => {
      window.clearTimeout(timeout);
      if (autosaveTimer.current === timeout) autosaveTimer.current = undefined;
    };
  }, [answers, draftLoaded, form.id, submissionLocked, versionId]);

  function updateAnswer(id: string, value: unknown) {
    setAnswers((current) => ({ ...current, [id]: value }));
    setStatus("Menyimpan…");
  }

  function openMatrixDialog(question: { matrixColumns?: Array<string | MatrixColumn> }, questionId: string, rowIndex: number | null) {
    const columns = (question.matrixColumns ?? []).map((column, index) => normalizeMatrixColumn(column, index));
    const rows = matrixRowsFromAnswer(answers[questionId], columns);
    setError("");
    setMatrixDialogError("");
    setMatrixDialog({
      questionId,
      rowIndex,
      row: rowIndex === null || !rows[rowIndex] ? emptyMatrixRow(columns) : {
        ...rows[rowIndex],
        cells: [...rows[rowIndex].cells],
      },
    });
  }

  function saveMatrixDialog() {
    if (!matrixDialog) return;
    const question = questions.find((item) => item.id === matrixDialog.questionId);
    if (!question) return;
    const columns = (question.matrixColumns ?? []).map((column, index) => normalizeMatrixColumn(column, index));
    const rows = matrixRowsFromAnswer(answers[matrixDialog.questionId], columns);
    if (matrixDialog.rowIndex === null && rows.length >= 50) {
      setMatrixDialogError("Tabel dibatasi maksimal 50 baris jawaban.");
      return;
    }
    if (matrixDialog.row.cells.length !== columns.length || (question.required && matrixDialog.row.cells.some((cell) =>
      Array.isArray(cell) ? cell.length === 0 : !cell.trim(),
    ))) {
      setMatrixDialogError("Lengkapi semua kolom sebelum menyimpan baris.");
      return;
    }
    if (matrixDialog.rowIndex === null) rows.push(matrixDialog.row);
    else rows[matrixDialog.rowIndex] = matrixDialog.row;
    updateAnswer(matrixDialog.questionId, { rows });
    setMatrixDialog(null);
    setMatrixDialogError("");
  }

  function deleteMatrixRow(question: { matrixColumns?: Array<string | MatrixColumn> }, questionId: string, rowIndex: number) {
    if (!window.confirm(`Hapus baris jawaban ${rowIndex + 1} beserta dokumen yang dilampirkan?`)) return;
    const columns = (question.matrixColumns ?? []).map((column, index) => normalizeMatrixColumn(column, index));
    const rows = matrixRowsFromAnswer(answers[questionId], columns).filter((_, index) => index !== rowIndex);
    updateAnswer(questionId, { rows });
  }

  async function uploadMatrixDocument(file: File | undefined) {
    if (!file || !matrixDialog) return;
    const allowedTypes = ["image/jpeg", "image/png", "application/pdf"] as const;
    if (!allowedTypes.includes(file.type as typeof allowedTypes[number])) {
      setMatrixDialogError("Dokumen harus berformat JPG, PNG, atau PDF.");
      return;
    }
    if (file.name.length > 255) {
      setMatrixDialogError("Nama dokumen terlalu panjang.");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setMatrixDialogError("Ukuran dokumen maksimal 2 MB per baris.");
      return;
    }
    const currentAttachmentSize = questions.reduce((total, question) => {
      if (question.type !== "MATRIX") return total;
      const columns = (question.matrixColumns ?? []).map((column, index) => normalizeMatrixColumn(column, index));
      return total + matrixRowsFromAnswer(answers[question.id], columns)
        .reduce((size, row) => size + (row.attachment?.dataUrl.length ?? 0), 0);
    }, 0) - (matrixDialog.row.attachment?.dataUrl.length ?? 0);
    if (currentAttachmentSize + file.size * 1.4 > 12 * 1024 * 1024) {
      setMatrixDialogError("Total lampiran pada jawaban tabel maksimal 12 MB.");
      return;
    }
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("Dokumen gagal dibaca. Pilih file lain."));
        reader.onload = () => typeof reader.result === "string"
          ? resolve(reader.result)
          : reject(new Error("Dokumen tidak dapat dipratinjau."));
        reader.readAsDataURL(file);
      });
      setMatrixDialog((current) => current ? {
        ...current,
        row: { ...current.row, attachment: { name: file.name, mimeType: file.type as MatrixAttachment["mimeType"], dataUrl } },
      } : current);
      setMatrixDialogError("");
    } catch (cause) {
      setMatrixDialogError(cause instanceof Error ? cause.message : "Dokumen tidak dapat dibaca.");
    }
  }

  async function submit() {
    if (submissionLocked || submitInProgress.current) return;
    setError("");
    if (!draftLoaded) {
      setError("Draf belum berhasil dibaca dari perangkat. Coba muat ulang draf sebelum mengirim.");
      return;
    }
    const missing = questions.find((question) => question.required && (
      question.type === "MATRIX"
        ? (() => {
          const columns = (question.matrixColumns ?? []).map((column, index) => normalizeMatrixColumn(column, index));
          const rows = matrixRowsFromAnswer(answers[question.id], columns);
          return rows.length === 0 || rows.some((row) => row.cells.some((cell) =>
            Array.isArray(cell) ? cell.length === 0 : !cell.trim(),
          ));
        })()
        : answers[question.id] === undefined || answers[question.id] === "" ||
          (Array.isArray(answers[question.id]) && (answers[question.id] as unknown[]).length === 0)
    ));
    if (missing) {
      setError(`Jawaban "${missing.title}" wajib diisi.`);
      return;
    }
    if (!versionId) {
      setError("Versi formulir belum tersedia di perangkat. Sambungkan ke internet terlebih dahulu.");
      return;
    }
    if (autosaveTimer.current !== undefined) {
      window.clearTimeout(autosaveTimer.current);
      autosaveTimer.current = undefined;
    }
    const mutation = {
      clientMutationId: crypto.randomUUID(),
      ownerUserId,
      formId: form.id,
      formVersionId: versionId,
      answers,
      createdAt: Date.now(),
      syncStatus: "PENDING" as const,
    };
    submitInProgress.current = true;
    setSubmitting(true);
    if (!online) {
      try {
        await offlineDb.pendingMutations.put(mutation);
        setStatus("Menunggu koneksi untuk dikirim");
        setError("");
        onSynced();
      } catch (cause) {
        setStatus("Jawaban belum tersimpan untuk dikirim");
        setError(cause instanceof DOMException && cause.name === "QuotaExceededError"
          ? "Penyimpanan perangkat penuh. Jawaban belum masuk antrean; kosongkan ruang dan coba lagi."
          : "Jawaban belum masuk antrean. Jangan tutup halaman dan coba lagi.");
      } finally {
        submitInProgress.current = false;
        setSubmitting(false);
      }
      return;
    }
    setStatus("Mengirim jawaban…");
    try {
      const result = await api<{
        earnedScore?: number | null;
        maximumScore?: number | null;
        percentage?: number | null;
        gradeStatus?: string | null;
      }>("/submissions/sync", { method: "POST", body: JSON.stringify({
        formVersionId: versionId,
        answers,
        clientMutationId: mutation.clientMutationId,
      }) });
      if (form.quizMode) {
        setScoreResult({
          earnedScore: result.earnedScore ?? null,
          maximumScore: result.maximumScore ?? null,
          percentage: result.percentage ?? null,
          gradeStatus: result.gradeStatus ?? null,
        });
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Pengiriman gagal.";
      const alreadySubmitted = cause instanceof ApiError && cause.status === 409 && message.includes("FORM_ALREADY_SUBMITTED");
      if (alreadySubmitted) {
        setSubmissionLocked(true);
        setStatus(`Jawaban untuk "${form.title}" sudah tersimpan. Formulir ini tidak dapat dikerjakan ulang.`);
        setError(`Pemberitahuan: jawaban untuk "${form.title}" sudah tersimpan sebelumnya dan tidak dapat dikirim atau dikerjakan ulang.`);
        try {
          await offlineDb.draftSubmissions.delete(form.id);
        } catch {
          setError("Jawaban sudah terkirim, tetapi draf lokal belum terhapus dari perangkat.");
        }
        submitInProgress.current = false;
        setSubmitting(false);
        onSynced();
        return;
      }
      try {
        const conflict = cause instanceof ApiError && cause.status === 409;
        await offlineDb.pendingMutations.put({
          ...mutation,
          syncStatus: conflict ? "CONFLICT" : "FAILED",
          lastError: message,
        });
        setStatus(conflict ? "Pengiriman perlu ditinjau" : "Gagal mengirim — jawaban menunggu sinkronisasi");
        setError(conflict
          ? `${message} Jawaban tetap tersimpan di perangkat dan tidak akan dikirim ulang otomatis. Hubungi admin untuk memeriksa status jawaban sebelum mengirim ulang.`
          : `${message} Jawaban tersimpan di perangkat; coba sinkronkan lagi.`);
      } catch (storageError) {
        setStatus("Jawaban belum tersimpan untuk dikirim");
        setError(storageError instanceof DOMException && storageError.name === "QuotaExceededError"
          ? "Koneksi gagal dan penyimpanan perangkat penuh. Jawaban belum aman tersimpan; jangan tutup halaman."
          : "Koneksi gagal dan antrean lokal tidak dapat disimpan. Jangan tutup halaman.");
      }
      onSynced();
      submitInProgress.current = false;
      setSubmitting(false);
      return;
    }
    setSubmissionLocked(true);
    setStatus("Sudah terkirim ke server");
    try {
      await offlineDb.draftSubmissions.delete(form.id);
    } catch {
      setError("Jawaban sudah terkirim ke server, tetapi draf lokal belum terhapus dari perangkat.");
    }
    submitInProgress.current = false;
    setSubmitting(false);
    onSynced();
  }

  return (
    <section className="mx-auto max-w-3xl rounded-3xl bg-white p-5 shadow sm:p-8">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div><p className="text-sm font-bold text-school-700">FORMULIR</p><h2 className="text-2xl font-black">{form.title}</h2></div>
        <Button secondary onClick={onBack}>Kembali</Button>
      </div>
      {form.currentVersion && questions.length > 0 && <div className="mb-5 h-2 overflow-hidden rounded-full bg-slate-100" aria-label={`Jumlah pertanyaan: ${questions.length}`}><div className="h-full w-full bg-amber-400" /></div>}
      <div className="space-y-6">
        {questions.map((question, index) => (
          <fieldset key={question.id} className="space-y-2">
            <legend className="mb-2 text-lg font-bold">{index + 1}. {question.title} {question.required && <span className="text-red-700" aria-label="wajib">*</span>}</legend>
            {form.quizMode && question.media && <div className="mb-3"><QuestionMediaView media={question.media} /></div>}
            {question.type === "MATRIX" ? (
              (() => {
                const columns = (question.matrixColumns ?? []).map((column, columnIndex) => normalizeMatrixColumn(column, columnIndex));
                const rows = matrixRowsFromAnswer(answers[question.id], columns);
                return <div className="space-y-3">
                  <div className="overflow-x-auto rounded-xl border border-slate-200">
                    <table className="w-full border-collapse text-left">
                      <thead className="bg-slate-100">
                        <tr>
                          <th scope="col" className="min-w-16 border-b border-slate-200 p-3">No.</th>
                          {columns.map((column, columnIndex) => <th key={columnIndex} scope="col" className="min-w-40 border-b border-slate-200 p-3">{column.label}</th>)}
                          <th scope="col" className="min-w-36 border-b border-slate-200 p-3">Dokumen</th>
                          <th scope="col" className="min-w-24 border-b border-slate-200 p-3">Aksi</th>
                        </tr>
                      </thead>
                      <tbody>{rows.map((row, rowIndex) => <tr key={rowIndex} className="border-b border-slate-200 last:border-0">
                        <th scope="row" className="p-3 font-semibold">{rowIndex + 1}</th>
                        {columns.map((column, columnIndex) => <td key={columnIndex} className="p-3">
                          <span className="block max-w-48 truncate text-sm" title={Array.isArray(row.cells[columnIndex]) ? (row.cells[columnIndex] as string[]).join(", ") : String(row.cells[columnIndex] ?? "")}>
                            {Array.isArray(row.cells[columnIndex]) ? (row.cells[columnIndex] as string[]).join(", ") : String(row.cells[columnIndex] ?? "") || "—"}
                          </span>
                        </td>)}
                        <td className="p-3">
                          {row.attachment ? <div className="space-y-1">
                            <span className="block max-w-40 truncate text-sm font-semibold" title={row.attachment.name}>{row.attachment.name}</span>
                            <DocumentPreview attachment={row.attachment} compact />
                          </div> : <span className="text-sm text-slate-400">—</span>}
                        </td>
                        <td className="p-3">
                          <div className="flex flex-wrap gap-2">
                            <button type="button" onClick={() => openMatrixDialog(question, question.id, rowIndex)} className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2 font-semibold text-school-700 hover:bg-blue-50" aria-label={`Edit baris jawaban ${rowIndex + 1}`}><Pencil size={15} />Edit</button>
                            <button type="button" onClick={() => deleteMatrixRow(question, question.id, rowIndex)} className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2 font-semibold text-red-700 hover:bg-red-50" aria-label={`Hapus baris jawaban ${rowIndex + 1}`}><Trash2 size={15} />Hapus</button>
                          </div>
                        </td>
                      </tr>)}
                      {rows.length === 0 && <tr><td colSpan={columns.length + 3} className="p-4 text-center text-sm text-slate-500">Belum ada baris jawaban. Tambahkan baris untuk mulai mengisi tabel.</td></tr>}
                      </tbody>
                    </table>
                  </div>
                  <Button
                    type="button"
                    secondary
                    disabled={rows.length >= 50}
                    onClick={() => openMatrixDialog(question, question.id, null)}
                  >
                    Tambah baris
                  </Button>
                  {rows.length >= 50 && <p className="text-sm text-slate-600">Batas 50 baris jawaban telah tercapai.</p>}
                </div>;
              })()
            ) : question.type === "PARAGRAPH" ? (
              <textarea rows={4} value={String(answers[question.id] ?? "")} onChange={(event) => updateAnswer(question.id, event.target.value)} className="w-full rounded-xl border border-slate-300 p-3" aria-label={question.title} />
            ) : ["SINGLE_CHOICE", "DROPDOWN"].includes(question.type) ? (
              <div className="space-y-2">{(question.options ?? []).map((option) => (
                <label key={option} className="flex min-h-12 items-center gap-3 rounded-xl border border-slate-200 p-3">
                  <input type="radio" name={question.id} checked={answers[question.id] === option} onChange={() => updateAnswer(question.id, option)} className="h-5 w-5" />{option}
                </label>
              ))}</div>
            ) : question.type === "MULTIPLE_CHOICE" ? (
              <div className="space-y-2">{(question.options ?? []).map((option) => {
                const selected = Array.isArray(answers[question.id]) ? answers[question.id] as string[] : [];
                return <label key={option} className="flex min-h-12 items-center gap-3 rounded-xl border border-slate-200 p-3">
                  <input type="checkbox" checked={selected.includes(option)} onChange={(event) => updateAnswer(question.id, event.target.checked ? [...selected, option] : selected.filter((value) => value !== option))} className="h-5 w-5" />{option}
                </label>;
              })}</div>
            ) : (
              <input type={question.type === "NUMBER" ? "number" : "text"} value={String(answers[question.id] ?? "")} onChange={(event) => updateAnswer(question.id, question.type === "NUMBER" ? (event.target.value === "" ? "" : Number(event.target.value)) : event.target.value)} className="min-h-12 w-full rounded-xl border border-slate-300 px-3" />
            )}
          </fieldset>
        ))}
      </div>
      {matrixDialog && (() => {
        const question = questions.find((item) => item.id === matrixDialog.questionId);
        const columns = (question?.matrixColumns ?? []).map((column, columnIndex) => normalizeMatrixColumn(column, columnIndex));
        if (!question) return null;
        const attachment = matrixDialog.row.attachment;
        return <div className="fixed inset-0 z-30 flex items-center justify-center overflow-y-auto bg-slate-950/50 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setMatrixDialog(null); }}>
          <section role="dialog" aria-modal="true" aria-labelledby="matrix-row-title" className="my-6 max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl sm:p-7">
            <div className="mb-5 flex items-start justify-between gap-3">
              <div><h3 id="matrix-row-title" className="text-xl font-black">{matrixDialog.rowIndex === null ? "Tambah baris jawaban" : `Edit baris ${matrixDialog.rowIndex + 1}`}</h3><p className="mt-1 text-sm text-slate-600">{question.title}</p></div>
              <button type="button" aria-label="Tutup" className="rounded-lg p-2 hover:bg-slate-100" onClick={() => setMatrixDialog(null)}><X size={20} /></button>
            </div>
            <div className="space-y-4">
              {columns.map((column, columnIndex) => {
                const cell = matrixDialog.row.cells[columnIndex] ?? (column.type === "MULTIPLE_CHOICE" ? [] : "");
                const selectedValues = Array.isArray(cell) ? cell : [];
                return <fieldset key={columnIndex} className="space-y-2 rounded-xl border border-slate-200 p-3">
                  <legend className="px-1 font-bold">{column.label}</legend>
                  {column.type === "SINGLE_CHOICE" ? <div className="space-y-2">{column.options.map((option) => <label key={option} className="flex min-h-10 items-center gap-2">
                    <input type="radio" name={`matrix-${matrixDialog.questionId}-${columnIndex}`} checked={cell === option} onChange={() => setMatrixDialog((current) => current ? { ...current, row: { ...current.row, cells: current.row.cells.map((value, index) => index === columnIndex ? option : value) } } : current)} />{option}
                  </label>)}</div>
                    : column.type === "MULTIPLE_CHOICE" ? <div className="space-y-2">{column.options.map((option) => <label key={option} className="flex min-h-10 items-center gap-2">
                      <input type="checkbox" checked={selectedValues.includes(option)} onChange={(event) => {
                        const next = event.target.checked ? [...selectedValues, option] : selectedValues.filter((value) => value !== option);
                        setMatrixDialog((current) => current ? { ...current, row: { ...current.row, cells: current.row.cells.map((value, index) => index === columnIndex ? next : value) } } : current);
                      }} />{option}
                    </label>)}</div>
                      : column.type === "DROPDOWN" ? <select value={typeof cell === "string" ? cell : ""} onChange={(event) => setMatrixDialog((current) => current ? { ...current, row: { ...current.row, cells: current.row.cells.map((value, index) => index === columnIndex ? event.target.value : value) } } : current)} className="min-h-11 w-full rounded-lg border border-slate-300 px-3">
                        <option value="">Pilih jawaban</option>{column.options.map((option) => <option key={option} value={option}>{option}</option>)}
                      </select>
                        : column.type === "PARAGRAPH" ? <textarea rows={3} maxLength={10000} value={typeof cell === "string" ? cell : ""} onChange={(event) => setMatrixDialog((current) => current ? { ...current, row: { ...current.row, cells: current.row.cells.map((value, index) => index === columnIndex ? event.target.value : value) } } : current)} className="w-full rounded-lg border border-slate-300 p-3" aria-label={column.label} />
                          : <input type="text" maxLength={10000} value={typeof cell === "string" ? cell : ""} onChange={(event) => setMatrixDialog((current) => current ? { ...current, row: { ...current.row, cells: current.row.cells.map((value, index) => index === columnIndex ? event.target.value : value) } } : current)} className="min-h-11 w-full rounded-lg border border-slate-300 px-3" aria-label={column.label} />}
                </fieldset>;
              })}
              <section className="space-y-3 rounded-xl border border-dashed border-slate-300 p-4">
                <h4 className="font-bold">Dokumen pendukung (opsional)</h4>
                <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border border-slate-300 px-3 font-semibold hover:bg-slate-50">
                  <FileUp size={18} />{attachment ? "Ganti dokumen" : "Upload JPG, PNG, atau PDF"}
                  <input type="file" accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf" className="sr-only" onChange={(event) => {
                    void uploadMatrixDocument(event.currentTarget.files?.[0]);
                    event.currentTarget.value = "";
                  }} />
                </label>
                {attachment && <div className="space-y-2 rounded-lg bg-slate-50 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="max-w-[70%] truncate font-semibold" title={attachment.name}>{attachment.name}</span>
                    <button type="button" className="font-semibold text-red-700 underline" onClick={() => setMatrixDialog((current) => current ? { ...current, row: { ...current.row, attachment: null } } : current)}>Hapus dokumen</button>
                  </div>
                  <DocumentPreview attachment={attachment} />
                </div>}
                <p className="text-xs text-slate-500">Format JPG/PNG/PDF, maksimal 2 MB per dokumen. Dokumen akan disimpan bersama jawaban.</p>
              </section>
              {matrixDialogError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{matrixDialogError}</p>}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button type="button" secondary onClick={() => setMatrixDialog(null)}>Batal</Button>
              <Button type="button" onClick={saveMatrixDialog}>Simpan baris</Button>
            </div>
          </section>
        </div>;
      })()}
      <div className="mt-7 flex flex-wrap items-center justify-between gap-3 border-t pt-5">
        <p className="text-sm font-semibold text-slate-600" aria-live="polite">{status}</p>
        <Button
          onClick={() => void submit()}
          disabled={submissionLocked || submitting || !submissionCheckComplete}
        >
          {submissionLocked ? "Jawaban sudah terkirim" : submitting ? "Mengirim…" : "Kirim jawaban"}
        </Button>
      </div>
      {scoreResult && form.quizMode && <section className="mt-5 rounded-2xl border border-green-200 bg-green-50 p-5" role="status">
        <h3 className="text-lg font-black text-green-950">Skor kuis</h3>
        {scoreResult.maximumScore !== null && scoreResult.maximumScore > 0
          ? <p className="mt-1 text-2xl font-black text-green-900">{scoreResult.earnedScore ?? 0} / {scoreResult.maximumScore} · {scoreResult.percentage === null ? "—" : `${scoreResult.percentage.toFixed(1)}%`}</p>
          : <p className="mt-1 text-sm text-green-900">Belum ada soal berbobot nilai otomatis.</p>}
        {scoreResult.gradeStatus === "NEEDS_REVIEW" && <p className="mt-2 text-sm text-green-900">Skor ini belum final karena ada jawaban yang memerlukan penilaian guru.</p>}
      </section>}
      {error && <div role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-800">
        <p>{error}</p>
        {!draftLoaded && <button type="button" className="mt-2 font-bold underline" onClick={() => { setError(""); setDraftLoadRetry((value) => value + 1); }}>Coba baca draf lagi</button>}
      </div>}
    </section>
  );
}

export default function Home() {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [ready, setReady] = useState(false);
  const [sessionNotice, setSessionNotice] = useState("");
  const [online, setOnline] = useState(true);
  const [selected, setSelected] = useState<CachedForm | null>(null);
  const [creating, setCreating] = useState(false);
  const [previewForm, setPreviewForm] = useState<SchoolForm | null>(null);
  const [reportForm, setReportForm] = useState<SchoolForm | null>(null);
  const [editingForm, setEditingForm] = useState<SchoolForm | null>(null);
  const [managingStudents, setManagingStudents] = useState(false);
  const [syncMessage, setSyncMessage] = useState("");
  const [formActionError, setFormActionError] = useState("");
  const [deletingFormId, setDeletingFormId] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [conflictCount, setConflictCount] = useState(0);
  const [unownedPendingCount, setUnownedPendingCount] = useState(0);
  const [syncRevision, setSyncRevision] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const isStudent = user?.role === "STUDENT";

  useEffect(() => {
    let active = true;
    setOnline(navigator.onLine);
    void restoreSession().then((restoredUser) => {
      if (!active) return;
      setUser(restoredUser);
      setReady(true);
    }).catch((cause: unknown) => {
      if (!active) return;
      setSessionNotice(cause instanceof Error ? cause.message : "Sesi tidak dapat dipulihkan. Silakan coba masuk kembali.");
      setUser(null);
      setReady(true);
    });
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js").catch((error: unknown) => {
        console.error("Service worker tidak dapat didaftarkan:", error);
      });
    }
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    const onSessionExpired = () => {
      setUser(null);
      setSessionNotice("Sesi Anda berakhir. Silakan masuk kembali dengan akun yang sesuai.");
      setSelected(null);
      setCreating(false);
      setManagingStudents(false);
    };
    window.addEventListener("sdn268:session-expired", onSessionExpired);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("sdn268:session-expired", onSessionExpired);
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!ready || window.location.pathname !== "/oauth/complete") return;
    void api<{ accessToken: string }>("/auth/refresh", { method: "POST" })
      .then(async (result) => {
        const currentUser = await api<SessionUser>("/auth/me", { headers: { Authorization: `Bearer ${result.accessToken}` } });
        setSession(result.accessToken, currentUser);
        setUser(currentUser);
        window.history.replaceState({}, "", "/");
      })
      .catch(() => {
        window.history.replaceState({}, "", "/login?error=session_failed");
      });
  }, [ready]);

  const query = useQuery({
    queryKey: ["forms", user?.id, refresh],
    enabled: Boolean(user),
    queryFn: async () => {
      try {
        const forms = await api<SchoolForm[]>("/forms");
        const cached: CachedForm[] = forms.map((form) => ({ ...form, cachedAt: Date.now() }));
        await offlineDb.cachedForms.bulkPut(cached);
        return cached;
      } catch (error) {
        if (navigator.onLine) throw error;
        return offlineDb.cachedForms.orderBy("cachedAt").reverse().toArray();
      }
    },
  });

  const updatePendingCount = useCallback(async () => {
    const items = await offlineDb.pendingMutations.toArray();
    setPendingCount(items.filter((item) =>
      item.ownerUserId === user?.id && (item.syncStatus === "PENDING" || item.syncStatus === "FAILED"),
    ).length);
    setConflictCount(items.filter((item) => item.ownerUserId === user?.id && item.syncStatus === "CONFLICT").length);
    setUnownedPendingCount(items.filter((item) =>
      !item.ownerUserId && (item.syncStatus === "PENDING" || item.syncStatus === "FAILED" || item.syncStatus === "CONFLICT"),
    ).length);
  }, [user?.id]);

  const runSync = useCallback(async () => {
    if (user?.role !== "STUDENT") return;
    if (!navigator.onLine) {
      setSyncMessage("Perangkat masih offline. Jawaban tetap tersimpan di perangkat.");
      return;
    }
    const result = await syncPending(user.id, async (item) => {
      await api("/submissions/sync", { method: "POST", body: JSON.stringify({
        formVersionId: item.formVersionId,
        answers: item.answers,
        clientMutationId: item.clientMutationId,
      }) });
    });
    setSyncMessage(result.conflicts
      ? `${result.synced} terkirim, ${result.conflicts} perlu ditinjau dan tidak dicoba ulang otomatis, ${result.failed} masih menunggu.`
      : result.failed
        ? `${result.synced} terkirim, ${result.failed} masih menunggu.`
        : result.synced ? `${result.synced} jawaban berhasil dikirim ke server.` : "Tidak ada jawaban yang menunggu.");
    await updatePendingCount();
  }, [updatePendingCount, user]);

  useEffect(() => {
    void updatePendingCount();
  }, [updatePendingCount, refresh]);

  useEffect(() => {
    if (online && user?.role === "STUDENT") void runSync();
  }, [online, user, runSync]);

  const forms = query.data ?? [];
  const draftsCount = useMemo(() => forms.length, [forms]);

  if (!ready) return <main className="p-10 text-center">Memuat…</main>;
  if (!user) return <Login sessionNotice={sessionNotice} onLogin={(nextUser) => { setSessionNotice(""); setUser(nextUser); setReady(true); }} />;
  if (user.firstLogin && isStudent) return <InitialPassword onChanged={() => setUser({ ...user, firstLogin: false })} />;

  function logout() {
    void api("/auth/logout", { method: "POST" }).catch(() => undefined);
    clearSession();
    setUser(null);
  }

  async function deleteForm(form: SchoolForm) {
    if (!window.confirm(`Hapus formulir "${form.title}"? Formulir tidak akan lagi tampil di daftar, tetapi data jawaban yang sudah masuk tetap disimpan.`)) return;
    setFormActionError("");
    setDeletingFormId(form.id);
    try {
      await api(`/forms/${form.id}`, { method: "DELETE" });
      if (previewForm?.id === form.id) setPreviewForm(null);
      await queryClient.invalidateQueries({ queryKey: ["forms"] });
    } catch (cause) {
      setFormActionError(cause instanceof Error ? cause.message : "Formulir tidak dapat dihapus.");
    } finally {
      setDeletingFormId(null);
    }
  }

  if (selected) {
    return <main className="min-h-screen p-4 sm:p-8"><FormFiller form={selected} online={online} ownerUserId={user.id} syncRevision={syncRevision} onBack={() => setSelected(null)} onSynced={() => { setSyncRevision((value) => value + 1); setRefresh((value) => value + 1); void updatePendingCount(); }} /></main>;
  }

  return (
    <main className="ds-aurora min-h-screen">
      <header className="sticky top-0 z-10 bg-school-700 text-white shadow">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4 pr-32 sm:pr-36">
          <div className="flex items-center gap-3"><img src="/logo-sdn-268.png" alt="Logo SDN 268 Panyileukan" className="h-10 w-10 rounded-full bg-slate-950 object-contain p-1 ring-1 ring-white/30" /><div><h1 className="text-lg font-black sm:text-xl">Portal SDN 268 Panyileukan</h1><p className="text-sm text-blue-100">{user.name} · {user.role === "STUDENT" ? "Murid" : user.role === "TEACHER" ? "Guru" : "Admin"}</p></div></div>
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm font-bold ${online ? "bg-green-700" : "bg-amber-500 text-slate-950"}`}><span className={`h-2 w-2 rounded-full ${online ? "bg-green-200" : "bg-slate-900"}`} />{online ? <><Wifi size={16} />Online</> : <><CloudOff size={16} />Offline</>}</span>
            <button onClick={logout} className="inline-flex min-h-11 items-center gap-2 rounded-xl px-3 font-bold hover:bg-blue-600"><LogOut size={18} />Keluar</button>
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-6xl p-4 py-7 sm:p-8">
        {managingStudents ? <StudentsPanel onBack={() => setManagingStudents(false)} /> : reportForm ? <FormReport form={reportForm} onBack={() => setReportForm(null)} /> : creating ? <Builder
          editingForm={editingForm}
          onCancel={() => { setCreating(false); setEditingForm(null); }}
          onSaved={() => { setCreating(false); setEditingForm(null); setRefresh((value) => value + 1); void queryClient.invalidateQueries({ queryKey: ["forms"] }); }}
        /> : previewForm ? <FormManagerPreview
          form={previewForm}
          onBack={() => setPreviewForm(null)}
          onEdit={() => { setEditingForm(previewForm); setPreviewForm(null); setCreating(true); }}
        /> : (
          <>
            <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
              <div><p className="font-bold uppercase tracking-wider text-secondary">{isStudent ? "RUANG MURID" : "RUANG PENGELOLA"}</p><h2 className="ds-title mt-1 text-3xl font-black">{isStudent ? "Formulir untuk dikerjakan" : "Formulir & kuis"}</h2><p className="mt-1 text-[var(--ds-text-secondary)]">{isStudent ? "Pilih formulir untuk mulai mengerjakan." : "Buat formulir baru atau kelola formulir yang sudah ada."}</p></div>
              {!isStudent && <div className="flex flex-wrap gap-2">{(user.role === "SUPER_ADMIN" || user.role === "ADMIN") && <Button secondary onClick={() => setManagingStudents(true)}><Users size={18} />Data murid</Button>}<Button onClick={() => setCreating(true)}><FilePlus2 size={18} />Buat formulir</Button></div>}
            </div>
            {isStudent && (
              <div className="ds-glass mb-5 flex flex-wrap items-center justify-between gap-3 p-4">
                <div>
                  <p className="font-bold">{pendingCount ? `${pendingCount} jawaban menunggu dikirim` : conflictCount ? `${conflictCount} jawaban perlu ditinjau` : unownedPendingCount ? "Ada jawaban dari sesi sebelumnya yang belum tersinkron" : "Semua jawaban sudah tersinkron"}</p>
                  {conflictCount > 0 && <p className="text-sm text-red-800" role="alert">{conflictCount} jawaban ditolak server karena konflik kunci pengiriman. Jawaban tetap tersimpan lokal dan tidak dicoba ulang otomatis. Periksa status jawaban dengan admin sebelum mengirim ulang.</p>}
                  {unownedPendingCount > 0 && <p className="text-sm text-amber-800" role="status">{unownedPendingCount} jawaban dari sesi lama tetap tersimpan di perangkat, tetapi tidak dikirim otomatis karena pemiliknya tidak diketahui. Periksa kembali isinya sebelum mengirim ulang.</p>}
                  {syncMessage && <p className="text-sm text-slate-600" aria-live="polite">{syncMessage}</p>}
                </div>
                <Button secondary onClick={() => void runSync()}><RefreshCw size={17} />Sinkronkan sekarang</Button>
              </div>
            )}
            {formActionError && <p role="alert" className="mb-4 rounded-xl bg-red-50 p-4 text-sm text-red-800">{formActionError}</p>}
            {query.isLoading ? <div className="ds-glass p-10 text-center text-[var(--ds-text-secondary)]">Memuat daftar formulir…</div> :
              query.isError ? <div role="alert" className="rounded-2xl bg-red-50 p-5 text-red-800">{query.error.message}<button className="ml-2 underline" onClick={() => void query.refetch()}>Coba lagi</button></div> :
              draftsCount === 0 ? <div className="rounded-2xl border-2 border-dashed border-slate-300 bg-white p-12 text-center"><FileText className="mx-auto text-slate-400" size={40} /><h3 className="mt-3 text-xl font-bold">Belum ada formulir</h3><p className="mt-1 text-slate-600">{online ? "Formulir yang tersedia akan muncul di sini." : "Hubungkan ke internet untuk memuat formulir."}</p></div> :
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {forms.filter((form) => isStudent ? form.status === "PUBLISHED" : true).map((form) => (
                  <article
                    key={form.id}
                    className={`ds-card flex flex-col p-5 ${form.submitted ? "opacity-80" : "ds-card-interactive"} ${!isStudent ? "cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500" : ""}`}
                    onClick={!isStudent ? () => setPreviewForm(form) : undefined}
                  >
                    <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-blue-100 text-school-700"><FileText size={23} /></div>
                    <div className="flex-1"><h3 className="text-xl font-black">{form.title}</h3><p className="mt-2 line-clamp-3 text-sm text-[var(--ds-text-secondary)]">{form.description}</p><p className="mt-3 text-sm font-semibold text-[var(--ds-text-muted)]">{form.currentVersion?.schema.questions.length ?? 0} pertanyaan</p></div>
                    {!isStudent && <span className={`mt-3 w-fit rounded-full px-3 py-1 text-xs font-bold ${form.status === "PUBLISHED" ? "bg-green-100 text-green-800" : "bg-slate-100 text-slate-700"}`}>{form.status === "PUBLISHED" ? "Dipublikasikan" : "Draf"}</span>}
                    {isStudent && form.submitted && <span className="ds-status ds-status-success mt-3 w-fit">Sudah tersimpan · tidak dapat dikerjakan ulang</span>}
                    {isStudent ? (
                      <Button
                        disabled={!form.currentVersion || form.submitted}
                        onClick={() => {
                          if (form.submitted) {
                            setSyncMessage(`Jawaban untuk "${form.title}" sudah tersimpan. Formulir yang sama tidak dapat dikerjakan ulang.`);
                            return;
                          }
                          setSelected(form);
                        }}
                      >
                        <CheckCircle2 size={18} />{form.submitted ? "Sudah tersimpan" : "Kerjakan"}
                      </Button>
                    ) : (
                      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm text-[var(--ds-text-secondary)]">
                        <span>{form.quizMode ? "Mode kuis aktif" : "Formulir biasa"} · versi {form.currentVersion?.versionNumber ?? "-"}</span>
                        <div className="flex items-center gap-2">
                          <button type="button" onClick={(event) => { event.stopPropagation(); setReportForm(form); }} className="min-h-10 rounded-lg px-2 font-bold text-school-700 hover:bg-blue-50">Laporan rekap</button>
                          <button type="button" onClick={(event) => { event.stopPropagation(); setPreviewForm(form); }} className="min-h-10 rounded-lg px-2 font-bold text-school-700 hover:bg-blue-50">Pratinjau & edit</button>
                          <button
                            type="button"
                            disabled={deletingFormId === form.id}
                            aria-label={`Hapus formulir ${form.title}`}
                            onClick={(event) => { event.stopPropagation(); void deleteForm(form); }}
                            className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-red-200 px-2 font-bold text-red-700 hover:bg-red-50 disabled:cursor-wait disabled:opacity-60"
                          >
                            <Trash2 size={16} aria-hidden="true" />
                            {deletingFormId === form.id ? "Menghapus…" : "Hapus"}
                          </button>
                        </div>
                      </div>
                    )}
                  </article>
                ))}
              </div>
            }
            <p className="mt-6 text-center text-xs text-[var(--ds-text-muted)]">Jawaban draf tersimpan di perangkat. Jawaban hanya dinyatakan terkirim setelah server mengonfirmasi.</p>
            <AppFooter />
          </>
        )}
      </div>
    </main>
  );
}
