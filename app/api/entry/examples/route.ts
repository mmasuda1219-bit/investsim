import { NextResponse } from 'next/server'
import { listSessions } from '@/lib/ai-trader/store'
import type { AISession } from '@/lib/ai-trader/engine'
import type { DecisionRecord } from '@/lib/ai-trader/memory'
import { getHistory, type Period } from '@/lib/market'
import type { HistoricalBar } from '@/types'
import { pickAnswerExamples, isEligible, MIN_ELAPSED_BUSINESS_DAYS, type AnswerCandidate } from '@/lib/entry/answer-examples'
import { hasServiceRole } from '@/lib/supabase/env'

// GET /api/entry/examples — ホーム（app/(night)/page.tsx）の「03 読み返す」と「残るもの（例）」に出す、このサイトのAIの判断の実例2件。
// ログイン不要。AI推論は走らせない（保存済みの判断を読むだけ。最も人が来る面を最も安い面にする）。
//
// データ源（DECISIONS.md 2026-09-29 決定(1)）: `ai_sessions` の blob の `learning.allDecisions`（上限1500・本番実測で最古 2026-07-14）。
// S0 の表 `ai_decisions` は**使わない**（まだ空で、20営業日の条件を満たす行が貯まるまで1か月かかる）。`ai_decisions` が育ったら
// この route の collectDecisions() だけを差し替える（選び方 lib/entry/answer-examples.ts と画面は変えない）。
//
// 手順:
//  1. 全セッションの allDecisions を集め、形の壊れた記録（時刻が読めない・価格が 0 以下・理由が空）を落とし、同じ判断（時刻＋銘柄）を1つにする
//  2. 各候補に **営業日の経過日数**（土日を除いた暦の日数。祝日は数えない＝近似）を付け、20営業日未満と禁止語を含む理由を落とし、
//     判断日が古い順（decidedAt → symbol → reasoning）に並べる
//  3. 古い順に1件ずつ、その銘柄の日足（getHistory・実データのみ・allowMock:false）を取り、**最終足の終値**と判断時の価格から騰落率を出す。
//     getQuote を別に呼ばない（出所と時刻が2つになり DESIGN.md §4-2 R8 が崩れる）。折れ線もこの同じ足から引く
//  4. 値上がりと値下がりが1件ずつそろった時点で止める（pickAnswerExamples は並べ替えて選ぶので、古い順に足していけば全件で選んだ結果と同じ）。
//     見る銘柄は先頭から最大 MAX_HISTORY_FETCHES まで（Yahoo の 429 を避ける。その範囲で見つからなければ「無い」）
//
// 応答（3つの形）:
//   実例あり（200）: { examples: { up: Example, down: Example } }  ← Example は下の型。社名は返さない（DecisionRecord に name が無い。銘柄コードだけ）
//   実例なし（200）: { examples: null }   ← 候補が無い／条件を満たさない。**正常な状態**（画面は節ごと出さない。架空で埋めない＝原則9）
//   失敗（502）:     { error: <和文> }    ← セッションの置き場か株価の取得元が返せなかった。「無い」と見せない（DESIGN.md §6-12）
//
// キャッシュ: 成功は CDN で1時間＋1日の stale-while-revalidate（全員に同じ応答＝「全員に同じものを同じ順で」もここで守れる。
// 判断が増えるのは自動 tick 1日3回だけ）。失敗（502）は no-store（一時的な障害を CDN に残さない）。
// 検査: scripts/check-answer-examples.ts（選び方の純関数）・scripts/check-entry.ts（この route の外形）

export type ExampleBar = { t: string; close: number }
export interface Example {
  symbol: string
  /** 判断した時刻（ISO） */
  decidedAt: string
  action: DecisionRecord['action']
  /** AI が書いた理由の全文（禁止語検査を通ったものだけ） */
  reasoning: string
  /** (最終足の終値 − 判断日の終値) / 判断日の終値 × 100。**記録側の価格は使わない**（下の baseIndex の注釈） */
  changePct: number
  /** 判断日からたった営業日数（土日を除く） */
  elapsedBusinessDays: number
  /** 折れ線用の日足の終値（判断日の少し前から最終足まで） */
  bars: ExampleBar[]
  /** 騰落率の起点にした足の日付（YYYY-MM-DD）＝判断日以降で最初の足。図の縦破線と同じ日 */
  baseAsOf: string
  /** 最終足の日付（YYYY-MM-DD）。騰落率の「いつ時点」 */
  priceAsOf: string
  /** 株価の出所（R8） */
  source: string
}
export type ExamplesBody = { examples: { up: Example; down: Example } | null }

const CACHE_1H = 'public, s-maxage=3600, stale-while-revalidate=86400'
const READ_FAILED_MESSAGE = 'AIの判断の記録を読み込めませんでした'
/** 1回の応答で日足を取りに行く銘柄の上限（古い順に見て、この範囲で見つからなければ「無い」） */
const MAX_HISTORY_FETCHES = 30
/** 折れ線に含める、判断日より前の足の本数（判断日の縦線が左端に張り付かないための余白） */
const LEAD_BARS = 10
/** 株価の出所。lib/market の実データ経路（yahoo-finance2 → Yahoo Direct → Twelve Data）の主経路 */
const PRICE_SOURCE = 'Yahoo Finance'

const ACTIONS: readonly DecisionRecord['action'][] = ['buy', 'sell', 'hold', 'watch']

interface Candidate extends AnswerCandidate {
  action: DecisionRecord['action']
  /** 記録側に価格が入っているか（形の確かめだけに使う）。**騰落率の計算には使わない** — 本番の blob で
   *  実際の株価と食い違っていることを 2026-09-29 に確認したため（baseIndex の注釈） */
  price: number
  /** 騰落率の起点にした足の日付。日足を取ってから埋める */
  baseAsOf: string
}

/** 1つのセッションの allDecisions から、形の整った判断だけを取り出す（時刻・価格・理由・方向がそろっているもの） */
function collectDecisions(sessions: AISession[], now: Date): Candidate[] {
  const seen = new Set<string>()
  const out: Candidate[] = []
  for (const s of sessions) {
    const all = Array.isArray(s?.learning?.allDecisions) ? s.learning.allDecisions : []
    for (const d of all) {
      if (!d || typeof d.timestamp !== 'string' || typeof d.symbol !== 'string' || typeof d.reasoning !== 'string') continue
      if (typeof d.price !== 'number' || !Number.isFinite(d.price) || d.price <= 0) continue
      if (!ACTIONS.includes(d.action)) continue
      if (Number.isNaN(Date.parse(d.timestamp)) || d.reasoning.trim().length === 0) continue
      const key = `${d.timestamp}|${d.symbol}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({
        symbol: d.symbol,
        decidedAt: d.timestamp,
        action: d.action,
        price: d.price,
        reasoning: d.reasoning,
        elapsedBusinessDays: businessDaysSince(d.timestamp, now),
        changePct: Number.NaN, // 日足を取ってから埋める
        baseAsOf: '',          // 同上
      })
    }
  }
  return out
}

/** UTC の暦日（00:00Z）に丸める */
function utcDay(ms: number): number {
  return Math.floor(ms / 86_400_000) * 86_400_000
}

/**
 * 判断日の翌日から今日（UTC）までの営業日の数。土日を除く。祝日は数えない（近似。祝日分だけ実際より多く数える）。
 * 判断日そのものは数えない（判断した日の値動きは「その後」ではない）。
 */
function businessDaysSince(decidedAtISO: string, now: Date): number {
  const from = utcDay(Date.parse(decidedAtISO))
  const to = utcDay(now.getTime())
  let n = 0
  for (let d = from + 86_400_000; d <= to; d += 86_400_000) {
    const dow = new Date(d).getUTCDay()
    if (dow !== 0 && dow !== 6) n++
  }
  return n
}

/** 判断日を含む日足が取れる最短の期間（暦日で判断。RANGE_MAP: 1mo=33日／3mo=95日／6mo=190日／1y=370日） */
function periodFor(calendarDays: number): Period {
  if (calendarDays <= 25) return '1mo'
  if (calendarDays <= 85) return '3mo'
  if (calendarDays <= 175) return '6mo'
  if (calendarDays <= 355) return '1y'
  return '2y'
}

/** HistoricalBar.time は秒（providers/yahoo2）。ms で来ても読めるようにする */
function barMs(bar: HistoricalBar): number {
  return bar.time < 1e12 ? bar.time * 1000 : bar.time
}
function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

/** 判断日以降で最初の足の位置（＝騰落率の起点「判断日の終値」）。無ければ -1 */
function baseIndex(bars: HistoricalBar[], decidedAt: string): number {
  const decidedDay = utcDay(Date.parse(decidedAt))
  return bars.findIndex(b => utcDay(barMs(b)) >= decidedDay)
}

function toExample(c: Candidate, bars: HistoricalBar[]): Example {
  const i0 = baseIndex(bars, c.decidedAt)
  const start = i0 < 0 ? 0 : Math.max(0, i0 - LEAD_BARS)
  const last = bars[bars.length - 1]
  return {
    symbol: c.symbol,
    decidedAt: c.decidedAt,
    action: c.action,
    reasoning: c.reasoning,
    changePct: c.changePct,
    elapsedBusinessDays: c.elapsedBusinessDays,
    bars: bars.slice(start).map(b => ({ t: isoDate(barMs(b)), close: b.close })),
    baseAsOf: c.baseAsOf,
    priceAsOf: isoDate(barMs(last)),
    source: PRICE_SOURCE,
  }
}

export async function GET() {
  try {
    // 本番で鍵が無いと listSessions() が黙ってローカルのファイル置き場を読み、空配列＝「まだ無い」に化ける
    // （設定漏れが「記録が無い」に見える。S2 レビュー W5）。正直に 502 へ倒す。
    if (process.env.NODE_ENV === 'production' && !hasServiceRole()) {
      throw new Error('SUPABASE_SERVICE_ROLE_KEY missing')
    }
    const now = new Date()
    const sessions = await listSessions()
    // 20営業日未満と禁止語を先に落とし、古い順に並べる（並び順は pickAnswerExamples と同じ鍵。入力順に依らない）
    const eligible = collectDecisions(sessions, now)
      .filter(isEligible)
      .sort((a, b) => (a.decidedAt !== b.decidedAt ? (a.decidedAt < b.decidedAt ? -1 : 1)
        : a.symbol !== b.symbol ? (a.symbol < b.symbol ? -1 : 1)
        : a.reasoning < b.reasoning ? -1 : a.reasoning > b.reasoning ? 1 : 0))

    const histories = new Map<string, Promise<HistoricalBar[]>>()
    const enriched: Candidate[] = []
    const barsOf = new Map<Candidate, HistoricalBar[]>()
    let fetches = 0
    /** 日足を取りに行って成功した銘柄の数と、失敗した数（1件も成功しなければ取得元の障害とみなす） */
    let fetched = 0
    let failures = 0
    for (const c of eligible) {
      const calendarDays = Math.ceil((now.getTime() - Date.parse(c.decidedAt)) / 86_400_000)
      const period = periodFor(calendarDays)
      const key = `${c.symbol}|${period}`
      if (!histories.has(key)) {
        if (fetches >= MAX_HISTORY_FETCHES) break
        fetches++
        histories.set(key, getHistory(c.symbol, period, { allowMock: false }))
      }
      // 銘柄1つの取得失敗でこの節を落とさない（S2 レビュー W2）。選び方が「古い順」で決定的なので、
      // 最古の候補の銘柄が上場廃止・コード変更で取れなくなると毎回同じ所で落ち、最も人が来る面が
      // 常時エラーになる。1銘柄の失敗は飛ばして数え、**1件も取れなかったときだけ** 502 にする
      // （取得元そのものが落ちている場合。失敗を「無い」と見せないのは §6-12 のまま）。
      let bars: HistoricalBar[]
      try {
        bars = (await histories.get(key)!).filter(b => Number.isFinite(b.close) && b.close > 0)
      } catch (e) {
        console.error(`[api/entry/examples] 日足を取れなかった: ${c.symbol} (${period}) — ${e instanceof Error ? e.message : String(e)}`)
        failures++
        continue
      }
      if (bars.length === 0) { failures++; continue }
      fetched++
      const last = bars[bars.length - 1]
      // 騰落率は **日足の系列だけ** から出す（判断日の終値 → 最終足の終値）。
      // 記録側の DecisionRecord.price は使わない: 2026-09-29 に本番の blob を実測したところ、
      // 2026-07-14 の記録が AMZN 188.25 相当（同日の実際の終値は 247.49）・9984.T 9,447 相当（実際は 6,574）で、
      // 方向も比率もばらばらに食い違っていた（分割では説明が付かない）。そこから騰落率を出すと、
      // 画面に実在しない数字が出る（原則9）。図と同じ系列から出せば、線と数字が必ず一致する。
      const baseIdx = baseIndex(bars, c.decidedAt)
      if (baseIdx < 0) continue // 判断日より後の足が無い＝比べられない。候補から外す（0 で埋めない）
      const base = bars[baseIdx]
      // 経過日数も **同じ日足の系列** から数える（S2 レビュー W1）。businessDaysSince は土日しか除かないので
      // 祝日の分だけ多く出る＝「営業日」と名乗りながら営業日でない数字が画面に出ていた。足の本数なら
      // 祝日の表を持たずに正確で、出所も図と同じ1つになる（R8）。事前の絞り込み（平日数）は
      // 平日数 ≥ 取引日数なので、通すべきものを落とすことはない＝そのまま残す。
      const tradingDaysAfter = bars.length - 1 - baseIdx
      if (tradingDaysAfter < MIN_ELAPSED_BUSINESS_DAYS) continue
      const withPct: Candidate = {
        ...c,
        changePct: ((last.close - base.close) / base.close) * 100,
        baseAsOf: isoDate(barMs(base)),
        elapsedBusinessDays: tradingDaysAfter,
      }
      enriched.push(withPct)
      barsOf.set(withPct, bars)
      const picked = pickAnswerExamples(enriched)
      if (picked) {
        const body: ExamplesBody = {
          examples: { up: toExample(picked.up, barsOf.get(picked.up)!), down: toExample(picked.down, barsOf.get(picked.down)!) },
        }
        return NextResponse.json(body, { headers: { 'Cache-Control': CACHE_1H } })
      }
    }
    // 取りに行ったのに1件も取れなかった＝株価の取得元そのものが落ちている。「無い」と見せない（§6-12）
    if (failures > 0 && fetched === 0) throw new Error(`no daily bars for any of ${failures} symbols`)
    // 候補が無い／条件（20営業日・禁止語・上げと下げが1件ずつ）を満たす組が無い＝正常な「無い」
    const body: ExamplesBody = { examples: null }
    return NextResponse.json(body, { headers: { 'Cache-Control': CACHE_1H } })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // 原因の英語はサーバーのログにだけ残す（画面には出さない）。app/api/ai-session/latest/route.ts と同じ流儀
    console.error(`[api/entry/examples] ${READ_FAILED_MESSAGE}: ${message}`)
    // 502 = 記録の置き場か株価の取得元が返せなかった。「実例が無い」（200 の null）とは区別する
    return NextResponse.json(
      { error: READ_FAILED_MESSAGE },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    )
  }
}

