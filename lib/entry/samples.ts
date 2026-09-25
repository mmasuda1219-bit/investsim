// トップページ（入口画面・S1c）に出す AI の判断の選び方。純関数だけ（React・fetch・保存は無い）。
// 画面は app/(night)/page.tsx が使う。検査は scripts/check-entry.ts がこの関数を実際に呼んで結果を確かめる
// （2026-09-25 reviewer W1・検査の強化: 文字列の一致だけでなく、0件／1件／両方 buy／禁止語 の場合の結果を見る）。
//
// 禁止語の一覧は lib/investors/rulebooks/forbidden.ts の FORBIDDEN_IN_OUTPUT の1か所が正（DECISIONS.md 2026-09-17）。

import { FORBIDDEN_IN_OUTPUT, forbiddenWordsIn } from '@/lib/investors/rulebooks/forbidden'

/** 判断の方向。画面の札（▲ 買い／▼ 売り／＝ 保有継続／◇ 様子見）はこの4つに対応する */
export type SampleAction = 'buy' | 'sell' | 'hold' | 'watch'

/** 選ぶのに要る最小の形。画面側の Decision（symbol・name 付き）はこれを満たす */
export interface SampleDecision {
  action: SampleAction
  reasoning: string
}

/** 理由文の冒頭1文（最初の「。」まで）。「。」が無ければ全文 */
export function firstSentence(text: string): string {
  const i = text.indexOf('。')
  return i < 0 ? text : text.slice(0, i + 1)
}

/**
 * プレビュー②（冒頭1文だけを表示する場所）に出してよい判断か:
 * 冒頭1文に禁止語（助言・断定・勧誘の形になる語）が無い（法務 F1・2026-09-25）。
 * 表示するのが冒頭1文だけなので、検査も冒頭1文でよい。
 */
export function isShowable(d: SampleDecision): boolean {
  return forbiddenWordsIn(firstSentence(d.reasoning), FORBIDDEN_IN_OUTPUT).length === 0
}

/**
 * 見本2件（全文を描画して line-clamp で切り詰める場所）に出してよい判断か:
 * **全文**に禁止語が無い。line-clamp-2 は全文を DOM に置いたうえで見た目だけ2行に切るので、
 * 3行目以降に禁止語があっても画面の文字としては存在する（reviewer W1・2026-09-25）。
 */
export function isFullyShowable(d: SampleDecision): boolean {
  return forbiddenWordsIn(d.reasoning, FORBIDDEN_IN_OUTPUT).length === 0
}

/**
 * 見本の2件。decisions の先頭から取り、「買い」以外（sell / hold / watch）を1件以上含める
 * （買いだけ並べると成績訴求に見える）。最新2件が両方 buy なら3件目以降から非 buy を探し、
 * それでも無ければ null（節ごと出さない）。全文に禁止語がある件は飛ばす（isFullyShowable）。
 */
export function pickSamples<D extends SampleDecision>(decisions: readonly D[]): [D, D] | null {
  const ok = decisions.filter(isFullyShowable)
  if (ok.length < 2) return null
  const [a, b, ...rest] = ok
  if (a.action !== 'buy' || b.action !== 'buy') return [a, b]
  const other = rest.find(d => d.action !== 'buy')
  return other ? [a, other] : null
}
