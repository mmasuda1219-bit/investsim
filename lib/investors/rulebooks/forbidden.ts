// 投資家のルールブックと、その読み直し（S3）で使わない語の一覧。ここ1か所が正
// （DECISIONS.md 2026-09-17「理由の読み直し」の不変条件: 禁止語は forbidden.ts の1か所）。
//
// 2つの一覧を分けている理由:
//  - FORBIDDEN_IN_OUTPUT … 画面の文言にも AI の出力にも出さない語。助言・断定・勧誘の形になる語
//    （legal-compliance: 銘柄の価値・売買の時期に触れる言い方は、有料化した時点で投資助言に近づく）
//  - NOT_ON_SCREEN       … 画面の呼び名・見出しで使わない語。機能が「相談に答える」「採点する」ものに見える語
//
// 検査は scripts/check-rulebook.ts（ルールブックの画面に出る項目）。S3 では AI 出力の後段検査でも使う。
// lookFor / tension（AI 向けの内部データ）は「上がりそう」を含むため検査の対象外（画面に出さない前提）。

/** 画面・AI 出力で禁じる語 */
export const FORBIDDEN_IN_OUTPUT: readonly string[] = [
  'べき',
  'おすすめ',
  '推奨',
  '買い時',
  '売り時',
  'あなたの場合',
  '私なら',
  '私は',
  '儲か',
  '必ず',
  '間違いな',
  '割安です',
  '上がる',
  '下がる',
]

/** 画面で使わない語（呼び名・見出し・説明文） */
export const NOT_ON_SCREEN: readonly string[] = [
  'アドバイス',
  '助言',
  '相談',
  '診断',
  '合格',
  '採点',
]

/**
 * 文字列に含まれている禁止語を返す（無ければ空配列）。
 * 既定は2つの一覧の両方。AI 出力の検査など、片方だけ見たいときは第2引数で渡す。
 */
export function forbiddenWordsIn(
  text: string,
  words: readonly string[] = [...FORBIDDEN_IN_OUTPUT, ...NOT_ON_SCREEN],
): string[] {
  return words.filter(w => text.includes(w))
}
