import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import {
  getFirestore,
  collection,
  addDoc,
  onSnapshot,
  updateDoc,
  deleteDoc,
  doc,
} from 'firebase/firestore';
import {
  getAuth,
  signInAnonymously,
  signInWithCustomToken,
  onAuthStateChanged,
} from 'firebase/auth';
import {
  Upload,
  Loader2,
  Calendar,
  User,
  Tag,
  Trash2,
  AlertCircle,
  Filter,
  Clock,
} from 'lucide-react';

// --- Firebase Configuration ---
const firebaseConfig = typeof __firebase_config !== 'undefined'
  ? JSON.parse(__firebase_config)
  : {};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'invoice-manager-001';

// --- Constants ---
const API_KEY = '';
const MODEL_NAME = 'gemini-2.5-flash-preview-09-2025';
const STATUS_OPTIONS = ['未処理', '処理中', '承認待ち', '完了'];

// --- Date Helpers ---
const getToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

const getEndOfWeek = () => {
  const d = getToday();
  d.setDate(d.getDate() + (7 - d.getDay()));
  return d;
};

const getEndOfMonth = () => {
  const t = getToday();
  return new Date(t.getFullYear(), t.getMonth() + 1, 0, 23, 59, 59, 999);
};

const DUE_DATE_OPTIONS = [
  { value: 'All', label: 'すべて' },
  { value: 'overdue', label: '期限超過' },
  { value: 'thisWeek', label: '今週中' },
  { value: 'thisMonth', label: '今月中' },
  { value: 'noDue', label: '期日未設定' },
];

function matchesDueFilter(inv, filterValue) {
  if (filterValue === 'All') return true;
  if (filterValue === 'noDue') return !inv.dueDate;
  if (!inv.dueDate) return false;
  const due = new Date(inv.dueDate);
  const t = getToday();
  if (filterValue === 'overdue') return due < t && inv.status !== '完了';
  if (filterValue === 'thisWeek') return due >= t && due <= getEndOfWeek();
  if (filterValue === 'thisMonth') return due >= t && due <= getEndOfMonth();
  return true;
}

function getDueDateClass(inv) {
  if (!inv.dueDate || inv.status === '完了') return '';
  const due = new Date(inv.dueDate);
  if (due < getToday()) return 'text-red-600 font-bold';
  const diffDays = (due - getToday()) / (1000 * 60 * 60 * 24);
  if (diffDays <= 3) return 'text-orange-500 font-semibold';
  return '';
}

function DueBadge({ inv }) {
  if (!inv.dueDate || inv.status === '完了') return null;
  const due = new Date(inv.dueDate);
  const t = getToday();
  if (due < t) {
    return (
      <span className="ml-1 text-[10px] bg-red-100 text-red-600 font-bold px-1.5 py-0.5 rounded-full">
        超過
      </span>
    );
  }
  const diffDays = Math.ceil((due - t) / (1000 * 60 * 60 * 24));
  if (diffDays <= 3) {
    return (
      <span className="ml-1 text-[10px] bg-orange-100 text-orange-600 font-bold px-1.5 py-0.5 rounded-full">
        あと{diffDays}日
      </span>
    );
  }
  return null;
}

export default function App() {
  const [user, setUser] = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [isUploading, setIsUploading] = useState(false);
  const [filterStatus, setFilterStatus] = useState('All');
  const [filterRep, setFilterRep] = useState('All');
  const [filterDue, setFilterDue] = useState('All');
  const fileInputRef = useRef(null);

  // Auth
  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (e) {
        console.error('Auth error:', e);
      }
    };
    initAuth();
    return onAuthStateChanged(auth, setUser);
  }, []);

  // Firestore Sync
  useEffect(() => {
    if (!user) return;
    const col = collection(db, 'artifacts', appId, 'public', 'data', 'invoices');
    return onSnapshot(col, (snap) => {
      const data = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setInvoices(data.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
    });
  }, [user]);

  // AI Extraction
  const extractInvoiceData = async (base64Data) => {
    const systemPrompt = `
      あなたは請求書解析の専門家です。
      提供された請求書画像から以下の情報を抽出し、JSON形式で返してください。
      プロパティ名:
      - amount (数値のみ、円記号やカンマは含めない)
      - media (媒体名や発行元)
      - dueDate (YYYY-MM-DD形式。不明な場合は現在から1ヶ月後の日付)
      - description (備考や主な項目)
    `;
    const payload = {
      contents: [{ role: 'user', parts: [
        { text: 'この請求書から情報を抽出してください。' },
        { inlineData: { mimeType: 'image/png', data: base64Data } },
      ]}],
      systemInstruction: { parts: [{ text: systemPrompt }] },
      generationConfig: { responseMimeType: 'application/json' },
    };

    let delay = 1000;
    for (let i = 0; i < 5; i++) {
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent?key=${API_KEY}`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
        );
        const result = await res.json();
        return JSON.parse(result.candidates[0].content.parts[0].text);
      } catch (err) {
        if (i === 4) throw err;
        await new Promise((r) => setTimeout(r, delay));
        delay *= 2;
      }
    }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file || !user) return;
    setIsUploading(true);
    try {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64Data = reader.result.split(',')[1];
        const extracted = await extractInvoiceData(base64Data);
        await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'invoices'), {
          amount: Number(extracted.amount),
          media: extracted.media || '不明な媒体',
          dueDate: extracted.dueDate || '',
          description: extracted.description || '',
          status: '未処理',
          salesRep: '未割り当て',
          createdAt: new Date().toISOString(),
          fileName: file.name,
          userId: user.uid,
        });
        setIsUploading(false);
      };
      reader.readAsDataURL(file);
    } catch (err) {
      console.error('Upload/AI error:', err);
      setIsUploading(false);
    }
  };

  const updateField = async (id, fields) => {
    await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'invoices', id), fields);
  };

  const deleteInvoice = async (id) => {
    await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'invoices', id));
  };

  const filteredInvoices = invoices.filter((inv) => {
    if (filterStatus !== 'All' && inv.status !== filterStatus) return false;
    if (filterRep !== 'All' && inv.salesRep !== filterRep) return false;
    if (!matchesDueFilter(inv, filterDue)) return false;
    return true;
  });

  const uniqueReps = [
    '未割り当て',
    ...new Set(invoices.map((i) => i.salesRep).filter((r) => r && r !== '未割り当て')),
  ];

  const overdueCount = invoices.filter(
    (i) => i.dueDate && new Date(i.dueDate) < getToday() && i.status !== '完了'
  ).length;

  const anyFilterActive = filterStatus !== 'All' || filterRep !== 'All' || filterDue !== 'All';

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 p-4 md:p-8 font-sans">
      <div className="max-w-6xl mx-auto">

        {/* Header */}
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold text-slate-800 tracking-tight">Invoice AI Manager</h1>
            <p className="text-slate-500 mt-1">請求書の自動解析・担当者別・期限別ステータス管理</p>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="file"
              accept="image/*,application/pdf"
              className="hidden"
              ref={fileInputRef}
              onChange={handleFileUpload}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2.5 rounded-xl font-medium flex items-center gap-2 shadow-lg shadow-indigo-200 transition-all disabled:opacity-50"
            >
              {isUploading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Upload className="w-5 h-5" />}
              {isUploading ? '解析中...' : '請求書をアップロード'}
            </button>
          </div>
        </header>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
          <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 col-span-2 md:col-span-1">
            <div className="text-slate-400 text-sm font-medium mb-1">総請求額</div>
            <div className="text-2xl font-bold">
              ¥{invoices.reduce((s, i) => s + (i.amount || 0), 0).toLocaleString()}
            </div>
          </div>
          <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100">
            <div className="text-slate-400 text-sm font-medium mb-1">未処理</div>
            <div className="text-2xl font-bold text-orange-500">
              {invoices.filter((i) => i.status === '未処理').length}件
            </div>
          </div>
          <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100">
            <div className="text-slate-400 text-sm font-medium mb-1">対応中</div>
            <div className="text-2xl font-bold text-blue-500">
              {invoices.filter((i) => i.status === '処理中').length}件
            </div>
          </div>
          <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100">
            <div className="text-slate-400 text-sm font-medium mb-1">完了</div>
            <div className="text-2xl font-bold text-emerald-500">
              {invoices.filter((i) => i.status === '完了').length}件
            </div>
          </div>
          <div
            className={`p-4 rounded-2xl shadow-sm border cursor-pointer transition-colors ${
              overdueCount > 0
                ? filterDue === 'overdue'
                  ? 'bg-red-100 border-red-300'
                  : 'bg-red-50 border-red-200 hover:bg-red-100'
                : 'bg-white border-slate-100'
            }`}
            onClick={() => setFilterDue(filterDue === 'overdue' ? 'All' : 'overdue')}
            title="クリックで期限超過のみ表示"
          >
            <div className="text-slate-400 text-sm font-medium mb-1">期限超過</div>
            <div className={`text-2xl font-bold ${overdueCount > 0 ? 'text-red-600' : 'text-slate-400'}`}>
              {overdueCount}件
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3 mb-6">
          {/* Status Filter */}
          <div className="flex items-center gap-2 bg-white px-3 py-2 rounded-lg border border-slate-200 text-sm">
            <Filter className="w-4 h-4 text-slate-400" />
            <span className="text-slate-500">ステータス:</span>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="outline-none bg-transparent font-medium"
            >
              <option value="All">すべて</option>
              {STATUS_OPTIONS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
            </select>
          </div>

          {/* Rep Filter */}
          <div className="flex items-center gap-2 bg-white px-3 py-2 rounded-lg border border-slate-200 text-sm">
            <User className="w-4 h-4 text-slate-400" />
            <span className="text-slate-500">担当者:</span>
            <select
              value={filterRep}
              onChange={(e) => setFilterRep(e.target.value)}
              className="outline-none bg-transparent font-medium"
            >
              <option value="All">すべて</option>
              {uniqueReps.map((rep) => <option key={rep} value={rep}>{rep}</option>)}
            </select>
          </div>

          {/* Due Date Filter */}
          <div className="flex items-center gap-2 bg-white px-3 py-2 rounded-lg border border-slate-200 text-sm">
            <Clock className="w-4 h-4 text-slate-400" />
            <span className="text-slate-500">期限:</span>
            <select
              value={filterDue}
              onChange={(e) => setFilterDue(e.target.value)}
              className="outline-none bg-transparent font-medium"
            >
              {DUE_DATE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          {anyFilterActive && (
            <button
              onClick={() => { setFilterStatus('All'); setFilterRep('All'); setFilterDue('All'); }}
              className="text-xs text-indigo-600 hover:text-indigo-800 underline"
            >
              フィルターをリセット
            </button>
          )}

          <span className="ml-auto text-sm text-slate-400">
            {filteredInvoices.length} / {invoices.length} 件表示
          </span>
        </div>

        {/* Table */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/50 border-b border-slate-100">
                  <th className="px-6 py-4 text-sm font-semibold text-slate-600">媒体・項目</th>
                  <th className="px-6 py-4 text-sm font-semibold text-slate-600">金額</th>
                  <th className="px-6 py-4 text-sm font-semibold text-slate-600">対応期日</th>
                  <th className="px-6 py-4 text-sm font-semibold text-slate-600">担当営業</th>
                  <th className="px-6 py-4 text-sm font-semibold text-slate-600">ステータス</th>
                  <th className="px-6 py-4 text-sm font-semibold text-slate-600 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredInvoices.length === 0 ? (
                  <tr>
                    <td colSpan="6" className="px-6 py-12 text-center text-slate-400">
                      該当するデータがありません。
                    </td>
                  </tr>
                ) : (
                  filteredInvoices.map((inv) => (
                    <tr key={inv.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="px-6 py-4">
                        <div className="font-semibold text-slate-800">{inv.media}</div>
                        <div className="text-xs text-slate-400 flex items-center gap-1 mt-0.5">
                          <Tag className="w-3 h-3" /> {inv.description || '詳細なし'}
                        </div>
                      </td>
                      <td className="px-6 py-4 font-mono font-medium text-slate-700">
                        ¥{(inv.amount || 0).toLocaleString()}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-1 text-sm">
                          <Calendar className="w-4 h-4 text-slate-400 shrink-0" />
                          <span className={getDueDateClass(inv)}>
                            {inv.dueDate || '未設定'}
                          </span>
                          <DueBadge inv={inv} />
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <input
                          type="text"
                          defaultValue={inv.salesRep}
                          onBlur={(e) => updateField(inv.id, { salesRep: e.target.value })}
                          className="bg-slate-50 border border-slate-200 rounded px-2 py-1 text-sm focus:ring-2 focus:ring-indigo-200 outline-none w-32"
                          placeholder="氏名を入力"
                        />
                      </td>
                      <td className="px-6 py-4">
                        <select
                          value={inv.status}
                          onChange={(e) => updateField(inv.id, { status: e.target.value })}
                          className={`text-xs font-bold px-2.5 py-1 rounded-full border appearance-none cursor-pointer outline-none ${
                            inv.status === '完了'
                              ? 'bg-emerald-50 text-emerald-600 border-emerald-200'
                              : inv.status === '処理中'
                              ? 'bg-blue-50 text-blue-600 border-blue-200'
                              : inv.status === '未処理'
                              ? 'bg-orange-50 text-orange-600 border-orange-200'
                              : 'bg-slate-50 text-slate-600 border-slate-200'
                          }`}
                        >
                          {STATUS_OPTIONS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                        </select>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button
                          onClick={() => deleteInvoice(inv.id)}
                          className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Tip */}
        <div className="mt-8 bg-indigo-50 p-6 rounded-2xl border border-indigo-100 flex gap-4">
          <div className="bg-indigo-600 p-2 rounded-xl h-fit">
            <AlertCircle className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="font-bold text-indigo-900 mb-1">使い方ガイド</h3>
            <p className="text-sm text-indigo-700 leading-relaxed">
              請求書の画像をアップロードするとAIが金額・媒体・期日を自動抽出します。
              「期限」フィルターで <strong>期限超過・今週中・今月中</strong> に絞り込めます。
              期限超過カードをクリックしても同様に絞り込めます。
              担当者名を入力すると <strong>担当者別フィルター</strong> に自動反映されます。
              期日が3日以内の案件は <span className="text-orange-600 font-bold">オレンジ</span>、超過は <span className="text-red-600 font-bold">赤バッジ</span> で表示されます。
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
