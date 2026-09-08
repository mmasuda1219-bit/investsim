// 取引可能ユニバースのスモークテスト。
//
// 実行: npx tsx scripts/check-universe.ts
//
// lib/market/universe.ts は `import 'server-only'` を持つため tsx から読めない。
// そのため規約は純ロジックの lib/market/universe-core.ts で検証し、
// 実データ（data/universe.json）はファイルとして直接読んで健全性を確かめる。
// ネットワークは一切叩かない（決定的・オフラインで走る）。
import fs from 'fs'
import path from 'path'
import { createUniverse, normalizeSymbol, type UniverseFile, type UniverseStock } from '../lib/market/universe-core'

let passed = 0
let failed = 0

function check(label: string, cond: boolean, detail = '') {
  if (cond) { passed++; console.log(`  PASS  ${label}`) }
  else { failed++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}

// ── 1. 純ロジック（合成データ・実データ非依存） ────────────────────────
console.log('\n[1] 規約（universe-core）')

const S = (symbol: string, name: string, marketCap?: number, extra: Partial<UniverseStock> = {}): UniverseStock =>
  ({ symbol, name, exchange: 'NYSE', currency: 'USD', marketCap, ...extra })

const sample = createUniverse([
  S('SMALL', 'Smallcap Industries', 1e8),
  S('BIG', 'Big Company Inc.', 9e11),
  S('MID', 'Middle Corp', 5e9, { sector: 'Technology' }),
  S('NOCAP', 'No Marketcap Co'),
  S('BAD', 'Deficient Holdings', 2e8, { deficient: true }),
  S('BIGGER', 'Bigger Company', 1e12),
])

check('normalizeSymbol が空白と小文字を吸収する', normalizeSymbol('  brk-b ') === 'BRK-B')
check('既定の並びが時価総額の降順', sample.stocks[0].symbol === 'BIGGER' && sample.stocks[1].symbol === 'BIG')
check('時価総額が欠損の銘柄は末尾に回る', sample.stocks[sample.stocks.length - 1].symbol === 'NOCAP')
check('欠損の時価総額を0で埋めない（原則9）', sample.find('NOCAP')?.marketCap === undefined)

check('find が小文字でも引ける', sample.find('big')?.symbol === 'BIG')
check('isTradeable は一覧内でtrue', sample.isTradeable('mid') === true)
check('isTradeable は一覧外でfalse', sample.isTradeable('ZZZZ') === false)

check('topByMarketCap(2) が上位2件', sample.topByMarketCap(2).map(s => s.symbol).join(',') === 'BIGGER,BIG')
check('topByMarketCap(0) が空配列', sample.topByMarketCap(0).length === 0)
check('topByMarketCap(負) でも落ちない', sample.topByMarketCap(-5).length === 0)

check('検索: ティッカー完全一致が最優先', sample.search('BIG')[0].symbol === 'BIG')
check('検索: 前方一致が社名一致より上', sample.search('BIG').slice(0, 2).map(s => s.symbol).join(',') === 'BIG,BIGGER')
check('検索: 社名の部分一致で拾える', sample.search('Middle')[0]?.symbol === 'MID')
check('検索: 大文字小文字を問わない', sample.search('middle')[0]?.symbol === 'MID')
check('検索: 空クエリは空配列', sample.search('   ').length === 0)
check('検索: limit が効く', sample.search('B', 1).length === 1)
check('検索: 該当なしは空配列', sample.search('QQQQQQ').length === 0)

check('絞込: minMarketCap', sample.filter({ minMarketCap: 1e10 }).map(s => s.symbol).join(',') === 'BIGGER,BIG')
check(
  '絞込: 時価総額が欠損の銘柄は下限指定で除外される（fail-closed）',
  !sample.filter({ minMarketCap: 1 }).some(s => s.symbol === 'NOCAP'),
)
check('絞込: excludeDeficient', !sample.filter({ excludeDeficient: true }).some(s => s.symbol === 'BAD'))
check('絞込: sector', sample.filter({ sector: 'Technology' }).map(s => s.symbol).join(',') === 'MID')
check('絞込: 条件なしは全件', sample.filter().length === 6)

// ── 2. 実データ（data/universe.json） ────────────────────────────────
console.log('\n[2] 実データ（data/universe.json）')

const dataPath = path.join(process.cwd(), 'data', 'universe.json')
if (!fs.existsSync(dataPath)) {
  failed++
  console.log('  FAIL  data/universe.json が無い — npx tsx scripts/build-universe.ts を実行してください')
} else {
  const file: UniverseFile = JSON.parse(fs.readFileSync(dataPath, 'utf8'))
  const u = createUniverse(file.stocks)

  check('出典が記録されている', typeof file.source === 'string' && file.source.includes('Nasdaq Trader'))
  check('生成時刻が ISO 文字列', !Number.isNaN(Date.parse(file.builtAt)))
  check('価格の検証元が記録されている', typeof file.priceVerifiedBy === 'string' && file.priceVerifiedBy.length > 0)
  check('count と実際の件数が一致', file.count === file.stocks.length, `count=${file.count} stocks=${file.stocks.length}`)

  check('旧ユニバース(105件)より大きい', u.size > 105, `size=${u.size}`)
  check('ティッカーが重複していない', new Set(file.stocks.map(s => s.symbol)).size === u.size)

  const badSymbol = file.stocks.find(s => !/^[A-Z]{1,5}(-[A-Z])?$/.test(s.symbol))
  check('ティッカーの形式がすべて妥当', !badSymbol, badSymbol?.symbol)

  const noName = file.stocks.find(s => !s.name || !s.name.trim())
  check('社名が空の行が無い', !noName, noName?.symbol)

  const badCap = file.stocks.find(s => s.marketCap != null && !(s.marketCap > 0))
  check('時価総額は「正の数」か「欠損」だけ（0や負を作らない）', !badCap, badCap?.symbol)

  const dollarSymbol = file.stocks.find(s => s.symbol.includes('$'))
  check('優先株($表記)が混ざっていない', !dollarSymbol, dollarSymbol?.symbol)

  const exchanges = new Set(file.stocks.map(s => s.exchange))
  check(
    '上場区分が想定内だけ',
    [...exchanges].every(e => ['NYSE', 'NYSE American', 'Nasdaq Global Select', 'Nasdaq Global', 'Nasdaq Capital Market'].includes(e)),
    [...exchanges].join('|'),
  )

  // 誰でも知っている銘柄が引けること。ここが落ちたら生成の絞り込みが効き過ぎている。
  for (const sym of ['AAPL', 'MSFT', 'NVDA', 'BRK-B', 'JPM', 'KO', 'F', 'T']) {
    check(`${sym} が一覧にある`, u.isTradeable(sym))
  }
  // ETF・優先株・テスト銘柄は落ちていること。
  for (const sym of ['SPY', 'QQQ', 'VOO']) {
    check(`${sym}（ETF）が除外されている`, !u.isTradeable(sym))
  }

  check('検索「apple」で AAPL が出る', u.search('apple').some(s => s.symbol === 'AAPL'))
  check('検索「BRK-B」で完全一致が先頭', u.search('BRK-B')[0]?.symbol === 'BRK-B')

  console.log(`\n  （参考）${u.size}件 / 時価総額$100億以上 ${u.filter({ minMarketCap: 1e10 }).length}件 / ` +
    `$20億以上 ${u.filter({ minMarketCap: 2e9 }).length}件 / 上場維持基準に抵触 ${file.stocks.filter(s => s.deficient).length}件`)
}

console.log(`\n${failed === 0 ? '全PASS' : '失敗あり'}: ${passed} passed / ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
