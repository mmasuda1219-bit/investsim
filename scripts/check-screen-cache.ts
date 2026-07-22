// S5c-1 スモーク: lib/screen/cache.ts のローカルJSONフォールバック経路を検証する。
// NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY を明示的に未設定化してから
// importすることで、Supabaseへは一切繋がずファイルstore経路のみを確定的にテストする
// （実ネットワーク不要）。合成データはテスト用途のみ（COMPANY.md原則9の範囲内）。
//
// 実行: npx tsx scripts/check-screen-cache.ts
delete process.env.NEXT_PUBLIC_SUPABASE_URL
delete process.env.SUPABASE_SERVICE_ROLE_KEY

import fs from 'fs'
import path from 'path'
import { getCached, listCached, upsertCached, listStaleTargets } from '../lib/screen/cache'
import type { CachedFundamentalRow } from '../lib/screen/types'

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
  return { symbol, metrics: { pe }, source: 'test', fetchedAt }
}

async function main() {
  // クリーンな状態から始める（前回実行の残骸を消す）
  try { fs.unlinkSync(STORE_PATH) } catch { /* ok if absent */ }

  // ── upsert → get 往復 ──
  await upsertCached(row('AAPL', '2026-07-01T00:00:00.000Z', 33.2))
  const got = await getCached('AAPL')
  check('getCached: upsertした行が読める', got?.symbol === 'AAPL' && got?.metrics.pe === 33.2, JSON.stringify(got))
  check('getCached: 未知シンボルはundefined', (await getCached('NOPE')) === undefined)

  // ── upsert → list 往復 ──
  await upsertCached(row('MSFT', '2026-07-02T00:00:00.000Z'))
  await upsertCached(row('NVDA', '2026-07-03T00:00:00.000Z'))
  const all = await listCached()
  check('listCached: 3件揃う', all.length === 3, `got ${all.length}`)
  check('listCached: symbolが一致', new Set(all.map(r => r.symbol)).size === 3)

  // upsertは冪等（同一symbolは上書き・件数は増えない）
  await upsertCached(row('AAPL', '2026-07-10T00:00:00.000Z', 34.5))
  const afterReupsert = await listCached()
  check('upsertCached: 同一symbolは上書き（件数不変）', afterReupsert.length === 3, `got ${afterReupsert.length}`)
  const refreshed = await getCached('AAPL')
  check('upsertCached: 上書き後の値が反映', refreshed?.metrics.pe === 34.5 && refreshed?.fetchedAt === '2026-07-10T00:00:00.000Z')

  // ── listStaleTargets: fetched_at昇順でn件 ──
  const stale2 = await listStaleTargets(2)
  check('listStaleTargets(2): 2件返る', stale2.length === 2, `got ${stale2.length}`)
  check(
    'listStaleTargets(2): fetched_at昇順で最古2件（MSFT, NVDA）',
    stale2[0]?.symbol === 'MSFT' && stale2[1]?.symbol === 'NVDA',
    JSON.stringify(stale2.map(r => r.symbol))
  )
  const staleAll = await listStaleTargets(100)
  check('listStaleTargets(100): 総件数を超えても全件のみ返る', staleAll.length === 3, `got ${staleAll.length}`)

  // ── no_data({}) はupsertを拒否する（原則9: 架空データ禁止のガード） ──
  let rejected = false
  try {
    await upsertCached({ symbol: 'NODATA', metrics: {}, source: 'test', fetchedAt: new Date().toISOString() })
  } catch {
    rejected = true
  }
  check('upsertCached: no_data({})は例外で拒否される', rejected)
  check('upsertCached: no_data拒否後もストアは汚染されない', (await getCached('NODATA')) === undefined)
  const afterRejectAttempt = await listCached()
  check('upsertCached: 拒否後も件数は3のまま', afterRejectAttempt.length === 3, `got ${afterRejectAttempt.length}`)

  // ── ファイルstoreが実際にディスクへ書かれていることの確認 ──
  check('data/universe-fundamentals.json が生成されている', fs.existsSync(STORE_PATH))

  console.log(failures === 0 ? '\n全PASS' : `\n${failures}件FAIL`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
