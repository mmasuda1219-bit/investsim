// S1: 知識ストアの型。knowledge_items（Supabase）/ data/knowledge.json（ローカル）の1行。

/** 'global' = サイト全体で共有 / 'session' = そのセッション（投資家ペルソナ）固有。 */
export type KnowledgeScope = 'global' | 'session'

/**
 * 知識の種類。
 * - theory: 投資理論・原則（KNOWLEDGE.md由来のバフェット哲学・安全域など）
 * - market: 相場環境・マクロ・指数の見立て（市場調査で自動蓄積）
 * - lesson: 取引結果から得た教訓
 * - bias:   自分の取引の癖・システマティックな偏り
 * - strategy: 次に実行すべき戦略調整
 * - causal: マクロ→セクター→銘柄の連想チェーン
 * - news_pattern: ニュースの読み方と結果の相関
 */
export type KnowledgeKind =
  | 'theory'
  | 'market'
  | 'lesson'
  | 'bias'
  | 'strategy'
  | 'causal'
  | 'news_pattern'

export interface KnowledgeItem {
  /** 帰属表示の参照キー。位置ではなくこのIDで同一性を持たせる。 */
  id: string
  scope: KnowledgeScope
  /** scope='session' のときだけ入る。 */
  sessionId?: string | null
  kind: KnowledgeKind
  title: string
  /** 1〜2文。プロンプト注入用（必ず短く保つ）。 */
  summary: string
  /** 全文・参照用。UIの詳細表示やレポートの裏付けに使う。 */
  detail?: string | null
  /** URL / 'KNOWLEDGE.md' / 'trade:<id>' など。 */
  source?: string | null
  tags: string[]
  useCount: number
  lastUsedAt?: string | null
  createdAt: string
  updatedAt: string
}

/** listKnowledge の絞り込み条件。 */
export interface KnowledgeQuery {
  scope?: KnowledgeScope
  sessionId?: string
  kind?: KnowledgeKind
  limit?: number
}
