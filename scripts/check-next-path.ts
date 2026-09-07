// ログイン後の «戻り先»（next）検証のテスト。
//   node node_modules/tsx/dist/cli.mjs scripts/check-next-path.ts
//
// ここは «外部サイトへ飛ばされないこと» を守る箇所なので、通す/弾くの境界を固定する。
// 通信もDBも使わないオフラインテスト。

import { safeNextPath, loginHref } from '../lib/auth/next-path'

let failed = 0

function eq(label: string, actual: unknown, expected: unknown) {
  const ok = actual === expected
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n        期待: ${JSON.stringify(expected)}\n        実際: ${JSON.stringify(actual)}`}`)
}

console.log('--- 通すべきもの（同一サイト内のパス）---')
eq('/trade', safeNextPath('/trade'), '/trade')
eq('/review', safeNextPath('/review'), '/review')
eq('クエリ付き', safeNextPath('/trade?symbol=AAPL'), '/trade?symbol=AAPL')
eq('ルート', safeNextPath('/'), '/')

console.log('\n--- 弾くべきもの（外部サイトへ飛べる形）---')
eq('絶対URL', safeNextPath('https://evil.example.com'), null)
eq('スキーム相対', safeNextPath('//evil.example.com'), null)
eq('バックスラッシュ', safeNextPath('/\\evil.example.com'), null)
eq('スキームのみ', safeNextPath('javascript:alert(1)'), null)
eq('相対パス', safeNextPath('trade'), null)

console.log('\n--- 弾くべきもの（その他）---')
eq('null', safeNextPath(null), null)
eq('空文字', safeNextPath(''), null)
eq('改行混入', safeNextPath('/trade\nSet-Cookie: a=b'), null)
eq('ログイン画面へ戻す（無限ループ）', safeNextPath('/auth/login'), null)
eq('コールバックへ戻す', safeNextPath('/auth/callback'), null)

console.log('\n--- リンクの組み立て ---')
eq('現在地を載せる', loginHref('/trade'), '/auth/login?next=%2Ftrade')
eq('クエリはエスケープされる', loginHref('/trade?symbol=AAPL'), '/auth/login?next=%2Ftrade%3Fsymbol%3DAAPL')
eq('危険な値は載せない', loginHref('//evil.example.com'), '/auth/login')
eq('現在地不明なら素のリンク', loginHref(null), '/auth/login')
eq('ログイン画面自身では載せない', loginHref('/auth/login'), '/auth/login')

console.log(`\n${failed === 0 ? '全て PASS' : `${failed} 件 FAIL`}`)
process.exit(failed === 0 ? 0 : 1)
