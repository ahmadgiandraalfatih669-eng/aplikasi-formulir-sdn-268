import React, { useState, useEffect, useCallback } from 'react';

// --- Types & Interfaces ---
type Role = 'ADMIN' | 'TEACHER' | 'STUDENT' | null;

interface User {
  id: string;
  name: string;
  role: Role;
}

interface Question {
  id: string;
  type: 'SHORT_TEXT' | 'MULTIPLE_CHOICE' | 'PARAGRAPH';
  title: string;
  options?: string[];
  required: boolean;
}

interface Form {
  id: string;
  title: string;
  questions: Question[];
  status: 'DRAFT' | 'PUBLISHED';
}

interface Answer {
  questionId: string;
  value: string;
}

// --- Mock Data & Local Storage Wrappers (Simulating IndexedDB) ---
const getLocalForms = (): Form[] => JSON.parse(localStorage.getItem('sdn_forms') || '[]');
const saveLocalForms = (forms: Form[]) => localStorage.setItem('sdn_forms', JSON.stringify(forms));
const getLocalDrafts = () => JSON.parse(localStorage.getItem('sdn_drafts') || '{}');
const saveLocalDraft = (formId: string, answers: Record<string, string>) => {
  const drafts = getLocalDrafts();
  drafts[formId] = answers;
  localStorage.setItem('sdn_drafts', JSON.stringify(drafts));
};

// --- Components ---

// 1. UI Components
const Button = ({ children, onClick, variant = 'primary', className = '' }: any) => {
  const baseStyle = "px-4 py-2 rounded-md font-semibold transition-colors disabled:opacity-50";
  const variants: Record<string, string> = {
    primary: "bg-blue-600 text-white hover:bg-blue-700",
    secondary: "bg-gray-200 text-gray-800 hover:bg-gray-300",
    danger: "bg-red-600 text-white hover:bg-red-700"
  };
  return (
    <button onClick={onClick} className={`${baseStyle} ${variants[variant]} ${className}`}>
      {children}
    </button>
  );
};

// 2. Form Builder (Admin/Teacher)
const FormBuilder = ({ onSave }: { onSave: (form: Form) => void }) => {
  const [title, setTitle] = useState('Formulir Baru');
  const [questions, setQuestions] = useState<Question[]>([]);

  const addQuestion = (type: Question['type']) => {
    setQuestions([...questions, {
      id: crypto.randomUUID(),
      type,
      title: 'Pertanyaan Baru',
      options: type === 'MULTIPLE_CHOICE' ? ['Opsi 1'] : [],
      required: true
    }]);
  };

  const updateQuestion = (id: string, updates: Partial<Question>) => {
    setQuestions(questions.map(q => q.id === id ? { ...q, ...updates } : q));
  };

  const handleSave = () => {
    const newForm: Form = {
      id: crypto.randomUUID(),
      title,
      questions,
      status: 'PUBLISHED'
    };
    onSave(newForm);
  };

  return (
    <div className="bg-white p-6 rounded-lg shadow-md max-w-3xl mx-auto mt-6">
      <h2 className="text-2xl font-bold mb-4">Pembuat Formulir</h2>
      <input 
        type="text" 
        value={title} 
        onChange={(e) => setTitle(e.target.value)}
        className="w-full text-xl border-b-2 border-gray-300 focus:border-blue-500 outline-none mb-6 pb-2"
        placeholder="Judul Formulir"
      />

      {questions.map((q, index) => (
        <div key={q.id} className="border border-gray-200 p-4 rounded-md mb-4 bg-gray-50">
          <div className="flex justify-between items-center mb-2">
            <span className="font-semibold text-gray-700">Soal {index + 1} ({q.type})</span>
            <Button variant="danger" onClick={() => setQuestions(questions.filter(qu => qu.id !== q.id))}>Hapus</Button>
          </div>
          <input 
            type="text" 
            value={q.title} 
            onChange={(e) => updateQuestion(q.id, { title: e.target.value })}
            className="w-full p-2 border rounded-md mb-2"
            placeholder="Tulis pertanyaan di sini..."
          />
          {q.type === 'MULTIPLE_CHOICE' && (
            <div className="pl-4 space-y-2">
              {q.options?.map((opt, i) => (
                <input 
                  key={i}
                  type="text"
                  value={opt}
                  onChange={(e) => {
                    const newOpts = [...(q.options || [])];
                    newOpts[i] = e.target.value;
                    updateQuestion(q.id, { options: newOpts });
                  }}
                  className="w-full p-2 border rounded-md"
                />
              ))}
              <Button variant="secondary" onClick={() => updateQuestion(q.id, { options: [...(q.options || []), `Opsi ${(q.options?.length || 0) + 1}`] })}>
                + Tambah Opsi
              </Button>
            </div>
          )}
        </div>
      ))}

      <div className="flex gap-2 mt-4">
        <Button variant="secondary" onClick={() => addQuestion('SHORT_TEXT')}>+ Jawaban Singkat</Button>
        <Button variant="secondary" onClick={() => addQuestion('MULTIPLE_CHOICE')}>+ Pilihan Ganda</Button>
      </div>
      <div className="mt-8 flex justify-end">
        <Button variant="primary" onClick={handleSave}>Publikasikan Form</Button>
      </div>
    </div>
  );
};

// 3. Form Viewer (Student)
const FormViewer = ({ form, isOnline, onBack }: { form: Form, isOnline: boolean, onBack: () => void }) => {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [syncStatus, setSyncStatus] = useState<'IDLE' | 'SAVING' | 'SYNCED' | 'QUEUED'>('IDLE');

  // Load drafts on mount
  useEffect(() => {
    const drafts = getLocalDrafts();
    if (drafts[form.id]) {
      setAnswers(drafts[form.id]);
    }
  }, [form.id]);

  // Autosave draft
  useEffect(() => {
    if (Object.keys(answers).length > 0) {
      saveLocalDraft(form.id, answers);
    }
  }, [answers, form.id]);

  const handleSubmit = () => {
    setSyncStatus('SAVING');
    setTimeout(() => {
      if (isOnline) {
        setSyncStatus('SYNCED');
        alert("Berhasil dikirim ke server!");
      } else {
        setSyncStatus('QUEUED');
        alert("Offline: Tersimpan di perangkat. Akan dikirim otomatis saat koneksi kembali.");
      }
    }, 1000);
  };

  return (
    <div className="bg-white p-6 rounded-lg shadow-md max-w-3xl mx-auto mt-6">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold">{form.title}</h2>
        <Button variant="secondary" onClick={onBack}>Kembali</Button>
      </div>
      
      {!isOnline && (
        <div className="bg-yellow-100 text-yellow-800 p-3 rounded-md mb-4 flex items-center">
          <span className="mr-2">⚠️</span> Anda sedang offline. Jawaban disimpan secara otomatis ke perangkat (Draft).
        </div>
      )}

      {form.questions.map((q, idx) => (
        <div key={q.id} className="mb-6">
          <p className="font-semibold text-lg mb-2">{idx + 1}. {q.title} {q.required && <span className="text-red-500">*</span>}</p>
          
          {q.type === 'SHORT_TEXT' && (
            <input 
              type="text" 
              value={answers[q.id] || ''}
              onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
              className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-400"
              placeholder="Jawaban Anda"
            />
          )}

          {q.type === 'MULTIPLE_CHOICE' && (
            <div className="space-y-2">
              {q.options?.map(opt => (
                <label key={opt} className="flex items-center space-x-2">
                  <input 
                    type="radio" 
                    name={`q-${q.id}`}
                    value={opt}
                    checked={answers[q.id] === opt}
                    onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
                    className="w-4 h-4 text-blue-600"
                  />
                  <span>{opt}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      ))}

      <div className="mt-8 border-t pt-4 flex justify-between items-center">
        <span className="text-sm text-gray-500">
          {syncStatus === 'QUEUED' ? 'Menunggu sinkronisasi...' : 
           syncStatus === 'SYNCED' ? '✓ Tersimpan di server' : 
           'Draft tersimpan.'}
        </span>
        <Button 
          variant="primary" 
          onClick={handleSubmit}
          disabled={syncStatus === 'SAVING'}
        >
          {syncStatus === 'SAVING' ? 'Menyimpan...' : 'Kirim Jawaban'}
        </Button>
      </div>
    </div>
  );
};

// 4. Main App Container
export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isOnline, setIsOnline] = useState(true); // Default true, would use navigator.onLine in real browser
  const [forms, setForms] = useState<Form[]>([]);
  const [activeView, setActiveView] = useState<'DASHBOARD' | 'BUILDER' | 'VIEWER'>('DASHBOARD');
  const [selectedForm, setSelectedForm] = useState<Form | null>(null);

  // Initialize offline listener & forms
  useEffect(() => {
    // Note: For SSR environments (like Next.js), ensure navigator is accessed only in useEffect
    if (typeof window !== 'undefined') {
      setIsOnline(navigator.onLine);
      const handleOnline = () => setIsOnline(true);
      const handleOffline = () => setIsOnline(false);
      window.addEventListener('online', handleOnline);
      window.addEventListener('offline', handleOffline);
      
      setForms(getLocalForms());

      return () => {
        window.removeEventListener('online', handleOnline);
        window.removeEventListener('offline', handleOffline);
      };
    }
  }, []);

  const handleSaveForm = (form: Form) => {
    const updatedForms = [...forms, form];
    setForms(updatedForms);
    saveLocalForms(updatedForms);
    setActiveView('DASHBOARD');
  };

  // Auth Screen
  if (!user) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4 font-sans">
        <div className="bg-white p-8 rounded-xl shadow-lg max-w-md w-full">
          <div className="text-center mb-8">
            <h1 className="text-2xl font-bold text-gray-800">SDN 268 Panyileukan</h1>
            <p className="text-gray-500">Sistem Formulir & Penilaian</p>
          </div>
          <div className="space-y-4">
            <Button variant="primary" className="w-full py-3" onClick={() => setUser({ id: '1', name: 'Pak Guru Budi', role: 'ADMIN' })}>
              Login sebagai Admin / Guru (OAuth)
            </Button>
            <div className="relative flex py-2 items-center">
              <div className="flex-grow border-t border-gray-300"></div>
              <span className="flex-shrink-0 mx-4 text-gray-400 text-sm">Atau</span>
              <div className="flex-grow border-t border-gray-300"></div>
            </div>
            <Button variant="secondary" className="w-full py-3" onClick={() => setUser({ id: '2', name: 'Siswa Andi', role: 'STUDENT' })}>
              Login sebagai Murid (NISN)
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // App Layout
  return (
    <div className="min-h-screen bg-slate-50 font-sans">
      {/* Header */}
      <header className="bg-blue-700 text-white p-4 shadow-md sticky top-0 z-10">
        <div className="max-w-6xl mx-auto flex justify-between items-center">
          <div>
            <h1 className="text-xl font-bold">Portal SDN 268 Panyileukan</h1>
            <p className="text-sm opacity-80">{user.name} ({user.role})</p>
          </div>
          <div className="flex items-center gap-4">
            <div className={`px-3 py-1 rounded-full text-sm font-semibold flex items-center gap-2 ${isOnline ? 'bg-green-500' : 'bg-red-500'}`}>
              <span className={`w-2 h-2 rounded-full bg-white ${!isOnline && 'animate-pulse'}`}></span>
              {isOnline ? 'Online' : 'Offline'}
            </div>
            <button onClick={() => setUser(null)} className="text-blue-100 hover:text-white underline">
              Logout
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="max-w-6xl mx-auto p-4 pb-20">
        {activeView === 'DASHBOARD' && (
          <div>
            <div className="flex justify-between items-center mb-6 mt-4">
              <h2 className="text-2xl font-bold text-gray-800">Daftar Formulir & Kuis</h2>
              {user.role === 'ADMIN' && (
                <Button onClick={() => setActiveView('BUILDER')}>+ Buat Formulir Baru</Button>
              )}
            </div>

            {forms.length === 0 ? (
              <div className="text-center p-12 bg-white rounded-lg border border-dashed border-gray-300 text-gray-500">
                Belum ada formulir yang tersedia.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {forms.map(form => (
                  <div key={form.id} className="bg-white p-5 rounded-lg shadow border border-gray-100 hover:shadow-md transition-shadow">
                    <div className="w-10 h-10 bg-blue-100 text-blue-600 rounded-lg flex items-center justify-center mb-4 text-xl">📄</div>
                    <h3 className="font-bold text-lg text-gray-800 mb-1">{form.title}</h3>
                    <p className="text-sm text-gray-500 mb-4">{form.questions.length} Pertanyaan</p>
                    
                    {user.role === 'STUDENT' ? (
                      <Button className="w-full" onClick={() => { setSelectedForm(form); setActiveView('VIEWER'); }}>
                        Kerjakan Sekarang
                      </Button>
                    ) : (
                      <div className="flex gap-2">
                         <Button variant="secondary" className="flex-1 text-sm">Lihat Respons</Button>
                         <Button variant="secondary" className="flex-1 text-sm">Edit</Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeView === 'BUILDER' && user.role === 'ADMIN' && (
          <FormBuilder onSave={handleSaveForm} />
        )}

        {activeView === 'VIEWER' && selectedForm && (
          <FormViewer 
            form={selectedForm} 
            isOnline={isOnline} 
            onBack={() => { setActiveView('DASHBOARD'); setSelectedForm(null); }} 
          />
        )}
      </main>
    </div>
  );
}