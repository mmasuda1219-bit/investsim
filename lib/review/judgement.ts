import type { Trade } from '@/lib/portfolio'

/**
 * 「振り返る」の素材づくり。
 *
 * オーナー定義の4段階のうち振り返るは「自分の判断がどう変わってきたかを見る。
 * 儲けた額ではなく、判断の質」。そのためには金額だけでなく
 * **買ったときに何を考えていたか → 実際どうなったか** を1件ずつ突き合わせられる
 * 必要がある。ここはその突き合わせだけを行う純関数。
 *
 * 守っている制約（原則9・金商法）:
 *  - 「判断の質スコア」のような合成指標を作らない。数えられる事実だけを返す。
 *    点数化は根拠が無く、良し悪しの断定にもなるため。
 *  - 往復が3件未満のときは統計語（中央値・平均）を使わせない。呼び出し側が
 *    判断できるよう `enoughForStats` を返す。
 *  - 理由が無い取引を「理由あり」に見せない。欠けているものは欠けていると返す。
 */

export interface Judgement {
  symbol: string
  name: string
  /** 買った時刻 */
  entryAt: number
  /** 売った時刻。未決済なら null */
  exitAt: number | null
  shares: number
  entryPrice: number
  exitPrice: number | null
  /** 実現損益率(%)。未決済なら null（含み損益は算出しない＝現在値を持たないため） */
  pnlPct: number | null
  /** 買った時に書いた理由。無ければ null */
  entryReason: string | null
  /** 売った時に書いた理由。無ければ null */
  exitReason: string | null
  /** 保有日数（暦日）。未決済なら null */
  heldDays: number | null
}

export interface JudgementSummary {
  judgements: Judgement[]
  /** 完結した往復の件数 */
  closedCount: number
  /** 未決済の件数 */
  openCount: number
  /** 買いのうち理由が残っているものの件数 */
  withEntryReason: number
  /** 買いの総数 */
  entryCount: number
  /** 往復3件以上か。false のとき呼び出し側は統計語を使わない */
  enoughForStats: boolean
}

const DAY_MS = 86_400_000

/**
 * 売買履歴を銘柄ごとに時系列で走査し、買い→売りの往復に組み直す。
 *
 * 部分決済は「買った順に売れていく」(FIFO) とみなす。実際の税務上の扱いとは
 * 別で、ここでの目的は判断と結果の対応づけなので、最も素直な対応を採る。
 * この前提は表示側で明示すること。
 */
export function buildJudgements(trades: Trade[]): JudgementSummary {
  // 保存は新しい順（unshift）なので、古い順に並べ替えてから処理する。
  const chronological = [...trades].sort((a, b) => a.timestamp - b.timestamp)

  const openLots: Record<string, Judgement[]> = {}
  const closed: Judgement[] = []
  let entryCount = 0
  let withEntryReason = 0

  for (const t of chronological) {
    if (t.action === 'buy') {
      entryCount++
      if (t.reason && t.reason.trim()) withEntryReason++
      const lot: Judgement = {
        symbol: t.symbol,
        name: t.name,
        entryAt: t.timestamp,
        exitAt: null,
        shares: t.shares,
        entryPrice: t.price,
        exitPrice: null,
        pnlPct: null,
        entryReason: t.reason?.trim() || null,
        exitReason: null,
        heldDays: null,
      }
      ;(openLots[t.symbol] ??= []).push(lot)
      continue
    }

    // 売り: 同じ銘柄の古い買いから順に充当する
    let remaining = t.shares
    const lots = openLots[t.symbol] ?? []
    while (remaining > 0 && lots.length > 0) {
      const lot = lots[0]
      const matched = Math.min(lot.shares, remaining)

      closed.push({
        ...lot,
        shares: matched,
        exitAt: t.timestamp,
        exitPrice: t.price,
        pnlPct: lot.entryPrice > 0 ? ((t.price - lot.entryPrice) / lot.entryPrice) * 100 : null,
        exitReason: t.reason?.trim() || null,
        heldDays: Math.max(0, Math.round((t.timestamp - lot.entryAt) / DAY_MS)),
      })

      lot.shares -= matched
      remaining -= matched
      if (lot.shares <= 0) lots.shift()
    }
    // 保有していない分の売りは対応づけられない。捏造せず黙って捨てる
    // （executeTrade が保有数を検証しているため通常は発生しない）。
  }

  const open = Object.values(openLots).flat()
  // 新しい順に見せる（直近の判断から振り返るため）
  const judgements = [...closed, ...open].sort(
    (a, b) => (b.exitAt ?? b.entryAt) - (a.exitAt ?? a.entryAt),
  )

  return {
    judgements,
    closedCount: closed.length,
    openCount: open.length,
    withEntryReason,
    entryCount,
    enoughForStats: closed.length >= 3,
  }
}
