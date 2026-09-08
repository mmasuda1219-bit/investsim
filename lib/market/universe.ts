import 'server-only'
// 取引可能ユニバース（サーバー専用）。データの読み込みだけを担い、規約は universe-core.ts に置く。
//
// data/universe.json は scripts/build-universe.ts がオーナーの手元で生成し、gitにコミットする成果物。
// 中身は「Nasdaq Trader の公式上場リストに存在し」かつ「Yahoo が実際に価格を返した」銘柄だけ
// （原則9）。ここに手打ちの銘柄・推測の値は1件も入らない。
//
// なぜ server-only か:
//   数千件の配列をクライアントバンドルに載せると全ページのJSが1MB近く膨らむ。
//   画面に出す一覧は /api/universe と /api/search 経由で必要な件数だけ渡す。
//   クライアントが直接 import してよい小さな厳選リストは lib/market/us-universe.ts のほう。
import raw from '@/data/universe.json'
import { createUniverse, type UniverseFile } from './universe-core'

export type { UniverseStock, UniverseFilter } from './universe-core'

const file = raw as UniverseFile

const universe = createUniverse(file.stocks)

export const UNIVERSE = universe.stocks

/** 出典と鮮度。UIで「いつ時点の一覧か」を正直に出すために使う。 */
export const UNIVERSE_META = {
  source: file.source,
  listedFileCreatedAt: file.listedFileCreatedAt,
  builtAt: file.builtAt,
  priceVerifiedBy: file.priceVerifiedBy,
  count: universe.size,
} as const

export const findStock = universe.find
export const isTradeable = universe.isTradeable
export const topByMarketCap = universe.topByMarketCap
export const searchUniverse = universe.search
export const filterUniverse = universe.filter
