// S5c-2 スモーク: lib/screen/refresh.ts の鮮度top-upオーケストレーションを検証する。
// NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY を明示的に未設定化してから
// importすることで、Supabaseへは一切繋がずlib/screen/cache.tsのファイルstore経路を
// 確定的にテストする。getFundamentalsは依存注入したスタブに差し替え、実ネットワークは
// 一切叩かない（合成データはテスト用途のみ・COMPANY.md原則9の範囲内）。
//
// 実行: npx tsx scripts/check-screen-refresh.ts
delete process.env.NEXT_PUBLIC_SUPABASE_URL
delete process.env.SUPABASE_SERVICE_ROLE_KEY

import fs from 'fs'
import path from 'path'
import { upsertCached, getCached, listCached } from '../lib/screen/cache'
import { refreshStaleFundamentals, REFRESH_SOURCE } from '../lib/screen/refresh'
import type { CachedFundamentalRow } from '../lib/screen/types'
import type { FundamentalsData } from '../types'

const STORE_PATH = path.join(process.cwd(), 'data', 'universe-fundamentals.json')

let failures = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    console.log(`  PASS ${name}`)
  } else {
    failures++
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

function row(symbol: string, fetchedAt: string, pe = 20): CachedFundamentalRow {
  return { symbol, metrics: { pe }, source: 'seed', fetchedAt }
}

const noSleep = async (_ms: number) => { /* テストでは実待機しない */ }

async function main() {
  // クリーンな状態から始める
  try { fs.unlinkSync(STORE_PATH) } catch { /* ok if absent */ }

  // ── 1. 古い順選択＋実データ更新（正常系） ──
  await upsertCached(row('AAA', '2026-01-01T00:00:00.000Z'))
  await upsertCached(row('BBB', '2026-01-02T00:00:00.000Z'))
  await upsertCached(row('CCC', '2026-01-03T00:00:00.000Z'))

  const calls: string[] = []
  const fetcher = async (symbol: string): Promise<FundamentalsData> => {
    calls.push(symbol)
    return { pe: 99 } // 実データ想定のスタブ（依存注入）
  }

  const r1 = await refreshStaleFundamentals({ batch: 2, fetcher, sleep: noSleep })
  check('古い順に選ばれる（AAA, BBBのみ・CCCは対象外）', calls.join(',') === 'AAA,BBB', calls.join(','))
  check('processed=2, skipped=0, truncated=false', r1.processed === 2 && r1.skipped === 0 && r1.truncated === false, JSON.stringify(r1))
  const updatedAAA = await getCached('AAA')
  check('更新後の値が反映される', updatedAAA?.metrics.pe === 99, JSON.stringify(updatedAAA))
  check('sourceがcron-refreshに更新される', updatedAAA?.source === REFRESH_SOURCE, updatedAAA?.source)
  check('fetchedAtが新しくなる（seed時刻より後）', (updatedAAA?.fetchedAt ?? '') > '2026-01-01T00:00:00.000Z')

  // CCCは今回未処理のまま（fetchedAtが古いseed値のまま）
  const untouchedCCC = await getCached('CCC')
  check('対象外の銘柄は変更されない', untouchedCCC?.source === 'seed' && untouchedCCC?.fetchedAt === '2026-01-03T00:00:00.000Z')

  // ── 2. no_data({})はスキップし既存キャッシュを上書きしない ──
  try { fs.unlinkSync(STORE_PATH) } catch { /* ok */ }
  await upsertCached(row('DDD', '2026-02-01T00:00:00.000Z', 15))
  const noDataFetcher = async (_symbol: string): Promise<FundamentalsData> => ({})
  const r2 = await refreshStaleFundamentals({ batch: 5, fetcher: noDataFetcher, sleep: noSleep })
  check('no_data時はprocessed=0, skipped=1', r2.processed === 0 && r2.skipped === 1, JSON.stringify(r2))
  const stillDDD = await getCached('DDD')
  check('no_data時は既存キャッシュが温存される（架空データで上書きしない）', stillDDD?.metrics.pe === 15 && stillDDD?.source === 'seed', JSON.stringify(stillDDD))

  // ── 3. fetcher例外もスキップ計上され、他の銘柄処理を止めない ──
  try { fs.unlinkSync(STORE_PATH) } catch { /* ok */ }
  await upsertCached(row('EEE', '2026-03-01T00:00:00.000Z'))
  await upsertCached(row('FFF', '2026-03-02T00:00:00.000Z'))
  const flakyFetcher = async (symbol: string): Promise<FundamentalsData> => {
    if (symbol === 'EEE') throw new Error('network boom')
    return { pe: 42 }
  }
  const r3 = await refreshStaleFundamentals({ batch: 5, fetcher: flakyFetcher, sleep: noSleep })
  check('例外が起きた銘柄はskipped扱い、他は継続処理される', r3.processed === 1 && r3.skipped === 1, JSON.stringify(r3))
  const fffAfter = await getCached('FFF')
  check('例外の後続銘柄は正常に更新される', fffAfter?.metrics.pe === 42, JSON.stringify(fffAfter))

  // ── 4. 時間バジェット到達で打ち切り（truncated=true） ──
  try { fs.unlinkSync(STORE_PATH) } catch { /* ok */ }
  await upsertCached(row('GGG', '2026-04-01T00:00:00.000Z'))
  await upsertCached(row('HHH', '2026-04-02T00:00:00.000Z'))
  await upsertCached(row('III', '2026-04-03T00:00:00.000Z'))
  let clock = 0
  const advancingNow = () => {
    clock += 1000 // 呼ばれるたびに1秒進む疑似時計
    return clock
  }
  const slowFetcher = async (symbol: string): Promise<FundamentalsData> => {
    calls.push(symbol)
    return { pe: 1 }
  }
  const r4 = await refreshStaleFundamentals({
    batch: 3,
    fetcher: slowFetcher,
    sleep: noSleep,
    now: advancingNow,
    timeBudgetMs: 500, // 1回の経過(1000ms)で即座に上限超過させる
  })
  check('時間バジェット超過でtruncated=true', r4.truncated === true, JSON.stringify(r4))
  check('打ち切り時は0件も処理しないことがある（1回目の時刻チェックで即中断）', r4.processed === 0 && r4.skipped === 0, JSON.stringify(r4))

  // ── 5. 対象0件（空キャッシュ）でも例外にならない ──
  try { fs.unlinkSync(STORE_PATH) } catch { /* ok */ }
  const r5 = await refreshStaleFundamentals({ fetcher, sleep: noSleep })
  check('空キャッシュではprocessed=0, skipped=0, truncated=false', r5.processed === 0 && r5.skipped === 0 && r5.truncated === false, JSON.stringify(r5))

  // ── 6. 既存の良いキャッシュ以外は増えない（listCachedの件数確認・全体の健全性） ──
  const all = await listCached()
  check('空キャッシュ検証後もストアは0件のまま', all.length === 0, `got ${all.length}`)

  console.log(failures === 0 ? '\n全PASS' : `\n${failures}件FAIL`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
