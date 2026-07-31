// 読者プロファイル（/analyze・/report S1「初心者向け一流分析」ロードマップ）。
//
// これは投資条件でもファンダメンタルデータでもない — 読者(ユーザー)が答える
// 3〜4問のアンケート結果である。目的はレポートの「強調順序・語り口・意味づけ」
// だけを最適化するレンズであり、数値・ゲート判定・バックテスト・シナリオの
// 中身は一切変えない（COMPANY.md 原則9の絶対線）。
//
// lib/backtest/presets.ts と同じパターンを踏襲: 純データ＋純関数のみ・I/Oなし。
// buildEmphasisHints は既存の実在指標（FundamentalMetric / DerivedMetric）の
// ラベルだけを参照する — 新しい指標・複合スコアは発明しない。

import { METRIC_INFO } from '@/lib/backtest/fundamental'
import type { FundamentalMetric } from '@/lib/backtest/types'
import { DERIVED_METRIC_INFO } from '@/lib/backtest/fundamental'
import type { DerivedMetric } from '@/lib/statements/types'

export interface ReaderProfile {
  /** 投資期間。 */
  horizon: 'short' | 'mid' | 'long'
  /** リスク許容度（値下がりへの耐性）。 */
  tolerance: 'low' | 'mid' | 'high'
  /** スタイル志向。 */
  style: 'income' | 'growth' | 'value'
  /** 資金の性格（任意・4問目）。未回答可。 */
  capacity?: 'core' | 'tight'
}

const HORIZONS = ['short', 'mid', 'long'] as const
const TOLERANCES = ['low', 'mid', 'high'] as const
const STYLES = ['income', 'growth', 'value'] as const
const CAPACITIES = ['core', 'tight'] as const

export const HORIZON_LABELS: Record<ReaderProfile['horizon'], string> = {
  short: '短期（〜1年程度）',
  mid: '中期（1〜3年程度）',
  long: '長期（3年超）',
}

export const TOLERANCE_LABELS: Record<ReaderProfile['tolerance'], string> = {
  low: '低い（値下がりに弱い・気になる）',
  mid: '普通',
  high: '高い（値動きが大きくても平気）',
}

export const STYLE_LABELS: Record<ReaderProfile['style'], string> = {
  income: '配当・インカム重視',
  growth: '成長重視',
  value: '割安重視',
}

export const CAPACITY_LABELS: Record<NonNullable<ReaderProfile['capacity']>, string> = {
  core: '余裕資金（当面使う予定のないお金）',
  tight: 'ぎりぎりの資金（生活資金に近い）',
}

/** UIの選択肢反復用（NEEDS_PRESET_IDS と同じ「配列も一緒にexportする」パターン）。 */
export const HORIZON_OPTIONS: { id: ReaderProfile['horizon']; label: string }[] =
  HORIZONS.map((id) => ({ id, label: HORIZON_LABELS[id] }))
export const TOLERANCE_OPTIONS: { id: ReaderProfile['tolerance']; label: string }[] =
  TOLERANCES.map((id) => ({ id, label: TOLERANCE_LABELS[id] }))
export const STYLE_OPTIONS: { id: ReaderProfile['style']; label: string }[] =
  STYLES.map((id) => ({ id, label: STYLE_LABELS[id] }))
export const CAPACITY_OPTIONS: { id: NonNullable<ReaderProfile['capacity']>; label: string }[] =
  CAPACITIES.map((id) => ({ id, label: CAPACITY_LABELS[id] }))

/** ホワイトリスト検証（generateルートで body.profile を検証する用）。 */
export function isReaderProfile(v: unknown): v is ReaderProfile {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  if (typeof o.horizon !== 'string' || !HORIZONS.includes(o.horizon as ReaderProfile['horizon'])) return false
  if (typeof o.tolerance !== 'string' || !TOLERANCES.includes(o.tolerance as ReaderProfile['tolerance'])) return false
  if (typeof o.style !== 'string' || !STYLES.includes(o.style as ReaderProfile['style'])) return false
  if (o.capacity !== undefined) {
    if (typeof o.capacity !== 'string' || !CAPACITIES.includes(o.capacity as NonNullable<ReaderProfile['capacity']>)) {
      return false
    }
  }
  return true
}

/** プロンプト用の人間可読ブロック（【読者プロファイル】節の冒頭に埋め込む）。 */
export function describeReaderProfile(p: ReaderProfile): string {
  const lines = [
    `- 投資期間: ${HORIZON_LABELS[p.horizon]}`,
    `- リスク許容度: ${TOLERANCE_LABELS[p.tolerance]}`,
    `- スタイル志向: ${STYLE_LABELS[p.style]}`,
  ]
  if (p.capacity) lines.push(`- 資金の性格: ${CAPACITY_LABELS[p.capacity]}`)
  return lines.join('\n')
}

function fLabel(m: FundamentalMetric): string {
  return METRIC_INFO[m].label
}
function dLabel(m: DerivedMetric): string {
  return DERIVED_METRIC_INFO[m].label
}

/**
 * プロファイルに応じた「強調順序・語り口」の指針を実在指標名つきで列挙する。
 * 数値・判定の中身を変える指示や「この指標だけ見ろ／リスクを省け」という
 * 指示は絶対に含めない — 順序と厚みの指示に留める（原則9・企画意図）。
 */
export function buildEmphasisHints(p: ReaderProfile): string[] {
  const hints: string[] = []

  switch (p.style) {
    case 'income':
      hints.push(
        `配当・インカム重視の読者向けに、${fLabel('dividendYield')}・${dLabel('fcfMargin')}・` +
        `${dLabel('fcfPositiveYears')}・${dLabel('equityRatio')}・${dLabel('profitQuality')}を他の指標より先に、` +
        'より詳しく取り上げる（値だけでなく「安定して配当を出し続けられそうか」の観点を厚くする）。',
      )
      break
    case 'growth':
      hints.push(
        `成長重視の読者向けに、${dLabel('revenueCagr3y')}・${dLabel('epsCagr3y')}・${fLabel('earningsGrowth')}を` +
        `他の指標より先に、より詳しく取り上げる。${fLabel('pe')}は「その成長率に対して割高か割安か」という` +
        'PEG的な文脈を添えて説明する。',
      )
      break
    case 'value':
      hints.push(
        `割安重視の読者向けに、${fLabel('pe')}・${fLabel('pb')}・${dLabel('profitQuality')}・` +
        `${dLabel('equityRatio')}・${dLabel('netDebtToEbitda')}を他の指標より先に、より詳しく取り上げる。`,
      )
      break
  }

  if (p.horizon === 'short' || p.tolerance === 'low' || p.capacity === 'tight') {
    hints.push(
      '弱気シナリオと最大ドローダウンへの耐性を他のシナリオより厚く扱い、' +
      '「弱気シナリオが実現しても現在の株価水準が正当化されるか」を明示的に論じる' +
      '（強気シナリオを省略しない・強み+リスクの両面評価は維持する）。',
    )
  }

  if (p.horizon === 'long') {
    hints.push(
      `${dLabel('epsCagr3y')}・${dLabel('revenueCagr3y')}や複数期の長期トレンドを厚く扱い、` +
      '複利効果・時間分散について一節を割く（将来の成長を保証する予言ではないという免責を必ず添える）。',
    )
  }

  if (p.tolerance === 'high') {
    hints.push(
      '強気シナリオの上値余地やカタリストも積極的に取り上げる' +
      '（弱気シナリオ・リスクの提示を省略しない）。',
    )
  }

  return hints
}
