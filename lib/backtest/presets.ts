// ニーズ軸プリセット定義（/lab S1）— 単一の真実源。
//
// 初心者向けの「ニーズ」を、既存の実在する部品だけに写像する:
//   - テクニカル: lib/backtest/rules.ts に実装済みの indicator のみ
//   - ファンダ: lib/backtest/fundamental.ts の FundamentalMetric のみ
// 新しいルール・指標は一切発明しない（COMPANY.md 原則9）。
//
// ファンダ条件は「現在値での参加可否判定（静的ゲート・fail-closed）」であり、
// バックテスト期間（過去5年）には遡及しない。UI・結果表示で必ず明記すること。
//
// このファイルは純データ＋純関数のみ（I/Oなし）。クライアント（ラベル表示）と
// サーバー（条件導出・排他ガード）の両方から import される。

import type {
  BacktestPeriod,
  CompositeCondition,
  LabBacktestRequest,
  NeedsPresetId,
} from './types'
import type { FundamentalGateResult } from './fundamental'
import type { BacktestResult } from './types'

export interface NeedsPreset {
  id: NeedsPresetId
  /** 初心者向けの抽象表現（専門用語なし）。 */
  label: string
  /** ニーズの説明文（UIの選択カードに表示）。 */
  description: string
  /** サーバーが導出する実条件（既存 CompositeCondition に写像）。 */
  condition: CompositeCondition
  /** バックテスト期間。長期MA等の warm-up を確保するため5年固定。 */
  period: BacktestPeriod
  /** 内部条件の正確な説明（結果表示用）。 */
  conditionNotes: string[]
}

// 閾値の根拠（値は生単位 = FundamentalsData と同じ）:
// - marketCap ≥ 100e9 … 大型株の目安（$100B ≒ メガキャップ圏）
// - dividendYield ≥ 0.03 … 配当利回り3%（percent系は小数表現）
// - marketCap ≤ 10e9 … 中小型株の上限目安（$10B）
//
// 注意（S1の既知の限界・レビュー指摘対応）: marketCap の比較は FundamentalsData の
// 生値（現地通貨建て）に対して行われるため、閾値は「米国株・USD建て」を想定した
// 目安である。日本株（7203.T 等・JPY建て）では ¥1000億 は大型の水準ではなく、
// 分類が実態とずれる。通貨別閾値・USユニバース強制は S3（自動絞り込み）で扱う。
// UI・conditionNotes に「米国株想定」を明記して誤認を防ぐ。
export const NEEDS_PRESETS: Record<NeedsPresetId, NeedsPreset> = {
  stable: {
    id: 'stable',
    label: '安定重視',
    description: 'リスクを抑えて、誰もが知る有名銘柄に投資したい',
    condition: {
      technical: { type: 'technical', indicator: 'ma_cross_dual', shortPeriod: 20, longPeriod: 50 },
      fundamentalFilters: [
        { metric: 'marketCap', operator: 'gte', value: 100e9 },
      ],
    },
    period: '5y',
    conditionNotes: [
      '参加条件（現在値で判定）: 時価総額 ≥ $100B（1000億米ドル）＝大型株のみ。閾値はUSD建て・米国株を想定した目安です',
      '売買ルール: 20日移動平均が50日移動平均を上抜けたら買い、下抜けたら売り（ゴールデンクロス/デッドクロス）',
      '検証期間: 過去5年の実データ日足',
    ],
  },
  income: {
    id: 'income',
    label: 'コツコツ配当',
    description: '配当や年利でコツコツ儲けたい',
    condition: {
      technical: { type: 'technical', indicator: 'ma_cross', period: 200 },
      fundamentalFilters: [
        { metric: 'dividendYield', operator: 'gte', value: 0.03 },
      ],
    },
    period: '5y',
    conditionNotes: [
      '参加条件（現在値で判定）: 配当利回り ≥ 3%',
      '売買ルール: 終値が200日移動平均を上抜けたら買い、下抜けたら売り（長期保有寄り）',
      '検証期間: 過去5年の実データ日足',
      '注: バックテストの損益は値動きベースです。配当の再投資は含まれていません',
    ],
  },
  aggressive: {
    id: 'aggressive',
    label: '積極リターン',
    description: '多少のリスクは許容し、大きな利益を狙いたい',
    condition: {
      technical: { type: 'technical', indicator: 'hl_break', period: 20 },
      fundamentalFilters: [
        { metric: 'marketCap', operator: 'lte', value: 10e9 },
      ],
    },
    period: '5y',
    conditionNotes: [
      '参加条件（現在値で判定）: 時価総額 ≤ $10B（100億米ドル）＝中小型株のみ。閾値はUSD建て・米国株を想定した目安です',
      '売買ルール: 終値が過去20日の高値を上抜けたら買い、過去20日の安値を下抜けたら売り（ブレイクアウト）',
      '検証期間: 過去5年の実データ日足',
    ],
  },
}

export const NEEDS_PRESET_IDS = Object.keys(NEEDS_PRESETS) as NeedsPresetId[]

export function isNeedsPresetId(v: unknown): v is NeedsPresetId {
  return typeof v === 'string' && v in NEEDS_PRESETS
}

// ── /analyze S1: ニーズ軸プリセット → /api/report/prepare 用 CompositeCondition ──
// NeedsPreset.condition は既に CompositeCondition 型そのものなので変換ロジックは
// 無い（新しい投資条件を発明しない・COMPANY.md 原則9）。/lab の無料プレビューと
// /report の専門レポートが「同一条件」を食うことを保証する単一の取り出し口。
export function getNeedsPresetCondition(id: NeedsPresetId): CompositeCondition {
  return NEEDS_PRESETS[id].condition
}

// ── /lab リクエストの検証＋排他ガード（純関数・APIとスモークで共用） ────────
// 排他の二重化のサーバー側: mode='needs'/'investor' でクライアントがカスタム
// condition を同梱してきたら 400。presetId が配列・複数・未知IDでも 400。

export type ParsedLabRequest =
  | { ok: true; request: LabBacktestRequest }
  | { ok: false; status: number; error: string }

const SYMBOL_RE = /^[A-Za-z0-9.\-]{1,15}$/

export function parseLabRequest(body: unknown): ParsedLabRequest {
  if (typeof body !== 'object' || body === null) {
    return { ok: false, status: 400, error: 'invalid request body' }
  }
  const b = body as Record<string, unknown>

  // symbol（全モード共通・必須）
  if (typeof b.symbol !== 'string' || !b.symbol.trim()) {
    return { ok: false, status: 400, error: 'symbol is required' }
  }
  const symbol = b.symbol.trim().toUpperCase()
  if (!SYMBOL_RE.test(symbol)) {
    return { ok: false, status: 400, error: 'invalid symbol format' }
  }

  // initialCapital（全モード共通・省略時 100,000・上限 10,000,000）
  const initialCapital =
    typeof b.initialCapital === 'number' && Number.isFinite(b.initialCapital) && b.initialCapital > 0
      ? Math.min(b.initialCapital, 10_000_000)
      : 100_000

  // mode（省略時は 'technical' — 既存クライアントの従来動作を維持）
  const mode = b.mode === undefined ? 'technical' : b.mode
  if (mode !== 'technical' && mode !== 'needs' && mode !== 'investor') {
    return { ok: false, status: 400, error: "mode must be 'technical' | 'needs' | 'investor'" }
  }

  if (mode === 'technical') {
    // 従来動作: MAクロスのみ・periodは 2..200 にクランプ
    const rawCond = b.condition as Record<string, unknown> | undefined
    const rawPeriod = rawCond?.period
    const period =
      typeof rawPeriod === 'number' && rawPeriod >= 2 && rawPeriod <= 200
        ? Math.floor(rawPeriod)
        : 20
    return {
      ok: true,
      request: {
        mode: 'technical',
        symbol,
        condition: { type: 'technical', indicator: 'ma_cross', period },
        initialCapital,
      },
    }
  }

  // ── 排他ガード: needs/investor でカスタム条件の同梱は 400 ────────────────
  if (b.condition !== undefined || b.conditions !== undefined) {
    return {
      ok: false,
      status: 400,
      error: `mode='${mode}' ではカスタム条件（condition）を指定できません。条件はサーバー側で導出されます。`,
    }
  }

  if (mode === 'investor') {
    return { ok: true, request: { mode: 'investor', symbol, initialCapital } }
  }

  // mode === 'needs': presetId は単一・必須・実在ID
  if (Array.isArray(b.presetId)) {
    return { ok: false, status: 400, error: 'presetId は単一のプリセットIDを指定してください（複数指定は不可）。' }
  }
  if (!isNeedsPresetId(b.presetId)) {
    return {
      ok: false,
      status: 400,
      error: `presetId は ${NEEDS_PRESET_IDS.join(' / ')} のいずれか1つを指定してください。`,
    }
  }
  return { ok: true, request: { mode: 'needs', symbol, presetId: b.presetId, initialCapital } }
}

// ── needsモードのAPIレスポンス型 ────────────────────────────────────────────
// FundamentalGateResult は fundamental.ts 定義のため（循環importを避けて）
// レスポンス型は types.ts でなくここに置く。
export interface LabNeedsResponse {
  mode: 'needs'
  presetId: NeedsPresetId
  presetLabel: string
  /** プリセットの内部条件の説明（結果表示用）。 */
  conditionNotes: string[]
  /** 現在値ファンダの静的ゲート判定（実測値つき）。 */
  gate: FundamentalGateResult
  gatePassed: boolean
  /** ゲート不成立時のみ: 実測値つきの不成立理由。 */
  gateFailReason?: string
  /** ゲート成立時のみバックテスト結果。不成立時は null（実行しない）。 */
  result: BacktestResult | null
}
