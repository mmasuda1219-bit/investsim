'use client'

// /analyze S2 — プロモードの条件ピッカー。
//
// /report のテクニカル＋ファンダ＋決算派生ピッカーを複製し（抽出はこのスライスの
// スコープ外・S1のMarkdownView先例に倣う）、分析タイプ軸
// （①ファンダメンタル ②テクニカル ③ハイブリッド）で出し分ける。
// 単位変換ヘルパ（toRawValue/toRawDerivedValue 等）は複製せず lib/backtest/fundamental
// から共有 import する（COMPANY.md 原則2: 横の足場を広げない）。
//
// CompositeCondition.technical は必須（バックテストは売買トリガーなしに走れない
// — lib/backtest/run.ts 参照）。ファンダメンタル型では「評価用の売買基準
// （ベースライントリガー）」をユーザーに明示的に選ばせる。選択肢は
// lib/backtest/rules.ts の evaluateTechnical が実サポートする indicator にのみ
// 写像する（BASELINE_TRIGGERS 参照）。「買い持ち（常時保有）」はエンジンに評価器が
// 存在しないため選択肢に出さない（COMPANY.md 原則9 — 偽装トリガー禁止）。
//
// buildProCondition() は純関数として分離・export し、React state を経由しない
// スモークテスト（scripts/check-analyze-pro.ts）から直接検証できるようにする。

import { useEffect, useRef, useState } from 'react'
import type {
  CompositeCondition,
  FundamentalFilter,
  FundamentalMetric,
  DerivedFilter,
  TechnicalCondition,
} from '@/lib/backtest/types'
import type { DerivedMetric } from '@/lib/statements/types'
import {
  METRIC_INFO,
  FUNDAMENTAL_METRICS,
  OPERATOR_LABEL,
  toRawValue,
  DERIVED_METRIC_INFO,
  DERIVED_METRICS,
  toRawDerivedValue,
} from '@/lib/backtest/fundamental'

export type AnalysisType = 'fundamental' | 'technical' | 'hybrid'

export const ANALYSIS_TYPE_TABS: { id: AnalysisType; label: string; hint: string }[] = [
  {
    id: 'fundamental',
    label: 'ファンダメンタル',
    hint: '決算・財務指標で参加条件を絞り込みます。売買タイミングの判定には下の「評価用の売買基準」を使います（ファンダ条件だけでは売買日は決まりません）。',
  },
  {
    id: 'technical',
    label: 'テクニカル',
    hint: '値動きの売買ルールだけで判定します（ファンダ条件・決算トレンド条件は使いません）。',
  },
  {
    id: 'hybrid',
    label: 'ハイブリッド',
    hint: 'ファンダ・決算トレンド条件で参加条件を絞り込み、売買タイミングはテクニカルルールで判定します。',
  },
]

export type IndicatorId = TechnicalCondition['indicator']

export const RULES: { id: IndicatorId; label: string; params: 'period' | 'dual' | 'none' }[] = [
  { id: 'ma_cross',      label: '移動平均クロス（終値×N日MA）',              params: 'period' },
  { id: 'ma_cross_dual', label: 'ゴールデンクロス（短期MA×長期MA）',         params: 'dual' },
  { id: 'rsi_reversal',  label: 'RSI反転（30回復で買い・70割れで売り）',      params: 'period' },
  { id: 'macd_cross',    label: 'MACDクロス（12,26,9固定）',                 params: 'none' },
  { id: 'bb_break',      label: 'ボリンジャーバンド突破（N日・±2σ）',        params: 'period' },
  { id: 'hl_break',      label: '高値/安値ブレイクアウト（前日までのN日）',   params: 'period' },
  { id: 'stoch_cross',   label: 'ストキャスティクス（%K/%D＋30/70ゾーン）',   params: 'period' },
  { id: 'roc_signal',    label: 'ROC 0ラインクロス（モメンタム）',           params: 'period' },
]

export const DEFAULT_PERIODS: Record<IndicatorId, string> = {
  ma_cross: '20', ma_cross_dual: '', rsi_reversal: '14', macd_cross: '',
  bb_break: '20', hl_break: '20', stoch_cross: '14', roc_signal: '12',
}

const OPERATORS: FundamentalFilter['operator'][] = ['gte', 'gt', 'lte', 'lt']

// ── ファンダメンタル型のベースライントリガー ────────────────────────────
// evaluateTechnical（lib/backtest/rules.ts）が実際に評価できる indicator のみを
// 使う。いずれも /lab のニーズ軸プリセット（lib/backtest/presets.ts）で実績のある
// 組み合わせ（ma_cross period=200 / ma_cross_dual 20×50 など）と同じ実装経路。
export type BaselineTriggerId = 'ma200' | 'ma50' | 'golden_50_200'

export const BASELINE_TRIGGERS: {
  id: BaselineTriggerId
  label: string
  technical: TechnicalCondition
  note: string
}[] = [
  {
    id: 'ma200',
    label: '長期トレンド（終値×200日MA）',
    technical: { type: 'technical', indicator: 'ma_cross', period: 200 },
    note: '終値が200日移動平均を上抜けたら買い、下抜けたら売り（長期保有寄りの評価基準）',
  },
  {
    id: 'ma50',
    label: '中期トレンド（終値×50日MA）',
    technical: { type: 'technical', indicator: 'ma_cross', period: 50 },
    note: '終値が50日移動平均を上抜けたら買い、下抜けたら売り',
  },
  {
    id: 'golden_50_200',
    label: 'ゴールデンクロス（50日×200日MA）',
    technical: { type: 'technical', indicator: 'ma_cross_dual', shortPeriod: 50, longPeriod: 200 },
    note: '50日移動平均が200日移動平均を上抜けたら買い、下抜けたら売り',
  },
]

export interface FilterInput {
  metric: FundamentalMetric
  operator: FundamentalFilter['operator']
  /** Human-unit input（%・10億等）。文字列のまま保持し buildProCondition で変換。 */
  value: string
}

export interface DerivedFilterInput {
  metric: DerivedMetric
  operator: DerivedFilter['operator']
  /** Human-unit input（%・倍・期）。文字列のまま保持し buildProCondition で変換。 */
  value: string
}

export interface BuildConditionInput {
  analysisType: AnalysisType
  indicator: IndicatorId
  periods: Record<IndicatorId, string>
  shortPeriod: string
  longPeriod: string
  baselineTrigger: BaselineTriggerId
  filters: FilterInput[]
  dFilters: DerivedFilterInput[]
}

// 期間入力の検証（レビュー指摘対応・原則9）: buildFundamentalFilters/
// buildDerivedFilters と同じく、無効値（非数値・空文字・0以下・NaN）は黙って
// デフォルト期間へフォールバックせず {error} を返す。「200日MAのつもりが無言で
// 別の期間になる」ような取り違えを防ぐ（正直な失敗 > 黙った代替）。
function parsePeriod(s: string, label: string): number | { error: string } {
  const n = Number(s)
  if (s.trim() === '' || !Number.isFinite(n) || n <= 0) {
    return { error: `${label}は正の整数で入力してください` }
  }
  return Math.floor(n)
}

function computeTechnicalFromRule(input: {
  indicator: IndicatorId
  periods: Record<IndicatorId, string>
  shortPeriod: string
  longPeriod: string
}): TechnicalCondition | { error: string } {
  const { indicator, periods, shortPeriod, longPeriod } = input
  switch (indicator) {
    case 'ma_cross': {
      const period = parsePeriod(periods.ma_cross, '移動平均クロスの期間')
      if (typeof period !== 'number') return period
      return { type: 'technical', indicator, period }
    }
    case 'ma_cross_dual': {
      const s = parsePeriod(shortPeriod, '短期MAの期間')
      if (typeof s !== 'number') return s
      const l = parsePeriod(longPeriod, '長期MAの期間')
      if (typeof l !== 'number') return l
      if (s >= l) return { error: '短期MAの期間は長期MAより小さくしてください' }
      return { type: 'technical', indicator, shortPeriod: s, longPeriod: l }
    }
    case 'rsi_reversal': {
      const period = parsePeriod(periods.rsi_reversal, 'RSI反転の期間')
      if (typeof period !== 'number') return period
      return { type: 'technical', indicator, period }
    }
    case 'macd_cross':    return { type: 'technical', indicator }
    case 'bb_break': {
      const period = parsePeriod(periods.bb_break, 'ボリンジャーバンド突破の期間')
      if (typeof period !== 'number') return period
      return { type: 'technical', indicator, period }
    }
    case 'hl_break': {
      const period = parsePeriod(periods.hl_break, '高値/安値ブレイクアウトの期間')
      if (typeof period !== 'number') return period
      return { type: 'technical', indicator, period }
    }
    case 'stoch_cross': {
      const period = parsePeriod(periods.stoch_cross, 'ストキャスティクスの期間')
      if (typeof period !== 'number') return period
      return { type: 'technical', indicator, period }
    }
    case 'roc_signal': {
      const period = parsePeriod(periods.roc_signal, 'ROC 0ラインクロスの期間')
      if (typeof period !== 'number') return period
      return { type: 'technical', indicator, period }
    }
  }
}

function buildFundamentalFilters(filters: FilterInput[]): FundamentalFilter[] | { error: string } {
  const out: FundamentalFilter[] = []
  for (const row of filters) {
    const v = Number(row.value)
    if (row.value.trim() === '' || !Number.isFinite(v)) {
      return { error: `ファンダ条件「${METRIC_INFO[row.metric].label}」の値を数値で入力してください` }
    }
    out.push({ metric: row.metric, operator: row.operator, value: toRawValue(row.metric, v) })
  }
  return out
}

function buildDerivedFilters(dFilters: DerivedFilterInput[]): DerivedFilter[] | { error: string } {
  const out: DerivedFilter[] = []
  for (const row of dFilters) {
    const v = Number(row.value)
    if (row.value.trim() === '' || !Number.isFinite(v)) {
      return { error: `決算トレンド条件「${DERIVED_METRIC_INFO[row.metric].label}」の値を数値で入力してください` }
    }
    out.push({ metric: row.metric, operator: row.operator, value: toRawDerivedValue(row.metric, v) })
  }
  return out
}

/**
 * 分析タイプ軸 → CompositeCondition の写像（純関数）。
 * - technical: technical条件のみ（フル選択）。fundamentalFilters/derivedFiltersは空。
 * - fundamental: fundamentalFilters＋derivedFilters＋ユーザー選択のベースライントリガー。
 * - hybrid: technical条件（フル選択）＋fundamentalFilters＋derivedFilters。
 */
export function buildProCondition(input: BuildConditionInput): CompositeCondition | { error: string } {
  const fundamentalFilters = buildFundamentalFilters(input.filters)
  if ('error' in fundamentalFilters) return fundamentalFilters
  const derivedFilters = buildDerivedFilters(input.dFilters)
  if ('error' in derivedFilters) return derivedFilters

  if (input.analysisType === 'fundamental') {
    const trigger = BASELINE_TRIGGERS.find(t => t.id === input.baselineTrigger)
    if (!trigger) return { error: '評価用の売買基準を選択してください' }
    return { technical: trigger.technical, fundamentalFilters, derivedFilters }
  }

  // technical / hybrid: ユーザーが選んだテクニカルルールを使う。
  const technical = computeTechnicalFromRule(input)
  if ('error' in technical) return technical

  if (input.analysisType === 'technical') {
    return { technical, fundamentalFilters: [], derivedFilters: [] }
  }
  return { technical, fundamentalFilters, derivedFilters }
}

interface FilterRow extends FilterInput { key: number }
interface DerivedRow extends DerivedFilterInput { key: number }

export interface ProConditionPickerProps {
  onConditionChange: (condition: CompositeCondition | { error: string }) => void
}

export default function ProConditionPicker({ onConditionChange }: ProConditionPickerProps) {
  const [analysisType, setAnalysisType] = useState<AnalysisType>('fundamental')

  // ── Technical rule picker（technical / hybrid で使用） ──────────────────
  const [indicator, setIndicator] = useState<IndicatorId>('ma_cross')
  const [periods, setPeriods] = useState<Record<IndicatorId, string>>({ ...DEFAULT_PERIODS })
  const [shortPeriod, setShortPeriod] = useState('20')
  const [longPeriod, setLongPeriod] = useState('50')

  // ── ベースライントリガー（fundamental で使用） ───────────────────────────
  const [baselineTrigger, setBaselineTrigger] = useState<BaselineTriggerId>('ma200')

  // ── Fundamental AND-filter rows（fundamental / hybrid で使用） ───────────
  const nextKey = useRef(1)
  const [filters, setFilters] = useState<FilterRow[]>([])

  // ── Derived (earnings-trend) AND-filter rows（fundamental / hybrid で使用） ──
  const nextDKey = useRef(1)
  const [dFilters, setDFilters] = useState<DerivedRow[]>([])

  const addFilter = () => {
    setFilters(prev => [...prev, { key: nextKey.current++, metric: 'pe', operator: 'lte', value: '' }])
  }
  const removeFilter = (key: number) => setFilters(prev => prev.filter(f => f.key !== key))
  const updateFilter = (key: number, patch: Partial<FilterRow>) =>
    setFilters(prev => prev.map(f => (f.key === key ? { ...f, ...patch } : f)))

  const addDFilter = () => {
    setDFilters(prev => [...prev, { key: nextDKey.current++, metric: 'revenueCagr3y', operator: 'gte', value: '' }])
  }
  const removeDFilter = (key: number) => setDFilters(prev => prev.filter(f => f.key !== key))
  const updateDFilter = (key: number, patch: Partial<DerivedRow>) =>
    setDFilters(prev => prev.map(f => (f.key === key ? { ...f, ...patch } : f)))

  // 内部状態が変わるたびに、最新の CompositeCondition（or エラー）を親へ通知する。
  // onConditionChange はあえて依存配列に含めない（親の再レンダー毎に新しい関数
  // 参照になり、含めると無限ループになるため — 呼び出し内容自体は安定）。
  useEffect(() => {
    onConditionChange(
      buildProCondition({
        analysisType,
        indicator,
        periods,
        shortPeriod,
        longPeriod,
        baselineTrigger,
        filters,
        dFilters,
      }),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysisType, indicator, periods, shortPeriod, longPeriod, baselineTrigger, filters, dFilters])

  const selectedRule = RULES.find(r => r.id === indicator)!
  const showTechnicalPicker = analysisType === 'technical' || analysisType === 'hybrid'
  const showFundamentalPickers = analysisType === 'fundamental' || analysisType === 'hybrid'

  return (
    <div className="space-y-5">
      {/* 分析タイプ軸 */}
      <div>
        <p className="text-xs text-muted mb-2">分析タイプ</p>
        <div className="inline-flex rounded-lg border border-border overflow-hidden">
          {ANALYSIS_TYPE_TABS.map(tab => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setAnalysisType(tab.id)}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                analysisType === tab.id
                  ? 'bg-blue-600 text-white'
                  : 'bg-surface text-slate-400 hover:text-slate-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted mt-1.5 leading-relaxed">
          {ANALYSIS_TYPE_TABS.find(t => t.id === analysisType)!.hint}
        </p>
      </div>

      {/* テクニカル条件（technical / hybrid） */}
      {showTechnicalPicker && (
        <div>
          <label className="block text-xs text-muted mb-2">テクニカル条件（1つ選択・売買タイミングの判定）</label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {RULES.map(rule => (
              <label
                key={rule.id}
                className={`flex items-center gap-2 text-sm rounded-lg border px-3 py-2 cursor-pointer transition-colors ${
                  indicator === rule.id
                    ? 'border-blue-500 bg-blue-950/30 text-white'
                    : 'border-border bg-surface text-slate-300 hover:border-slate-600'
                }`}
              >
                <input
                  type="radio"
                  name="pro-rule"
                  checked={indicator === rule.id}
                  onChange={() => setIndicator(rule.id)}
                  className="accent-blue-500"
                />
                {rule.label}
              </label>
            ))}
          </div>

          <div className="mt-3 flex flex-wrap items-end gap-4">
            {selectedRule.params === 'period' && (
              <div>
                <label className="block text-xs text-muted mb-1">期間（日）</label>
                <input
                  type="number" min="2" max="200" step="1"
                  value={periods[indicator]}
                  onChange={e => setPeriods(prev => ({ ...prev, [indicator]: e.target.value }))}
                  className="w-28 bg-surface border border-border rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-blue-500"
                />
              </div>
            )}
            {selectedRule.params === 'dual' && (
              <>
                <div>
                  <label className="block text-xs text-muted mb-1">短期MA（日）</label>
                  <input
                    type="number" min="2" max="199" step="1"
                    value={shortPeriod}
                    onChange={e => setShortPeriod(e.target.value)}
                    className="w-28 bg-surface border border-border rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-muted mb-1">長期MA（日）</label>
                  <input
                    type="number" min="3" max="200" step="1"
                    value={longPeriod}
                    onChange={e => setLongPeriod(e.target.value)}
                    className="w-28 bg-surface border border-border rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-blue-500"
                  />
                </div>
              </>
            )}
            {selectedRule.params === 'none' && (
              <p className="text-xs text-muted">このルールにパラメータはありません（12,26,9固定）</p>
            )}
          </div>
        </div>
      )}

      {/* ベースライントリガー（fundamental のみ） */}
      {analysisType === 'fundamental' && (
        <div>
          <label className="block text-xs text-muted mb-2">
            評価用の売買基準（ベースライントリガー）— 下のファンダ条件は参加可否の判定のみに使われるため、
            バックテストの売買タイミングにはこの基準を使います
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {BASELINE_TRIGGERS.map(t => (
              <label
                key={t.id}
                className={`flex items-center gap-2 text-sm rounded-lg border px-3 py-2 cursor-pointer transition-colors ${
                  baselineTrigger === t.id
                    ? 'border-blue-500 bg-blue-950/30 text-white'
                    : 'border-border bg-surface text-slate-300 hover:border-slate-600'
                }`}
              >
                <input
                  type="radio"
                  name="baseline-trigger"
                  checked={baselineTrigger === t.id}
                  onChange={() => setBaselineTrigger(t.id)}
                  className="accent-blue-500"
                />
                {t.label}
              </label>
            ))}
          </div>
          <p className="text-xs text-muted/70 mt-1.5">
            {BASELINE_TRIGGERS.find(t => t.id === baselineTrigger)!.note}
          </p>
          <p className="text-xs text-amber-400/80 mt-1 leading-relaxed">
            ※ ファンダメンタル条件だけでは売買日を決められないため、上記の基準トリガーで過去5年をバックテストします。
            ファンダ条件そのものは「参加できるか（現在値の静的判定）」にのみ使われ、売買判定には使われません。
          </p>
        </div>
      )}

      {/* ファンダメンタル条件（fundamental / hybrid） */}
      {showFundamentalPickers && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs text-muted">ファンダメンタル条件（任意・AND結合）</label>
            <button
              type="button"
              onClick={addFilter}
              disabled={filters.length >= 10}
              className="text-xs px-3 py-1 rounded-lg border border-border text-slate-300 hover:border-blue-500 hover:text-white transition-colors disabled:opacity-40"
            >
              ＋ 条件を追加
            </button>
          </div>
          {filters.length === 0 && (
            <p className="text-xs text-muted/70">
              条件なし（
              {analysisType === 'fundamental'
                ? '評価用の売買基準のみでバックテストします'
                : 'テクニカル条件のみでバックテストします'}
              ）
            </p>
          )}
          <div className="space-y-2">
            {filters.map(row => (
              <div key={row.key} className="flex flex-wrap items-center gap-2">
                <select
                  value={row.metric}
                  onChange={e => updateFilter(row.key, { metric: e.target.value as FundamentalMetric })}
                  className="bg-surface border border-border rounded-lg px-2 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                >
                  {FUNDAMENTAL_METRICS.map(mId => (
                    <option key={mId} value={mId}>{METRIC_INFO[mId].label}</option>
                  ))}
                </select>
                <select
                  value={row.operator}
                  onChange={e => updateFilter(row.key, { operator: e.target.value as FundamentalFilter['operator'] })}
                  className="bg-surface border border-border rounded-lg px-2 py-2 text-white text-sm font-mono focus:outline-none focus:border-blue-500"
                >
                  {OPERATORS.map(op => (
                    <option key={op} value={op}>{OPERATOR_LABEL[op]}</option>
                  ))}
                </select>
                <input
                  type="number" step="any"
                  value={row.value}
                  onChange={e => updateFilter(row.key, { value: e.target.value })}
                  placeholder={METRIC_INFO[row.metric].hint}
                  className="w-48 bg-surface border border-border rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-blue-500"
                />
                <span className="text-xs text-muted/70">{METRIC_INFO[row.metric].hint}</span>
                <button
                  type="button"
                  onClick={() => removeFilter(row.key)}
                  className="text-xs px-2 py-1.5 rounded-lg border border-border text-red-400 hover:border-red-500 transition-colors"
                >
                  削除
                </button>
              </div>
            ))}
          </div>
          <p className="text-xs text-amber-400/80 mt-2">
            ※ ファンダ条件は現在値による静的フィルタで、過去5年には遡及しません（過去の各時点のファンダメンタルは取得できないため）。
          </p>

          {/* 決算トレンド条件（fundamental / hybrid） */}
          <div className="mt-4">
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs text-muted">
                決算トレンド条件（任意・AND結合／損益計算書など年次決算の複数期推移から算出）
              </label>
              <button
                type="button"
                onClick={addDFilter}
                disabled={dFilters.length >= 10}
                className="text-xs px-3 py-1 rounded-lg border border-border text-slate-300 hover:border-blue-500 hover:text-white transition-colors disabled:opacity-40"
              >
                ＋ 決算条件を追加
              </button>
            </div>
            {dFilters.length === 0 && (
              <p className="text-xs text-muted/70">条件なし（例: 売上高CAGR(3年) ≥ 10%、営業利益率の連続上昇期数 ≥ 2）</p>
            )}
            <div className="space-y-2">
              {dFilters.map(row => (
                <div key={row.key} className="flex flex-wrap items-center gap-2">
                  <select
                    value={row.metric}
                    onChange={e => updateDFilter(row.key, { metric: e.target.value as DerivedMetric })}
                    className="bg-surface border border-border rounded-lg px-2 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                  >
                    {DERIVED_METRICS.map(mId => (
                      <option key={mId} value={mId}>{DERIVED_METRIC_INFO[mId].label}</option>
                    ))}
                  </select>
                  <select
                    value={row.operator}
                    onChange={e => updateDFilter(row.key, { operator: e.target.value as DerivedFilter['operator'] })}
                    className="bg-surface border border-border rounded-lg px-2 py-2 text-white text-sm font-mono focus:outline-none focus:border-blue-500"
                  >
                    {OPERATORS.map(op => (
                      <option key={op} value={op}>{OPERATOR_LABEL[op]}</option>
                    ))}
                  </select>
                  <input
                    type="number" step="any"
                    value={row.value}
                    onChange={e => updateDFilter(row.key, { value: e.target.value })}
                    placeholder={DERIVED_METRIC_INFO[row.metric].hint}
                    className="w-48 bg-surface border border-border rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-blue-500"
                  />
                  <span className="text-xs text-muted/70">{DERIVED_METRIC_INFO[row.metric].hint}</span>
                  <button
                    type="button"
                    onClick={() => removeDFilter(row.key)}
                    className="text-xs px-2 py-1.5 rounded-lg border border-border text-red-400 hover:border-red-500 transition-colors"
                  >
                    削除
                  </button>
                </div>
              ))}
            </div>
            <p className="text-xs text-amber-400/80 mt-2">
              ※ 決算データは年次の実績（最新約5期）。トレンド指標は直近数期から計算し、データ不足の場合は「判定不能（不成立扱い）」になります。
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
