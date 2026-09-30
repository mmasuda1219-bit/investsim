import type { HistoricalBar } from '@/types'
import type { ExitLevel } from '@/lib/review/exit-rule'

/**
 * 「起きたことの頻度」（/review/[recordId] §5・S3a・2026-09-30）を **日足だけから** 数える純関数。AI は使わない。
 *
 * 出すのは最大3項目。どれも「数えられる事実」で止め、固定の文型で返す（DECISIONS 2026-09-30 (7)）:
 *  1. 保有していた期間の、1日の値動き（最大の上げ・最大の下げ・±3%以上動いた日数）
 *  2. 降りる条件が「買値から−x%」の形で読めたとき、同じ幅を1日で動いた日が、取れた日足の全期間で何日あったか
 *  3. 保有していた期間の営業日数と、終値が「あなたの記録の買値」を上回っていた日数
 *
 * 書かないもの:
 *  - 「過去10年」（取れる日足は最長 5y。実際に取れた期間と本数を window に入れて画面に出す）
 *  - 決算に関する項目（発表日の履歴が取れない＝原則9）
 *  - 良し悪しの副詞（よくある・珍しい・意外・多い・少ない）と、損益との結びつき
 *  - 「当社の分析」という名乗り
 * 日足が2本未満なら何も出さない（架空で埋めない）。買った日を日足が覆っていなければ 1・3 は出さない。
 *
 * 買値（entryPrice）は本人の記録の値で、実勢と食い違い得る（DECISIONS 2026-09-30 (11)）。使うのは
 *  - 2 の「買値から−x%」の幅（parseExitLevel の % 基準そのもの。ラベルに「買値から」と出る）
 *  - 3 のしきい値（文に「あなたの記録では $X」と出所を書く）
 * だけで、値動きの計算根拠にはしない。
 *
 * 入力に持たないもの: 現在時刻・乱数・ユーザー。同じ入力には常に同じ答え。検査: scripts/check-review-record.ts。
 */

export interface BaseRateWindow {
  /** 対象期間の最初の日足の日付（YYYY-MM-DD・UTC） */
  from: string
  /** 対象期間の最後の日足の日付 */
  to: string
  /** 対象期間の日足の本数 */
  bars: number
}

export interface BaseRate {
  key: 'daily-moves' | 'same-move' | 'above-entry'
  label: string
  /** 固定の文型で組んだ本文 */
  value: string
  window: BaseRateWindow
  /** 数えた根拠。いまは日足だけ */
  basis: 'bars'
}

export interface BaseRateInput {
  symbol: string
  bars: HistoricalBar[]
  entryAt: number
  /** 売った時刻。分割して売ったときは最後の売り。保有中は null */
  exitAt: number | null
  /** parseExitLevel の結果。無ければ null */
  exitLevel: ExitLevel | null
  /** 本人の記録の買値 */
  entryPrice: number
}

/** ±この割合以上を「大きく動いた日」と数える（%） */
export const BIG_MOVE_PCT = 3

/** ms → UTC の暦日（YYYY-MM-DD）。判断の記録と日足の日付を同じ基準で比べる（PriceSincePanel の dayKey と同じ） */
function dayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}
const barDay = (b: HistoricalBar) => dayKey(b.time * 1000)

/** 'YYYY-MM-DD' → '9/1' */
function slash(key: string): string {
  const [, m, d] = key.split('-')
  return `${Number(m)}/${Number(d)}`
}

/** 符号付きの割合。マイナスは U+2212、小数1桁（整数なら小数を付けない＝exit-rule.ts のラベルと同じ書き方） */
function fmtPct(x: number): string {
  const sign = x > 0 ? '+' : x < 0 ? '−' : '±'
  const a = Math.round(Math.abs(x) * 10) / 10
  return `${sign}${a % 1 === 0 ? String(a) : a.toFixed(1)}%`
}

/** .T は円（整数）、それ以外はドル（小数2桁）。仮想資金でも単位は偽らない（原則10） */
function fmtPrice(symbol: string, n: number): string {
  return /\.T$/i.test(symbol)
    ? `¥${Math.round(n).toLocaleString('en-US')}`
    : `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** 前日の終値との比べ（%）。i は 1 以上 */
function changePct(bars: HistoricalBar[], i: number): number | null {
  const prev = bars[i - 1].close
  if (!(prev > 0)) return null
  return ((bars[i].close - prev) / prev) * 100
}

/** 保有していた期間（買った日の足〜売った日の足／最後の足）の添え字。買った日を覆っていなければ null */
function holdSpan(sorted: HistoricalBar[], entryAt: number, exitAt: number | null): { start: number; end: number } | null {
  const entryDay = dayKey(entryAt)
  const start = sorted.findIndex(b => barDay(b) >= entryDay)
  if (start < 0) return null
  if (start === 0 && barDay(sorted[0]) > entryDay) return null
  let end = sorted.length - 1
  if (exitAt !== null) {
    const exitDay = dayKey(exitAt)
    const found = sorted.findIndex(b => barDay(b) >= exitDay)
    if (found >= 0) end = found
  }
  if (end < start) return null
  return { start, end }
}

export function computeBaseRates(input: BaseRateInput): BaseRate[] {
  const { symbol, entryAt, exitAt, exitLevel, entryPrice } = input
  if (!Array.isArray(input.bars) || input.bars.length < 2) return []
  const sorted = [...input.bars].sort((a, b) => a.time - b.time)
  const out: BaseRate[] = []
  const span = holdSpan(sorted, entryAt, exitAt)

  // 1. 保有していた期間の、1日の値動き
  if (span && span.end > span.start) {
    let up: { pct: number; day: string } | null = null
    let down: { pct: number; day: string } | null = null
    let big = 0
    let compared = 0
    for (let i = span.start + 1; i <= span.end; i++) {
      const c = changePct(sorted, i)
      if (c === null) continue
      compared++
      const day = barDay(sorted[i])
      if (c > 0 && (up === null || c > up.pct)) up = { pct: c, day }
      if (c < 0 && (down === null || c < down.pct)) down = { pct: c, day }
      if (Math.abs(c) >= BIG_MOVE_PCT) big++
    }
    if (compared > 0) {
      out.push({
        key: 'daily-moves',
        label: '保有していた期間の、1日の値動き（終値を前日の終値と比べて）',
        value:
          `最大の上げ ${up ? `${fmtPct(up.pct)}（${slash(up.day)}）` : 'なし'}・` +
          `最大の下げ ${down ? `${fmtPct(down.pct)}（${slash(down.day)}）` : 'なし'}・` +
          `±${BIG_MOVE_PCT}%以上動いた日 ${big}日（前日と比べられた ${compared}日のうち）`,
        window: { from: barDay(sorted[span.start]), to: barDay(sorted[span.end]), bars: span.end - span.start + 1 },
        basis: 'bars',
      })
    }
  }

  // 2. 降りる条件が「買値から−x%」の形で読めたとき、同じ幅を1日で動いた日（取れた日足の全期間）
  if (exitLevel && exitLevel.label.includes('買値から') && entryPrice > 0 && Number.isFinite(entryPrice)) {
    // 浮動小数のずれ（0.8 × 107 / 107 → 19.999…）を落とす。parseExitLevel の x は小数1桁までの想定
    const x = Math.round(Math.abs(exitLevel.price / entryPrice - 1) * 1000) / 10
    const downward = exitLevel.price < entryPrice
    if (x > 0 && x < 100) {
      let hit = 0
      let compared = 0
      for (let i = 1; i < sorted.length; i++) {
        const c = changePct(sorted, i)
        if (c === null) continue
        compared++
        if (downward ? c <= -x : c >= x) hit++
      }
      if (compared > 0) {
        const width = fmtPct(downward ? -x : x)
        out.push({
          key: 'same-move',
          label: `書いた条件と同じ幅（買値から${width}）を、1日で${downward ? '下げた' : '上げた'}日（終値を前日の終値と比べて）`,
          value: `${hit}日（日足 ${sorted.length}本・前日と比べられた ${compared}日のうち）`,
          window: { from: barDay(sorted[0]), to: barDay(sorted[sorted.length - 1]), bars: sorted.length },
          basis: 'bars',
        })
      }
    }
  }

  // 3. 保有していた期間の営業日数と、終値が買値を上回っていた日数
  if (span && entryPrice > 0 && Number.isFinite(entryPrice)) {
    const n = span.end - span.start + 1
    let above = 0
    for (let i = span.start; i <= span.end; i++) if (sorted[i].close > entryPrice) above++
    out.push({
      key: 'above-entry',
      label: '保有していた期間の営業日数と、終値が買値を上回っていた日数',
      value: `営業日 ${n}日のうち ${above}日（買値は、あなたの記録では ${fmtPrice(symbol, entryPrice)}）`,
      window: { from: barDay(sorted[span.start]), to: barDay(sorted[span.end]), bars: n },
      basis: 'bars',
    })
  }

  return out
}
