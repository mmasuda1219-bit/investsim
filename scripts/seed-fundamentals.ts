// S5c-1: US_UNIVERSE（約104銘柄）の現在値ファンダを実データで一括取得し、
// Supabase の universe_fundamentals テーブルへ投入する初期シードスクリプト。
// 冪等（symbolでupsertするので何度実行しても同じ結果）。
//
// 実行: npx tsx scripts/seed-fundamentals.ts
// 前提: .env.local（または環境変数）に NEXT_PUBLIC_SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY
//       かつ 0002_universe_fundamentals.sql をSupabaseに流し済みであること。
//
// 注意: このスクリプトは実際にSupabaseへ書き込む（＝service-role経路を必ず通る）ため、
// lib/screen/cache.ts経由だとその内部で動的importする lib/supabase/admin.ts
// （`import 'server-only'` を含む）が Next.js サーバー外（tsx）で例外を投げる
// （scripts/seed-sessions.ts と同じ既存制約）。そのためここでは自前で service-role
// クライアントを作り、lib/screen/cache.ts の upsertCached と同じテーブル/列構造で書き込む。
//
// 原則9（実データ必須・架空データ禁止）: getFundamentals(symbol, { allowMock: false }) が
// no_data（{}）を返した銘柄は保存せずスキップする。レート制限を避けるため逐次・間隔を空けて取得する。
import fs from 'fs'
import path from 'path'
import { createClient } from '@supabase/supabase-js'
import { US_UNIVERSE } from '../lib/market/us-universe'
import { getFundamentals } from '../lib/market'
import type { CachedFundamentalRow } from '../lib/screen/types'

const SPACING_MS = 1500
const SOURCE = 'seed'

// .env.local を手動ロード（dotenv非依存・既存の環境変数は上書きしない）
function loadEnvLocal() {
  const envPath = path.join(process.cwd(), '.env.local')
  if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
    if (!m) continue
    const key = m[1]
    let value = m[2].trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (!(key in process.env)) process.env[key] = value
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function main() {
  loadEnvLocal()

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error('NEXT_PUBLIC_SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY を設定してください（.env.local か環境変数）')
    process.exit(1)
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } })

  console.log(`US_UNIVERSE ${US_UNIVERSE.length} 銘柄のファンダを取得します（間隔 ${SPACING_MS}ms）`)

  let saved = 0
  let skippedNoData = 0
  let errored = 0

  for (let i = 0; i < US_UNIVERSE.length; i++) {
    const { symbol } = US_UNIVERSE[i]
    try {
      const metrics = await getFundamentals(symbol, { allowMock: false })
      if (Object.keys(metrics).length === 0) {
        console.log(`- ${symbol}: no_data のためスキップ (${i + 1}/${US_UNIVERSE.length})`)
        skippedNoData++
      } else {
        const row: CachedFundamentalRow = {
          symbol,
          metrics,
          source: SOURCE,
          fetchedAt: new Date().toISOString(),
        }
        const { error } = await supabase.from('universe_fundamentals').upsert({
          symbol:     row.symbol,
          metrics:    row.metrics,
          source:     row.source,
          fetched_at: row.fetchedAt,
        })
        if (error) {
          console.error(`✗ ${symbol}: upsert失敗 — ${error.message}`)
          errored++
        } else {
          console.log(`✓ ${symbol} (${i + 1}/${US_UNIVERSE.length})`)
          saved++
        }
      }
    } catch (e) {
      console.error(`✗ ${symbol}: 取得中に例外 — ${e instanceof Error ? e.message : String(e)}`)
      errored++
    }

    if (i < US_UNIVERSE.length - 1) await sleep(SPACING_MS)
  }

  console.log(
    `完了: ${saved}件保存 / ${skippedNoData}件スキップ(no_data) / ${errored}件エラー（全${US_UNIVERSE.length}銘柄）`
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
