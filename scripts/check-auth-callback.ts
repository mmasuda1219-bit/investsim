// ログイン後の «戻り先の土台»（base）決定のテスト。
//   node node_modules/tsx/dist/cli.mjs scripts/check-auth-callback.ts
//
// 本番（Vercel）では req.url の origin が localhost になりうるので x-forwarded-host を優先する。
// 一方でヘッダは細工されうるので、ホスト名として妥当な値以外は origin に戻す。
// この «優先順» と «弾く境界» を固定する。通信もDBも使わないオフラインテスト。

import { resolveCallbackBase, sanitizeForwardedHost } from '../lib/auth/callback-base'
import { safeNextPath } from '../lib/auth/next-path'

let failed = 0

function eq(label: string, actual: unknown, expected: unknown) {
  const ok = actual === expected
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n        期待: ${JSON.stringify(expected)}\n        実際: ${JSON.stringify(actual)}`}`)
}

const PROD = 'https://investsim-nine.vercel.app'
const INTERNAL = 'http://localhost:3000'
const silent = () => {}

// 本番相当の既定入力。各ケースは必要な項目だけ上書きする。
function prod(over: Partial<Parameters<typeof resolveCallbackBase>[0]> = {}) {
  return resolveCallbackBase({
    origin: INTERNAL,
    forwardedHost: 'investsim-nine.vercel.app',
    forwardedProto: 'https',
    nodeEnv: 'production',
    siteUrl: undefined,
    warn: silent,
    ...over,
  })
}

console.log('--- 優先順 ---')
eq('forwarded あり → そのホスト（https）', prod(), PROD)
eq('forwarded なし → origin', prod({ forwardedHost: null, forwardedProto: null }), INTERNAL)
eq('development → forwarded があっても origin', prod({ nodeEnv: 'development' }), INTERNAL)
eq('development → origin が localhost でも SITE_URL に置き換えない', prod({ nodeEnv: 'development', siteUrl: PROD }), INTERNAL)
eq('proto なし → https', prod({ forwardedProto: null }), PROD)
eq('proto=http → http', prod({ forwardedProto: 'http' }), 'http://investsim-nine.vercel.app')
eq('proto が不正 → https', prod({ forwardedProto: 'javascript' }), PROD)
eq('ポート付きホスト', prod({ forwardedHost: 'example.com:8443' }), 'https://example.com:8443')

console.log('\n--- 複数値（プロキシ多段）---')
eq('host 複数 → 最初の1つ', prod({ forwardedHost: 'investsim-nine.vercel.app, internal.vercel.app' }), PROD)
eq('proto 複数 → 最初の1つ', prod({ forwardedProto: 'http, https' }), 'http://investsim-nine.vercel.app')
eq('前後の空白は無視', prod({ forwardedHost: '  investsim-nine.vercel.app  ' }), PROD)

console.log('\n--- 不正な forwarded-host は捨てて origin に戻す ---')
const PROD_ORIGIN = 'https://app.internal'
eq('パス混入 evil.com/x', prod({ origin: PROD_ORIGIN, forwardedHost: 'evil.com/x' }), PROD_ORIGIN)
eq('スキーム混入 http://evil.com', prod({ origin: PROD_ORIGIN, forwardedHost: 'http://evil.com' }), PROD_ORIGIN)
eq('改行混入', prod({ origin: PROD_ORIGIN, forwardedHost: 'evil.com\nX-Injected: 1' }), PROD_ORIGIN)
eq('ユーザー情報混入 a@evil.com', prod({ origin: PROD_ORIGIN, forwardedHost: 'good.com@evil.com' }), PROD_ORIGIN)
eq('クエリ混入', prod({ origin: PROD_ORIGIN, forwardedHost: 'evil.com?x=1' }), PROD_ORIGIN)
eq('空文字', prod({ origin: PROD_ORIGIN, forwardedHost: '' }), PROD_ORIGIN)
eq('空白のみ', prod({ origin: PROD_ORIGIN, forwardedHost: '   ' }), PROD_ORIGIN)
eq('先頭ハイフン', prod({ origin: PROD_ORIGIN, forwardedHost: '-evil.com' }), PROD_ORIGIN)
eq('sanitize: 妥当', sanitizeForwardedHost('investsim-nine.vercel.app'), 'investsim-nine.vercel.app')
eq('sanitize: 不正', sanitizeForwardedHost('evil.com/x'), null)

console.log('\n--- 本番で localhost に落ちたとき ---')
eq('SITE_URL あり → SITE_URL', prod({ forwardedHost: null, siteUrl: PROD }), PROD)
eq('SITE_URL の末尾スラッシュ/パスは落とす', prod({ forwardedHost: null, siteUrl: `${PROD}/foo/` }), PROD)
eq('SITE_URL が不正 → そのまま', prod({ forwardedHost: null, siteUrl: 'not a url' }), INTERNAL)
eq('SITE_URL が空 → そのまま', prod({ forwardedHost: null, siteUrl: '' }), INTERNAL)
eq('forwarded が localhost でも SITE_URL', prod({ forwardedHost: 'localhost:3000', siteUrl: PROD }), PROD)
eq('127.0.0.1 も対象', prod({ forwardedHost: null, origin: 'http://127.0.0.1:3000', siteUrl: PROD }), PROD)
eq('SITE_URL があっても本物のホストなら使わない', prod({ siteUrl: 'https://other.example.com' }), PROD)

{
  const warned: string[] = []
  const r = prod({ forwardedHost: null, siteUrl: undefined, warn: (m) => warned.push(m) })
  eq('SITE_URL なし → そのまま', r, INTERNAL)
  eq('SITE_URL なし → warn が1行', warned.length, 1)
  eq('warn は NEXT_PUBLIC_SITE_URL を案内する', warned[0]?.includes('NEXT_PUBLIC_SITE_URL'), true)
}
{
  const warned: string[] = []
  prod({ warn: (m) => warned.push(m) })
  eq('正常時は warn しない', warned.length, 0)
}

console.log('\n--- safeNextPath との組み合わせ（route.ts と同じ組み立て）---')
{
  const base = prod()
  const next = safeNextPath('//evil.com') ?? '/'
  eq('next=//evil.com は通らずトップへ', `${base}${next}`, `${PROD}/`)
  const ok = safeNextPath('/trade?symbol=AAPL') ?? '/'
  eq('正しい next は本番の住所に付く', `${base}${ok}`, `${PROD}/trade?symbol=AAPL`)
  const login = new URL('/auth/login', base)
  login.searchParams.set('next', ok)
  login.searchParams.set('error', 'x')
  eq('loginUrl も本番の住所', login.toString(), `${PROD}/auth/login?next=%2Ftrade%3Fsymbol%3DAAPL&error=x`)
}

console.log(`\n${failed === 0 ? '全て PASS' : `${failed} 件 FAIL`}`)
process.exit(failed === 0 ? 0 : 1)
