// S5c-2: ユニバース・ファンダの鮮度top-upオーケストレーション（純ロジック）。
// lib/ai-trader/auto.ts の「時間バジェット内で古い順に前進」パターンを踏襲する。
// 初期充填は scripts/seed-fundamentals.ts（オーナー手動・S5c-1）が担うため、本ロジックは
// 既にキャッシュ済みの銘柄（listStaleTargets）だけを対象にした差分の鮮度維持に限定する。
// runTick本体・lib/ai-trader/*・lib/screen/cache.ts本体には一切手を入れず、再利用のみ。
import { listStaleTargets, upsertCached } from './cache'
import { getFundamentals } from '@/lib/market'
import type { FundamentalsData } from '@/types'

/** 1回のcron実行で処理する最大銘柄数。Vercel Hobbyの60秒関数上限に収めるため保守的に小さくする。 */
export const REFRESH_BATCH = 6
/** 逐次取得の間隔(ms)。self-429（同一IPからの連続リクエストによるレート制限）を避けるため。 */
export const REFRESH_SPACING_MS = 1500
/** 経過時間バジェット。maxDuration(60s)手前で打ち切り、残りは次回cronが古い順に拾う。 */
export const TIME_BUDGET_MS = 50_000
/** universe_fundamentals.source に記録する取得経路名（seed/screenと区別するため）。 */
export const REFRESH_SOURCE = 'cron-refresh'

export type FundamentalsFetcher = (symbol: string) => Promise<FundamentalsData>

/** 既定のfetcher: 実データのみ（原則9）。allowMock:falseなので失敗時は{}（no_data）を返す。 */
const defaultFetcher: FundamentalsFetcher = (symbol) =>
  getFundamentals(symbol, { allowMock: false })

export interface RefreshOutcome {
  /** 実データが取得できキャッシュを更新した件数。 */
  processed: number
  /** no_data（空オブジェクト）または取得エラーでスキップした件数（既存キャッシュは上書きしない）。 */
  skipped: number
  /** 時間バジェット到達で残りを未処理のまま打ち切ったか。 */
  truncated: boolean
  /** 実際に更新できたシンボル（デバッグ・スモーク用）。 */
  symbols: string[]
}

export interface RefreshOptions {
  /** 1回で処理する最大件数。既定 REFRESH_BATCH。 */
  batch?: number
  /** 逐次取得の間隔(ms)。既定 REFRESH_SPACING_MS。 */
  spacingMs?: number
  /** 時間バジェット(ms)。既定 TIME_BUDGET_MS。 */
  timeBudgetMs?: number
  /** ファンダ取得関数の差し替え（スモークテストで実ネットワークを避けるための依存注入）。 */
  fetcher?: FundamentalsFetcher
  /** spacing待機の差し替え（スモークテストで実待機をスキップするための依存注入）。 */
  sleep?: (ms: number) => Promise<void>
  /** 現在時刻の差し替え（時間バジェットのテスト用）。既定 Date.now。 */
  now?: () => number
}

const defaultSleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

/**
 * fetched_atが最も古いN銘柄（listStaleTargets）だけを対象に実データで鮮度を更新する。
 * 逐次実行＋spacingでレート制限を避け、時間バジェットで必ず打ち切る（Vercel Hobby 60秒対策）。
 * no_data（{}）はキャッシュを上書きせずスキップする（原則9: 良いキャッシュをno_dataで潰さない）。
 */
export async function refreshStaleFundamentals(opts: RefreshOptions = {}): Promise<RefreshOutcome> {
  const batch = opts.batch ?? REFRESH_BATCH
  const spacingMs = opts.spacingMs ?? REFRESH_SPACING_MS
  const timeBudgetMs = opts.timeBudgetMs ?? TIME_BUDGET_MS
  const fetcher = opts.fetcher ?? defaultFetcher
  const sleep = opts.sleep ?? defaultSleep
  const now = opts.now ?? Date.now

  const startedAt = now()
  const targets = await listStaleTargets(batch)

  let processed = 0
  let skipped = 0
  let truncated = false
  const symbols: string[] = []

  for (let i = 0; i < targets.length; i++) {
    if (now() - startedAt > timeBudgetMs) {
      truncated = true
      break
    }
    // 逐次実行（Promise.allではなく順番に）。1件目以外はspacingを挟んでself-429を避ける。
    if (i > 0) await sleep(spacingMs)

    const target = targets[i]
    try {
      const metrics = await fetcher(target.symbol)
      if (!metrics || Object.keys(metrics).length === 0) {
        // no_data: 取得失敗時にupsertCachedへ渡すと拒否されるため、ここで先に計上してスキップ。
        // 既存の良いキャッシュ行はそのまま温存される（架空データで上書きしない＝原則9）。
        skipped++
        continue
      }
      await upsertCached({
        symbol: target.symbol,
        metrics,
        source: REFRESH_SOURCE,
        fetchedAt: new Date(now()).toISOString(),
      })
      processed++
      symbols.push(target.symbol)
    } catch (err) {
      console.error(`[screen/refresh] ${target.symbol} failed:`, err)
      skipped++
    }
  }

  return { processed, skipped, truncated, symbols }
}
