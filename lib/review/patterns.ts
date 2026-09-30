import type { Judgement } from '@/lib/review/judgement'
import { parseReason } from '@/lib/trade/reason'

/**
 * 「あなたのクセが、1つ見えてきた。」の1つを選ぶ純関数（S2b「振り返りの作り直し」・2026-09-30・designer 2026-09-29 の設計 A）。
 *
 * 軸は4つだけ（発明しない）。複数該当したら **固定順 1→2→3→4 で1つだけ** 返す（オーナーの「クセが、1つ」）:
 *  1. exitRule   降りる条件を書いたか … 【降りる条件】が空
 *  2. holdLength 保有の長さ           … 売って終わった記録のうち heldDays < 7
 *  3. catalyst   【注目】を書いたか   … 【注目】が空
 *  4. sameSymbol 同じ銘柄に戻る       … 最頻の銘柄
 *
 * 出す条件: その軸の対象が **5件以上** かつ **4/5 以上が同じ側**。満たさなければ null。
 * 5件と 4/5 は統計的な根拠ではなく「言い過ぎないための線」（既存の運用線）。
 *
 * 守っていること:
 *  - 入力に持たないもの: 現在時刻・Date・Math.random・ユーザー・ログイン状態・入力の並び順（entryAt 昇順に並べ替えてから見る）
 *  - 合成スコア・点数・ランクを返さない。数は total / hits だけ
 *  - **損益との相関は絶対に見ない**（成績を掲げることになる＋n=5 で因果は誤り）。pnlPct・exitPrice を読まない
 *  - 軸1・3の対象は «見出し付きで書かれた記録»（【見立て】などの見出しがある形式）だけ。見出しの無い旧形式の自由記述と
 *    理由そのものが残っていない記録は、書いた/書いていないを判定できないので対象に数えない（責めない・原則9）
 *
 * ⚠ 構造上の非対称: /trade では【降りる条件】が必須なので、軸1の差が出るのは主に source='past'（/review/backfill）の記録。
 *   クセが最初に見えるのは過去の取引を入れた人＝backfill の存在意義と一致する（designer 2026-09-29）。
 *
 * 検査: scripts/check-review.ts（4）。
 */

export type PatternAxis = 'exitRule' | 'holdLength' | 'catalyst' | 'sameSymbol'

export interface Pattern {
  axis: PatternAxis
  /** その軸で見た記録の件数 */
  total: number
  /** 同じ側に寄った件数 */
  hits: number
  /** 画面に出す1文 */
  text: string
  /** 該当した記録の識別子 `${symbol}-${entryAt}`（一覧が「この回」を添えるのに使う） */
  keys: string[]
}

/** 対象が5件以上で、4/5 以上が同じ側 */
export const MIN_RECORDS = 5
const RATIO_NUM = 4
const RATIO_DEN = 5

/** 「1週間以内」の線（暦日）。投資上の根拠は無く、短い／長いの素朴な区切り */
export const SHORT_HOLD_DAYS = 7

export const keyOf = (j: Pick<Judgement, 'symbol' | 'entryAt'>): string => `${j.symbol}-${j.entryAt}`

function skewed(total: number, hits: number): boolean {
  return total >= MIN_RECORDS && hits * RATIO_DEN >= total * RATIO_NUM
}

/**
 * 入力の並び順に依らないよう、entryAt → symbol → exitAt で並べ替える（複製の上で）。
 *
 * そのうえで **1回の買いにつき1行に間引く**（S2b レビュー W4）。`buildJudgements` は1回の買いを、
 * 売った回数ぶんの行に分ける（古い買いから順に対応づけるため）。間引かないと、1回の買いを4回に
 * 分けて売った人が「5件のうち4件は…」と言われる ＝ 実際は2回しか買っていないのに数が膨らむ。
 * 残すのは各買いの最初の行（並べ替え後なので、いちばん早く売った行で決まる＝入力順に依らない）。
 */
function chronological(js: Judgement[]): Judgement[] {
  const sorted = [...js].sort((a, b) =>
    a.entryAt !== b.entryAt ? a.entryAt - b.entryAt
    : a.symbol !== b.symbol ? (a.symbol < b.symbol ? -1 : 1)
    : (a.exitAt ?? 0) - (b.exitAt ?? 0))
  const seen = new Set<string>()
  return sorted.filter(j => {
    const k = `${j.source}-${keyOf(j)}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

/** 見出し付きで書かれた買いの理由を、見出し → 本文 に分解する。見出しが無い（旧形式・理由なし）なら null */
function structuredEntry(j: Judgement): Map<string, string> | null {
  if (!j.entryReason) return null
  const sections = parseReason(j.entryReason)
  if (!sections.some(s => s.label !== null)) return null
  const m = new Map<string, string>()
  for (const s of sections) if (s.label !== null) m.set(s.label, s.value.trim())
  return m
}

/** 見出し付きの記録のうち、その見出しの本文が空のもの */
function emptyField(js: Judgement[], label: string): { total: number; hits: Judgement[] } {
  const structured = js.map(j => [j, structuredEntry(j)] as const).filter((x): x is readonly [Judgement, Map<string, string>] => x[1] !== null)
  const hits = structured.filter(([, m]) => !(m.get(label) ?? '')).map(([j]) => j)
  return { total: structured.length, hits }
}

export function findPattern(js: Judgement[]): Pattern | null {
  const all = chronological(js)

  // 1. 降りる条件を決めないまま買っていた
  {
    const { total, hits } = emptyField(all, '降りる条件')
    if (skewed(total, hits.length)) {
      return {
        axis: 'exitRule', total, hits: hits.length,
        text: `${total}件のうち${hits.length}件は、降りる条件を決めないまま買っていました。`,
        keys: hits.map(keyOf),
      }
    }
  }

  // 2. 買ってから1週間以内に売っている（売って終わった記録だけ）
  {
    const closed = all.filter(j => j.exitAt !== null && j.heldDays !== null)
    const hits = closed.filter(j => (j.heldDays as number) < SHORT_HOLD_DAYS)
    if (skewed(closed.length, hits.length)) {
      return {
        axis: 'holdLength', total: closed.length, hits: hits.length,
        text: `売って終わった${closed.length}件のうち${hits.length}件は、買ってから1週間以内に売っています。`,
        keys: hits.map(keyOf),
      }
    }
  }

  // 3. これから何を見るか（【注目】）を書かずに買っている
  {
    const { total, hits } = emptyField(all, '注目')
    if (skewed(total, hits.length)) {
      return {
        axis: 'catalyst', total, hits: hits.length,
        text: `${total}件のうち${hits.length}件は、これから何を見るかを書かずに買っています。`,
        keys: hits.map(keyOf),
      }
    }
  }

  // 4. 同じ銘柄に戻ってきている（最頻の銘柄。同数なら銘柄コードの若い方＝入力順に依らない）
  {
    const counts = new Map<string, number>()
    for (const j of all) counts.set(j.symbol, (counts.get(j.symbol) ?? 0) + 1)
    let top: string | null = null
    for (const [sym, n] of counts) {
      if (top === null || n > (counts.get(top) ?? 0) || (n === counts.get(top) && sym < top)) top = sym
    }
    if (top !== null) {
      const hits = all.filter(j => j.symbol === top)
      if (skewed(all.length, hits.length)) {
        return {
          axis: 'sameSymbol', total: all.length, hits: hits.length,
          text: `${all.length}件のうち${hits.length}件が ${top} です。同じ銘柄に戻ってきています。`,
          keys: hits.map(keyOf),
        }
      }
    }
  }

  return null
}
