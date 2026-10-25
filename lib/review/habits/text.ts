import type { ExitRuleKind, HabitSource, HoldSide, MaterialKind, SellLinkKind } from './types'

/**
 * 「書いたことと、したことのまとめ」の画面の文（S-H1・2026-10-25）。**画面に出る固定の文はこのファイルだけに置く**。
 * 部品（components/habits/HabitSummary.tsx）はここから引くだけで、自分で文を作らない。
 *
 * 書き方の決まり（legal-compliance 2026-10-24 §2・§4・§8／MC ゲート① 2026-10-24）:
 *  - 「N件のうちM件」で書く。割合の記号・ゲージ・色・順位・合計の点・向きの語（減った／増えた）を使わない
 *  - 「多い／少ない／よくある／珍しい」を使わない。区分は0件でも全部・固定順
 *  - 主語は「記録」「あなたが書いた文」。人柄・能力を言わない。これからの売買に向けた文を書かない
 *  - 断り (a)(b)(d) は一字も変えない（scripts/check-review-habits.ts (10) が全文で見る）
 * 禁止語の検査: scripts/check-review-habits.ts (1)（一覧は検査側の scripts/lib/habits-forbidden.ts）。
 */

export const HABITS_HEADING = '書いたことと、したことのまとめ'

export function headingText(total: number): string {
  return `${HABITS_HEADING}（売り終えた${total}件から）`
}

/**
 * (a) 冒頭の断り（株価を使う版）。legal §8 (a) の原文。S-H3（日足を使う傾向）で使う。S-H1 では出さない。
 */
export const DISCLAIMER_A_WITH_PRICES =
  'このまとめは、あなたが書いた文、あなたの売買の記録、公表されている株価（日足の終値）の3つを、決まった規則で照らし合わせて並べたものです。判断の良し悪しや、これからの売買、どの銘柄がよいかは示しません。'

/** (a) 冒頭の断り（株価を使わない版・S-H1）。S-H1 は株価を読まないので「2つ」の版を出す */
export const DISCLAIMER_A =
  'このまとめは、あなたが書いた文と、あなたの売買の記録の2つを、決まった規則で照らし合わせて並べたものです。判断の良し悪しや、これからの売買、どの銘柄がよいかは示しません。'

/** (b) 規則の限界 */
export const DISCLAIMER_B =
  '数えているのは、決まった語と数字の規則で見つけられるものだけです。当てはまらなかったことは、判断が正しかったことを意味しません。'

/** (d) 5件未満（lib/review/patterns.ts の MIN_RECORDS＝5 と同じ数。検査が一致を見る）。カウントダウンにしない */
export const DISCLAIMER_D = '記録が5件に満たないため、件数だけを並べています。'

/** 練習と過去の記録を分けている理由 */
export const SEPARATE_NOTE = '練習の記録と過去の記録は、入れる画面の欄が違うため、別々に数えています。'

/** 過去の記録の入力欄に【注目】が無いことの断り */
export const PAST_NO_CATALYST_NOTE = '過去の取引を入れる画面には【注目】の欄がありません。'

export const SOURCE_LABEL: Readonly<Record<HabitSource, string>> = {
  practice: '練習の記録',
  past: '過去の記録',
}

export function groupHeading(source: HabitSource, total: number): string {
  return `${SOURCE_LABEL[source]}（${total}件）`
}

/** 期間の表記「2026年7月〜2026年10月」（同じ月なら1つ） */
export function periodText(firstAt: number, lastAt: number): string {
  const a = new Date(firstAt)
  const b = new Date(lastAt)
  const fa = `${a.getFullYear()}年${a.getMonth() + 1}月`
  const fb = `${b.getFullYear()}年${b.getMonth() + 1}月`
  return fa === fb ? fa : `${fa}〜${fb}`
}

const SCOPE_TAIL = '最新500件の売買の中で数えています。'

/** §0 数えたもの */
export function countedText(p: {
  total: number
  practice: number
  past: number
  closedCount: number
  openCount: number
  unstructuredCount: number
  firstAt: number | null
  lastAt: number | null
}): string {
  if (p.closedCount === 0) {
    return `売り終えた記録は、まだありません。保有中の${p.openCount}件は数えていません。${SCOPE_TAIL}`
  }
  if (p.total === 0 || p.firstAt === null || p.lastAt === null) {
    return `売り終えた記録${p.closedCount}件は、どれも見出しの無い形で書かれているため、数えていません。保有中の${p.openCount}件も数えていません。${SCOPE_TAIL}`
  }
  return `売り終えた記録${p.total}件（練習${p.practice}件・過去の記録${p.past}件）、${periodText(p.firstAt, p.lastAt)}。保有中の${p.openCount}件と、見出しの無い${p.unstructuredCount}件は数えていません。${SCOPE_TAIL}`
}

/** (c) 分母の文。各傾向の段落の中に必ず置く */
export function denominatorText(closedCount: number, what: string, n: number, notWhat: string): string {
  return `数えたのは、売り終えた記録${closedCount}件のうち、${what}${n}件です。${notWhat}${closedCount - n}件は数えていません。`
}

/** 「N件のうちM件」（5件以上のときの行の右側） */
export function ofText(total: number, count: number): string {
  return `${total}件のうち${count}件`
}

/** 「M件」（5件未満のときの行の右側） */
export function countText(count: number): string {
  return `${count}件`
}

// ── §1 書き方の内訳 ───────────────────────────────────────────────────────────

export const SECTION_WRITING = '書き方の内訳'

export const EXIT_RULE_TITLE = '降りる条件の書き方'
export const EXIT_RULE_LABEL: Readonly<Record<ExitRuleKind, string>> = {
  pricePct: '買値からのパーセントで書いた',
  priceValue: '株価の値で書いた',
  company: '会社の数字（決算・売上・利益など）で書いた',
  period: '持つ期間で書いた',
  combined: '上の2つ以上を組み合わせて書いた',
  other: '上のどれにも当てはまらない書き方',
  none: '書いていない（「決めていなかった」を含む）',
}
export const EXIT_RULE_DENOM: readonly [string, string] = ['見出し付きで書かれた', '見出しの無い']

export const MATERIAL_TITLE = '見立てに使った材料'
export const MATERIAL_LEAD =
  '見立ての文のうち、材料の語のあとに「ので」「から」「ため」が続いていたものを数えています。触れただけの文、打ち消しの文、仮の話の文、問いの文は数えていません。1件の見立てが2つ以上の材料に当たるときは、それぞれに数えています。'
export const MATERIAL_LABEL: Readonly<Record<MaterialKind, string>> = {
  company: '会社の数字（売上・利益・決算など）',
  momentum: '株価の値動き',
  fame: '会社の知名度・規模',
  forecast: '株価の見通し',
  opinion: '人の意見・ニュース',
}
export const MATERIAL_NONE_LABEL = '上のどれにも当たらなかった見立て'
export const MATERIAL_DENOM: readonly [string, string] = ['見立てが書かれた', '見立ての無い']

export const CATALYST_TITLE = '【注目】を書いたか'
export const CATALYST_LABEL: Readonly<Record<'written' | 'blank', string>> = {
  written: '【注目】を書いた',
  blank: '【注目】を書いていない',
}
export const CATALYST_DENOM: readonly [string, string] = ['見出し付きで書かれた', '見出しの無い']

// ── §2 書いたことと、したこと ─────────────────────────────────────────────────

export const SECTION_DOING = '書いたことと、したこと'

export const SELL_LINK_TITLE = '売る理由と、買ったときの降りる条件'
export const SELL_LINK_LEAD =
  '売るときに書いた【売る理由】に、買ったときの【降りる条件】と同じ数字か同じ語、または「条件」「決めた」「予定どおり」「ルール」のどれかが出てくるかを見ています。'
export const SELL_LINK_HIT_LABEL = '売る理由に、どれかが出てくる'
export const SELL_LINK_MISS_LABEL = '売る理由に、どれも出てこない'
export const SELL_LINK_LABEL: Readonly<Record<SellLinkKind, string>> = {
  fixedWord: '「条件」「決めた」「予定どおり」「ルール」のどれかが出てくる',
  sameNumber: '降りる条件と同じ数字が出てくる',
  sameWord: '降りる条件と同じ語（決算・売上・利益など決まった語）が出てくる',
}
export const SELL_LINK_BREAKDOWN = '出てきたものの内訳（1件が2つ以上に当たるときは、それぞれに数えています）'
/** legal-compliance 2026-10-25 warning 1: 「出てこない」が「条件を守らなかった」と読まれないための断り（内訳の下・分母の文の前に常時出す） */
export const SELL_LINK_NOTE = '出てこないことは、条件を守らなかったことを意味しません。条件を別の言葉で書いた場合も、ここでは数えていません。'
export const SELL_LINK_DENOM: readonly [string, string] = ['降りる条件と売る理由の両方が書かれた', 'どちらかが書かれていない']

export const CHANGE_TITLE = '売るときに【変化】を書いたか'
export const CHANGE_LABEL: Readonly<Record<'written' | 'blank', string>> = {
  written: '【変化】を書いた',
  blank: '【変化】を書いていない',
}
export const CHANGE_DENOM: readonly [string, string] = ['見出し付きで書かれた', '見出しの無い']

export const HOLD_TITLE = '予定の期間と、売るまでの日数'
export const HOLD_LEAD = '【降りる条件】か【見立て】に「3年は持つ」「半年様子を見る」のような予定の期間が書かれていた記録について、買った日から売り終えた日までの日数（暦日）と並べています。'
export const HOLD_LABEL: Readonly<Record<HoldSide, string>> = {
  before: '予定の期間より前に売った',
  after: '予定の期間を過ぎてから売った',
  same: '予定の期間と同じ日数で売った',
}
export const HOLD_DENOM: readonly [string, string] = ['予定の期間が読めた', '予定の期間が読めなかった']

// ── §3 くり返し出てくる言い回し ───────────────────────────────────────────────

export const SECTION_PHRASE = 'くり返し出てくる言い回し'
export const PHRASE_LEAD =
  '空白と全角・半角の違いをならした【見立て】の中で、8字以上の同じ文字列が3件以上の別の記録に出てくるものを、長い順に5つまで並べています。文字列は、いちばん古い記録の原文のままです。'
export const PHRASE_NONE = '8字以上の同じ文字列が3件以上の記録に出てくるものは、見つかりませんでした。'
export const PHRASE_DENOM: readonly [string, string] = ['見立てが書かれた', '見立ての無い']

export function recordLinkText(seq: number): string {
  return `記録 #${seq}`
}
