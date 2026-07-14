// data/sessions.json の全セッションを Supabase の ai_sessions テーブルへ移行するシードスクリプト。
// 冪等（idでupsertするので何度実行しても同じ結果）。
//
// 実行: npx tsx scripts/seed-sessions.ts
// 前提: .env.local（または環境変数）に NEXT_PUBLIC_SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY
//
// 注意: lib/supabase/admin.ts は `import 'server-only'` のため Next.js サーバー外（tsx）では
// importできない。ここでは自前で service-role クライアントを作る（保存形式は store.ts と同一）。
import fs from 'fs'
import path from 'path'
import { createClient } from '@supabase/supabase-js'
import { normalizeLearningMemory } from '../lib/ai-trader/memory'
import type { AISession } from '../lib/ai-trader/engine'

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

async function main() {
  loadEnvLocal()

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error('NEXT_PUBLIC_SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY を設定してください（.env.local か環境変数）')
    process.exit(1)
  }

  const storePath = path.join(process.cwd(), 'data', 'sessions.json')
  if (!fs.existsSync(storePath)) {
    console.error(`セッションファイルが見つかりません: ${storePath}`)
    process.exit(1)
  }
  const sessions: AISession[] = JSON.parse(fs.readFileSync(storePath, 'utf8'))
  console.log(`data/sessions.json から ${sessions.length} 件のセッションを読み込みました`)

  const supabase = createClient(url, key, { auth: { persistSession: false } })

  for (const session of sessions) {
    // 旧フォーマットの学習メモリ欠損を補完してから保存（engine.tsのtickと同じ正規化）
    session.learning = normalizeLearningMemory(session.learning)

    const { error } = await supabase.from('ai_sessions').upsert({
      id:         session.id,
      data:       session,
      started_at: session.startedAt,
      updated_at: session.lastTickAt,
    })
    if (error) {
      console.error(`✗ ${session.id}: upsert失敗 — ${error.message}`)
      process.exit(1)
    }
    console.log(`✓ ${session.id} (tick ${session.tickCount}, 開始 ${session.startedAt})`)
  }

  console.log('完了: 全セッションを ai_sessions へ upsert しました（冪等）')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
