import investors from './index'
import type { InvestorId } from '@/types'

/**
 * 投資家の「見た目のメタデータ」の単一の出所。
 *
 * これを作った理由: 同じ投資家モデルの一覧が画面ごとに独立して宣言されており、
 * 表示名・色・並び順・人数がバラバラだった（トップ5人／`/simulate` 5人／
 * `/screener` 5人／`/lab` 5人だが押しても動かない／`/learn` 3人／`/watch` 2人）。
 * 「バフェットが選べるページと選べないページがある」状態は、機能の重複より
 * 深刻な信頼の毀損なので、ここを唯一の出所にする。
 *
 * 実装（analyze）は `lib/investors/*.ts` のまま。ここは表示のためだけの薄い層で、
 * 新しい情報を足さず、既存の InvestorLogic から導出する。
 *
 * 重要な注意（人数が場所により違う理由）:
 *   この5人は「ルールベースの現在シグナル」を持つ投資家。バックテスト用の
 *   プリセット（`lib/backtest/investor-presets.ts`・3人）とAI人格
 *   （`lib/ai-trader/personas.ts`・バフェットのみ）は**別の実装**であり、
 *   対応できる機能が違うために人数が異なる。統合するなら「投資家モデルとは何か」
 *   の設計判断が要るため、ここでは名前と色だけを揃える。
 *   各画面は「その画面で実際に動くもの」だけを出すこと（動かない選択肢を
 *   並べない）。
 */

export interface InvestorMeta {
  id: InvestorId
  /** 姓のみの短い表示名。タブやバッジ用（例: バフェット） */
  label: string
  /** フルネーム（例: ウォーレン・バフェット） */
  fullName: string
  /** 一覧のバッジに出す頭文字 */
  initial: string
  /** 弁別しやすい5色。暗色地での識別性を優先して選んである */
  color: string
  /** 一文の説明 */
  description: string
  /** 投資哲学の一文 */
  philosophy: string
}

/** 「ウォーレン・バフェット」→「バフェット」。中黒で区切られた姓を取る。 */
function surname(fullName: string): string {
  const parts = fullName.split('・')
  return parts.length > 1 ? parts[parts.length - 1] : fullName
}

export const INVESTOR_META: InvestorMeta[] = investors.map(inv => ({
  id: inv.id as InvestorId,
  label: surname(inv.nameJa),
  fullName: inv.nameJa,
  initial: inv.name.charAt(0).toUpperCase(),
  color: inv.avatarColor,
  description: inv.description,
  philosophy: inv.philosophy,
}))

export const INVESTOR_META_BY_ID: Record<string, InvestorMeta> =
  Object.fromEntries(INVESTOR_META.map(m => [m.id, m]))

/** ルールベースの現在シグナルを持つ投資家のID一覧（並び順もここが正）。 */
export const RULE_INVESTOR_IDS: InvestorId[] = INVESTOR_META.map(m => m.id)
