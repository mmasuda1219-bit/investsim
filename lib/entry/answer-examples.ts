// ホーム（app/(night)/page.tsx）の「03 読み返す」に出す、このサイトのAIの判断の実例2件の選び方。純関数だけ。
//
// 正は DECISIONS.md 2026-09-29「ホームのAI実例は `ai_decisions` ではなく既存の blob から出し…」決定(2)と不変条件:
//  - 判断日から20営業日以上たったものだけ（「いま買え」に読ませない。結果が無い判断は材料にならない）
//  - 値上がりした例と値下がりした例を1件ずつ（勝ちだけ並べると成績訴求＝marketing/RULES.md #14）
//  - **判断日が古い順**に、それぞれ最初の1件。成績のよい判断を選ばない（画面にもその旨を明記する）
//  - 禁止語（FORBIDDEN_IN_OUTPUT）の検査は理由の**全文**（lib/entry/samples.ts の isTextShowable の1か所）
//  - どちらか欠けたら null（＝節ごと出さない。架空で埋めない＝COMPANY.md 原則9）
//
// 入力に持たないもの（法務 2026-09-28 論点7「全員に同じものを同じ順で」）: 現在時刻・Date・Math.random・ユーザーID・
// ログイン状態・地域・**入力の並び順**（decidedAt → symbol → reasoning の順に並べ替えてから選ぶので、入力をシャッフルしても
// 同じ2件になる。同じ tick の判断は timestamp が同じなので symbol・reasoning で順序を決める）。
// 営業日の数え方と騰落率の計算は呼び出し側（app/api/entry/examples/route.ts）が行い、ここは数を受け取るだけ。
//
// 検査: scripts/check-answer-examples.ts（この関数を実際に呼んで 0件／19営業日／片方だけ／禁止語／シャッフル／0%／古い順 を見る）

import { isTextShowable } from '@/lib/entry/samples'

/** 判断日からこの営業日数がたっていない判断は出さない（2026-09-24 不変条件「お手本に出せるのは判断日から20営業日以上」） */
export const MIN_ELAPSED_BUSINESS_DAYS = 20

export interface AnswerCandidate {
  symbol: string
  /** 判断した時刻（ISO 8601。engine.ts の DecisionRecord.timestamp） */
  decidedAt: string
  /** AI が書いた理由の全文 */
  reasoning: string
  /** 判断日からたった営業日数。呼び出し側が数えて渡す（この関数は時計を持たない） */
  elapsedBusinessDays: number
  /** (最終足の終値 − 判断時の価格) / 判断時の価格 × 100 */
  changePct: number
}

/** 並べ替えの鍵。decidedAt が同じ（同じ tick）なら symbol、それも同じなら reasoning で決める。入力順に依らない */
function compareCandidates(a: AnswerCandidate, b: AnswerCandidate): number {
  if (a.decidedAt !== b.decidedAt) return a.decidedAt < b.decidedAt ? -1 : 1
  if (a.symbol !== b.symbol) return a.symbol < b.symbol ? -1 : 1
  if (a.reasoning !== b.reasoning) return a.reasoning < b.reasoning ? -1 : 1
  return 0
}

/** 出してよい候補か: 20営業日以上たっていて、理由の全文に禁止語が無い */
export function isEligible(c: AnswerCandidate): boolean {
  return c.elapsedBusinessDays >= MIN_ELAPSED_BUSINESS_DAYS && isTextShowable(c.reasoning)
}

/**
 * 判断日が古い順に、値上がりした例（changePct > 0）と値下がりした例（changePct < 0）を1件ずつ。
 * どちらか欠けたら null（＝節ごと出さない）。changePct === 0（と NaN）はどちらにも数えない。
 */
export function pickAnswerExamples<C extends AnswerCandidate>(
  candidates: readonly C[],
): { up: C; down: C } | null {
  const sorted = candidates.filter(isEligible).sort(compareCandidates)
  let up: C | undefined
  let down: C | undefined
  for (const c of sorted) {
    if (!up && c.changePct > 0) up = c
    else if (!down && c.changePct < 0) down = c
    if (up && down) break
  }
  return up && down ? { up, down } : null
}
