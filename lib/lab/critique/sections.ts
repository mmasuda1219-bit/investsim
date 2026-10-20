/**
 * 添削の7節の見出しと順番（/study・2026-10-09 S-A に /lab/9983 として作成）。**ここで固定し、画面も検査もこれを読む。**
 *
 *  - 見出しは「添削」の語を使ってよい（オーナーの語。対象は利用者の文で、禁止語「採点・診断」とは別）
 *  - §2 は「よくできている点」ではなく「書けていたこと」（評価の形容詞を避け、事実側に置く。MC 2026-10-09 ②）
 *  - §3 は計算方法と確認漏れに限る（catalogue.ts の固定カタログ）。S-B で AI が選ぶのも同じカタログの id だけ。
 *    2026-10-19（S-L1a・公開に合わせたオーナー決定）に「計算の確かめと、確認したいこと」から「計算の確かめと、確認したいこと」へ。
 *    断定（誤り）から問いの形へ変える趣旨で、key・no・順番は変えない
 *  - 「役に立った／立たなかった」のボタンは出さない（保存先が無い。MC ③）
 */

export type SectionKey = 'flow' | 'written' | 'check' | 'missing' | 'connect' | 'learn' | 'notes'

export interface SectionSpec {
  key: SectionKey
  /** 画面に出す番号（§1〜§7） */
  no: number
  title: string
}

export const CRITIQUE_SECTIONS: readonly SectionSpec[] = [
  { key: 'flow', no: 1, title: 'あなたの判断の流れ' },
  { key: 'written', no: 2, title: '書けていたこと' },
  { key: 'check', no: 3, title: '計算の確かめと、確認したいこと' },
  { key: 'missing', no: 4, title: '確認が抜けている項目' },
  { key: 'connect', no: 5, title: '情報のつなげ方の例' },
  { key: 'learn', no: 6, title: '次に学ぶとよいテーマ' },
  { key: 'notes', no: 7, title: '注意事項' },
]

/** §7 の固定文（AI は書かない） */
export const NOTES_TEXT: readonly string[] = [
  'この添削は、あなたが書いた文と、会社が公表した数字を突き合わせたものです。計算方法と確認漏れだけを、決まった一覧から探しています。',
  '売買を勧めるものではなく、将来を予測するものではありません。あなたの判断の良し悪しは判定しません。',
  '書いた内容はこのページの中にだけあり、送信も保存もしていません。ページを閉じると消えます。',
]

/** 画面5の見出し */
export const CRITIQUE_TITLE = '添削'
