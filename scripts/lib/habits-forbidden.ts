import { DISCLAIMER_A, DISCLAIMER_A_WITH_PRICES, DISCLAIMER_B } from '../../lib/review/habits/text'

/**
 * 「書いたことと、したことのまとめ」（/review・S-H1）で使わない語。検査専用（製品コードは読まない）。
 * 2026-10-25 に lib/review/habits/forbidden.ts から移した（reviewer W3: 禁止語の一覧は製品に要らない）。
 * scripts/check-review-habits.ts (1) だけが読む。利用者の原文（引用）は対象にしない。
 *
 * 由来: legal-compliance 2026-10-24 §2（損益・人柄・これからの売買に向けた語）／MC ゲート① 2026-10-24（量の印象語）。
 * scripts/ は scripts/check-review.ts (1)（lib/review/** の文字列検査）の対象外なので「評価」は普通の文字で書く。
 */
export const HABITS_FORBIDDEN_EXTRA: readonly string[] = [
  '損切り', '遅れ', '遅すぎ', '早すぎ', '高値づかみ', '追いかけ', '過剰', '勝率', '勝ち', '負け', '成績',
  '判断の質', '評価', '分析', '改善', '上達', '成長', '性格',
  '次は', '次回は', 'しましょう', '心がけ', '気質効果', 'アンカリング',
  '多い', '少ない', 'よくある', '珍しい',
  // 添削の門と重なるが、この一覧だけで落とせるよう明示する
  '診断', '採点', 'べき',
]

/**
 * 添削の門の語（lib/lab/critique/guard.ts の GUARD_FORBIDDEN）の写し。
 * 2026-10-25 に guard.ts を読んで（合成後の値を1回印字して）写した。import しない＝lib/lab に依存しない。
 * guard.ts 側が後で増えても、ここは自動では追わない（必要ならまた写す）。
 */
export const GUARD_FORBIDDEN_COPY: readonly string[] = [
  'べき', 'おすすめ', '推奨', '買い時', '売り時', 'あなたの場合', '私なら', '私は', '儲か', '必ず', '間違いな', '割安です',
  '上がる', '下がる', 'アドバイス', '助言', '相談', '診断', '合格', '採点', '売買推奨', '目標株価', '株価予測', '好調',
  '悪化', '改善', '健全', '危険', '優良', '要注意', '割安', '割高', '高い部類', '自信', 'シグナル', '点数', 'スコア',
  'ランク', '正解', '的中', '予測', '買うべき', '売るべき', '狙い目', '有望', 'A評価', 'この買いは良かった',
  '損をした判断', 'あなたの判断は間違っていた', '不正解', '経験が浅い', '勉強不足', '間違っ',
]

/** scripts/check-review.ts (8) の語（app/review/**・components/review/** の禁止語）の写し（2026-10-25） */
export const REVIEW_SCREEN_FORBIDDEN: readonly string[] = [
  '守れた', '守れなかった', '正しかった', '判断ミス', '的中', '当たった', '外れた', '正解', '見本', 'お手本',
]

const unique = (xs: readonly string[]) => xs.filter((w, i) => w.length > 0 && xs.indexOf(w) === i)

/** まとめの固定文が使わない語の全部 */
export const HABITS_FORBIDDEN_ALL: readonly string[] = unique([...HABITS_FORBIDDEN_EXTRA, ...GUARD_FORBIDDEN_COPY, ...REVIEW_SCREEN_FORBIDDEN])

/**
 * 法務が一字一句で求める断りの文（legal §8 (a)(b)）は、禁止語の検査の前に取り除く。
 * (b)「判断が正しかったことを意味しません」は打ち消しの定型で「正しかった」に当たるが、文を変えてはいけない。
 */
export const HABITS_FORBIDDEN_EXCEPTIONS: readonly string[] = [DISCLAIMER_A_WITH_PRICES, DISCLAIMER_A, DISCLAIMER_B]

/** 例外の文を取り除いてから、含まれている禁止語を返す（無ければ空配列） */
export function habitsForbiddenWordsIn(text: string): string[] {
  let t = text
  for (const e of HABITS_FORBIDDEN_EXCEPTIONS) t = t.split(e).join('')
  return HABITS_FORBIDDEN_ALL.filter(w => t.includes(w))
}
