import { FORBIDDEN_IN_OUTPUT, NOT_ON_SCREEN } from '@/lib/investors/rulebooks/forbidden'

/**
 * /study の画面で使わない語（2026-10-09・S-A）。`lib/investors/rulebooks/forbidden.ts` の2つの一覧に**足す**もの。
 * forbidden.ts 自体には語を足さない（check-rulebook.ts の 471 件が動く。DECISIONS 2026-10-09 却下案）。
 *
 * forbidden.ts を直接 import してよいのは lib/ だけ（check-rulebook.ts は app/・components/ からの直接 import を禁じている）。
 * 画面の部品（components/lab/**）はこのファイルも forbidden.ts も読まない。検査（scripts/check-lab-9983.ts (a)）が読む。
 *
 * 由来: DECISIONS 2026-10-09 の不変条件（売買推奨・目標株価・株価予測を出さない／優劣のラベルと点数・ランクを出さない）と
 * legal-compliance 2026-10-07（評価を出せるのは利用者が書いた文と行動についてだけ）。
 */
export const LAB_FORBIDDEN: readonly string[] = [
  '売買推奨', '目標株価', '株価予測',
  '好調', '悪化', '改善', '健全', '危険', '優良', '要注意',
  '割安', '割高', '高い部類',
  '自信', 'シグナル',
  '点数', 'スコア', 'ランク',
  '正解', '的中',
  '予測',
]

/**
 * 「将来を予測するものではありません」は免責の定型句として**全画面で使ってよい**（打ち消しの形。§7 の固定文・
 * 画面2の出所の注記・画面3の figcaption など。MC 2026-10-09 レビュー S7）。
 * 検査はこの句を取り除いてから禁止語を探す。
 */
export const FORBIDDEN_EXCEPTIONS: readonly string[] = ['将来を予測するものではありません']

/** この画面の禁止語の全部（forbidden.ts の2一覧＋ここ） */
export const LAB_FORBIDDEN_ALL: readonly string[] = [...FORBIDDEN_IN_OUTPUT, ...NOT_ON_SCREEN, ...LAB_FORBIDDEN]

/** 例外の文を取り除いてから、含まれている禁止語を返す（無ければ空配列） */
export function labForbiddenWordsIn(text: string): string[] {
  let t = text
  for (const e of FORBIDDEN_EXCEPTIONS) t = t.split(e).join('')
  return LAB_FORBIDDEN_ALL.filter(w => t.includes(w))
}
