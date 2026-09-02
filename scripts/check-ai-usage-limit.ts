// AI日次上限スモーク: lib/ai-usage/limit.ts を検証する。
// - 全体枠と個別枠が «両方» 消費される
// - 個別枠が上限に達したら拒否し、そのとき全体枠を消費しない（巻き戻しが効いている）
// - 全体枠が上限に達したら拒否し、個別枠に余りがあっても通さない
// - 上限0以下は fail-closed（'config'）で通さない
// - 日付が変わると枠がリセットされる
// - limitFromEnv が不正値を既定値（安全側）へ倒す
// - clientIp が x-forwarded-for の先頭を取り、無ければ 'unknown' に寄せる
//
// ネットワーク・Supabase不要。SUPABASE_SERVICE_ROLE_KEY を明示的に外して、
// ファイルstore経路（ローカル開発と同じ経路）を検証する。
// 本番のSupabase経路の原子性は supabase/migrations/0004 のSQL側の責務で、ここでは見ない。
//
// 実行: npx tsx scripts/check-ai-usage-limit.ts

import fs from 'fs'
import path from 'path'
import os from 'os'
import { consumeAiQuota, limitFromEnv, clientIp, nyDate } from '../lib/ai-usage/limit'

// hasServiceRole() も storePath() も «呼び出し時» に読むので、import後に環境を整えてよい。
delete process.env.SUPABASE_SERVICE_ROLE_KEY
delete process.env.NEXT_PUBLIC_SUPABASE_URL

// ファイルstoreは process.cwd()/data に書く。実データを汚さないよう一時ディレクトリへ移す。
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'investsim-usage-'))
const originalCwd = process.cwd()
process.chdir(tmp)

let failures = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) console.log(`  PASS ${name}`)
  else { failures++; console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`) }
}

/** 毎ケース独立させるため、バケット名にケース固有の接頭辞を付ける。 */
let caseNo = 0
function buckets() {
  caseNo++
  return { g: `t${caseNo}:global`, s: `t${caseNo}:scoped` }
}

async function main() {
  console.log('consumeAiQuota — 全体枠と個別枠を両方消費する')
  {
    const { g, s } = buckets()
    const r1 = await consumeAiQuota({ globalBucket: g, globalLimit: 5, scopedBucket: s, scopedLimit: 3 })
    check('1回目は通る', r1.allowed === true)
    check('全体カウントが1', r1.globalCount === 1, `actual=${r1.globalCount}`)
    check('個別カウントが1', r1.scopedCount === 1, `actual=${r1.scopedCount}`)

    const r2 = await consumeAiQuota({ globalBucket: g, globalLimit: 5, scopedBucket: s, scopedLimit: 3 })
    check('2回目も通り、両方2に増える', r2.allowed === true && r2.globalCount === 2 && r2.scopedCount === 2,
      `g=${r2.globalCount} s=${r2.scopedCount}`)
  }

  console.log('consumeAiQuota — 個別枠が上限なら拒否し、全体枠を消費しない')
  {
    const { g, s } = buckets()
    for (let i = 0; i < 2; i++) {
      await consumeAiQuota({ globalBucket: g, globalLimit: 10, scopedBucket: s, scopedLimit: 2 })
    }
    const denied = await consumeAiQuota({ globalBucket: g, globalLimit: 10, scopedBucket: s, scopedLimit: 2 })
    check('個別上限で拒否される', denied.allowed === false && denied.deniedBy === 'scoped', `deniedBy=${denied.deniedBy}`)
    check('拒否時に全体枠が増えていない（巻き戻し）', denied.globalCount === 2, `actual=${denied.globalCount}`)

    // 別の個別枠なら、全体枠の残りを使って通るはず（全体が無駄に減っていない証拠）
    const other = await consumeAiQuota({ globalBucket: g, globalLimit: 10, scopedBucket: `${s}-other`, scopedLimit: 2 })
    check('別の個別枠は通り、全体は3になる', other.allowed === true && other.globalCount === 3,
      `allowed=${other.allowed} g=${other.globalCount}`)
  }

  console.log('consumeAiQuota — 全体枠が上限なら、個別枠に余りがあっても通さない')
  {
    const { g } = buckets()
    for (let i = 0; i < 2; i++) {
      await consumeAiQuota({ globalBucket: g, globalLimit: 2, scopedBucket: `s-${i}`, scopedLimit: 99 })
    }
    const denied = await consumeAiQuota({ globalBucket: g, globalLimit: 2, scopedBucket: 's-fresh', scopedLimit: 99 })
    check('全体上限で拒否される', denied.allowed === false && denied.deniedBy === 'global', `deniedBy=${denied.deniedBy}`)
  }

  console.log('consumeAiQuota — 上限0以下は fail-closed')
  {
    const { g, s } = buckets()
    const zero = await consumeAiQuota({ globalBucket: g, globalLimit: 0, scopedBucket: s, scopedLimit: 5 })
    check('全体上限0で拒否（config）', zero.allowed === false && zero.deniedBy === 'config', `deniedBy=${zero.deniedBy}`)
    const neg = await consumeAiQuota({ globalBucket: g, globalLimit: 5, scopedBucket: s, scopedLimit: -1 })
    check('個別上限が負で拒否（config）', neg.allowed === false && neg.deniedBy === 'config', `deniedBy=${neg.deniedBy}`)
  }

  console.log('consumeAiQuota — 日付が変わると枠がリセットされる')
  {
    const { g, s } = buckets()
    await consumeAiQuota({ day: '2026-09-01', globalBucket: g, globalLimit: 1, scopedBucket: s, scopedLimit: 1 })
    const sameDay = await consumeAiQuota({ day: '2026-09-01', globalBucket: g, globalLimit: 1, scopedBucket: s, scopedLimit: 1 })
    check('同じ日の2回目は拒否', sameDay.allowed === false)
    const nextDay = await consumeAiQuota({ day: '2026-09-02', globalBucket: g, globalLimit: 1, scopedBucket: s, scopedLimit: 1 })
    check('翌日は通る', nextDay.allowed === true && nextDay.globalCount === 1, `g=${nextDay.globalCount}`)
  }

  console.log('nyDate — NY市場日付をYYYY-MM-DDで返す')
  {
    // 取引日の境界がUTCではないことを確かめる。冬(EST=UTC-5): 03:00Z は前日22:00。
    const winter = nyDate(new Date('2026-01-01T03:00:00Z'))
    check('冬時間: UTC未明はNYの前日になる', winter === '2025-12-31', `actual=${winter}`)
    // ちょうど境界: 05:00Z = EST 00:00 なので当日に切り替わっている。
    const boundary = nyDate(new Date('2026-01-01T05:00:00Z'))
    check('冬時間: 05:00Zで当日に切り替わる', boundary === '2026-01-01', `actual=${boundary}`)
    // 夏(EDT=UTC-4): 03:00Z は前日23:00。オフセット固定ではなく夏時間に追随している。
    const summer = nyDate(new Date('2026-07-01T03:00:00Z'))
    check('夏時間にも追随する', summer === '2026-06-30', `actual=${summer}`)
    check('YYYY-MM-DD形式', /^\d{4}-\d{2}-\d{2}$/.test(nyDate()))
  }

  console.log('limitFromEnv — 不正値は既定値（安全側）へ倒す')
  {
    delete process.env.X_LIMIT
    check('未設定なら既定値', limitFromEnv('X_LIMIT', 50) === 50)
    process.env.X_LIMIT = '7'
    check('正の整数はそのまま', limitFromEnv('X_LIMIT', 50) === 7)
    process.env.X_LIMIT = '0'
    check('0は既定値へ（全開放を作らない）', limitFromEnv('X_LIMIT', 50) === 50)
    process.env.X_LIMIT = '-3'
    check('負値は既定値へ', limitFromEnv('X_LIMIT', 50) === 50)
    process.env.X_LIMIT = 'abc'
    check('非数値は既定値へ', limitFromEnv('X_LIMIT', 50) === 50)
    process.env.X_LIMIT = '1.5'
    check('小数は既定値へ', limitFromEnv('X_LIMIT', 50) === 50)
    delete process.env.X_LIMIT
  }

  console.log('clientIp — x-forwarded-for の先頭を取る')
  {
    const req = (h: Record<string, string>) => new Request('http://localhost/x', { headers: h })
    check('複数連なる場合は先頭', clientIp(req({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8' })) === '1.2.3.4')
    check('前後の空白を落とす', clientIp(req({ 'x-forwarded-for': '  9.9.9.9  ' })) === '9.9.9.9')
    check('x-real-ip にフォールバック', clientIp(req({ 'x-real-ip': '4.4.4.4' })) === '4.4.4.4')
    check('どちらも無ければ unknown', clientIp(req({})) === 'unknown')
  }
}

main().then(() => {
  // 後片付け（cwdを戻してから消す。消せなくてもテスト結果には影響しない）
  process.chdir(originalCwd)
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch { /* 一時ディレクトリ */ }
  console.log(`\n${failures === 0 ? '全PASS' : `NG: ${failures}件のチェックが失敗しました`}`)
  process.exit(failures === 0 ? 0 : 1)
})
