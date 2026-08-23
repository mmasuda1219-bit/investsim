'use client'

// /analyze — /lab（無料の数字プレビュー）と /report（AIレポート）を単一の
// 統合入口に束ねる背骨。
//
// S1: クイックモード（ニーズ軸プリセット）＋銘柄指定あり。
//   フロー: ニーズ軸プリセット選択 → /api/lab/backtest(needsモード) で無料プレビュー
//   → 「この条件でAIレポート生成」→ 同じプリセットの CompositeCondition をそのまま
//   /api/report/prepare → /api/report/generate へ渡し、既存の専門レポートを表示する。
//
// S2: プロモード（銘柄指定あり）。ProConditionPicker（分析タイプ軸: ファンダ/
//   テクニカル/ハイブリッド）で CompositeCondition を組み立て、lab-backtest は
//   使わずに「プレビュー」ボタン→/api/report/prepare（非AI・ゲート＋5年バックテスト）、
//   「AIレポート生成」ボタン→/api/report/generate、と2段を別ボタンに分割して呼ぶ。
//   結果表示（bundle要約・透明性カード・教訓使用状況・引用元）はクイックと共通再利用。
//
// S3: 投資家モデル（銘柄指定あり）。InvestorModelPicker（バフェット/グレアム/
//   リンチの3モデル・lib/backtest/investor-presets.ts）で CompositeCondition を
//   選択し、S2のプロモードと全く同じ2段ボタン（プレビュー→AIレポート生成）に流す。
//   投資家名は表示のみに使い、generate へのプロンプトには注入しない（AIが「本人が
//   買う」と断定できない構造を維持・COMPANY.md 原則9）。
//
// 銘柄指定なしは引き続きプレースホルダ（/lab の investor 無効化と同手法）。
// 新しいAPIルート・新しいデータ源はゼロ（既存 /lab・/report をそのまま再利用）。

import { useRef, useState } from 'react'
import Link from 'next/link'
import type { ReactNode } from 'react'
import type { CompositeCondition, InvestorModelId, NeedsPresetId } from '@/lib/backtest/types'
import {
  NEEDS_PRESETS,
  NEEDS_PRESET_IDS,
  getNeedsPresetCondition,
  type LabNeedsResponse,
} from '@/lib/backtest/presets'
import {
  INVESTOR_PRESETS,
  INVESTOR_PRESET_IDS,
  getInvestorPresetCondition,
} from '@/lib/backtest/investor-presets'
import { describeFundamentalFilter, formatMetricValue } from '@/lib/backtest/fundamental'
import type { PreparedBundle, PrepareResponse, ReaderProfile } from '@/lib/report/types'
import { describeCompositeCondition } from '@/lib/report/prompt'
import { buildTransparencyCard } from '@/lib/report/transparency'
import { buildExecutionPlan } from '@/lib/report/execution'
import { US_UNIVERSE } from '@/lib/market/us-universe'
import type { ScreenResponse } from '@/lib/screen/types'
import ProConditionPicker from '@/components/analyze/ProConditionPicker'
import InvestorModelPicker from '@/components/analyze/InvestorModelPicker'
import ReaderProfilePanel from '@/components/analyze/ReaderProfilePanel'
import ConditionSummaryBar from '@/components/analyze/ConditionSummaryBar'
import AnalyzeBanner from '@/components/analyze/AnalyzeBanner'
import ModeScopeBar from '@/components/analyze/ModeScopeBar'
import MetricStrip from '@/components/analyze/MetricStrip'
import type { MetricStripGateItem, MetricStripItem } from '@/components/analyze/MetricStrip'
import DetailsSection from '@/components/analyze/DetailsSection'
import ExecutionPlanCard from '@/components/analyze/ExecutionPlanCard'

type AnalyzeMode = 'quick' | 'pro' | 'investor'
type AnalyzeScope = 'with-symbol' | 'no-symbol'

// S3で投資家モデルを有効化（バフェット/グレアム/リンチの3モデル）。
// S5aで銘柄指定なし（自動スクリーニング）を有効化。ただしスクリーニングは
// quick/investorのみ対応（プロ＝カスタム条件は/api/analyze/screen非対応。
// UI側は mode==='pro' の場合その旨のメッセージを表示する）。
export const ANALYZE_MODE_TABS: { id: AnalyzeMode; label: string; disabled?: boolean }[] = [
  { id: 'quick',    label: 'クイック' },
  { id: 'pro',      label: 'プロ' },
  { id: 'investor', label: '投資家モデル' },
]

export const ANALYZE_SCOPE_OPTIONS: { id: AnalyzeScope; label: string; disabled?: boolean }[] = [
  { id: 'with-symbol', label: '銘柄指定あり' },
  { id: 'no-symbol',   label: '銘柄指定なし（自動スクリーニング）' },
]

// ── S-B2: MetricStrip（Tier1「結論」）の「この数字の意味」注記。無料プレビュー・
// AIレポート実行結果の両方の5指標グリッドで共有する（同じ性質の数字のため文面も
// 共通）。将来 S-C/S-D/S-E で計5箇所に増える前提で InsightNote 側は汎用化済み —
// ここでは今回の1文面だけを定義する。
// 1要素＝1文（各要素が1つの<p>になるため、文の途中で要素を切らない）。
const METRIC_INSIGHT_LINES = [
  '過去5年の実データに、あなたが選んだ条件をあてはめて計算した結果です。',
  '手数料・税金・売買のタイミングのズレは考慮していない簡略計算のため、実際に同じ売買をした場合の成績とは必ず違いが出ます。',
  '将来同じ成績になることを示すものではありません。',
]

type PreviewPhase = 'idle' | 'loading' | 'done'
// 'prepared' はプロモード専用: prepare段階（無料プレビュー相当）が終わり、
// AIレポート生成ボタンの実行待ちになっている状態（S2）。
type ReportPhase = 'idle' | 'preparing' | 'prepared' | 'generating' | 'done'

function formatMoney(v: number, currency: string) {
  return v.toLocaleString(currency === 'JPY' ? 'ja-JP' : 'en-US', {
    style: 'currency', currency,
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  })
}

// ── Minimal Markdown renderer（/report page.tsx と同一パターンの複製 — 共有部品
// 化はS1計画外。headings / bullets / bold / links のみ・依存ゼロ）。
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  return text
    .split(/(\*\*[^*]+\*\*|\[[^\]]+\]\(https?:\/\/[^)]+\)|https?:\/\/[^\s)]+)/g)
    .map((part, i) => {
      const key = `${keyPrefix}-${i}`
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={key} className="text-white font-semibold">{part.slice(2, -2)}</strong>
      }
      const md = part.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/)
      if (md) {
        return <a key={key} href={md[2]} target="_blank" rel="noopener noreferrer" className="text-blue-400 underline hover:text-blue-300 break-all">{md[1]}</a>
      }
      if (/^https?:\/\//.test(part)) {
        return <a key={key} href={part} target="_blank" rel="noopener noreferrer" className="text-blue-400 underline hover:text-blue-300 break-all">{part}</a>
      }
      return <span key={key}>{part}</span>
    })
}

function MarkdownView({ text }: { text: string }) {
  const lines = text.split('\n')
  return (
    <div className="space-y-1.5 text-sm leading-relaxed text-slate-300">
      {lines.map((line, i) => {
        if (line.startsWith('## ')) {
          return (
            <h2 key={i} className="text-white text-base font-bold mt-5 mb-1 pb-1 border-b border-border">
              {line.slice(3)}
            </h2>
          )
        }
        if (line.startsWith('### ')) {
          return <h3 key={i} className="text-white text-sm font-semibold mt-3">{line.slice(4)}</h3>
        }
        if (/^\s*[-•*]\s+/.test(line)) {
          return (
            <div key={i} className="flex gap-2 pl-2">
              <span className="text-slate-500 shrink-0">•</span>
              <span>{renderInline(line.replace(/^\s*[-•*]\s+/, ''), `l${i}`)}</span>
            </div>
          )
        }
        if (line.trim() === '') return <div key={i} className="h-1" />
        return <p key={i}>{renderInline(line, `l${i}`)}</p>
      })}
    </div>
  )
}

// ── Stage 1/2 の共有ヘルパ（S2: プロモードはボタンを2つに分割して使う） ──────
// クイックモードの runReport（1ボタンで prepare→generate を連続実行）と、
// プロモードの runProPreview/runProGenerate（別ボタンで分割実行）の両方から
// 同じ実装を呼ぶ。新しいAPIルート・新しいデータ源は増やさない（原則2/8/9）。

async function prepareBundle(input: {
  symbol: string
  condition: CompositeCondition
  initialCapital?: number
}): Promise<PreparedBundle> {
  const prepRes = await fetch('/api/report/prepare', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!prepRes.ok) {
    const err = await prepRes.json().catch(() => ({}))
    throw new Error(err.error ?? `準備に失敗しました (HTTP ${prepRes.status})`)
  }
  const { bundle } = (await prepRes.json()) as PrepareResponse
  return bundle
}

async function streamGeneratedReport(
  bundle: PreparedBundle,
  onChunk: (chunk: string) => void,
  profile?: ReaderProfile,
): Promise<void> {
  const genRes = await fetch('/api/report/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // profile が undefined の場合 JSON.stringify がキー自体を落とすため、
    // 未回答時は今までどおり { bundle } だけが送られる（後方互換）。
    body: JSON.stringify({ bundle, profile }),
  })
  if (!genRes.ok || !genRes.body) {
    const err = await genRes.json().catch(() => ({}))
    throw new Error(err.error ?? `生成に失敗しました (HTTP ${genRes.status})`)
  }

  const reader = genRes.body.getReader()
  const decoder = new TextDecoder()
  let received = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = decoder.decode(value, { stream: true })
      if (chunk) {
        received += chunk.length
        onChunk(chunk)
      }
    }
    const tail = decoder.decode()
    if (tail) {
      received += tail.length
      onChunk(tail)
    }
  } catch {
    // サーバー側streamエラー or ネットワーク切断。部分表示は残したまま通知する。
    throw new Error(
      received > 0
        ? 'レポート生成が途中で中断されました（表示中の内容は部分的な結果です）。再試行してください。'
        : 'レポートの受信に失敗しました。ネットワークを確認して再試行してください。',
    )
  }
  if (received === 0) {
    throw new Error('AIからのレポートが空でした。少し待ってから再試行してください。')
  }
}

// fetch自体の失敗（ネットワーク断など）は英語の "Failed to fetch" になるため翻訳する
function toUserMessage(e: unknown): string {
  return e instanceof TypeError
    ? 'サーバーに接続できませんでした。ネットワークを確認して再試行してください。'
    : e instanceof Error ? e.message : 'エラーが発生しました'
}

export default function AnalyzePage() {
  const [mode, setMode] = useState<AnalyzeMode>('quick')
  const [scope, setScope] = useState<AnalyzeScope>('with-symbol')

  const [symbol, setSymbol] = useState('AAPL')
  const [capital, setCapital] = useState('100000')
  const [presetId, setPresetId] = useState<NeedsPresetId>('stable')

  const [previewPhase, setPreviewPhase] = useState<PreviewPhase>('idle')
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [previewRes, setPreviewRes] = useState<LabNeedsResponse | null>(null)

  const [reportPhase, setReportPhase] = useState<ReportPhase>('idle')
  const [reportError, setReportError] = useState<string | null>(null)
  const [bundle, setBundle] = useState<PreparedBundle | null>(null)
  const [report, setReport] = useState('')
  const runningReportRef = useRef(false)

  // ── 読者プロファイル（/analyze S1）: 3問必須＋4問目(資金の性格)は任意。
  // すべて未回答（''）ならAIレポートはprofileを一切送らない＝既存挙動のまま。
  // profileはbundleを無効化しない（数値・判定は変わらない強調レンズのため）
  // ので、変更時に resetDownstream は呼ばない — prepare結果を再利用できる。
  const [profileHorizon, setProfileHorizon] = useState<ReaderProfile['horizon'] | ''>('')
  const [profileTolerance, setProfileTolerance] = useState<ReaderProfile['tolerance'] | ''>('')
  const [profileStyle, setProfileStyle] = useState<ReaderProfile['style'] | ''>('')
  const [profileCapacity, setProfileCapacity] = useState<NonNullable<ReaderProfile['capacity']> | ''>('')
  const readerProfile: ReaderProfile | undefined =
    profileHorizon && profileTolerance && profileStyle
      ? { horizon: profileHorizon, tolerance: profileTolerance, style: profileStyle, ...(profileCapacity ? { capacity: profileCapacity } : {}) }
      : undefined

  // ── S5a: 銘柄指定なし（自動スクリーニング）。quick/investorのみ対応（プロは
  // /api/analyze/screen非対応）。プリセット選択はここでは screenNeedsPresetId /
  // screenInvestorId として独立管理する（with-symbol側の presetId / investorCondition
  // とは別の状態 — 混ぜると「今表示している結果がどちらの入力由来か」が曖昧になる
  // ため。TOP行選択時は銘柄だけを with-symbol 側へ渡す最小導線に留める）。
  const [screenNeedsPresetId, setScreenNeedsPresetId] = useState<NeedsPresetId>('stable')
  const [screenInvestorId, setScreenInvestorId] = useState<InvestorModelId>(INVESTOR_PRESET_IDS[0])
  const [screenPhase, setScreenPhase] = useState<PreviewPhase>('idle')
  const [screenError, setScreenError] = useState<string | null>(null)
  const [screenRes, setScreenRes] = useState<ScreenResponse | null>(null)

  // リクエストID方式（レビュー指摘・原則9）: resetDownstream() の呼び出しの
  // たび（＝モード切替ハンドラ・銘柄/資金/プリセット変更・プロ条件変更のすべて）
  // にインクリメントする。runPreview/runReport/runProPreview/runProGenerate は
  // 開始時にこのIDを捕捉し、各 await の直後・setState の前に「現在のIDと一致するか」
  // を確認してから書き込む。不一致（＝待機中にモード切替や条件変更が起きた）なら
  // 結果を捨てて即 return する。これにより、fetch進行中に quick⇄pro を切り替えても
  // 古いリクエストの結果が別モード・別条件の共通表示ブロック（transparency/sources/
  // learningUsage 等）へ書き戻されることを防ぐ。
  const requestIdRef = useRef(0)

  // ── S-B1: 結果確定後に設定エリアを1行のサマリー帯へ自動圧縮する（見た目の
  // 開閉状態のみ・値は一切変えない）。「条件を編集」クリックで true にして
  // 再展開する。この state 自体の変更では resetDownstream は呼ばない（呼ぶと
  // 畳んだだけで結果が消えてしまうため）。値が変わって resetDownstream が
  // 走ったときだけ false に戻し、次の結果確定時にまた自動で畳まれるようにする。
  const [configForceOpen, setConfigForceOpen] = useState(false)

  // 条件（銘柄/資金/プリセット）を変えたら、古いプレビュー・古いレポートは
  // その条件の結果ではなくなるため必ず捨てる（原則9: 古い結果を新条件の結果と
  // 誤認させない）。
  const resetDownstream = () => {
    requestIdRef.current += 1
    setPreviewPhase('idle')
    setPreviewError(null)
    setPreviewRes(null)
    setReportPhase('idle')
    setReportError(null)
    setBundle(null)
    setReport('')
    setScreenPhase('idle')
    setScreenError(null)
    setScreenRes(null)
    setConfigForceOpen(false)
  }

  const runPreview = async () => {
    if (mode !== 'quick' || previewPhase === 'loading') return
    resetDownstream()
    const requestId = requestIdRef.current
    setPreviewPhase('loading')
    try {
      const res = await fetch('/api/lab/backtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'needs',
          symbol,
          presetId,
          initialCapital: Number(capital) || 100_000,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error ?? `HTTP ${res.status}`)
      }
      const data = (await res.json()) as LabNeedsResponse
      if (requestIdRef.current !== requestId) return // 待機中にモード切替/条件変更 → 結果を破棄
      setPreviewRes(data)
      setPreviewPhase('done')
    } catch (e) {
      if (requestIdRef.current !== requestId) return
      setPreviewError(e instanceof Error ? e.message : 'エラーが発生しました')
      setPreviewPhase('idle')
    }
  }

  // ── S5a: 銘柄指定なしのスクリーニング実行。/api/analyze/screen はキャッシュのみ
  // 読み（ライブ取得なし）・quick/investorのみ対応。空/薄いキャッシュでも200で
  // 「評価0件」を正直に返す実装のため、ここでは通常のエラーパス（HTTP以外)は
  // ネットワーク断など本当の障害のみを扱う。
  const runScreen = async () => {
    if (scope !== 'no-symbol' || (mode !== 'quick' && mode !== 'investor') || screenPhase === 'loading') return
    resetDownstream()
    const requestId = requestIdRef.current
    setScreenPhase('loading')
    try {
      const body =
        mode === 'quick'
          ? { mode: 'quick', presetId: screenNeedsPresetId }
          : { mode: 'investor', presetId: screenInvestorId }
      const res = await fetch('/api/analyze/screen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error ?? `HTTP ${res.status}`)
      }
      const data = (await res.json()) as ScreenResponse
      if (requestIdRef.current !== requestId) return // 待機中にモード切替/条件変更 → 結果を破棄
      setScreenRes(data)
      setScreenPhase('done')
    } catch (e) {
      if (requestIdRef.current !== requestId) return
      setScreenError(toUserMessage(e))
      setScreenPhase('idle')
    }
  }

  // TOP行クリック → その銘柄を「銘柄指定あり」の単一銘柄フローに渡す最小導線。
  // プリセット選択の同期・自動プレビュー実行はS5bのスコープ（ここでは銘柄のみ渡す）。
  const pickCandidateSymbol = (sym: string) => {
    setSymbol(sym)
    setScope('with-symbol')
    resetDownstream()
  }

  const runReport = async () => {
    if (mode !== 'quick' || !previewRes || runningReportRef.current) return
    runningReportRef.current = true
    const requestId = requestIdRef.current
    setReportError(null)
    setBundle(null)
    setReport('')
    setReportPhase('preparing')
    try {
      // 同じプリセットの CompositeCondition をそのまま流用する（新しい条件は発明しない）。
      const condition = getNeedsPresetCondition(presetId)

      // ── Stage 1: prepare（ゲート評価＋5年実データバックテスト）──────
      const prepared = await prepareBundle({ symbol, condition, initialCapital: Number(capital) || undefined })
      if (requestIdRef.current !== requestId) return // 待機中にモード切替/条件変更 → 結果を破棄
      setBundle(prepared)

      // ── Stage 2: generate（Opusストリーミング・ゲート不成立でも実行）──
      setReportPhase('generating')
      await streamGeneratedReport(prepared, chunk => {
        if (requestIdRef.current === requestId) setReport(prev => prev + chunk)
      }, readerProfile)
      if (requestIdRef.current !== requestId) return
      setReportPhase('done')
    } catch (e) {
      if (requestIdRef.current !== requestId) return
      setReportError(toUserMessage(e))
      setReportPhase('idle')
    } finally {
      runningReportRef.current = false
    }
  }

  // ── プロモード（S2）: プレビュー（prepare のみ・非AI）とAIレポート生成
  // （generate のみ）を別ボタンに分割する。lab-backtest は使わない（無改修）。
  const [proCondition, setProCondition] = useState<CompositeCondition | { error: string }>({
    error: '条件を読み込み中です',
  })

  // ── 投資家モデル（S3）: InvestorModelPicker は自由入力を持たない（ラジオ選択の
  // み）ため、常に有効な CompositeCondition を返す（エラー状態が無い）。プロモード
  // と全く同じ prepare→generate の2段ボタンに流すため、以下では mode に応じて
  // proCondition/investorCondition のどちらを「今アクティブな条件」として使うかを
  // activeCondition ひとつにまとめ、runProPreview/runProGenerate を両モード共用にする。
  // 選択されたモデルID自体は保持しない（投資家名をレポート生成へ一切渡さないため・
  // 表示は InvestorModelPicker 内部で完結する）。
  const [investorCondition, setInvestorCondition] = useState<CompositeCondition>(
    getInvestorPresetCondition(INVESTOR_PRESET_IDS[0]),
  )

  // ProConditionPicker の内部条件が変わるたびに呼ばれる。古い結果は新条件の
  // 結果ではなくなるため必ず捨てる（quick と同じ原則9の扱い・resetDownstream流用
  // ＝ここで requestIdRef もインクリメントされる）。
  const handleProConditionChange = (condition: CompositeCondition | { error: string }) => {
    setProCondition(condition)
    resetDownstream()
  }

  // InvestorModelPicker の選択が変わるたびに呼ばれる（同じ原則9の扱い）。
  const handleInvestorConditionChange = (condition: CompositeCondition) => {
    setInvestorCondition(condition)
    resetDownstream()
  }

  // 「今アクティブな条件」— プロモードなら proCondition、投資家モデルなら
  // investorCondition。それ以外（quick）では使われない（クイックは
  // getNeedsPresetCondition を直接使う既存経路のまま・無改修）。
  const activeCondition: CompositeCondition | { error: string } =
    mode === 'investor' ? investorCondition : proCondition

  const runProPreview = async () => {
    if ((mode !== 'pro' && mode !== 'investor') || runningReportRef.current) return
    if ('error' in activeCondition) {
      setReportError(activeCondition.error)
      return
    }
    runningReportRef.current = true
    const requestId = requestIdRef.current
    setReportError(null)
    setBundle(null)
    setReport('')
    setReportPhase('preparing')
    try {
      const prepared = await prepareBundle({
        symbol,
        condition: activeCondition,
        initialCapital: Number(capital) || undefined,
      })
      if (requestIdRef.current !== requestId) return // 待機中にモード切替/条件変更 → 結果を破棄
      setBundle(prepared)
      setReportPhase('prepared')
    } catch (e) {
      if (requestIdRef.current !== requestId) return
      setReportError(toUserMessage(e))
      setReportPhase('idle')
    } finally {
      runningReportRef.current = false
    }
  }

  const runProGenerate = async () => {
    if ((mode !== 'pro' && mode !== 'investor') || !bundle || reportPhase !== 'prepared' || runningReportRef.current) return
    runningReportRef.current = true
    const requestId = requestIdRef.current
    setReportError(null)
    setReport('')
    setReportPhase('generating')
    try {
      await streamGeneratedReport(bundle, chunk => {
        if (requestIdRef.current === requestId) setReport(prev => prev + chunk)
      }, readerProfile)
      if (requestIdRef.current !== requestId) return // 待機中にモード切替/条件変更 → 結果を破棄
      setReportPhase('done')
    } catch (e) {
      if (requestIdRef.current !== requestId) return
      setReportError(toUserMessage(e))
      // prepared済みのbundleは維持し、再生成だけやり直せるようにする（prepareのやり直しは不要）。
      setReportPhase('prepared')
    } finally {
      runningReportRef.current = false
    }
  }

  const busyPreview = previewPhase === 'loading'
  const busyReport = reportPhase === 'preparing' || reportPhase === 'generating'
  const quickActive = mode === 'quick'
  const preset = NEEDS_PRESETS[presetId]
  const m = previewRes?.result?.metrics
  const returnPositive = (m?.totalReturnPct ?? 0) >= 0
  const gate = bundle?.fundamentalGate
  const bm = bundle?.backtest?.metrics
  // 透明性カード（S4）: bundle 確定時に PreparedBundle の3要素だけから再計算する
  // 純関数（I/Oなし・新データ源なし）。bundle が無ければ表示しない。
  const transparency = bundle ? buildTransparencyCard(bundle) : null
  // 選んだルールの過去5年の成績カード（S-C・Tier2）: bundle だけを食う純関数
  // （I/Oなし・新データ源なし）。ReaderProfile はこのカードへ一切反映しない
  // （個別性が助言性を跳ね上げるため — 法務由来の設計制約）。
  const executionPlan = bundle ? buildExecutionPlan(bundle) : null

  // ── S-B2: MetricStrip（Tier1）用の変換 — 表示ロジック（フォーマット・色分け）は
  // ページ側に残し、MetricStrip自体は純粋な表示部品のまま保つ。値が無い項目は
  // 配列に入れない（捏造しない・原則9）。
  const previewMetricItems: MetricStripItem[] =
    m && previewRes?.result
      ? [
          {
            label: '総リターン（5年）',
            value: `${returnPositive ? '+' : ''}${m.totalReturnPct.toFixed(2)}%`,
            valueClassName: returnPositive ? 'text-green-400' : 'text-red-400',
            sub: formatMoney(previewRes.result.finalValue, previewRes.result.currency),
          },
          { label: '勝率', value: `${m.winRate.toFixed(0)}%` },
          { label: '最大DD', value: `-${m.maxDrawdownPct.toFixed(2)}%`, valueClassName: 'text-red-400' },
          { label: 'シャープレシオ', value: m.sharpeRatio.toFixed(2) },
          { label: '取引数', value: `${m.tradeCount}件` },
        ]
      : []
  const previewGateBreakdown: MetricStripGateItem[] =
    previewRes?.gate.evaluations.map(ev => ({
      label: describeFundamentalFilter(ev.filter),
      result: ev.result,
      // no_data時の文言はbundle側（下のbundleGateBreakdown）と統一する — 同じ
      // MetricStripに載るため表記ゆれ（「データなし」）を残さない（S3）。
      actualText:
        ev.result === 'no_data'
          ? '判定不能（実データ取得不可）'
          : ev.actual != null
            ? formatMetricValue(ev.filter.metric, ev.actual)
            : '—',
    })) ?? []

  const bundleMetricItems: MetricStripItem[] =
    bundle?.backtest && bm
      ? [
          {
            label: '総リターン（5年）',
            value: `${bm.totalReturnPct >= 0 ? '+' : ''}${bm.totalReturnPct.toFixed(2)}%`,
            valueClassName: bm.totalReturnPct >= 0 ? 'text-green-400' : 'text-red-400',
          },
          {
            label: 'バイ&ホールド',
            value: `${bundle.backtest.buyHoldReturnPct >= 0 ? '+' : ''}${bundle.backtest.buyHoldReturnPct.toFixed(2)}%`,
            valueClassName: bundle.backtest.buyHoldReturnPct >= 0 ? 'text-green-400' : 'text-red-400',
          },
          { label: '勝率', value: `${bm.winRate.toFixed(0)}%` },
          { label: '最大DD', value: `-${bm.maxDrawdownPct.toFixed(2)}%`, valueClassName: 'text-red-400' },
          { label: '取引数', value: `${bm.tradeCount}件` },
        ]
      : []
  const bundleGateBreakdown: MetricStripGateItem[] =
    gate?.evaluations.map(ev => ({
      label: describeFundamentalFilter(ev.filter),
      result: ev.result,
      actualText:
        ev.result === 'no_data'
          ? '判定不能（実データ取得不可）'
          : ev.actual != null
            ? formatMetricValue(ev.filter.metric, ev.actual)
            : '—',
    })) ?? []
  // ニーズ軸プリセットは米国株（USD建て）想定（/lab と同じ静的ゲートの限界）。
  const nonUsWarning = quickActive && symbol.trim().toUpperCase().endsWith('.T')

  // ── S-B1: 結果確定後に設定エリアをサマリー帯へ畳む条件。「結果」は bundle
  // （プロ/投資家モデルのprepare結果・クイックのAIレポート結果）または
  // previewRes（クイックの無料プレビュー）のどちらか。銘柄指定なし（screenRes）
  // はこの対象外（サマリー帯の項目がそもそも銘柄指定ありの入力を前提にしているため）。
  // プレビューがゲート不成立（gatePassed === false）のときは畳まない（S6）—
  // ユーザーが次にやることは「条件を直す」なので、設定エリアを開いたままにして
  // 修正の導線を確保する。
  const hasConfirmedResult =
    scope === 'with-symbol' &&
    (bundle !== null || (previewPhase === 'done' && previewRes !== null && previewRes.gatePassed))
  const configCollapsed = hasConfirmedResult && !configForceOpen

  // サマリー帯に表示する断片（表示できない項目は省略し、捏造しない）。
  const modeLabel = ANALYZE_MODE_TABS.find(t => t.id === mode)?.label
  const scopeLabel = ANALYZE_SCOPE_OPTIONS.find(o => o.id === scope)?.label
  const conditionSummaryText =
    mode === 'quick'
      ? `プリセット「${preset.label}」`
      : bundle
        ? describeCompositeCondition(bundle.request.condition)
        : undefined
  const summaryCurrency = bundle?.backtest?.currency ?? previewRes?.result?.currency
  // W5: サマリー帯の初期資金は「実際に実行へ使われた値」を表示する。実行側は
  // /api/report/prepare・/api/lab/backtest ともに「正の数でなければ100,000・
  // 上限10,000,000」へ正規化するため、入力文字列をそのまま出すと（例:「0」入力時）
  // 帯は$0・計算は100,000という食い違いが起きる。優先順: bundle.request
  // （prepareが正規化後の値をエコー）→ プレビュー結果（result.initialCapital）→
  // 入力値にサーバーと同じ正規化を通した値。
  const capitalInput = Number(capital)
  const usedCapital =
    bundle?.request.initialCapital ??
    previewRes?.result?.initialCapital ??
    (Number.isFinite(capitalInput) && capitalInput > 0 ? Math.min(capitalInput, 10_000_000) : 100_000)
  const capitalDisplay =
    `初期資金（仮想）${summaryCurrency ? formatMoney(usedCapital, summaryCurrency) : usedCapital.toLocaleString('ja-JP')}`
  const summaryItems = [modeLabel, scopeLabel, symbol, conditionSummaryText, capitalDisplay]
    .filter((v): v is string => Boolean(v && v.trim() !== ''))

  return (
    <div className="space-y-6">
      {/* Header + 恒久ディスクレーマ（免責）— S-B2でAnalyzeBannerに集約（横並び）。
          免責は設定中・プレビュー中・ストリーミング中も常に表示（内容は無改変）。 */}
      <AnalyzeBanner />

      {/* Config summary bar（S-B1）: bundle/previewRes 確定後、設定カードを畳んで
          代わりにこの1行サマリーを表示する。設定カード自体は下で display:none
          （hidden）にするだけで実際にはマウントしたまま保つ — ProConditionPicker /
          InvestorModelPicker は自身の内部stateを持つため、ここをアンマウントする
          と「条件を編集」で再展開したときに入力内容が消えてしまう（詳細はビルダー
          報告参照）。 */}
      {configCollapsed && (
        <ConditionSummaryBar items={summaryItems} onEdit={() => setConfigForceOpen(true)} />
      )}

      {/* Config */}
      <div className={configCollapsed ? 'hidden' : 'bg-panel border border-border rounded-xl p-5 space-y-5'}>
        {/* Mode tabs + Scope toggle（S-B2: ModeScopeBarへ統合・デスクトップは1行）。
            resetDownstream（fetch競合ガード・requestIdインクリメント）はここで従来どおり
            トリガーする — ModeScopeBar自体は選択肢のdisabled/同値ガードのみ担当し、
            ロジックは持たない。 */}
        <ModeScopeBar
          modeTabs={ANALYZE_MODE_TABS}
          mode={mode}
          onModeChange={id => {
            setMode(id)
            // モードを切り替えたら古い結果（別モードの条件に基づく）は破棄する（原則9）。
            // resetDownstream() が requestIdRef もインクリメントするため、進行中の
            // fetch（runReport/runProPreview/runProGenerate等）は解決しても無視される。
            resetDownstream()
          }}
          scopeOptions={ANALYZE_SCOPE_OPTIONS}
          scope={scope}
          onScopeChange={id => {
            setScope(id)
            // 範囲を切り替えたら古い結果（別範囲の入力に基づく）は破棄する（原則9）。
            resetDownstream()
          }}
        />

        {/* 銘柄指定あり: 既存の銘柄シンボル/初期資金＋quick/pro/investorパネル
            （S1/S2/S3のまま無改修）。銘柄指定なし時はアンマウントせず hidden
            （display:none）で隠すだけにする（W2）— ProConditionPicker /
            InvestorModelPicker は条件入力を内部stateで保持しており、アンマウント
            すると「銘柄指定なし」へ切替→戻す で入力が全部消えてしまう。モード
            切替（下のpro/investorパネル）と同じ hidden 方式に統一し、「切替で
            入力を失わない」保証を範囲切替にも適用する。 */}
        <div className={scope === 'with-symbol' ? 'space-y-5' : 'hidden'}>
        {/* 銘柄シンボル/初期資金（クイック・プロ共通・対象範囲=銘柄指定ありのみ機能） */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-muted mb-2">銘柄シンボル</label>
            <input
              value={symbol}
              onChange={e => { setSymbol(e.target.value.toUpperCase()); resetDownstream() }}
              placeholder="AAPL / MSFT"
              list="us-universe"
              className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-blue-500"
            />
            <datalist id="us-universe">
              {US_UNIVERSE.map(s => (
                <option key={s.symbol} value={s.symbol}>{`${s.name}（${s.sector}）`}</option>
              ))}
            </datalist>
            {/* 4段階を繋ぐ導線: まねる → やる。銘柄を引き継いで自分の判断に移れる */}
            {symbol.trim() && (
              <Link
                href={`/trade?symbol=${encodeURIComponent(symbol.trim())}`}
                className="inline-block mt-2 text-xs font-semibold text-emerald-400 hover:text-emerald-300 transition-colors"
              >
                {symbol.trim()} で自分も判断してみる →
              </Link>
            )}
          </div>
          <div>
            <label className="block text-xs text-muted mb-2">初期資金（仮想）</label>
            <input
              type="number" min="1000" step="1000"
              value={capital}
              onChange={e => { setCapital(e.target.value); resetDownstream() }}
              className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>

        {/* ── 読者プロファイル（/analyze S1・任意・銘柄指定あり全モード共通）:
            3問(投資期間/リスク耐性/スタイル志向)＋任意の4問目(資金の性格)。
            数値・判定・バックテストの中身は一切変えず、AIレポートの強調順序・
            語り口・意味づけだけを最適化するレンズ。未回答ならprofileを一切
            送らない（既存挙動のまま・後方互換）。resetDownstreamは呼ばない
            — bundleは無効化されないため、prepare結果を再利用したまま
            プロファイルだけ変えて再生成できる。 ── */}
        <ReaderProfilePanel
          horizon={profileHorizon}
          tolerance={profileTolerance}
          style={profileStyle}
          capacity={profileCapacity}
          onHorizonChange={setProfileHorizon}
          onToleranceChange={setProfileTolerance}
          onStyleChange={setProfileStyle}
          onCapacityChange={setProfileCapacity}
        />

        {/* ── Quick panel（銘柄指定あり・ニーズ軸プリセット）── S-B1: 他モードへの
            切替時はDOMごとアンマウントする（presetIdは親stateのため安全）。 ── */}
        {mode === 'quick' && (
        <div className="border border-border rounded-lg p-4 space-y-4">
          <div>
            <p className="text-sm text-white font-medium mb-2">ニーズ軸で選ぶ（5年・銘柄の参加条件つき）</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {NEEDS_PRESET_IDS.map(id => {
                const p = NEEDS_PRESETS[id]
                const selected = presetId === id
                return (
                  <label
                    key={id}
                    className={`block rounded-lg border p-3 cursor-pointer transition-colors ${
                      selected ? 'border-blue-500 bg-blue-950/30' : 'border-border bg-surface/50 hover:border-blue-600'
                    }`}
                  >
                    <span className="flex items-start gap-2">
                      <input
                        type="radio"
                        name="needs-preset"
                        value={id}
                        checked={presetId === id}
                        onChange={() => { setPresetId(id); resetDownstream() }}
                        className="mt-1 accent-blue-500"
                      />
                      <span>
                        <span className="block text-sm text-white font-medium">{p.label}</span>
                        <span className="block text-xs text-muted mt-1 leading-relaxed">「{p.description}」</span>
                      </span>
                    </span>
                  </label>
                )
              })}
            </div>
            {nonUsWarning && (
              <p className="mt-2 text-xs text-amber-400 bg-amber-950/30 border border-amber-700 rounded-lg px-3 py-2 leading-relaxed">
                ニーズ軸プリセットは米国株（USD建て）想定です。日本株（.T）では時価総額閾値の目安が実態とずれる可能性があります（実行は可能）。
              </p>
            )}
          </div>

          <button
            onClick={runPreview}
            disabled={busyPreview}
            className={`px-6 py-2.5 text-white text-sm font-medium rounded-lg transition-colors ${
              busyPreview ? 'bg-slate-700 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-500'
            }`}
          >
            {busyPreview ? '無料プレビュー実行中...' : '無料プレビューを実行（純計算・AIは使いません）'}
          </button>
        </div>
        )}

        {/* ── Pro panel（S2: 分析タイプ軸で条件ピッカーを出し分け・銘柄指定ありのみ）
            ── S-B1: ProConditionPicker は分析タイプ/期間/フィルタ行などを自身の
            内部stateで保持しており親にリフトアップされていない。ここをDOMごと
            アンマウントすると、他モードへ切替→戻ったときに入力内容が消える
            （劣化になる）ため、条件付きレンダリング（アンマウント）は見送り、
            非表示時は hidden（display:none）でスクロール高さだけを0にする
            （マウントは維持＝内部stateは保持される）。プレビュー/AIレポート生成
            ボタンは reviewer指摘により Config ラッパーの外（クイックと同じ位置）
            に移設した — 詳細は下の「Pro/Investor 2-stage buttons」ブロックを参照。 ── */}
        <div className={mode === 'pro' ? 'border border-border rounded-lg p-4 space-y-4' : 'hidden'}>
          <ProConditionPicker onConditionChange={handleProConditionChange} />

          {'error' in proCondition && (
            <p className="text-xs text-amber-400 bg-amber-950/20 border border-amber-800/40 rounded-lg px-3 py-2">
              {proCondition.error}
            </p>
          )}
        </div>

        {/* ── Investor panel（S3: 投資家モデル・銘柄指定ありのみ）
            ── S-B1: InvestorModelPicker も選択中モデルIDを内部stateで保持して
            おり（本ファイルの計画対象外・無改修）、ProConditionPickerと同じ理由
            でアンマウントは見送り、hidden（display:none）のみで高さを0にする。
            プレビュー/AIレポート生成ボタンは reviewer指摘により Config ラッパー
            の外（クイックと同じ位置）に移設した — 詳細は下の「Pro/Investor
            2-stage buttons」ブロックを参照。 ── */}
        <div className={mode === 'investor' ? 'border border-border rounded-lg p-4 space-y-4' : 'hidden'}>
          <InvestorModelPicker onConditionChange={handleInvestorConditionChange} />
        </div>
        </div>

        {/* ── S5a: 銘柄指定なし（自動スクリーニング）。キャッシュ済みユニバース
            （lib/screen/cache.ts）に quick/investor の条件を適用し、適合度TOPを
            表示する。ライブ取得は一切しない（原則9・60秒制約）。プロ（カスタム
            条件）は非対応 — 導出規約（先頭フィルタで第2キーを決める）と汎用
            カスタム条件は相性が悪いため対象外にし、その旨をメッセージで明示する。 */}
        {scope === 'no-symbol' && (
          <div className="border border-border rounded-lg p-4 space-y-4">
            {mode === 'pro' ? (
              <p className="text-sm text-amber-300 bg-amber-950/20 border border-amber-800/40 rounded-lg px-3 py-3 leading-relaxed">
                銘柄指定なし（自動スクリーニング）はプロ（カスタム条件）に対応していません。
                クイックまたは投資家モデルのタブに切り替えてご利用ください。
              </p>
            ) : (
              <>
                <div>
                  <p className="text-sm text-white font-medium mb-1">
                    {mode === 'quick' ? 'ニーズ軸プリセットで適合銘柄を探す' : '投資家モデルで適合銘柄を探す'}
                  </p>
                  <p className="text-xs text-muted leading-relaxed">
                    事前計算済みキャッシュ（現在値ファンダメンタル）にのみ条件を適用します。ライブ取得・バックテスト・決算派生の評価はここでは行いません。
                  </p>
                </div>

                {mode === 'quick' ? (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {NEEDS_PRESET_IDS.map(id => {
                      const p = NEEDS_PRESETS[id]
                      const selected = screenNeedsPresetId === id
                      return (
                        <label
                          key={id}
                          className={`block rounded-lg border p-3 cursor-pointer transition-colors ${
                            selected ? 'border-blue-500 bg-blue-950/30' : 'border-border bg-surface/50 hover:border-blue-600'
                          }`}
                        >
                          <span className="flex items-start gap-2">
                            <input
                              type="radio"
                              name="screen-needs-preset"
                              checked={selected}
                              onChange={() => { setScreenNeedsPresetId(id); resetDownstream() }}
                              className="mt-1 accent-blue-500"
                            />
                            <span>
                              <span className="block text-sm text-white font-medium">{p.label}</span>
                              <span className="block text-xs text-muted mt-1 leading-relaxed">「{p.description}」</span>
                            </span>
                          </span>
                        </label>
                      )
                    })}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {INVESTOR_PRESET_IDS.map(id => {
                      const p = INVESTOR_PRESETS[id]
                      const selected = screenInvestorId === id
                      return (
                        <label
                          key={id}
                          className={`block rounded-lg border p-3 cursor-pointer transition-colors ${
                            selected ? 'border-blue-500 bg-blue-950/30' : 'border-border bg-surface/50 hover:border-blue-600'
                          }`}
                        >
                          <span className="flex items-start gap-2">
                            <input
                              type="radio"
                              name="screen-investor-preset"
                              checked={selected}
                              onChange={() => { setScreenInvestorId(id); resetDownstream() }}
                              className="mt-1 accent-blue-500"
                            />
                            <span className="block text-sm text-white font-medium">{p.label}</span>
                          </span>
                        </label>
                      )
                    })}
                  </div>
                )}

                <button
                  onClick={runScreen}
                  disabled={screenPhase === 'loading'}
                  className={`px-6 py-2.5 text-white text-sm font-medium rounded-lg transition-colors ${
                    screenPhase === 'loading' ? 'bg-slate-700 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-500'
                  }`}
                >
                  {screenPhase === 'loading' ? 'スクリーニング実行中...' : 'スクリーニング実行（キャッシュのみ・AIは使いません）'}
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Pro/Investor 2-stage buttons（S2/S3・reviewer指摘の修正）: プレビュー実行
          （runProPreview）完了で即 bundle が確定し、hasConfirmedResult が true になって
          Config が自動で畳まれる。この2つのボタンが Config ラッパーの内側にあると、
          畳まれた瞬間に次に押すべき「AIレポート生成」ボタンごと画面から消えてしまう
          （critical指摘）。クイックモードの「AIレポート生成」ボタン（下）と同じく
          Config ラッパーの外に置き、3モードの構造を揃える。銘柄指定あり（scope==
          'with-symbol'）のみ対象 — 銘柄指定なしはスクリーニング専用フロー（runScreen）。
          外側分岐（mode === 'pro' / 'investor'）で常に偽になる mode 条件は
          disabled/className から削除した（死んだ条件の掃除・挙動は不変）。 */}
      {mode === 'pro' && scope === 'with-symbol' && (
        <div className="bg-panel border border-border rounded-xl p-5 space-y-3">
          <div className="flex flex-wrap gap-3">
            <button
              onClick={runProPreview}
              disabled={busyReport}
              className={`px-6 py-2.5 text-white text-sm font-medium rounded-lg transition-colors ${
                busyReport ? 'bg-slate-700 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-500'
              }`}
            >
              {reportPhase === 'preparing' ? '準備中...' : 'プレビュー実行（実データ・AIは使いません）'}
            </button>
            <button
              onClick={runProGenerate}
              disabled={busyReport || reportPhase !== 'prepared'}
              className={`px-6 py-2.5 text-white text-sm font-medium rounded-lg transition-colors ${
                busyReport || reportPhase !== 'prepared' ? 'bg-slate-700 cursor-not-allowed' : 'bg-emerald-600 hover:bg-emerald-500'
              }`}
            >
              {reportPhase === 'generating' ? 'レポート生成中...' : 'この条件でAIレポート生成'}
            </button>
          </div>
          {reportPhase === 'prepared' && (
            <p className="text-xs text-muted">
              プレビュー完了。内容を確認のうえ「AIレポート生成」でOpusによる分析を実行できます。
            </p>
          )}
        </div>
      )}

      {mode === 'investor' && scope === 'with-symbol' && (
        <div className="bg-panel border border-border rounded-xl p-5 space-y-3">
          <div className="flex flex-wrap gap-3">
            <button
              onClick={runProPreview}
              disabled={busyReport}
              className={`px-6 py-2.5 text-white text-sm font-medium rounded-lg transition-colors ${
                busyReport ? 'bg-slate-700 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-500'
              }`}
            >
              {reportPhase === 'preparing' ? '準備中...' : 'プレビュー実行（実データ・AIは使いません）'}
            </button>
            <button
              onClick={runProGenerate}
              disabled={busyReport || reportPhase !== 'prepared'}
              className={`px-6 py-2.5 text-white text-sm font-medium rounded-lg transition-colors ${
                busyReport || reportPhase !== 'prepared' ? 'bg-slate-700 cursor-not-allowed' : 'bg-emerald-600 hover:bg-emerald-500'
              }`}
            >
              {reportPhase === 'generating' ? 'レポート生成中...' : 'この条件でAIレポート生成'}
            </button>
          </div>
          {reportPhase === 'prepared' && (
            <p className="text-xs text-muted">
              プレビュー完了。内容を確認のうえ「AIレポート生成」でOpusによる分析を実行できます（投資家名はAIへは伝えません）。
            </p>
          )}
        </div>
      )}

      {/* Screening: error / loading（S5a・銘柄指定なし） */}
      {scope === 'no-symbol' && screenError && (
        <div className="bg-red-900/30 border border-red-700 rounded-xl px-4 py-3 text-red-300 text-sm">
          {screenError}
        </div>
      )}
      {scope === 'no-symbol' && screenPhase === 'loading' && (
        <div className="bg-panel border border-border rounded-xl p-8 text-center space-y-3">
          <div className="w-8 h-8 border-2 border-slate-600 border-t-blue-500 rounded-full animate-spin mx-auto" />
          <p className="text-muted text-sm">キャッシュ済みユニバースを評価中...</p>
        </div>
      )}

      {/* Screening: ranking result（S5a） */}
      {scope === 'no-symbol' && screenRes && screenPhase === 'done' && (
        <div className="bg-panel border border-border rounded-xl p-5 space-y-3">
          <h2 className="text-white font-semibold text-sm">
            「{screenRes.presetLabel}」の適合度ランキング（キャッシュ評価・現在値）
          </h2>
          <p className="text-xs text-muted leading-relaxed">
            {screenRes.universeSize}銘柄中 {screenRes.meta.evaluatedCount}件を評価
            ・鮮度切れ{screenRes.meta.excludedStaleCount}件除外
            ・データ欠損{screenRes.meta.excludedNoDataCount}件除外
            ・未キャッシュ{screenRes.excludedMissingCount}件除外
            （鮮度閾値: {screenRes.staleDaysThreshold}日）
          </p>

          {screenRes.candidates.length === 0 ? (
            <p className="text-sm text-amber-300 bg-amber-950/20 border border-amber-800/40 rounded-lg px-3 py-3 leading-relaxed">
              条件に適合する銘柄が見つかりませんでした（評価対象が0件、または該当銘柄が無い可能性があります）。
            </p>
          ) : (
            <div className="space-y-2">
              {screenRes.candidates.map((c, i) => (
                <button
                  key={c.symbol}
                  onClick={() => pickCandidateSymbol(c.symbol)}
                  className="w-full text-left bg-surface/50 hover:bg-surface border border-border hover:border-blue-600 rounded-lg px-3 py-2.5 transition-colors"
                >
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-xs font-mono text-muted w-5 shrink-0">{i + 1}</span>
                    <span className="text-sm font-mono font-semibold text-white">{c.symbol}</span>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded shrink-0 ${
                      c.allPassed ? 'bg-green-900/50 text-green-400' : 'bg-amber-900/50 text-amber-400'
                    }`}>
                      {c.passedCount}/{c.totalFilters}件成立
                    </span>
                    <span className="text-xs text-muted ml-auto shrink-0">
                      取得: {new Date(c.fetchedAt).toLocaleDateString('ja-JP')}（{c.source}）
                    </span>
                  </div>
                  <p className="text-xs text-slate-300 mt-1 pl-8">{c.reason}</p>
                </button>
              ))}
            </div>
          )}

          <div className="pt-1 border-t border-border/60">
            <p className="text-xs text-muted mb-1.5 mt-2">このプリセットの実際の条件:</p>
            <ul className="text-xs text-slate-400 space-y-1 list-disc list-inside leading-relaxed">
              {screenRes.conditionNotes.map((note, i) => <li key={i}>{note}</li>)}
            </ul>
          </div>

          <p className="text-xs text-muted/60">
            銘柄をクリックすると「銘柄指定あり」に切り替わり、その銘柄でプレビュー・AIレポート生成を実行できます。
          </p>
        </div>
      )}

      {/* Preview: error / loading */}
      {previewError && (
        <div className="bg-red-900/30 border border-red-700 rounded-xl px-4 py-3 text-red-300 text-sm">
          {previewError}
        </div>
      )}
      {busyPreview && (
        <div className="bg-panel border border-border rounded-xl p-8 text-center space-y-3">
          <div className="w-8 h-8 border-2 border-slate-600 border-t-blue-500 rounded-full animate-spin mx-auto" />
          <p className="text-muted text-sm">実データを取得して計算中...</p>
        </div>
      )}

      {/* Preview: gate result + backtest summary（Tier1・S-B2: MetricStripへ統合） */}
      {previewRes && previewPhase === 'done' && (
        <MetricStrip
          passed={previewRes.gatePassed}
          heading={`プリセット「${previewRes.presetLabel}」の無料プレビュー（現在値判定・純計算）`}
          metrics={previewMetricItems}
          gateBreakdown={previewGateBreakdown}
          insightLines={previewMetricItems.length > 0 ? METRIC_INSIGHT_LINES : undefined}
          emphasizeFailure
        >
          {!previewRes.gatePassed && previewRes.gateFailReason && (
            <p className="text-amber-300 text-sm leading-relaxed">
              {previewRes.gateFailReason}
              <br />
              <span className="text-amber-400/80 text-xs">
                参加条件不成立のためプレビューのバックテストは実行していません（AIレポートは不成立の理由も分析します）。
              </span>
            </p>
          )}
        </MetricStrip>
      )}

      {/* Preview: このプリセットの実際の条件（Tier1のまま・MetricStripの外・DetailsSection対象外
          — previewRes段階ではbundleが無くDetailsSectionの4項目に該当しないため） */}
      {previewRes && previewPhase === 'done' && (
        <div className="bg-panel/60 border border-border/60 rounded-xl px-4 py-3">
          <p className="text-xs text-muted mb-1.5">このプリセットの実際の条件:</p>
          <ul className="text-xs text-slate-400 space-y-1 list-disc list-inside leading-relaxed">
            {previewRes.conditionNotes.map((note, i) => <li key={i}>{note}</li>)}
          </ul>
        </div>
      )}

      {/* AIレポート生成ボタン（無料プレビュー完了後のみ・同じプリセット条件を流用・クイックモード専用） */}
      {mode === 'quick' && previewRes && previewPhase === 'done' && (
        <div className="bg-panel border border-border rounded-xl p-5 flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
          <p className="text-sm text-slate-300">
            この条件（プリセット「{preset.label}」・{symbol}）でAIがレポート（現状分析・AIトレーダー実績・根拠つき未来予想）を執筆します。
          </p>
          <button
            onClick={runReport}
            disabled={busyReport}
            className={`shrink-0 px-6 py-2.5 text-white text-sm font-medium rounded-lg transition-colors ${
              busyReport ? 'bg-slate-700 cursor-not-allowed' : 'bg-emerald-600 hover:bg-emerald-500'
            }`}
          >
            {reportPhase === 'preparing' ? '実データを準備中...'
              : reportPhase === 'generating' ? 'レポート生成中...'
              : 'この条件でAIレポート生成'}
          </button>
        </div>
      )}

      {/* Report: error / progress */}
      {reportError && (
        <div className="bg-red-900/30 border border-red-700 rounded-xl px-4 py-3 text-red-300 text-sm">
          {reportError}
        </div>
      )}
      {busyReport && (
        <div className="bg-panel border border-border rounded-xl p-5 space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-5 h-5 border-2 border-slate-600 border-t-blue-500 rounded-full animate-spin" />
            <div className="text-sm text-slate-300">
              {reportPhase === 'preparing'
                ? (mode === 'pro' || mode === 'investor'
                    ? '条件を検証し、Yahoo Financeの過去5年実データでバックテスト中（プレビュー）...'
                    : 'ステップ1/2: 条件を検証し、Yahoo Financeの過去5年実データでバックテスト中...')
                : (mode === 'pro' || mode === 'investor'
                    ? 'Opusがレポートを執筆中（少しずつ表示されます）...'
                    : 'ステップ2/2: Opusがレポートを執筆中（少しずつ表示されます）...')}
            </div>
          </div>
        </div>
      )}

      {/* Report: prepared bundle summary（Tier1・S-B2: MetricStripへ統合）。
          注意（W1）: ファンダフィルタ0件のとき gate.passed は仕様上 true になるが、
          MetricStrip側が gateBreakdown 0件を検出して緑バッジではなく中立表示
          （参加条件なし）に切り替える — 評価していない条件を「成立」と見せない。
          プレビュー側（上のMetricStrip）も同じ部品なので同じ扱いになる。 */}
      {bundle && (
        <MetricStrip
          passed={gate?.passed ?? true}
          heading="AIレポートの実行結果（実データ・過去5年日足）"
          metrics={bundleMetricItems}
          gateBreakdown={bundleGateBreakdown}
          insightLines={bundleMetricItems.length > 0 ? METRIC_INSIGHT_LINES : undefined}
        />
      )}

      {/* Tier2（S-C）: あなたが選んだルールの過去5年の成績 — bundle だけから計算した
          実測値カード（lib/report/execution.ts の純関数・新データ源ゼロ）。数値の出所は
          ユーザーが選んだ条件と過去の実データのみで、当社/AIが決めた数値は含まない
          （法務設計 — 旧称「執行計画カード」は金商法上実装不可のため主語をユーザーへ
          移した検証カードに変更）。将来シナリオ図（S-D）は未実装。 */}
      {bundle && executionPlan && <ExecutionPlanCard plan={executionPlan} />}

      {/* Tier3: 詳細情報群（S-B2でDetailsSectionへアコーディオン化・デフォルト閉）。
          AIレポート本文だけは絶対にDetailsSectionで包まない（生成直後は常に展開表示）。 */}
      {bundle && (
        <DetailsSection title="実行した条件・ゲート内訳の詳細版">
          <div className="bg-surface/50 border border-blue-900/50 rounded-lg p-3 space-y-1">
            <p className="text-xs text-blue-300 font-medium">実行した条件</p>
            <p className="text-sm text-white font-medium">
              {describeCompositeCondition(bundle.request.condition)}
            </p>
          </div>

          {gate && gate.evaluations.length > 0 && (
            <div className={`rounded-lg p-3 space-y-1 border ${
              gate.passed ? 'bg-surface/50 border-green-900/50' : 'bg-surface/50 border-amber-800/60'
            }`}>
              <p className={`text-xs font-medium ${gate.passed ? 'text-green-400' : 'text-amber-400'}`}>
                ファンダメンタル・ゲート判定（現在値）: {gate.passed ? '成立' : '不成立'}
              </p>
              <ul className="space-y-0.5">
                {gate.evaluations.map((ev, i) => (
                  <li key={i} className="text-xs text-slate-300 font-mono">
                    {ev.result === 'pass' ? '✓' : '✗'} {describeFundamentalFilter(ev.filter)}
                    {' → '}
                    {ev.result === 'no_data'
                      ? '判定不能（実データ取得不可・不成立扱い）'
                      : `実測 ${ev.actual != null ? formatMetricValue(ev.filter.metric, ev.actual) : '-'}（${ev.result === 'pass' ? '成立' : '不成立'}）`}
                  </li>
                ))}
              </ul>
              {!gate.passed && (
                <p className="text-xs text-amber-400/90">
                  条件不成立のためバックテストはスキップされました。レポートは「不成立の理由と成立に必要な変化」を分析します。
                </p>
              )}
            </div>
          )}

          {bundle.aiEvidence.hasData && (
            <p className="text-xs text-muted">
              AIトレーダー実績: この銘柄を{bundle.aiEvidence.tradeCount}回売買
              {bundle.aiEvidence.tradeCount > 0 &&
                `（勝率${bundle.aiEvidence.winRate.toFixed(0)}%・平均${bundle.aiEvidence.avgPnlPct >= 0 ? '+' : ''}${bundle.aiEvidence.avgPnlPct.toFixed(2)}%）`}
              — 詳細はレポート本文の「AIトレーダーの実績」参照
            </p>
          )}
        </DetailsSection>
      )}

      {/* Transparency card（S4）: なぜこの銘柄/戦略が選ばれたかを、bundleの3要素
          （テクニカルトリガー・ファンダゲート実測・バックテスト要約）だけから可視化。
          新しいデータ源は追加していない（原則9）。 */}
      {bundle && transparency && (
        <DetailsSection title="なぜこの銘柄・戦略が選ばれたか（透明性）">
          {transparency.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {transparency.tags.map((tag, i) => (
                <span key={i} className="text-[11px] font-mono px-2 py-1 rounded-full bg-blue-950/40 border border-blue-800/50 text-blue-300">
                  {tag}
                </span>
              ))}
            </div>
          )}

          {transparency.reasons.length > 0 && (
            <ul className="space-y-1">
              {transparency.reasons.map((reason, i) => (
                <li key={i} className="flex gap-2 text-xs text-slate-300">
                  <span className="text-green-400 shrink-0">✓</span>
                  <span>{reason}</span>
                </li>
              ))}
            </ul>
          )}

          {transparency.caveats.length > 0 && (
            <ul className="space-y-1 pt-1 border-t border-border/60">
              {transparency.caveats.map((caveat, i) => (
                <li key={i} className="flex gap-2 text-xs text-amber-400/90">
                  <span className="shrink-0">※</span>
                  <span>{caveat}</span>
                </li>
              ))}
            </ul>
          )}
        </DetailsSection>
      )}

      {/* Learning-usage honest disclosure（原則9 — 使っていない教訓を使ったと見せない） */}
      {bundle && (
        <DetailsSection title="教訓の使用状況（AI学習メモリ）">
          {bundle.learningUsage?.hasData ? (
            <>
              <p className="text-xs text-muted">集計範囲: {bundle.learningUsage.scope}</p>
              <ul className="space-y-1">
                {bundle.learningUsage.usedLessons.map((lesson, i) => (
                  <li key={i} className="flex gap-2 text-xs text-slate-300">
                    <span className="text-blue-400 shrink-0">•</span>
                    <span>{lesson}</span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted/70">{bundle.learningUsage.note}</p>
            </>
          ) : (
            <>
              <p className="text-xs text-slate-300">蓄積された教訓はまだ無く、本レポートでは未使用です。</p>
              <p className="text-xs text-muted/70">
                {bundle.learningUsage?.note ?? '蓄積された教訓はまだありません。本レポートでは教訓を使用していません。'}
                {' '}AIセッションで仮想売買を重ねると教訓が蒸留され、以後のレポートに反映されます。
              </p>
            </>
          )}
        </DetailsSection>
      )}

      {/* Report body (streamed) — DetailsSectionで包まない。生成直後は常に展開表示のまま。 */}
      {report && (
        <div className="bg-panel border border-border rounded-xl p-6">
          <MarkdownView text={report} />
          {reportPhase === 'generating' && (
            <span className="inline-block w-2 h-4 bg-blue-400 animate-pulse ml-1 align-text-bottom" />
          )}
        </div>
      )}

      {/* Sources */}
      {bundle && bundle.sources.length > 0 && (
        <DetailsSection title="引用元・参照リンク">
          <ol className="space-y-1">
            {bundle.sources.map(s => (
              <li key={s.id} className="text-xs text-slate-300">
                <span className="text-muted/70 font-mono">[{s.id}]</span>{' '}
                {s.url
                  ? <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 underline break-all">{s.label}</a>
                  : <span>{s.label}</span>}
                <span className="text-muted/60"> — {s.usedFor}</span>
              </li>
            ))}
          </ol>
        </DetailsSection>
      )}

      {/* Disclaimer */}
      {(report || bundle || previewRes || screenRes) && (
        <p className="text-xs text-muted/60 leading-relaxed">
          ※ 数字プレビュー・AIレポートともに過去の実市場データに基づく参考情報です。
          ファンダメンタル条件は現在値の静的評価であり、過去5年のバックテスト期間には遡及しません。
          資金はすべて仮想であり、実際の投資成果を保証しません。投資判断はご自身の責任で行ってください。
          レポートは保存されません（画面を離れると消えます）。
        </p>
      )}
    </div>
  )
}
