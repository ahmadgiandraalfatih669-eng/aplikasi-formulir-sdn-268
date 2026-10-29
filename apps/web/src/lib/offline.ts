"use client";

import Dexie, { type Table } from "dexie";
import { ApiError } from "./api";

export type CachedForm = {
  id: string;
  title: string;
  description: string;
  status: string;
  quizMode: boolean;
  currentVersion: { id: string; versionNumber: number; schema: { questions: Array<{
    id: string;
    type: "SHORT_TEXT" | "PARAGRAPH" | "NUMBER" | "SINGLE_CHOICE" | "MULTIPLE_CHOICE" | "DROPDOWN" | "MATRIX";
    title: string;
    required: boolean;
    options?: string[];
    matrixRows?: string[];
    matrixColumns?: Array<string | {
      label: string;
      type: "SHORT_TEXT" | "PARAGRAPH" | "SINGLE_CHOICE" | "MULTIPLE_CHOICE" | "DROPDOWN";
      options: string[];
    }>;
    scoreWeight?: number;
    answerKey?: string | string[] | number;
    media?: {
      kind: "IMAGE" | "VIDEO";
      url?: string;
      dataUrl?: string;
      name?: string;
      mimeType?: "image/jpeg" | "image/png" | "image/webp" | "video/mp4" | "video/webm";
      sizeBytes?: number;
    };
  }> } } | null;
  cachedAt: number;
};

export type DraftRecord = {
  formId: string;
  formVersionId: string;
  answers: Record<string, unknown>;
  updatedAt: number;
};

export type PendingSubmission = {
  clientMutationId: string;
  ownerUserId?: string;
  formId: string;
  formVersionId: string;
  answers: Record<string, unknown>;
  createdAt: number;
  syncStatus: "PENDING" | "SYNCING" | "FAILED" | "CONFLICT" | "SYNCED";
  lastError?: string;
};

class OfflineDatabase extends Dexie {
  cachedForms!: Table<CachedForm, string>;
  draftSubmissions!: Table<DraftRecord, string>;
  pendingMutations!: Table<PendingSubmission, string>;
  syncLogs!: Table<{ id?: number; createdAt: number; message: string }, number>;

  constructor() {
    super("sdn268-offline");
    this.version(1).stores({
      cachedForms: "id, cachedAt",
      draftSubmissions: "formId, updatedAt",
      pendingMutations: "clientMutationId, formId, syncStatus, createdAt",
      syncLogs: "++id, createdAt",
    });
  }
}

export const offlineDb = new OfflineDatabase();

export async function syncPending(
  ownerUserId: string,
  send: (item: PendingSubmission) => Promise<void>,
): Promise<{ synced: number; failed: number; conflicts: number }> {
  const items = (await offlineDb.pendingMutations.where("syncStatus").anyOf("PENDING", "FAILED").sortBy("createdAt"))
    .filter((item) => item.ownerUserId === ownerUserId);
  let synced = 0;
  let failed = 0;
  let conflicts = 0;
  for (const item of items) {
    await offlineDb.pendingMutations.update(item.clientMutationId, { syncStatus: "SYNCING", lastError: undefined });
    try {
      await send(item);
      await offlineDb.pendingMutations.update(item.clientMutationId, { syncStatus: "SYNCED", lastError: undefined });
      await offlineDb.draftSubmissions.delete(item.formId);
      await offlineDb.syncLogs.add({ createdAt: Date.now(), message: "Jawaban berhasil dikirim ke server." });
      synced += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Sinkronisasi gagal.";
      const conflict = error instanceof ApiError && error.status === 409;
      await offlineDb.pendingMutations.update(item.clientMutationId, {
        syncStatus: conflict ? "CONFLICT" : "FAILED",
        lastError: message,
      });
      await offlineDb.syncLogs.add({ createdAt: Date.now(), message: `Gagal mengirim jawaban: ${message}` });
      if (conflict) conflicts += 1;
      else failed += 1;
    }
  }
  return { synced, failed, conflicts };
}
