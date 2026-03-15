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
  query,
  orderBy
} from 'firebase/firestore';
import {
  getAuth,
  signInAnonymously,
  signInWithCustomToken,
  onAuthStateChanged
} from 'firebase/auth';
import {
  Plus,
  Upload,
  Loader2,
  Calendar,
  User,
  Tag,
  Trash2,
  CheckCircle2,
  Clock,
  AlertCircle,
  Filter,
  Search
} from 'lucide-react';

// --- Firebase Configuration ---
// __firebase_config / __app_id / __initial_auth_token are injected via vite.config.js define
const firebaseConfig = (() => {
  try { return JSON.parse(__firebase_config); } catch { return {}; }
})();
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = __app_id || 'invoice-manager-001';

// --- Constants ---
const API_KEY = ""; // System provides this
const MODEL_NAME = "gemini-2.5-flash-preview-09-2025";
const STATUS_OPTIONS = ['未処理', '処理中', '承認待ち', '完了'];

export default function App() {
  const [user, setUser] = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [filterStatus, setFilterStatus] = useState('All');
  const [filterRep, setFilterRep] = useState('All');
  const fileInputRef = useRef(null);

  // Auth Initialization
  useEffect(() => {
    const initAuth = async () => {
      try {
        if (__initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (error) {
        console.error("Auth error:", error);
      }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  // Firestore Sync
  useEffect(() => {
    if (!user) return;

    const q = collection(db, 'artifacts', appId, 'public', 'data', 'invoices');

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setInvoices(data.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
    }, (error) => {
      console.error("Firestore error:", error);
    });

    return () => unsubscribe();
  }, [user]);

  // AI Extraction Function
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
      contents: [{
        role: "user",
        parts: [
          { text: "この請求書から情報を抽出してください。" },
          { inlineData: { mimeType: "image/png", data: base64Data } }
        ]
      }],
      systemInstruction: { parts: [{ text: systemPrompt }] },
      generationConfig: { responseMimeType: "application/json" }
    };

    let delay = 1000;
    for (let i = 0; i < 5; i++) {
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent?key=${API_KEY}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          }
        );
        const result = await response.json();
        return JSON.parse(result.candidates[0].content.parts[0].text);
      } catch (err) {
        if (i === 4) throw err;
        await new Promise(r => setTimeout(r, delay));
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
          media: extracted.media || "不明な媒体",
          dueDate: extracted.dueDate || "",
          description: extracted.description || "",
          status: '未処理',
          salesRep: '未割り当て',
          createdAt: new Date().toISOString(),
          fileName: file.name,
          userId: user.uid
        });
        setIsUploading(false);
      };
      reader.readAsDataURL(file);
    } catch (error) {
      console.error("Upload/AI error:", error);
      setIsUploading(false);
    }
  };

  const updateStatus = async (id, newStatus) => {
    const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'invoices', id);
    await updateDoc(docRef, { status: newStatus });
  };

  const updateRep = async (id, newRep) => {
    const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'invoices', id);
    await updateDoc(docRef, { salesRep: newRep });
  };

  const deleteInvoice = async (id) => {
    const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'invoices', id);
    await deleteDoc(docRef);
  };

  const filteredInvoices = invoices.filter(inv => {
    const statusMatch = filterStatus === 'All' || inv.status === filterStatus;
    const repMatch = filterRep === 'All' || inv.salesRep === filterRep;
    return statusMatch && repMatch;
  });

  const uniqueReps = ['未割り当て', ...new Set(invoices.map(i => i.salesRep).filter(r => r !== '未割り当て'))];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 p-4 md:p-8 font-sans">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold text-slate-800 tracking-tight">Invoice AI Manager</h1>
            <p className="text-slate-500 mt-1">請求書の自動解析とステータス管理</p>
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
              {isUploading ? "解析中..." : "請求書をアップロード"}
            </button>
          </div>
        </header>

        {/* Stats Summary */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100">
            <div className="text-slate-400 text-sm font-medium mb-1">総請求額</div>
            <div className="text-2xl font-bold">¥{invoices.reduce((sum, i) => sum + (i.amount || 0), 0).toLocaleString()}</div>
          </div>
          <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100">
            <div className="text-slate-400 text-sm font-medium mb-1">未処理</div>
            <div className="text-2xl font-bold text-orange-500">{invoices.filter(i => i.status === '未処理').length}件</div>
          </div>
          <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100">
            <div className="text-slate-400 text-sm font-medium mb-1">対応中</div>
            <div className="text-2xl font-bold text-blue-500">{invoices.filter(i => i.status === '処理中').length}件</div>
          </div>
          <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100">
            <div className="text-slate-400 text-sm font-medium mb-1">完了</div>
            <div className="text-2xl font-bold text-emerald-500">{invoices.filter(i => i.status === '完了').length}件</div>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-4 mb-6">
          <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-lg border border-slate-200 text-sm">
            <Filter className="w-4 h-4 text-slate-400" />
            <span className="text-slate-500 mr-2">ステータス:</span>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="outline-none bg-transparent font-medium"
            >
              <option value="All">すべて</option>
              {STATUS_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
            </select>
          </div>

          <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-lg border border-slate-200 text-sm">
            <User className="w-4 h-4 text-slate-400" />
            <span className="text-slate-500 mr-2">担当者:</span>
            <select
              value={filterRep}
              onChange={(e) => setFilterRep(e.target.value)}
              className="outline-none bg-transparent font-medium"
            >
              <option value="All">すべて</option>
              {uniqueReps.map(rep => <option key={rep} value={rep}>{rep}</option>)}
            </select>
          </div>
        </div>

        {/* Invoice List */}
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
                      データがありません。請求書をアップロードしてください。
                    </td>
                  </tr>
                ) : (
                  filteredInvoices.map((inv) => (
                    <tr key={inv.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="px-6 py-4">
                        <div className="font-semibold text-slate-800">{inv.media}</div>
                        <div className="text-xs text-slate-400 flex items-center gap-1 mt-0.5">
                          <Tag className="w-3 h-3" /> {inv.description || "詳細なし"}
                        </div>
                      </td>
                      <td className="px-6 py-4 font-mono font-medium text-slate-700">
                        ¥{(inv.amount || 0).toLocaleString()}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2 text-sm text-slate-600">
                          <Calendar className="w-4 h-4 text-slate-400" />
                          <span className={new Date(inv.dueDate) < new Date() && inv.status !== '完了' ? "text-red-500 font-bold" : ""}>
                            {inv.dueDate || "未設定"}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <input
                          type="text"
                          defaultValue={inv.salesRep}
                          onBlur={(e) => updateRep(inv.id, e.target.value)}
                          className="bg-slate-50 border border-slate-200 rounded px-2 py-1 text-sm focus:ring-2 focus:ring-indigo-200 outline-none w-32"
                          placeholder="氏名を入力"
                        />
                      </td>
                      <td className="px-6 py-4">
                        <select
                          value={inv.status}
                          onChange={(e) => updateStatus(inv.id, e.target.value)}
                          className={`text-xs font-bold px-2.5 py-1 rounded-full border appearance-none cursor-pointer outline-none ${
                            inv.status === '完了' ? 'bg-emerald-50 text-emerald-600 border-emerald-200' :
                            inv.status === '処理中' ? 'bg-blue-50 text-blue-600 border-blue-200' :
                            inv.status === '未処理' ? 'bg-orange-50 text-orange-600 border-orange-200' :
                            'bg-slate-50 text-slate-600 border-slate-200'
                          }`}
                        >
                          {STATUS_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
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

        {/* Tips */}
        <div className="mt-8 bg-indigo-50 p-6 rounded-2xl border border-indigo-100 flex gap-4">
          <div className="bg-indigo-600 p-2 rounded-xl h-fit">
            <AlertCircle className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="font-bold text-indigo-900 mb-1">AI解析のヒント</h3>
            <p className="text-sm text-indigo-700 leading-relaxed">
              請求書の画像をアップロードすると、AIが自動的に金額や媒体を読み取ります。
              担当者名は「担当営業」欄を直接クリックして入力することで、次回からフィルタリングも可能になります。
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
