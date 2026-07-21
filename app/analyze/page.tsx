'use client'

// /analyze S1 — /lab（無料の数字プレビュー）と /report（AIレポート）を単一の
// 統合入口に束ねる背骨。このスライスは「クイックモード（ニーズ軸プリセット）＋
// 銘柄指定あり」だけを完全配線する。プロ/投資家モデル/銘柄指定なしはプレース
// ホルダ（/lab の investor 無効化と同手法）— S2以降で順次配線する。
//
// フロー: ニーズ軸プリセット選択 → /api/lab/backtest(needsモード) で無料プレビュー
//   → 「この条件でAIレポート生成」→ 同じプリセットの CompositeCondition をそのまま
//   /api/report/prepare → /api/report/generate へ渡し、既存の専門レポートを表示する。
// 新しいAPIルート・新しいデータ源はゼロ（既存 /lab・/report をそのまま再利用）。

import { useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { NeedsPresetId } from '@/lib/backtest/types'
import {
  NEEDS_PRESETS,
  NEEDS_PRESET_IDS,
  getNeedsPresetCondition,
  type LabNeedsResponse,
} from '@/lib/backtest/presets'
import { describeFundamentalFilter, formatMetricValue } from '@/lib/backtest/fundamental'
import type { PreparedBundle, PrepareResponse } from '@/lib/report/types'
import { describeCompositeCondition } from '@/lib/report/prompt'
import { buildTransparencyCard } from '@/lib/report/transparency'
import { US_UNIVERSE } from '@/lib/market/us-universe'

type AnalyzeMode = 'quick' | 'pro' | 'investor'
type AnalyzeScope = 'with-symbol' | 'no-symbol'

// このスライスで実際に機能するのはクイック×銘柄指定ありのみ。他はプレースホルダ。
export const ANALYZE_MODE_TABS: { id: AnalyzeMode; label: string; disabled?: boolean }[] = [
  { id: 'quick',    label: 'クイック' },
  { id: 'pro',      label: 'プロ',       disabled: true },
  { id: 'investor', label: '投資家モデル', disabled: true },
]

export const ANALYZE_SCOPE_OPTIONS: { id: AnalyzeScope; label: string; disabled?: boolean }[] = [
  { id: 'with-symbol', label: '銘柄指定あり' },
  { id: 'no-symbol',   label: '銘柄指定なし（自動スクリーニング）', disabled: true },
]

type PreviewPhase = 'idle' | 'loading' | 'done'
type ReportPhase = 'idle' | 'preparing' | 'generating' | 'done'

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

  // 条件（銘柄/資金/プリセット）を変えたら、古いプレビュー・古いレポートは
  // その条件の結果ではなくなるため必ず捨てる（原則9: 古い結果を新条件の結果と
  // 誤認させない）。
  const resetDownstream = () => {
    setPreviewPhase('idle')
    setPreviewError(null)
    setPreviewRes(null)
    setReportPhase('idle')
    setReportError(null)
    setBundle(null)
    setReport('')
  }

  const runPreview = async () => {
    if (mode !== 'quick' || previewPhase === 'loading') return
    resetDownstream()
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
      setPreviewRes(data)
      setPreviewPhase('done')
    } catch (e) {
      setPreviewError(e instanceof Error ? e.message : 'エラーが発生しました')
      setPreviewPhase('idle')
    }
  }

  const runReport = async () => {
    if (mode !== 'quick' || !previewRes || runningReportRef.current) return
    runningReportRef.current = true
    setReportError(null)
    setBundle(null)
    setReport('')
    setReportPhase('preparing')
    try {
      // 同じプリセットの CompositeCondition をそのまま流用する（新しい条件は発明しない）。
      const condition = getNeedsPresetCondition(presetId)

      // ── Stage 1: prepare（ゲート評価＋5年実データバックテスト）──────
      const prepRes = await fetch('/api/report/prepare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol,
          condition,
          initialCapital: Number(capital) || undefined,
        }),
      })
      if (!prepRes.ok) {
        const err = await prepRes.json().catch(() => ({}))
        throw new Error(err.error ?? `準備に失敗しました (HTTP ${prepRes.status})`)
      }
      const { bundle: prepared } = (await prepRes.json()) as PrepareResponse
      setBundle(prepared)

      // ── Stage 2: generate（Opusストリーミング・ゲート不成立でも実行）──
      setReportPhase('generating')
      const genRes = await fetch('/api/report/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bundle: prepared }),
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
            setReport(prev => prev + chunk)
          }
        }
        const tail = decoder.decode()
        if (tail) {
          received += tail.length
          setReport(prev => prev + tail)
        }
      } catch {
        throw new Error(
          received > 0
            ? 'レポート生成が途中で中断されました（表示中の内容は部分的な結果です）。再試行してください。'
            : 'レポートの受信に失敗しました。ネットワークを確認して再試行してください。',
        )
      }
      if (received === 0) {
        throw new Error('AIからのレポートが空でした。少し待ってから再試行してください。')
      }
      setReportPhase('done')
    } catch (e) {
      const message =
        e instanceof TypeError
          ? 'サーバーに接続できませんでした。ネットワークを確認して再試行してください。'
          : e instanceof Error ? e.message : 'エラーが発生しました'
      setReportError(message)
      setReportPhase('idle')
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
  // ニーズ軸プリセットは米国株（USD建て）想定（/lab と同じ静的ゲートの限界）。
  const nonUsWarning = quickActive && symbol.trim().toUpperCase().endsWith('.T')

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">分析</h1>
        <p className="text-muted text-sm mt-1">
          ニーズ軸プリセットで実データの数字プレビュー（無料・純計算）を確認し、
          同じ条件でAIレポート（現状分析・根拠つき未来予想）を生成します。
        </p>
      </div>

      {/* 恒久ディスクレーマ（免責）— 設定中・プレビュー中・ストリーミング中も常に表示 */}
      <p className="text-xs text-amber-300/90 bg-amber-950/20 border border-amber-800/40 rounded-lg px-3 py-2 leading-relaxed">
        本ページのAIレポートは投資助言ではありません。プロの投資アナリストが実データをもとにどう分析プロセスを
        組み立てるかを、実データに基づき再現したものです。投資判断はご自身の責任で行ってください。
      </p>

      {/* Config */}
      <div className="bg-panel border border-border rounded-xl p-5 space-y-5">
        {/* Mode tabs */}
        <div>
          <p className="text-xs text-muted mb-2">モード</p>
          <div className="inline-flex rounded-lg border border-border overflow-hidden">
            {ANALYZE_MODE_TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => !tab.disabled && setMode(tab.id)}
                disabled={tab.disabled}
                className={`px-4 py-2 text-sm font-medium transition-colors ${
                  mode === tab.id
                    ? 'bg-blue-600 text-white'
                    : tab.disabled
                      ? 'bg-surface text-slate-600 cursor-not-allowed'
                      : 'bg-surface text-slate-400 hover:text-slate-200'
                }`}
              >
                {tab.label}
                {tab.disabled && (
                  <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-300 align-middle">近日対応</span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Scope toggle */}
        <div>
          <p className="text-xs text-muted mb-2">対象範囲</p>
          <div className="inline-flex rounded-lg border border-border overflow-hidden">
            {ANALYZE_SCOPE_OPTIONS.map(opt => (
              <button
                key={opt.id}
                onClick={() => !opt.disabled && setScope(opt.id)}
                disabled={opt.disabled}
                className={`px-4 py-2 text-sm font-medium transition-colors ${
                  scope === opt.id
                    ? 'bg-blue-600 text-white'
                    : opt.disabled
                      ? 'bg-surface text-slate-600 cursor-not-allowed'
                      : 'bg-surface text-slate-400 hover:text-slate-200'
                }`}
              >
                {opt.label}
                {opt.disabled && (
                  <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-300 align-middle">近日対応</span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* ── Quick panel（銘柄指定あり・S1で唯一機能する組み合わせ） ── */}
        <div className={`border border-border rounded-lg p-4 space-y-4 transition-opacity ${quickActive ? '' : 'opacity-50 pointer-events-none'}`}>
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
            disabled={busyPreview || !quickActive}
            className={`px-6 py-2.5 text-white text-sm font-medium rounded-lg transition-colors ${
              busyPreview || !quickActive ? 'bg-slate-700 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-500'
            }`}
          >
            {busyPreview ? '無料プレビュー実行中...' : '無料プレビューを実行（純計算・AIは使いません）'}
          </button>
        </div>

        {/* ── Pro / Investor placeholders（S1では非機能） ── */}
        {mode === 'pro' && (
          <div className="border border-border rounded-lg p-4 opacity-70">
            <p className="text-sm text-white font-medium">
              プロモード
              <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-300 align-middle">近日対応</span>
            </p>
            <p className="text-xs text-muted mt-1">テクニカル・ファンダ・決算トレンド条件を自由に組み合わせるモードを準備中です。それまでは <a href="/report" className="text-blue-400 underline">AIレポート</a> ページをご利用ください。</p>
          </div>
        )}
        {mode === 'investor' && (
          <div className="border border-border rounded-lg p-4 opacity-70">
            <p className="text-sm text-white font-medium">
              投資家モデル
              <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-300 align-middle">近日対応</span>
            </p>
            <p className="text-xs text-muted mt-1">著名投資家の投資スタイルを条件に写像して検証する機能を準備中です。</p>
          </div>
        )}
      </div>

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

      {/* Preview: gate result + backtest summary */}
      {previewRes && previewPhase === 'done' && (
        <div className={`border rounded-xl p-5 space-y-3 ${
          previewRes.gatePassed ? 'bg-panel border-border' : 'bg-amber-950/30 border-amber-700'
        }`}>
          <div className="flex items-center gap-2">
            <span className={`text-xs font-bold px-2 py-0.5 rounded ${
              previewRes.gatePassed ? 'bg-green-900/50 text-green-400' : 'bg-amber-900/50 text-amber-400'
            }`}>
              {previewRes.gatePassed ? '参加条件 成立' : '参加条件 不成立'}
            </span>
            <h2 className="text-white font-semibold text-sm">
              プリセット「{previewRes.presetLabel}」の無料プレビュー（現在値判定・純計算）
            </h2>
          </div>

          {!previewRes.gatePassed && previewRes.gateFailReason && (
            <p className="text-amber-300 text-sm leading-relaxed">
              {previewRes.gateFailReason}
              <br />
              <span className="text-amber-400/80 text-xs">
                参加条件不成立のためプレビューのバックテストは実行していません（AIレポートは不成立の理由も分析します）。
              </span>
            </p>
          )}

          <div className="space-y-1.5">
            {previewRes.gate.evaluations.map((ev, i) => (
              <div key={i} className="flex items-center gap-3 px-3 py-2 bg-surface/50 rounded-lg text-xs">
                <span className={`shrink-0 font-bold px-2 py-0.5 rounded ${
                  ev.result === 'pass' ? 'bg-green-900/50 text-green-400'
                    : ev.result === 'fail' ? 'bg-red-900/50 text-red-400'
                    : 'bg-slate-700 text-slate-300'
                }`}>
                  {ev.result === 'pass' ? '成立' : ev.result === 'fail' ? '不成立' : '判定不能'}
                </span>
                <span className="text-slate-300">{describeFundamentalFilter(ev.filter)}</span>
                <span className="text-muted font-mono ml-auto">
                  実測: {ev.actual != null ? formatMetricValue(ev.filter.metric, ev.actual) : 'データなし'}
                </span>
              </div>
            ))}
          </div>

          {m && previewRes.result && (
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-center pt-1">
              <div className="bg-surface/50 rounded-lg p-3">
                <p className="text-muted text-xs mb-1">総リターン（5年）</p>
                <p className={`font-mono font-bold ${returnPositive ? 'text-green-400' : 'text-red-400'}`}>
                  {returnPositive ? '+' : ''}{m.totalReturnPct.toFixed(2)}%
                </p>
                <p className="text-xs text-muted mt-0.5">{formatMoney(previewRes.result.finalValue, previewRes.result.currency)}</p>
              </div>
              <div className="bg-surface/50 rounded-lg p-3">
                <p className="text-muted text-xs mb-1">勝率</p>
                <p className="text-white font-mono font-bold">{m.winRate.toFixed(0)}%</p>
              </div>
              <div className="bg-surface/50 rounded-lg p-3">
                <p className="text-muted text-xs mb-1">最大DD</p>
                <p className="text-red-400 font-mono font-bold">-{m.maxDrawdownPct.toFixed(2)}%</p>
              </div>
              <div className="bg-surface/50 rounded-lg p-3">
                <p className="text-muted text-xs mb-1">シャープレシオ</p>
                <p className="text-white font-mono font-bold">{m.sharpeRatio.toFixed(2)}</p>
              </div>
              <div className="bg-surface/50 rounded-lg p-3">
                <p className="text-muted text-xs mb-1">取引数</p>
                <p className="text-white font-mono font-bold">{m.tradeCount}件</p>
              </div>
            </div>
          )}

          <div className="pt-1">
            <p className="text-xs text-muted mb-1.5">このプリセットの実際の条件:</p>
            <ul className="text-xs text-slate-400 space-y-1 list-disc list-inside leading-relaxed">
              {previewRes.conditionNotes.map((note, i) => <li key={i}>{note}</li>)}
            </ul>
          </div>
        </div>
      )}

      {/* AIレポート生成ボタン（無料プレビュー完了後のみ・同じプリセット条件を流用） */}
      {previewRes && previewPhase === 'done' && (
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
                ? 'ステップ1/2: 条件を検証し、Yahoo Financeの過去5年実データでバックテスト中...'
                : 'ステップ2/2: Opusがレポートを執筆中（少しずつ表示されます）...'}
            </div>
          </div>
        </div>
      )}

      {/* Report: prepared bundle summary */}
      {bundle && (
        <div className="bg-panel border border-border rounded-xl p-5 space-y-3">
          <h2 className="text-white font-semibold text-sm">AIレポートの実行結果（実データ・過去5年日足）</h2>
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

          {bundle.backtest && bm && (
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-center">
              <div className="bg-surface/50 rounded-lg p-3">
                <p className="text-muted text-xs mb-1">総リターン（5年）</p>
                <p className={`font-mono font-bold ${bm.totalReturnPct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {bm.totalReturnPct >= 0 ? '+' : ''}{bm.totalReturnPct.toFixed(2)}%
                </p>
              </div>
              <div className="bg-surface/50 rounded-lg p-3">
                <p className="text-muted text-xs mb-1">バイ&ホールド</p>
                <p className={`font-mono font-bold ${bundle.backtest.buyHoldReturnPct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {bundle.backtest.buyHoldReturnPct >= 0 ? '+' : ''}{bundle.backtest.buyHoldReturnPct.toFixed(2)}%
                </p>
              </div>
              <div className="bg-surface/50 rounded-lg p-3">
                <p className="text-muted text-xs mb-1">勝率</p>
                <p className="text-white font-mono font-bold">{bm.winRate.toFixed(0)}%</p>
              </div>
              <div className="bg-surface/50 rounded-lg p-3">
                <p className="text-muted text-xs mb-1">最大DD</p>
                <p className="text-red-400 font-mono font-bold">-{bm.maxDrawdownPct.toFixed(2)}%</p>
              </div>
              <div className="bg-surface/50 rounded-lg p-3">
                <p className="text-muted text-xs mb-1">取引数</p>
                <p className="text-white font-mono font-bold">{bm.tradeCount}件</p>
              </div>
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
        </div>
      )}

      {/* Transparency card（S4）: なぜこの銘柄/戦略が選ばれたかを、bundleの3要素
          （テクニカルトリガー・ファンダゲート実測・バックテスト要約）だけから可視化。
          新しいデータ源は追加していない（原則9）。 */}
      {bundle && transparency && (
        <div className="bg-panel border border-border rounded-xl p-5 space-y-3">
          <h2 className="text-white font-semibold text-sm">なぜこの銘柄・戦略が選ばれたか（透明性）</h2>

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
        </div>
      )}

      {/* Learning-usage honest disclosure（原則9 — 使っていない教訓を使ったと見せない） */}
      {bundle && (
        <div className="bg-panel border border-border rounded-xl p-5 space-y-2">
          <h2 className="text-white font-semibold text-sm">教訓の使用状況（AI学習メモリ）</h2>
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
        </div>
      )}

      {/* Report body (streamed) */}
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
        <div className="bg-panel border border-border rounded-xl p-5 space-y-2">
          <p className="text-xs text-muted font-medium mb-1.5">引用元・参照リンク</p>
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
        </div>
      )}

      {/* Disclaimer */}
      {(report || bundle || previewRes) && (
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
