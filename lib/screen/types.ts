// S5c-1: ユニバース・ファンダメンタルのキャッシュ行の型のみ。
// screen API応答型（ScreenResponse等）はS5aで追加する — 早すぎる抽象化はしない（COMPANY.md 原則8）。
import type { FundamentalsData } from '@/types'

/** universe_fundamentals（Supabase）/ data/universe-fundamentals.json（ローカル）の1行。 */
export interface CachedFundamentalRow {
  symbol: string
  /** lib/market/index.ts の getFundamentals() が返した実値のみ。空({})は保存しない（原則9）。 */
  metrics: FundamentalsData
  /** 取得経路（例: 'seed', 'cron'）。architectのS5計画に合わせて追記されていく。 */
  source: string
  /** ISO文字列。取得時刻。 */
  fetchedAt: string
}
