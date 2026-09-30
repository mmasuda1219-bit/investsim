import type { Trade } from '@/lib/portfolio'

/**
 * 「1件のふりかえり」（/review/[recordId]・S3a・2026-09-30）の素材づくり。
 *
 * `lib/review/judgement.ts` の `buildJudgements` は「買い→売りの往復」を1行ずつ返すが、行に id が無い
 * （1文字も変えない方針・S2b）。この画面は **1回の買い＝1件** を URL で指すので、買いの `Trade.id`（uuid）
 * を鍵にした対応づけをここに新設する。分割して売ったときは1件の中に `sells` として並ぶ。
 *
 * 対応づけの規則は `buildJudgements` と同じでなければならない（同じ売買を2通りに組むと、一覧と詳細で
 * 別の往復が出る）。同じ規則:
 *  - 保存順（新しい順）に依らず、timestamp の古い順に走査する
 *  - 売りは **同じ銘柄・同じ帳簿（source）** の古い買いから順に充当する（FIFO）
 *  - 保有していない分の売りは対応づけられないので、捏造せず黙って捨てる
 * 一致は scripts/check-review-record.ts が合成データで機械的に見る（二重実装のずれを防ぐ）。
 *
 * このファイルは純関数だけ。I/O・時計・乱数を持たない。
 */

export interface ReviewSell {
  /** 売りの Trade.id */
  id: string
  exitAt: number
  exitPrice: number
  /** この売りのうち、この買いに充てられた株数 */
  shares: number
  /** 売るときに書いたこと。無ければ null */
  exitReason: string | null
}

export interface ReviewRecord {
  /** 買いの Trade.id（uuid）。URL の recordId */
  id: string
  symbol: string
  name: string
  source: 'practice' | 'past'
  entryAt: number
  /** 買値（本人の記録の値。図・基準率の計算根拠にはしない＝DECISIONS 2026-09-30 (11)） */
  entryPrice: number
  /** 買った株数 */
  shares: number
  /** 買う前に書いたこと。無ければ null */
  entryReason: string | null
  /** 古い順。分割して売ったときは複数 */
  sells: ReviewSell[]
  /** その人の買いを古い順に数えた通し番号（1始まり）。画面の「記録 #N」 */
  seq: number
}

/** 練習場の売買と過去の記録は別の帳簿として突き合わせる。未設定は練習場扱い（judgement.ts と同じ） */
const lotKey = (t: Trade) => `${t.symbol} ${t.source ?? 'practice'}`

/** まだ売っていない株数 */
export function openShares(r: ReviewRecord): number {
  return r.shares - r.sells.reduce((s, x) => s + x.shares, 0)
}

/**
 * 売買履歴を「1回の買い＝1件」に組み直す。返す並びは買った順（seq の順）。
 */
export function buildRecords(trades: Trade[]): ReviewRecord[] {
  const chronological = [...trades].sort((a, b) => a.timestamp - b.timestamp)

  const records: ReviewRecord[] = []
  /** 帳簿ごとの、まだ売り切っていない買い（古い順） */
  const openLots: Record<string, { rec: ReviewRecord; left: number }[]> = {}
  let seq = 0

  for (const t of chronological) {
    if (t.action === 'buy') {
      seq++
      const rec: ReviewRecord = {
        id: t.id,
        symbol: t.symbol,
        name: t.name,
        source: t.source ?? 'practice',
        entryAt: t.timestamp,
        entryPrice: t.price,
        shares: t.shares,
        entryReason: t.reason?.trim() || null,
        sells: [],
        seq,
      }
      records.push(rec)
      ;(openLots[lotKey(t)] ??= []).push({ rec, left: t.shares })
      continue
    }

    let remaining = t.shares
    const lots = openLots[lotKey(t)] ?? []
    while (remaining > 0 && lots.length > 0) {
      const lot = lots[0]
      const matched = Math.min(lot.left, remaining)
      lot.rec.sells.push({
        id: t.id,
        exitAt: t.timestamp,
        exitPrice: t.price,
        shares: matched,
        exitReason: t.reason?.trim() || null,
      })
      lot.left -= matched
      remaining -= matched
      if (lot.left <= 0) lots.shift()
    }
  }

  return records
}

/** id（買いの Trade.id）で1件を探す。無ければ null */
export function findRecord(trades: Trade[], id: string): ReviewRecord | null {
  return buildRecords(trades).find(r => r.id === id) ?? null
}

/**
 * `buildJudgements` の1行（symbol / source / entryAt / exitAt / shares）に対応する記録の id を返す。
 * 一覧（app/review/page.tsx）が各カードから詳細へ飛ぶために使う。
 *
 * 同じ銘柄・同じ帳簿・同じ時刻の買いが2件あると（過去の記録は日付で入るので同日2件があり得る）
 * 鍵だけでは決められない。そのときは売った時刻と株数でしぼり、それでも同じなら古い方（記録の中身も同じ）。
 */
export function matchRecordId(
  records: ReviewRecord[],
  j: { symbol: string; source: 'practice' | 'past'; entryAt: number; exitAt: number | null; shares: number },
): string | null {
  const cands = records.filter(r => r.symbol === j.symbol && r.source === j.source && r.entryAt === j.entryAt)
  if (cands.length === 0) return null
  if (cands.length === 1) return cands[0].id
  const narrowed = cands.filter(r =>
    j.exitAt === null ? openShares(r) === j.shares : r.sells.some(s => s.exitAt === j.exitAt && s.shares === j.shares),
  )
  return (narrowed[0] ?? cands[0]).id
}
