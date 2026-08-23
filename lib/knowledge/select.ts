// S2: 知識ストア(lib/knowledge/store.ts)からロードした知識プールを、AIの売買判断
// プロンプトへ注入する分だけ選抜する純関数レイヤー。
//
// lib/report/profile.ts と同じ「純データ＋純関数のみ・I/O禁止」パターンに揃える。
// I/O（listKnowledge/recordKnowledgeUsage呼び出し・タイムアウト処理）は
// 呼び出し側（lib/ai-trader/engine.ts の runTick）の責務であり、ここには一切含めない。
//
// 選抜は決定的（同じ入力→同じ出力）であることが必須。updatedAt/createdAtのような
// 「同期のたびに書き換わる」時刻フィールドは選抜基準に一切使わない
// （scripts/sync-knowledge.ts が全行を同一nowISOで刻むため、順序が不安定になる）。
import type { InvestorId } from '@/types'
import type { KnowledgeItem, KnowledgeKind } from './types'

export interface KnowledgeSelectContext {
  /** session.persona。指定時のみペルソナ一致タグに加点する。 */
  persona?: InvestorId
  /** 分析対象銘柄（'.T' 判定に使う）。 */
  symbols: string[]
}

/** プロンプトに注入する知識の最大件数。 */
export const MAX_ITEMS = 6
/** 注入ブロック本文（title+summary合計・見出し/注意文を除く）の文字数上限。 */
export const MAX_CHARS = 1000

/** バフェット以外の著名投資家タグ。ペルソナと異なるものは「他投資家の教義」として減点・上限対象。 */
const OTHER_INVESTOR_TAGS = ['graham', 'lynch', 'soros', 'dalio', 'fisher'] as const
/** 最終選抜で許容する「他投資家タグ」を持つ知識の件数上限。教義の混在で判断が希釈されるのを防ぐ。 */
const OTHER_INVESTOR_CAP = 1

/** クォータ（kind別に高スコア順で確保する件数）。合計5枠＋自由枠1でMAX_ITEMS(6)。 */
const KIND_QUOTAS: Array<[KnowledgeKind, number]> = [
  ['theory', 2],
  ['market', 1],
  ['strategy', 1],
  ['bias', 1],
]

interface ScoredItem {
  item: KnowledgeItem
  score: number
}

function isOtherInvestorTag(item: KnowledgeItem, persona?: InvestorId): boolean {
  return item.tags.some(t => (OTHER_INVESTOR_TAGS as readonly string[]).includes(t) && t !== persona)
}

/**
 * 除外ルール:
 * - tags.includes('meta')（サイト制作のための知識であり売買判断の原則ではない）
 * - summaryが空
 * - scope==='session'（KnowledgeSelectContextはグローバル判断専用でsessionIdを持たないため、
 *   「sessionIdが一致する」という状況が原理的に発生しない。よってscope==='session'は常に
 *   「sessionId不一致」として除外される — これは仕様どおりで、個人セッション固有の知識を
 *   このスライスでは判断プロンプトへ混ぜない設計）
 */
function isEligible(item: KnowledgeItem): boolean {
  if (item.tags.includes('meta')) return false
  if (!item.summary || item.summary.trim().length === 0) return false
  if (item.scope === 'session') return false
  return true
}

function scoreItem(item: KnowledgeItem, ctx: KnowledgeSelectContext, hasJapanSymbol: boolean): number {
  let score = 0
  if (ctx.persona && item.tags.includes(ctx.persona)) score += 3
  if (isOtherInvestorTag(item, ctx.persona)) score -= 2
  if (item.tags.includes('japan')) score += hasJapanSymbol ? 1 : -1
  if (item.kind === 'bias') score += 0.5
  return score
}

/** タイブレーク: スコア降順 → useCount昇順（使われていない知識が浮上） → id昇順（安定）。 */
function compare(a: ScoredItem, b: ScoredItem): number {
  if (a.score !== b.score) return b.score - a.score
  if (a.item.useCount !== b.item.useCount) return a.item.useCount - b.item.useCount
  return a.item.id < b.item.id ? -1 : a.item.id > b.item.id ? 1 : 0
}

// 実際に注入する文字列（formatKnowledgeBlockが出力するtitle+summary）と同じ長さで数える。
// 会計とレンダリングを二重定義しない。
function charLenForCount(item: KnowledgeItem): number {
  return item.title.length + item.summary.length
}

/** MAX_CHARSを超える場合、スコア降順で並んだ末尾（=最も優先度が低い）から落とす。summary自体は切らない。 */
function trimToCharLimit(sorted: ScoredItem[]): ScoredItem[] {
  const result = [...sorted]
  let total = result.reduce((sum, c) => sum + charLenForCount(c.item), 0)
  while (total > MAX_CHARS && result.length > 0) {
    const dropped = result.pop()
    if (!dropped) break
    total -= charLenForCount(dropped.item)
  }
  return result
}

/**
 * 判断プロンプトに注入する知識を選抜する（決定的）。
 * 1) 除外ルールを適用 → 2) スコアリング → 3) kindクォータを高スコア順で充足
 *    （該当kindが空/不足なら枠を捨てて残りを高スコア順で埋める。架空アイテムでパディングしない）
 * 4) 自由枠をグローバル高スコア順で埋めMAX_ITEMSまで → 5) 文字数超過時は下位から落とす
 */
export function selectKnowledgeForDecision(
  pool: KnowledgeItem[],
  ctx: KnowledgeSelectContext,
): KnowledgeItem[] {
  const hasJapanSymbol = ctx.symbols.some(s => s.endsWith('.T'))
  const scored: ScoredItem[] = pool
    .filter(isEligible)
    .map(item => ({ item, score: scoreItem(item, ctx, hasJapanSymbol) }))
  scored.sort(compare)

  const chosen: ScoredItem[] = []
  const chosenIds = new Set<string>()
  let otherInvestorCount = 0

  const tryAdd = (candidate: ScoredItem): boolean => {
    if (chosenIds.has(candidate.item.id)) return false
    const isOther = isOtherInvestorTag(candidate.item, ctx.persona)
    if (isOther && otherInvestorCount >= OTHER_INVESTOR_CAP) return false
    chosen.push(candidate)
    chosenIds.add(candidate.item.id)
    if (isOther) otherInvestorCount++
    return true
  }

  // kindクォータを高スコア順で充足（globalに`compare`済みのscoredをkindでフィルタするだけで
  // 「各kind内の高スコア順」を保てる — comparatorがkindに依存しないため）。
  for (const [kind, quota] of KIND_QUOTAS) {
    let filled = 0
    for (const c of scored) {
      if (filled >= quota) break
      if (c.item.kind !== kind) continue
      if (tryAdd(c)) filled++
    }
  }

  // 該当kindが空/不足だった枠＋自由枠1を、残りの高スコア順でMAX_ITEMSまで埋める。
  for (const c of scored) {
    if (chosen.length >= MAX_ITEMS) break
    tryAdd(c)
  }

  chosen.sort(compare)
  return trimToCharLimit(chosen).map(c => c.item)
}

/** engine側でそのままプロンプトに埋め込む注入ブロック。0件なら空文字（プレースホルダは書かない）。 */
export function formatKnowledgeBlock(items: KnowledgeItem[]): string {
  if (items.length === 0) return ''
  const lines = items.map(i => `- [${i.id}] ${i.title}: ${i.summary}`)
  return [
    '【投資の原則（知識ベース）】',
    '以下はKNOWLEDGE.md由来の蒸留済み原則。上の【過去の経験・学習】と矛盾する場合、サンプル数の少ない直近教訓よりこちらを優先すること。',
    ...lines,
  ].join('\n')
}

/**
 * AIが返したknowledgeRefsを、実際に注入した集合(allowedIds)で検証してから使う。
 * 非配列・非文字列・null・数値・空文字・重複・注入集合に無いIDはすべて除去する。
 */
export function filterKnowledgeRefs(raw: unknown, allowedIds: Set<string>): string[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const result: string[] = []
  for (const v of raw) {
    if (typeof v !== 'string') continue
    const id = v.trim()
    if (!id) continue
    if (!allowedIds.has(id)) continue
    if (seen.has(id)) continue
    seen.add(id)
    result.push(id)
  }
  return result
}
