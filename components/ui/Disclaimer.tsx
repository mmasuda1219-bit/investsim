// 免責表示の共通部品（DESIGN.md §6-11）。文言はここ1か所。ページごとに手書きしない。
//
//  - 文言の正は marketing/RULES.md §2(a) の短い版。部品の中で文言を作り直さない
//  - 著名投資家の名前が出る画面では「ご本人とは無関係です」の1文を必ず出す
//    （RULES.md「著名投資家名を出す投稿に必須の1文」・DESIGN §6-11）
//  - 名人欄では2つを分けて置く（2026-09-18 オーナー選択）: part="investor" を人物像の直下、part="general" を末尾。
//    part を省くと両方を1段落で出す（従来どおり）。文言はどちらでも変えない
//  - 形は small・--ink-2 に固定（caption・--muted に下げない）。折りたたみの中に入れない
//  - 投資助言に当たるかどうかの法的な評価を自称する文は書かない（RULES.md:169）
//
// 「推奨」「助言」「相談」の語は、この免責文では「しない」と打ち消す形で使う（法務の定型文）。
// lib/investors/rulebooks/forbidden.ts の禁止語は、免責文以外の画面の文言と AI の出力に対するもの。

/** marketing/RULES.md §2(a) の短い版（約120字）。一字も変えない */
export const DISCLAIMER_TEXT =
  'InvestSimは仮想資金で投資判断を練習するシミュレーターです。実際の売買・決済は行いません。特定銘柄の推奨や投資助言・勧誘を目的とするものではなく、投資の最終判断はご自身の責任でお願いします。個別の投資相談にはお答えできません。'

/** 著名投資家の名前が出る画面に必ず添える1文 */
export const INVESTOR_DISCLAIMER_TEXT =
  'ご本人とは無関係です（公開されている考え方を当てはめたもの）。ご本人の言葉や見解ではありません。'

export type DisclaimerPart = 'investor' | 'general'

export function Disclaimer({ part, className = '' }: { part?: DisclaimerPart; className?: string }) {
  return (
    <p className={`text-small text-ink-2 max-w-[42rem] ${className}`.trim()}>
      {part !== 'investor' ? DISCLAIMER_TEXT : null}
      {part !== 'general' ? INVESTOR_DISCLAIMER_TEXT : null}
    </p>
  )
}
