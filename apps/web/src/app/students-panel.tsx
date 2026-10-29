"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import ExcelJS from "exceljs";
import { ArrowDownToLine, ArrowLeft, ChevronLeft, ChevronRight, FileSpreadsheet, Pencil, Plus, RotateCcw, Search, Trash2, Upload, Users, X } from "lucide-react";
import { useRef, useState } from "react";
import { api, apiWithMeta } from "@/lib/api";
import { Button } from "@sdn268/ui";

type StudentStatus = "ACTIVE" | "INACTIVE" | "SUSPENDED";

type Student = {
  id: string;
  name: string;
  studentLoginId: string;
  nisnMasked: string;
  classId: string | null;
  className: string | null;
  status: StudentStatus;
  firstLogin: boolean;
  recordVersion: number;
  deletedAt: string | null;
};

type SchoolClass = {
  id: string;
  name: string;
  academicYear: { name: string; active: boolean };
};

const statusLabels: Record<StudentStatus, string> = {
  ACTIVE: "Aktif",
  INACTIVE: "Tidak aktif",
  SUSPENDED: "Ditangguhkan",
};

function queryString(values: Record<string, string>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value) params.set(key, value);
  }
  return params.toString();
}

export function StudentsPanel({ onBack }: { onBack: () => void }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [classId, setClassId] = useState("");
  const [status, setStatus] = useState("");
  const [showDeleted, setShowDeleted] = useState(false);
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [editing, setEditing] = useState<Student | null>(null);
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const importInput = useRef<HTMLInputElement>(null);
  const filters = queryString({
    page: String(page),
    pageSize: "10",
    q: search.trim(),
    classId,
    status,
    showDeleted: String(showDeleted),
  });
  const studentsQuery = useQuery({
    queryKey: ["students", filters],
    queryFn: () => apiWithMeta<Student[]>(`/students?${filters}`),
  });
  const classesQuery = useQuery({
    queryKey: ["classes"],
    queryFn: () => api<SchoolClass[]>("/classes"),
  });
  const students = studentsQuery.data?.data ?? [];
  const pageMeta = studentsQuery.data?.meta;
  const activePage = typeof pageMeta?.page === "number" ? pageMeta.page : page;
  const totalPages = typeof pageMeta?.totalPages === "number" ? pageMeta.totalPages : 1;
  const total = typeof pageMeta?.total === "number" ? pageMeta.total : 0;

  async function refreshStudents() {
    setSelectedIds([]);
    await queryClient.invalidateQueries({ queryKey: ["students"] });
  }

  function toggleSelected(id: string) {
    setSelectedIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  }

  async function deleteStudent(student: Student) {
    if (!window.confirm(`Hapus data ${student.name}? Data akan masuk ke daftar terhapus dan dapat dipulihkan.`)) return;
    setError("");
    setNotice("");
    try {
      await api(`/students/${student.id}`, { method: "DELETE" });
      setNotice(`Data ${student.name} dipindahkan ke daftar terhapus.`);
      await refreshStudents();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Data murid tidak dapat dihapus.");
    }
  }

  async function restoreStudent(student: Student) {
    setError("");
    setNotice("");
    try {
      await api(`/students/${student.id}/restore`, { method: "POST" });
      setNotice(`Data ${student.name} berhasil dipulihkan.`);
      await refreshStudents();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Data murid tidak dapat dipulihkan.");
    }
  }

  async function bulkAction(action: "delete" | "restore") {
    const verb = action === "delete" ? "menghapus" : "memulihkan";
    if (action === "delete" && !window.confirm(`Soft delete ${selectedIds.length} data murid yang dipilih?`)) return;
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const result = await api<{ deletedCount?: number; restoredCount?: number }>(
        `/students/bulk-${action}`,
        { method: "POST", body: JSON.stringify({ ids: selectedIds }) },
      );
      const count = result.deletedCount ?? result.restoredCount ?? 0;
      setNotice(`${count} data murid berhasil ${verb}.`);
      await refreshStudents();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Tindakan untuk data terpilih gagal.");
    } finally {
      setBusy(false);
    }
  }

  async function permanentlyDeleteStudent(student: Student) {
    const confirmation = window.prompt(`Hapus permanen data ${student.name}? Semua jawaban dan nilainya akan ikut dihapus. Ketik HAPUS PERMANEN untuk melanjutkan.`);
    if (confirmation !== "HAPUS PERMANEN") return;
    setError("");
    setNotice("");
    setBusy(true);
    try {
      await api(`/students/${student.id}/permanent`, { method: "DELETE" });
      setNotice(`Data ${student.name} dihapus permanen dan dapat ditambahkan kembali.`);
      await refreshStudents();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Data murid tidak dapat dihapus permanen.");
    } finally {
      setBusy(false);
    }
  }

  async function permanentlyDeleteSelected() {
    const confirmation = window.prompt(`Hapus permanen ${selectedIds.length} data murid terpilih? Semua jawaban dan nilainya akan ikut dihapus. Ketik HAPUS PERMANEN untuk melanjutkan.`);
    if (confirmation !== "HAPUS PERMANEN") return;
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const result = await api<{ deletedCount: number }>("/students/bulk-permanent-delete", {
        method: "POST",
        body: JSON.stringify({ ids: selectedIds }),
      });
      setNotice(`${result.deletedCount} data murid dihapus permanen dan dapat ditambahkan kembali.`);
      await refreshStudents();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Data murid terpilih tidak dapat dihapus permanen.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteAllStudents() {
    const confirmation = window.prompt(
      "Tindakan ini memindahkan SELURUH data murid yang belum terhapus ke daftar terhapus, tidak hanya hasil filter saat ini. Data dapat dipulihkan. Ketik HAPUS SEMUA untuk melanjutkan.",
    );
    if (confirmation !== "HAPUS SEMUA") return;
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const result = await api<{ deletedCount: number }>("/students/bulk-delete-all", {
        method: "POST",
        body: JSON.stringify({ confirmation }),
      });
      setNotice(`${result.deletedCount} data murid dipindahkan ke daftar terhapus.`);
      await refreshStudents();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Semua data murid tidak dapat dihapus.");
    } finally {
      setBusy(false);
    }
  }

  async function permanentlyDeleteAllStudents() {
    const confirmation = window.prompt(
      "Tindakan ini menghapus PERMANEN SELURUH data pada daftar terhapus beserta jawaban dan nilainya. Data tidak dapat dipulihkan. Ketik HAPUS PERMANEN untuk melanjutkan.",
    );
    if (confirmation !== "HAPUS PERMANEN") return;
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const result = await api<{ deletedCount: number }>("/students/delete-all-deleted", {
        method: "POST",
        body: JSON.stringify({ confirmation: "HAPUS PERMANEN" }),
      });
      setNotice(`${result.deletedCount} data murid terhapus dihapus permanen.`);
      await refreshStudents();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Data terhapus tidak dapat dihapus permanen.");
    } finally {
      setBusy(false);
    }
  }

  async function createWorkbook(isTemplate: boolean) {
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const workbook = new ExcelJS.Workbook();
      workbook.creator = "SDN 268 Panyileukan";
      workbook.created = new Date();
      const sheet = workbook.addWorksheet("Data Murid");
      sheet.columns = [
        { header: "Nama", key: "name", width: 28 },
        { header: "Nama Pengguna", key: "studentLoginId", width: 34 },
        { header: "NISN", key: "nisn", width: 16, style: { numFmt: "@" } },
        { header: "Kelas", key: "className", width: 14 },
        { header: "Tahun Ajaran", key: "academicYear", width: 18 },
        { header: "Status", key: "status", width: 16 },
      ];
      sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
      sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1D4ED8" } };
      sheet.views = [{ state: "frozen", ySplit: 1 }];
      sheet.getColumn("nisn").numFmt = "@";

      if (isTemplate) {
        sheet.addRow({ name: "", studentLoginId: "", nisn: "", className: "", academicYear: "", status: "ACTIVE" });
        const instructions = workbook.addWorksheet("Petunjuk");
        instructions.addRows([
          ["PETUNJUK IMPOR DATA MURID"],
          ["Isi satu murid pada setiap baris di sheet Data Murid."],
          ["Kolom Nama wajib diisi. Status: ACTIVE, INACTIVE, atau SUSPENDED."],
          ["Murid baru: NISN 10 angka wajib diisi; NISN menjadi kata sandi awal."],
          ["Perbarui data yang sudah ada: isi Nama Pengguna dari file ekspor; NISN boleh dikosongkan."],
          ["Mengisi NISN pada akun lama akan mengatur ulang kata sandi awal dan meminta murid menggantinya saat masuk."],
          ["Kelas harus cocok dengan Tahun Ajaran. Kosongkan keduanya jika kelas belum ditetapkan."],
          ["Jangan mengubah judul kolom. Maksimal 500 baris per impor."],
        ]);
        instructions.getColumn(1).width = 110;
        instructions.getRow(1).font = { bold: true, size: 14 };
      } else {
        const exportRows: Student[] = [];
        const exportFilters = { q: search.trim(), classId, status, showDeleted: String(showDeleted) };
        let exportPage = 1;
        let exportPages = 1;
        do {
          const query = queryString({ ...exportFilters, page: String(exportPage), pageSize: "10" });
          const response = await apiWithMeta<Student[]>(`/students?${query}`);
          exportRows.push(...response.data);
          exportPages = typeof response.meta.totalPages === "number" ? response.meta.totalPages : 1;
          exportPage += 1;
        } while (exportPage <= exportPages);

        const classesById = new Map((classesQuery.data ?? []).map((schoolClass) => [schoolClass.id, schoolClass]));
        for (const student of exportRows) {
          const schoolClass = student.classId ? classesById.get(student.classId) : undefined;
          sheet.addRow({
            name: student.name,
            studentLoginId: student.studentLoginId,
            nisn: "",
            className: student.className ?? "",
            academicYear: schoolClass?.academicYear.name ?? "",
            status: student.status,
          });
        }
      }

      const output = await workbook.xlsx.writeBuffer();
      const url = URL.createObjectURL(new Blob([output], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = isTemplate ? "template-data-murid.xlsx" : `data-murid-${new Date().toISOString().slice(0, 10)}.xlsx`;
      link.click();
      URL.revokeObjectURL(url);
      setNotice(isTemplate ? "Template impor berhasil diunduh." : "Ekspor data murid berhasil diunduh. NISN tidak disertakan; file ini dapat diimpor kembali untuk memperbarui atau memulihkan data.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "File XLSX tidak dapat dibuat.");
    } finally {
      setBusy(false);
    }
  }

  async function importWorkbook(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const result = await apiWithMeta<{ createdCount: number; updatedCount: number }>("/students/import", {
        method: "POST",
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        },
        body: file,
      });
      setNotice(`Impor selesai: ${result.data.createdCount} murid baru, ${result.data.updatedCount} data diperbarui.`);
      await refreshStudents();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "File XLSX gagal diimpor.");
    } finally {
      setBusy(false);
    }
  }

  async function saveStudent(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    setBusy(true);
    const formData = new FormData(event.currentTarget);
    const name = String(formData.get("name") ?? "").trim();
    const selectedClass = String(formData.get("classId") ?? "");
    const selectedStatus = String(formData.get("status") ?? "ACTIVE") as StudentStatus;
    const payload = {
      name,
      classId: selectedClass || null,
      status: selectedStatus,
      ...(editing ? { recordVersion: editing.recordVersion } : { nisn: String(formData.get("nisn") ?? "").trim() }),
    };
    try {
      const result = editing
        ? await api<Student>(`/students/${editing.id}`, { method: "PATCH", body: JSON.stringify(payload) })
        : await api<Student>("/students", { method: "POST", body: JSON.stringify(payload) });
      setAdding(false);
      setEditing(null);
      setNotice(editing
        ? `Data ${result.name} berhasil diperbarui.`
        : `Murid berhasil ditambahkan. Nama pengguna: ${result.studentLoginId}. Kata sandi awal adalah NISN yang dimasukkan.`);
      await refreshStudents();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Data murid tidak dapat disimpan.");
    } finally {
      setBusy(false);
    }
  }

  const selectedOnPage = students.length > 0 && students.every((student) => selectedIds.includes(student.id));

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button onClick={onBack} aria-label="Kembali ke formulir" className="flex h-11 w-11 items-center justify-center rounded-xl bg-white shadow-sm hover:bg-slate-100"><ArrowLeft size={20} /></button>
          <div><p className="font-bold uppercase tracking-wider text-school-700">ADMINISTRASI SEKOLAH</p><h2 className="text-3xl font-black">Data murid</h2></div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button secondary disabled={busy} onClick={() => void createWorkbook(true)}><FileSpreadsheet size={17} />Template (.xlsx)</Button>
          <Button secondary disabled={busy} onClick={() => void createWorkbook(false)}><ArrowDownToLine size={17} />Ekspor (.xlsx)</Button>
          <Button secondary disabled={busy} onClick={() => importInput.current?.click()}><Upload size={17} />Impor (.xlsx)</Button>
          <input ref={importInput} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" onChange={(event) => void importWorkbook(event)} />
          <Button className="bg-red-700 hover:bg-red-800" disabled={busy || (showDeleted ? students.length === 0 : false)} onClick={() => void (showDeleted ? permanentlyDeleteAllStudents() : deleteAllStudents())}><Trash2 size={17} />{showDeleted ? "Hapus semua permanen" : "Hapus semua"}</Button>
          <Button disabled={busy} onClick={() => { setAdding(true); setEditing(null); setError(""); }}><Plus size={18} />Tambah murid</Button>
        </div>
      </div>

      <div className="ds-glass p-4 sm:p-5">
        <div className="grid gap-3 md:grid-cols-[minmax(220px,1fr)_190px_180px_auto]">
          <label className="relative block">
            <span className="sr-only">Cari nama murid atau nama pengguna</span>
            <Search className="absolute left-3 top-3.5 text-slate-500" size={18} />
            <input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} className="min-h-11 w-full rounded-xl border border-slate-300 pl-10 pr-3" placeholder="Cari nama murid…" />
          </label>
          <label className="sr-only" htmlFor="filter-class">Filter kelas</label>
          <select id="filter-class" value={classId} onChange={(event) => { setClassId(event.target.value); setPage(1); }} className="min-h-11 rounded-xl border border-slate-300 px-3">
            <option value="">Semua kelas</option>
            {(classesQuery.data ?? []).map((schoolClass) => <option key={schoolClass.id} value={schoolClass.id}>{schoolClass.name} · {schoolClass.academicYear.name}</option>)}
          </select>
          <label className="sr-only" htmlFor="filter-status">Filter status murid</label>
          <select id="filter-status" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }} className="min-h-11 rounded-xl border border-slate-300 px-3">
            <option value="">Semua status</option>
            {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <label className="flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 px-3 text-sm font-semibold">
            <input type="checkbox" checked={showDeleted} onChange={(event) => { setShowDeleted(event.target.checked); setPage(1); setSelectedIds([]); }} />
            Data terhapus
          </label>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
          <p className="text-sm text-slate-600" aria-live="polite">{total} murid · Halaman {activePage} dari {Math.max(1, totalPages)}</p>
          <div className="flex flex-wrap gap-2">
            {selectedIds.length > 0 && <>
              <Button secondary disabled={busy} onClick={() => void bulkAction(showDeleted ? "restore" : "delete")}>{showDeleted ? <RotateCcw size={17} /> : <Trash2 size={17} />}{showDeleted ? "Pulihkan" : "Hapus"} {selectedIds.length} terpilih</Button>
              {showDeleted && <Button className="bg-red-700 hover:bg-red-800" disabled={busy} onClick={() => void permanentlyDeleteSelected()}><Trash2 size={17} />Hapus permanen {selectedIds.length}</Button>}
            </>}
            <Button secondary disabled={page <= 1} onClick={() => setPage((value) => value - 1)}><ChevronLeft size={18} />Sebelumnya</Button>
            <Button secondary disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)}>Berikutnya<ChevronRight size={18} /></Button>
          </div>
        </div>

        {studentsQuery.isLoading ? <p className="py-12 text-center text-slate-600">Memuat data murid…</p>
          : studentsQuery.isError ? <div role="alert" className="mt-4 rounded-xl bg-red-50 p-4 text-red-800">{studentsQuery.error.message}<button className="ml-2 underline" onClick={() => void studentsQuery.refetch()}>Coba lagi</button></div>
            : students.length === 0 ? <div className="py-12 text-center"><Users className="mx-auto text-slate-400" size={38} /><h3 className="mt-3 font-bold">Belum ada data murid</h3><p className="mt-1 text-sm text-slate-600">Ubah filter atau tambahkan data murid.</p></div>
              : <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
                <table className="ds-table w-full min-w-[760px] text-left text-sm text-[var(--ds-text)]">
                  <thead><tr>
                    <th className="w-12 p-3"><input aria-label="Pilih semua murid di halaman ini" type="checkbox" checked={selectedOnPage} onChange={(event) => setSelectedIds(event.target.checked ? [...new Set([...selectedIds, ...students.map((student) => student.id)])] : selectedIds.filter((id) => !students.some((student) => student.id === id)))} /></th>
                    <th className="p-3">Nama murid</th><th className="p-3">Nama pengguna</th><th className="p-3">NISN</th><th className="p-3">Kelas</th><th className="p-3">Status</th><th className="p-3">Tindakan</th>
                  </tr></thead>
                  <tbody>
                    {students.map((student) => <tr key={student.id}>
                      <td className="p-3"><input aria-label={`Pilih ${student.name}`} type="checkbox" checked={selectedIds.includes(student.id)} onChange={() => toggleSelected(student.id)} /></td>
                      <td className="p-3 font-semibold">{student.name}</td><td className="p-3">{student.studentLoginId}</td><td className="p-3">{student.nisnMasked}</td><td className="p-3">{student.className ?? "—"}</td>
                      <td className="p-3"><span className="ds-status ds-status-neutral">{statusLabels[student.status]}</span>{student.firstLogin && <span className="ml-2 text-xs font-semibold text-amber-300">Sandi awal</span>}</td>
                      <td className="p-3"><div className="flex gap-2">
                        {showDeleted ? <><button onClick={() => void restoreStudent(student)} className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2 font-bold text-green-800 hover:bg-green-50"><RotateCcw size={16} />Pulihkan</button><button onClick={() => void permanentlyDeleteStudent(student)} className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2 font-bold text-red-700 hover:bg-red-50"><Trash2 size={16} />Hapus permanen</button></> : <>
                          <button onClick={() => { setEditing(student); setAdding(false); setError(""); }} className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2 font-bold text-secondary hover:bg-white/10"><Pencil size={16} />Edit</button>
                          <button onClick={() => void deleteStudent(student)} className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2 font-bold text-danger hover:bg-white/10"><Trash2 size={16} />Hapus</button>
                        </>}
                      </div></td>
                    </tr>)}
                  </tbody>
                </table>
              </div>}
      </div>

      {notice && <p role="status" className="rounded-xl bg-green-50 p-4 font-semibold text-green-900">{notice}</p>}
      {error && <p role="alert" className="rounded-xl bg-red-50 p-4 font-semibold text-red-900">{error}</p>}

      {(adding || editing) && <div className="fixed inset-0 z-30 flex items-center justify-center overflow-y-auto bg-slate-950/50 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) { setAdding(false); setEditing(null); } }}>
        <section role="dialog" aria-modal="true" aria-labelledby="student-dialog-title" className="my-6 w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl sm:p-7">
          <div className="mb-5 flex items-start justify-between gap-3">
            <div><h3 id="student-dialog-title" className="text-xl font-black">{editing ? "Ubah data murid" : "Tambah murid"}</h3><p className="mt-1 text-sm text-slate-600">{editing ? "Perbarui informasi kelas atau akun." : "NISN menjadi kata sandi awal dan harus diganti saat login pertama."}</p></div>
            <button aria-label="Tutup" className="rounded-lg p-2 hover:bg-slate-100" onClick={() => { setAdding(false); setEditing(null); }}><X size={20} /></button>
          </div>
          <form className="space-y-4" onSubmit={(event) => void saveStudent(event)}>
            <label className="block font-semibold">Nama lengkap<input name="name" required minLength={2} maxLength={160} defaultValue={editing?.name ?? ""} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-3" /></label>
            {!editing && <label className="block font-semibold">NISN (10 angka)<input name="nisn" required inputMode="numeric" pattern="[0-9]{10}" maxLength={10} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-3" /><span className="mt-1 block text-xs font-normal text-slate-600">NISN tidak akan ditampilkan kembali setelah disimpan.</span></label>}
            <label className="block font-semibold">Kelas<select name="classId" defaultValue={editing?.classId ?? ""} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-3"><option value="">Belum ditetapkan</option>{(classesQuery.data ?? []).map((schoolClass) => <option key={schoolClass.id} value={schoolClass.id}>{schoolClass.name} · {schoolClass.academicYear.name}{schoolClass.academicYear.active ? " (aktif)" : ""}</option>)}</select></label>
            {editing && <label className="block font-semibold">Status<select name="status" defaultValue={editing.status} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-3">{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}
            {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
            <div className="flex justify-end gap-2 pt-2"><Button type="button" secondary onClick={() => { setAdding(false); setEditing(null); }}>Batal</Button><Button type="submit" disabled={busy}>{busy ? "Menyimpan…" : "Simpan"}</Button></div>
          </form>
        </section>
      </div>}
    </section>
  );
}
