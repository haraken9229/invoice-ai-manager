import React, { useState, useEffect, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';
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

// --- Supabase ---
const SUPABASE_URL  = import.meta.env.VITE_SUPABASE_URL  || '';
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
const supabase = SUPABASE_URL && SUPABASE_ANON
  ? createClient(SUPABASE_URL, SUPABASE_ANON)
  : null;

// --- Gemini ---
const GEMINI_KEY  = import.meta.env.VITE_GEMINI_API_KEY || '';
const MODEL_NAME  = 'gemini-2.5-flash-preview-05-20';
const STATUS_OPTIONS = ['未処理', '処理中', '承認待ち', '完了'];

// --- Date helpers ---
const getToday = () => { const d = new Date(); d.setHours(0,0,0,0); return d; };
const endOfWeek  = () => { const d = getToday(); d.setDate(d.getDate() + (7 - d.getDay())); return d; };
const endOfMonth = () => { const t = getToday(); return new Date(t.getFullYear(), t.getMonth()+1, 0, 23,59,59,999); };

const DUE_DATE_OPTIONS = [
  { value: 'All',       label: 'すべて' },
  { value: 'overdue',   label: '期限超過' },
  { value: 'thisWeek',  label: '今週中' },
  { value: 'thisMonth', label: '今月中' },
  { value: 'noDue',     label: '期日未設定' },
];

function matchesDue(inv, f) {
  if (f === 'All') return true;
  if (f === 'noDue') return !inv.due_date;
  if (!inv.due_date) return false;
  const due = new Date(inv.due_date);
  const t = getToday();
  if (f === 'overdue')   return due < t && inv.status !== '完了';
  if (f === 'thisWeek')  return due >= t && due <= endOfWeek();
  if (f === 'thisMonth') return due >= t && due <= endOfMonth();
  return true;
}

function dueCls(inv) {
  if (!inv.due_date || inv.status === '完了') return '';
  const due = new Date(inv.due_date);
  if (due < getToday()) return 'text-red-600 font-bold';
  if ((due - getToday()) / 86400000 <= 3) return 'text-orange-500 font-semibold';
  return '';
}

function DueBadge({ inv }) {
  if (!inv.due_date || inv.status === '完了') return null;
  const due = new Date(inv.due_date);
  const t = getToday();
  if (due < t) return <span className="ml-1 text-[10px] bg-red-100 text-red-600 font-bold px-1.5 py-0.5 rounded-full">超過</span>;
  const diff = Math.ceil((due - t) / 86400000);
  if (diff <= 3) return <span className="ml-1 text-[10px] bg-orange-100 text-orange-600 font-bold px-1.5 py-0.5 rounded-full">あと{diff}日</span>;
  return null;
}

// ── Supabase 未設定時のガイド ──────────────────────────────
function SetupGuide() {
  return (
    <div style={{minHeight:'100vh',background:'#f0f4f8',display:'flex',alignItems:'center',justifyContent:'center',padding:'24px',fontFamily:'sans-serif'}}>
      <div style={{background:'#fff',borderRadius:'16px',padding:'40px',maxWidth:'580px',width:'100%',boxShadow:'0 4px 24px rgba(0,0,0,0.08)'}}>
        <div style={{fontSize:'48px',textAlign:'center',marginBottom:'16px'}}>🔧</div>
        <h1 style={{fontSize:'22px',fontWeight:'800',color:'#0f172a',textAlign:'center',marginBottom:'8px'}}>Supabase 設定が必要です</h1>
        <p style={{color:'#64748b',fontSize:'14px',textAlign:'center',marginBottom:'28px',lineHeight:'1.6'}}>
          Vercel / ローカルの環境変数に Supabase の接続情報を追加してください。
        </p>

        <div style={{background:'#f8fafc',borderRadius:'10px',padding:'20px',marginBottom:'20px',border:'1px solid #e2e8f0'}}>
          <div style={{fontSize:'13px',fontWeight:'700',color:'#374151',marginBottom:'12px'}}>📋 Supabase テーブル作成 SQL</div>
          <pre style={{background:'#1e293b',color:'#e2e8f0',borderRadius:'8px',padding:'14px',fontSize:'12px',overflowX:'auto',lineHeight:'1.6'}}>{`create table invoices (
  id         uuid    default gen_random_uuid() primary key,
  amount     numeric default 0,
  media      text,
  due_date   date,
  description text,
  status     text    default '未処理',
  sales_rep  text    default '未割り当て',
  file_name  text,
  created_at timestamptz default now()
);

-- RLS を有効化（全員が読み書き可能な例）
alter table invoices enable row level security;
create policy "public access"
  on invoices for all using (true) with check (true);`}</pre>
        </div>

        <div style={{background:'#1e293b',borderRadius:'10px',padding:'16px',marginBottom:'20px'}}>
          <div style={{fontSize:'11px',color:'#94a3b8',marginBottom:'8px',fontWeight:'600'}}>環境変数（Vercel / .env.local）</div>
          <pre style={{fontFamily:'monospace',fontSize:'12px',color:'#e2e8f0',lineHeight:'1.8',margin:0}}>{`VITE_SUPABASE_URL      = https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY = eyJh...（anon / public キー）
VITE_GEMINI_API_KEY    = AIza...（任意・AI解析用）`}</pre>
        </div>

        <div style={{background:'#eff6ff',borderRadius:'10px',padding:'14px',border:'1px solid #bfdbfe',fontSize:'13px',color:'#1e40af',lineHeight:'1.6'}}>
          💡 Supabase の URL と anon key は <strong>Supabase Console</strong> → Project Settings → API から取得できます。
        </div>
      </div>
    </div>
  );
}

// ── メインアプリ ────────────────────────────────────────────
export default function App() {
  if (!supabase) return <SetupGuide />;

  const [invoices, setInvoices]       = useState([]);
  const [isUploading, setIsUploading] = useState(false);
  const [filterStatus, setFilterStatus] = useState('All');
  const [filterRep,    setFilterRep]    = useState('All');
  const [filterDue,    setFilterDue]    = useState('All');
  const fileInputRef = useRef(null);

  // ── データ取得 ──
  const fetchInvoices = async () => {
    const { data, error } = await supabase
      .from('invoices')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) console.error(error);
    else setInvoices(data || []);
  };

  useEffect(() => { fetchInvoices(); }, []);

  // ── AI 抽出 ──
  const extractInvoiceData = async (base64Data) => {
    if (!GEMINI_KEY) return { amount: 0, media: 'API KEY 未設定', due_date: '', description: 'VITE_GEMINI_API_KEY を設定してください' };

    const payload = {
      contents: [{ role: 'user', parts: [
        { text: 'この請求書から情報を抽出してください。' },
        { inlineData: { mimeType: 'image/png', data: base64Data } },
      ]}],
      systemInstruction: { parts: [{ text: `
        あなたは請求書解析の専門家です。以下のJSONキーで情報を返してください。
        - amount: 数値のみ（記号・カンマ不可）
        - media: 媒体名や発行元
        - due_date: YYYY-MM-DD形式（不明なら1ヶ月後）
        - description: 備考や主な項目
      `}]},
      generationConfig: { responseMimeType: 'application/json' },
    };

    let delay = 1000;
    for (let i = 0; i < 5; i++) {
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent?key=${GEMINI_KEY}`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
        );
        const result = await res.json();
        return JSON.parse(result.candidates[0].content.parts[0].text);
      } catch (err) {
        if (i === 4) throw err;
        await new Promise(r => setTimeout(r, delay));
        delay *= 2;
      }
    }
  };

  // ── ファイルアップロード ──
  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';
    setIsUploading(true);
    try {
      const reader = new FileReader();
      reader.onloadend = async () => {
        let extracted = { amount: 0, media: file.name, due_date: '', description: '' };
        try { extracted = await extractInvoiceData(reader.result.split(',')[1]); } catch {}
        const { error } = await supabase.from('invoices').insert({
          amount:      Number(extracted.amount) || 0,
          media:       extracted.media      || file.name,
          due_date:    extracted.due_date   || null,
          description: extracted.description || '',
          status:    '未処理',
          sales_rep: '未割り当て',
          file_name: file.name,
        });
        if (error) console.error(error);
        else await fetchInvoices();
        setIsUploading(false);
      };
      reader.readAsDataURL(file);
    } catch (err) {
      console.error(err);
      setIsUploading(false);
    }
  };

  const updateField = async (id, fields) => {
    const { error } = await supabase.from('invoices').update(fields).eq('id', id);
    if (error) console.error(error);
    else await fetchInvoices();
  };

  const deleteInvoice = async (id) => {
    const { error } = await supabase.from('invoices').delete().eq('id', id);
    if (error) console.error(error);
    else await fetchInvoices();
  };

  // ── フィルタリング ──
  const filtered = invoices.filter(inv => {
    if (filterStatus !== 'All' && inv.status !== filterStatus) return false;
    if (filterRep    !== 'All' && inv.sales_rep !== filterRep) return false;
    if (!matchesDue(inv, filterDue)) return false;
    return true;
  });

  const uniqueReps = ['未割り当て', ...new Set(
    invoices.map(i => i.sales_rep).filter(r => r && r !== '未割り当て')
  )];

  const overdueCount = invoices.filter(
    i => i.due_date && new Date(i.due_date) < getToday() && i.status !== '完了'
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
            <input type="file" accept="image/*,application/pdf" className="hidden" ref={fileInputRef} onChange={handleFileUpload} />
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
            <div className="text-2xl font-bold">¥{invoices.reduce((s,i) => s+(i.amount||0),0).toLocaleString()}</div>
          </div>
          <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100">
            <div className="text-slate-400 text-sm font-medium mb-1">未処理</div>
            <div className="text-2xl font-bold text-orange-500">{invoices.filter(i=>i.status==='未処理').length}件</div>
          </div>
          <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100">
            <div className="text-slate-400 text-sm font-medium mb-1">対応中</div>
            <div className="text-2xl font-bold text-blue-500">{invoices.filter(i=>i.status==='処理中').length}件</div>
          </div>
          <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100">
            <div className="text-slate-400 text-sm font-medium mb-1">完了</div>
            <div className="text-2xl font-bold text-emerald-500">{invoices.filter(i=>i.status==='完了').length}件</div>
          </div>
          <div
            className={`p-4 rounded-2xl shadow-sm border cursor-pointer transition-colors ${
              overdueCount > 0
                ? filterDue==='overdue' ? 'bg-red-100 border-red-300' : 'bg-red-50 border-red-200 hover:bg-red-100'
                : 'bg-white border-slate-100'
            }`}
            onClick={() => setFilterDue(filterDue==='overdue'?'All':'overdue')}
          >
            <div className="text-slate-400 text-sm font-medium mb-1">期限超過</div>
            <div className={`text-2xl font-bold ${overdueCount>0?'text-red-600':'text-slate-400'}`}>{overdueCount}件</div>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3 mb-6">
          <div className="flex items-center gap-2 bg-white px-3 py-2 rounded-lg border border-slate-200 text-sm">
            <Filter className="w-4 h-4 text-slate-400" />
            <span className="text-slate-500">ステータス:</span>
            <select value={filterStatus} onChange={e=>setFilterStatus(e.target.value)} className="outline-none bg-transparent font-medium">
              <option value="All">すべて</option>
              {STATUS_OPTIONS.map(o=><option key={o} value={o}>{o}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2 bg-white px-3 py-2 rounded-lg border border-slate-200 text-sm">
            <User className="w-4 h-4 text-slate-400" />
            <span className="text-slate-500">担当者:</span>
            <select value={filterRep} onChange={e=>setFilterRep(e.target.value)} className="outline-none bg-transparent font-medium">
              <option value="All">すべて</option>
              {uniqueReps.map(r=><option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2 bg-white px-3 py-2 rounded-lg border border-slate-200 text-sm">
            <Clock className="w-4 h-4 text-slate-400" />
            <span className="text-slate-500">期限:</span>
            <select value={filterDue} onChange={e=>setFilterDue(e.target.value)} className="outline-none bg-transparent font-medium">
              {DUE_DATE_OPTIONS.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          {anyFilterActive && (
            <button onClick={()=>{setFilterStatus('All');setFilterRep('All');setFilterDue('All');}} className="text-xs text-indigo-600 hover:text-indigo-800 underline">
              フィルターをリセット
            </button>
          )}
          <span className="ml-auto text-sm text-slate-400">{filtered.length} / {invoices.length} 件表示</span>
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
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan="6" className="px-6 py-12 text-center text-slate-400">
                      {invoices.length === 0 ? 'データがありません。請求書をアップロードしてください。' : '該当するデータがありません。'}
                    </td>
                  </tr>
                ) : filtered.map(inv => (
                  <tr key={inv.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="px-6 py-4">
                      <div className="font-semibold text-slate-800">{inv.media}</div>
                      <div className="text-xs text-slate-400 flex items-center gap-1 mt-0.5">
                        <Tag className="w-3 h-3" /> {inv.description || '詳細なし'}
                      </div>
                    </td>
                    <td className="px-6 py-4 font-mono font-medium text-slate-700">¥{(inv.amount||0).toLocaleString()}</td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-1 text-sm">
                        <Calendar className="w-4 h-4 text-slate-400 shrink-0" />
                        <span className={dueCls(inv)}>{inv.due_date || '未設定'}</span>
                        <DueBadge inv={inv} />
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <input
                        type="text"
                        defaultValue={inv.sales_rep}
                        onBlur={e => updateField(inv.id, { sales_rep: e.target.value || '未割り当て' })}
                        className="bg-slate-50 border border-slate-200 rounded px-2 py-1 text-sm focus:ring-2 focus:ring-indigo-200 outline-none w-32"
                        placeholder="氏名を入力"
                      />
                    </td>
                    <td className="px-6 py-4">
                      <select
                        value={inv.status}
                        onChange={e => updateField(inv.id, { status: e.target.value })}
                        className={`text-xs font-bold px-2.5 py-1 rounded-full border appearance-none cursor-pointer outline-none ${
                          inv.status==='完了'   ? 'bg-emerald-50 text-emerald-600 border-emerald-200' :
                          inv.status==='処理中' ? 'bg-blue-50 text-blue-600 border-blue-200' :
                          inv.status==='未処理' ? 'bg-orange-50 text-orange-600 border-orange-200' :
                                                  'bg-slate-50 text-slate-600 border-slate-200'
                        }`}
                      >
                        {STATUS_OPTIONS.map(o=><option key={o} value={o}>{o}</option>)}
                      </select>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button onClick={()=>deleteInvoice(inv.id)} className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
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
              請求書をアップロードするとAIが金額・媒体・期日を自動抽出します（Gemini API キー設定時）。
              データは Supabase にリアルタイム保存されます。
              期限フィルターで超過・今週中・今月中に絞り込み、担当者名入力で担当者フィルターに反映されます。
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
