// 「1件のふりかえり」（/review/[recordId]・S3a・2026-09-30・DECISIONS 2026-09-30 3本目）の検査。
//   $env:PATH = "C:\Program Files\nodejs;$env:PATH"; npx tsx scripts/check-review-record.ts
//
// 見るもの:
//  1. lib/review/record.ts の対応づけ（買いの Trade.id を鍵にした FIFO）が lib/review/judgement.ts の buildJudgements と
//     一致する（symbol / source / entryAt / exitAt / shares と、理由の対応）。合成データは 分割売り・同銘柄2回・練習と過去の同銘柄・
//     保有していない分の売り・保存順（新しい順）を含む。judgement.ts は読むだけ（1文字も変えない方針の担保）
//  2. lib/review/planned-hold.ts: 期間でない数字（「3日連続」「2週間前」「決算は3か月ごと」「成長率が15%」）→ null、
//     「3年は持つ」「半年様子を見る」→ 値。同じ入力で同じ答え。時計・乱数を持たない
//  3. lib/review/base-rates.ts: 日足2本未満で空・評価の副詞と「過去10年」「決算」「当社の分析」を含まない・各項目に window と basis・
//     買値からの%条件のときだけ「同じ幅」の項目・絶対値の条件では出さない・買った日を覆わない足では 1・3 を出さない
//  4. 部品を実際に描く: PremiseChain（結論に状態を付けない・形＋語・--danger 無し・凡例の固定順）、PlanVsActualBars（点線＋実線・凡例・role=img）
//  5. ページ（app/review/[recordId]/page.tsx）: バッジ・フッター・「書かれていません」・固定文言・幅・uuid でなければ notFound()・
//     /review/backfill が優先される注釈・--danger 無し・lib/ai-trader / lib/investors を import しない・§6 §7 を出さない
//  6. 禁止語（DECISIONS (8) の画面語）が新規ファイルに無い（注釈は落として見る。免責の固定文の「予測」だけ除外）
//  7. app/sitemap.ts に /review/ の個別ページが無い・一覧に導線・DESIGN.md §6-15・SKILL.md の行
//
// 実ネットワーク不要。合成データは検査の中だけ（製品コードに入れない）。

import fs from 'fs'
import path from 'path'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Trade } from '../lib/portfolio'
import { buildJudgements, type Judgement } from '../lib/review/judgement'
import { buildRecords, findRecord, matchRecordId, openShares, type ReviewRecord } from '../lib/review/record'
import { parsePlannedHold } from '../lib/review/planned-hold'
import { computeBaseRates, BIG_MOVE_PCT } from '../lib/review/base-rates'
import { parseExitLevel } from '../lib/review/exit-rule'
import { PremiseChain, STATUS_LABEL, STATUS_ORDER, type PremiseChainProps } from '../components/review/PremiseChain'
import { PlanVsActualBars, type PlanVsActualBarsProps } from '../components/review/PlanVsActualBars'
import type { HistoricalBar } from '../types'

let passed = 0
let failed = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    passed++
    console.log(`  PASS ${name}`)
  } else {
    failed++
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

const ROOT = process.cwd()
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const exists = (rel: string) => fs.existsSync(path.join(ROOT, rel))
/** 注釈を落とす（文字列の中の // は残す。check-review.ts と同じ） */
function stripComments(src: string): string {
  let out = ''
  let i = 0
  while (i < src.length) {
    const c = src[i]
    const n = src[i + 1]
    if (c === '"' || c === "'" || c === '`') {
      out += c; i++
      while (i < src.length && src[i] !== c) {
        if (src[i] === '\\') { out += src[i]; i++ }
        out += src[i] ?? ''; i++
      }
      out += src[i] ?? ''; i++
      continue
    }
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i++; continue }
    if (c === '/' && n === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue }
    out += c; i++
  }
  return out
}
function walk(rel: string): string[] {
  const abs = path.join(ROOT, rel)
  if (!fs.existsSync(abs)) return []
  const out: string[] = []
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    const r = `${rel}/${e.name}`
    if (e.isDirectory()) out.push(...walk(r))
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(r)
  }
  return out
}
const count = (s: string, needle: string | RegExp) =>
  typeof needle === 'string' ? s.split(needle).length - 1 : (s.match(new RegExp(needle.source, needle.flags.includes('g') ? needle.flags : `${needle.flags}g`)) ?? []).length
const j = (v: unknown) => JSON.stringify(v)

const PAGE = 'app/review/[recordId]/page.tsx'
const NEW_FILES = [PAGE, 'components/review/PremiseChain.tsx', 'components/review/PlanVsActualBars.tsx', 'lib/review/record.ts', 'lib/review/base-rates.ts', 'lib/review/planned-hold.ts']

// ─────────────────────────────────────────────────────────────────────────────
console.log('■ 1. record.ts の対応づけが judgement.ts と一致する（合成データ）')
const DAY = 86_400_000
const T0 = Date.UTC(2026, 5, 1, 14, 30)
let n = 0
const uuid = () => {
  n++
  const h = n.toString(16).padStart(12, '0')
  return `0000${n.toString(16).padStart(4, '0')}-0000-4000-8000-${h}`
}
const tr = (o: Partial<Trade> & Pick<Trade, 'symbol' | 'action' | 'shares' | 'price' | 'timestamp'>): Trade =>
  ({ id: uuid(), name: `${o.symbol} Inc.`, ...o }) as Trade

/** 分割売り・同銘柄2回・練習と過去の同銘柄・保有していない分の売り・理由あり／なし */
const SYNTH: Trade[] = [
  tr({ symbol: 'AAPL', action: 'buy', shares: 10, price: 100, timestamp: T0, reason: '【見立て】決算が良かった\n【注目】次の決算\n【降りる条件】株価が-10%になったら売る' }),
  tr({ symbol: 'AAPL', action: 'sell', shares: 4, price: 110, timestamp: T0 + 10 * DAY, reason: '【売る理由】一部を売った' }),
  tr({ symbol: 'AAPL', action: 'sell', shares: 6, price: 120, timestamp: T0 + 20 * DAY, reason: '【売る理由】残りを売った\n【変化】競合が強かった' }),
  tr({ symbol: 'AAPL', action: 'buy', shares: 5, price: 130, timestamp: T0 + 30 * DAY, reason: '2回目。理由は自由記述' }),
  tr({ symbol: 'MSFT', action: 'buy', shares: 8, price: 300, timestamp: T0 + 31 * DAY }),
  tr({ symbol: 'MSFT', action: 'buy', shares: 2, price: 310, timestamp: T0 + 32 * DAY, reason: '【見立て】伸びる' }),
  tr({ symbol: 'MSFT', action: 'sell', shares: 9, price: 320, timestamp: T0 + 40 * DAY, reason: '【売る理由】まとめて売った' }),
  tr({ symbol: 'AAPL', action: 'buy', shares: 3, price: 90, timestamp: T0 + 5 * DAY, reason: '【見立て】実際の記録', source: 'past' }),
  tr({ symbol: 'AAPL', action: 'sell', shares: 3, price: 95, timestamp: T0 + 15 * DAY, reason: '【売る理由】実際の記録', source: 'past' }),
  tr({ symbol: 'NVDA', action: 'sell', shares: 5, price: 500, timestamp: T0 + 50 * DAY }), // 保有していない分の売り（捨てる）
  tr({ symbol: 'TSLA', action: 'buy', shares: 1, price: 200, timestamp: T0 + 60 * DAY, reason: '【見立て】保有中' }),
]
/** 保存順（新しい順）で渡す */
const STORED = [...SYNTH].sort((a, b) => b.timestamp - a.timestamp)

type Pair = { symbol: string; source: string; entryAt: number; exitAt: number | 'open'; shares: number; entryReason: string | null; exitReason: string | null }
const pairKey = (p: Pair) => `${p.symbol}|${p.source}|${p.entryAt}|${p.exitAt}|${p.shares}|${p.entryReason ?? ''}|${p.exitReason ?? ''}`
function pairsFromJudgements(js: Judgement[]): string[] {
  return js.map(x => pairKey({ symbol: x.symbol, source: x.source, entryAt: x.entryAt, exitAt: x.exitAt ?? 'open', shares: x.shares, entryReason: x.entryReason, exitReason: x.exitReason })).sort()
}
function pairsFromRecords(rs: ReviewRecord[]): string[] {
  const out: string[] = []
  for (const r of rs) {
    for (const s of r.sells) out.push(pairKey({ symbol: r.symbol, source: r.source, entryAt: r.entryAt, exitAt: s.exitAt, shares: s.shares, entryReason: r.entryReason, exitReason: s.exitReason }))
    const left = openShares(r)
    if (left > 0) out.push(pairKey({ symbol: r.symbol, source: r.source, entryAt: r.entryAt, exitAt: 'open', shares: left, entryReason: r.entryReason, exitReason: null }))
  }
  return out.sort()
}
{
  const js = buildJudgements(STORED).judgements
  const rs = buildRecords(STORED)
  const a = pairsFromJudgements(js)
  const b = pairsFromRecords(rs)
  check(`対応づけ（symbol / source / entryAt / exitAt / shares / 理由）の多重集合が一致（${a.length} 対）`, j(a) === j(b), `\n    judgement: ${j(a)}\n    record:    ${j(b)}`)
  check('件数: 買い6件（practice 5・past 1）が seq 1〜6・買った順', rs.length === 6 && rs.every((r, i) => r.seq === i + 1) && rs.every((r, i) => i === 0 || r.entryAt >= rs[i - 1].entryAt))
  const aapl1 = rs.find(r => r.entryAt === T0 && r.source === 'practice')
  check('分割売り: 1回目の AAPL の買いに売りが2つ（4株 @110・6株 @120）・売り切り', aapl1 !== undefined && aapl1.sells.length === 2 && aapl1.sells[0].shares === 4 && aapl1.sells[0].exitPrice === 110 && aapl1.sells[1].shares === 6 && aapl1.sells[1].exitPrice === 120 && openShares(aapl1) === 0, j(aapl1?.sells))
  check('分割売り: 売りの id はそれぞれの売りの Trade.id・理由も対応', aapl1 !== undefined && aapl1.sells[0].id === SYNTH[1].id && aapl1.sells[1].id === SYNTH[2].id && aapl1.sells[1].exitReason === '【売る理由】残りを売った\n【変化】競合が強かった')
  const msft = rs.filter(r => r.symbol === 'MSFT')
  check('同銘柄2回: MSFT の売り9株は古い買い（8株）を先に、次の買いから1株（FIFO）', msft.length === 2 && msft[0].sells.length === 1 && msft[0].sells[0].shares === 8 && msft[1].sells.length === 1 && msft[1].sells[0].shares === 1 && openShares(msft[1]) === 1, j(msft.map(r => r.sells)))
  const past = rs.find(r => r.source === 'past')
  check('練習と過去の同銘柄は別の帳簿: past の AAPL は past の売りだけで決済', past !== undefined && past.sells.length === 1 && past.sells[0].exitPrice === 95 && past.sells[0].exitReason === '【売る理由】実際の記録')
  check('保有していない分の売り（NVDA）は記録を作らない', !rs.some(r => r.symbol === 'NVDA'))
  const tsla = rs.find(r => r.symbol === 'TSLA')
  check('保有中: TSLA は sells が空・openShares 1', tsla !== undefined && tsla.sells.length === 0 && openShares(tsla) === 1)
  check('id は買いの Trade.id（uuid）', rs.every(r => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(r.id)) && rs[0].id === SYNTH[0].id)
  check('findRecord: id で1件・無い id は null', findRecord(STORED, SYNTH[3].id)?.entryReason === '2回目。理由は自由記述' && findRecord(STORED, 'ffffffff-0000-4000-8000-000000000000') === null)
  check('matchRecordId: buildJudgements の各行から記録の id が引ける（全行）', js.every(x => matchRecordId(rs, x) !== null))
  check('matchRecordId: 分割売りの2行は同じ id（1回目の AAPL の買い）', js.filter(x => x.symbol === 'AAPL' && x.source === 'practice' && x.entryAt === T0).every(x => matchRecordId(rs, x) === SYNTH[0].id))
  check('入力の配列を書き換えない', STORED[0].symbol === 'TSLA' && STORED[STORED.length - 1].symbol === 'AAPL')
  // 同じ銘柄・同じ帳簿・同じ時刻の買いが2件（過去の記録は日付で入るので同日2件があり得る）
  const same: Trade[] = [
    tr({ symbol: 'AMZN', action: 'buy', shares: 2, price: 100, timestamp: T0, source: 'past', reason: 'A' }),
    tr({ symbol: 'AMZN', action: 'buy', shares: 3, price: 100, timestamp: T0, source: 'past', reason: 'B' }),
    tr({ symbol: 'AMZN', action: 'sell', shares: 2, price: 120, timestamp: T0 + DAY, source: 'past' }),
  ]
  const sj = buildJudgements(same).judgements
  const sr = buildRecords(same)
  check('同時刻2件: 対応づけが一致し、売りは前の買い（2株）を先に', j(pairsFromJudgements(sj)) === j(pairsFromRecords(sr)) && sr[0].sells.length === 1 && sr[1].sells.length === 0)
  const closedRow = sj.find(x => x.exitAt !== null)!
  const openRow = sj.find(x => x.exitAt === null)!
  check('同時刻2件: matchRecordId が売った時刻と株数でしぼる（往復→1件目・保有中→2件目）', matchRecordId(sr, closedRow) === same[0].id && matchRecordId(sr, openRow) === same[1].id)
  // 100回・順序を変えても同じ
  const first = j(pairsFromRecords(buildRecords(SYNTH)))
  check('同じ入力を100回で同一・保存順を変えても同一', Array.from({ length: 100 }, () => j(pairsFromRecords(buildRecords(STORED)))).every(x => x === first))
  const rec = stripComments(read('lib/review/record.ts'))
  for (const w of ['Date.now', 'Math.random', 'fetch(', 'localStorage', 'process.env', "'react'"]) check(`record.ts に「${w}」が無い（純関数）`, !rec.includes(w))
  check('record.ts: 帳簿は symbol＋source（judgement.ts と同じ lotKey）・timestamp 昇順に並べ替えてから走査', rec.includes("`${t.symbol} ${t.source ?? 'practice'}`") && rec.includes('a.timestamp - b.timestamp'))
  const jsrc = read('lib/review/judgement.ts')
  check('lib/review/judgement.ts は無変更（id を足していない・合成指標を作らない注釈と enoughForStats が残る）', !/\bid:/.test(stripComments(jsrc)) && jsrc.includes('「判断の質スコア」のような合成指標を作らない') && jsrc.includes('enoughForStats: closed.length >= 3'))
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('■ 2. planned-hold.ts（保守的に読む）')
// 否定形（S3a レビュー W2）と「◯前」「◯から」（S8）も null
for (const t of ['3日連続で下げたら', '2週間前に買っていた', '決算は3か月ごと', '成長率が15%を割ったら', '2026年まで', '1年以内に売る', '3か月で見直す', '', '決めていなかった', '株価が-20%になったら売る', '3年後に見直す', '2027年は持つ', '10%は持つ',
  '3年は持てない', '3年持っていられない', '3年保有しない', '半年前に買った', '3年前から', '1年持たずに売った']) {
  check(`「${t}」→ null`, parsePlannedHold(t) === null, j(parsePlannedHold(t)))
}
for (const [t, days, label] of [['3年は持つ', 1095, '3年'], ['半年様子を見る', 182, '半年'], ['1年ほど持つつもり', 365, '1年'], ['保有期間は3年', 1095, '3年'], ['最低でも2週間は持つ', 14, '2週間'], ['3か月は様子を見る', 90, '3か月'], ['３年持つ', 1095, '3年'], ['3ヶ月持ち続ける', 90, '3か月'], ['1年半は持つ', 547, '1年半'], ['10日持つ', 10, '10日']] as const) {
  const r = parsePlannedHold(t)
  check(`「${t}」→ ${days}日・「${label}」`, r !== null && r.days === days && r.label === label, j(r))
}
check('期間の候補が2つで値が違う → null（「1年は持つ。3年は持つ」）', parsePlannedHold('1年は持つ。3年は持つ') === null)
check('【見立て】【降りる条件】の複数行からも読める（「【見立て】伸びる。3年は持つ\\n【降りる条件】-20%」）', parsePlannedHold('【見立て】伸びる。3年は持つ\n【降りる条件】-20%')?.days === 1095)
check('同じ入力を100回で同一', Array.from({ length: 100 }, () => j(parsePlannedHold('3年は持つ'))).every(x => x === j({ days: 1095, label: '3年' })))
{
  const p = stripComments(read('lib/review/planned-hold.ts'))
  for (const w of ['Date', 'Math.random', 'fetch', 'localStorage', 'process.env', "'react'"]) check(`planned-hold.ts に「${w}」が無い（時計・乱数・ユーザーを入力にしない）`, !p.includes(w))
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('■ 3. base-rates.ts（日足だけから・固定の文型）')
const ENTRY = Date.UTC(2026, 7, 10, 14, 30) // 2026-08-10
function mkBars(count: number, startDay = Date.UTC(2026, 7, 3), step = (i: number) => 100 + i): HistoricalBar[] {
  return Array.from({ length: count }, (_, i) => {
    const c = step(i)
    return { time: Math.floor((startDay + i * DAY) / 1000), open: c, high: c + 1, low: c - 1, close: c, volume: 1000 }
  })
}
const BAD_WORDS = /よくある|珍しい|意外|多い|少ない|過去10年|決算|当社の分析|評価|点数|スコア|予測|おすすめ|べき|正解|的中/
{
  const level = parseExitLevel('株価が-20%になったら売る', 107)
  const base = { symbol: 'AAPL', entryAt: ENTRY, exitAt: null as number | null, exitLevel: level, entryPrice: 107 }
  check('日足 0本 → []', computeBaseRates({ ...base, bars: [] }).length === 0)
  check('日足 1本 → []', computeBaseRates({ ...base, bars: mkBars(1) }).length === 0)
  // 8/3 から 30 本・終値 100→129。買った日 8/10 は 8番目（添字 7）。保有中
  const bars = mkBars(30)
  const rates = computeBaseRates({ ...base, bars })
  check('保有中・%条件あり → 3項目（daily-moves / same-move / above-entry）の順', j(rates.map(r => r.key)) === j(['daily-moves', 'same-move', 'above-entry']), j(rates.map(r => r.key)))
  check('各項目に window { from, to, bars } と basis: "bars"', rates.every(r => /^\d{4}-\d{2}-\d{2}$/.test(r.window.from) && /^\d{4}-\d{2}-\d{2}$/.test(r.window.to) && r.window.bars > 0 && r.basis === 'bars'))
  const dm = rates[0]
  // 保有期間 8/10〜9/1（23本）。毎日 +1 なので上げは +1.0%（8/11: 107→108 = +0.93%）…最大は 8/11、下げは無い
  check('1. 保有していた期間の1日の値動き: 対象期間 2026-08-10〜2026-09-01・日足 23本', dm.window.from === '2026-08-10' && dm.window.to === '2026-09-01' && dm.window.bars === 23, j(dm.window))
  check('1. 文型「最大の上げ +x.x%（M/D）・最大の下げ なし・±3%以上動いた日 0日（前日と比べられた 22日のうち）」', /^最大の上げ \+\d+\.\d%（\d{1,2}\/\d{1,2}）・最大の下げ なし・±3%以上動いた日 0日（前日と比べられた 22日のうち）$/.test(dm.value), dm.value)
  const sm = rates[1]
  check('2. 同じ幅: ラベルに「買値から−20%」「1日で下げた日」・値「0日（日足 30本・前日と比べられた 29日のうち）」・対象は全期間', sm.label.includes('買値から−20%') && sm.label.includes('1日で下げた日') && sm.value === '0日（日足 30本・前日と比べられた 29日のうち）' && sm.window.from === '2026-08-03' && sm.window.bars === 30, `${sm.label} / ${sm.value}`)
  const ae = rates[2]
  check('3. 営業日 23日のうち 終値が買値（あなたの記録では $107.00）を上回っていた日: 8/11 以降の 22日', ae.value === '営業日 23日のうち 22日（買値は、あなたの記録では $107.00）' && ae.window.bars === 23, ae.value)
  check('出力に評価の副詞・「過去10年」「決算」「当社の分析」が無い', rates.every(r => !BAD_WORDS.test(r.label) && !BAD_WORDS.test(r.value)))
  check(`BIG_MOVE_PCT === 3`, BIG_MOVE_PCT === 3)
  // 大きく動く足: 8/14 に −8%、8/20 に +5%
  const jumpy = mkBars(30, Date.UTC(2026, 7, 3), i => (i === 11 ? 92 : i === 17 ? 105 : 100))
  const r2 = computeBaseRates({ ...base, bars: jumpy })
  check('値動きの数え方: −8%（8/14）・+8.7%（8/15 の戻り）・±3%以上 4日（整数は小数を付けない）', r2[0].value.includes('最大の下げ −8%（8/14）') && r2[0].value.includes('最大の上げ +8.7%（8/15）') && r2[0].value.includes('±3%以上動いた日 4日'), r2[0].value)
  check('同じ幅（−20%）: −8% の日は数えない → 0日', r2[1].value.startsWith('0日'))
  const wide = parseExitLevel('株価が-5%になったら売る', 107)
  const r3 = computeBaseRates({ ...base, bars: jumpy, exitLevel: wide })
  check('同じ幅（−5%）: −8.0% の日を数える → 1日・ラベル「買値から−5%」', r3[1].value.startsWith('1日') && r3[1].label.includes('買値から−5%'), `${r3[1].label} / ${r3[1].value}`)
  // 売却済み: 8/28 に売った → 保有期間は 8/10〜8/28
  const closedRates = computeBaseRates({ ...base, bars, exitAt: Date.UTC(2026, 7, 28, 14, 30) })
  check('売却済み: 保有期間は売った日まで（2026-08-10〜2026-08-28・19本）', closedRates[0].window.to === '2026-08-28' && closedRates[0].window.bars === 19 && closedRates[2].window.bars === 19, j(closedRates[0].window))
  // 絶対値の条件（$90を割ったら）→ 買値を根拠にした幅を作らないので「同じ幅」は出さない
  const abs = computeBaseRates({ ...base, bars, exitLevel: parseExitLevel('$90を割ったら', 107) })
  check('絶対値の条件（$90）→ same-move を出さない（買値を計算根拠にしない・DECISIONS (11)）', !abs.some(r => r.key === 'same-move') && abs.length === 2)
  check('条件なし → same-move を出さない', !computeBaseRates({ ...base, bars, exitLevel: null }).some(r => r.key === 'same-move'))
  // 買った日を覆わない足（買った日より後から始まる）→ 1・3 を出さない。2 は全期間なので出る
  const later = computeBaseRates({ ...base, bars: mkBars(10, Date.UTC(2026, 7, 20)) })
  check('買った日を覆わない足 → daily-moves / above-entry を出さない（same-move だけ）', j(later.map(r => r.key)) === j(['same-move']), j(later.map(r => r.key)))
  // 買った当日（足が1本だけ）→ 1 は出さない・3 は 1日ぶん
  const sameDay = computeBaseRates({ ...base, bars: mkBars(8) })
  check('買った日の足が最後の1本 → daily-moves は出さず、above-entry は営業日 1日', !sameDay.some(r => r.key === 'daily-moves') && sameDay.find(r => r.key === 'above-entry')?.value.startsWith('営業日 1日のうち') === true, j(sameDay.map(r => [r.key, r.value])))
  // 円建て
  const yenRates = computeBaseRates({ ...base, symbol: '9984.T', bars: mkBars(30, Date.UTC(2026, 7, 3), i => 6000 + i * 10), entryPrice: 6070, exitLevel: null })
  check('円建て（.T）: 買値は ¥6,070 と書く', yenRates.find(r => r.key === 'above-entry')?.value.includes('¥6,070') === true)
  check('同じ入力を100回で同一・入力の順序（新しい順）でも同一', Array.from({ length: 100 }, () => j(computeBaseRates({ ...base, bars }))).every(x => x === j(rates)) && j(computeBaseRates({ ...base, bars: [...bars].reverse() })) === j(rates))
  check('入力の配列を書き換えない', bars[0].close === 100 && bars[29].close === 129)
  const src = stripComments(read('lib/review/base-rates.ts'))
  for (const w of ['Date.now', 'Math.random', 'fetch(', 'localStorage', 'process.env', "'react'", '.low', '.high']) check(`base-rates.ts に「${w}」が無い（純関数・終値だけ）`, !src.includes(w))
  check('base-rates.ts の文字列に 過去10年／決算／当社の分析／評価の副詞 が無い', !/よくある|珍しい|意外|過去10年|決算|当社の分析/.test(src))
  check("base-rates.ts: 出所は画面側で PRICE_SOURCE（Yahoo Finance）を添える。ここに 'mock' が無い", !/mock/i.test(src))
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('■ 4. 部品を実際に描く')
const RED = /--danger|text-danger|--success|text-success/
{
  const full: PremiseChainProps = { symbol: 'AAPL', shares: 10, thesis: '直近の決算で売上が+22%。', catalyst: '次の四半期決算', exitRule: '株価が-20%になったら売る', exitRuleRaw: '株価が-20%になったら売る', plannedHold: { days: 1095, label: '3年' } }
  const html = renderToStaticMarkup(React.createElement(PremiseChain, full))
  const items = html.split(/<li(?=[\s>])/).slice(1)
  check('PremiseChain: ノードは 前提 → 結論 → 期間 → 注目 → 降りる条件 の5つ＋凡例4つ', items.length === 9 && ['前提', '結論', '期間', '注目', '降りる条件'].every((h, i) => items[i].includes(`>${h}</span>`)), String(items.length))
  check('PremiseChain: 「↓ だから」が結論の直前に1つ', count(html, '↓ だから') === 1 && items[1].includes('↓ だから'))
  check('PremiseChain: 結論のノードに状態（data-status）が無い', !items[1].includes('data-status'))
  // S3a レビュー W1: 書かれたものには状態を付けない（「確かめようがありません」は意見・感想の意味で、
  // 資料と突き合わせていないだけの S3a では語がずれる。S3b で「確認できた」が付きうる）。付くのは「書かれていません」だけ
  check('PremiseChain: 書かれた見立て・注目・期間・降りる条件には状態を付けない（S3a は「書かれていません」だけ）', [0, 2, 3, 4].every(i => !items[i].includes('data-status')))
  // 凡例（4つの状態を固定順で示す）には出るので、チェーンの5項目だけを見る
  check('PremiseChain: 書かれた見立て・注目に「確かめようがありません」を付けない（凡例を除く）', !items.slice(0, 5).some(x => x.includes('data-status="unverifiable"')))
  check('PremiseChain: 原文をそのまま出す', html.includes('直近の決算で売上が+22%。') && html.includes('次の四半期決算') && html.includes('株価が-20%になったら売る') && html.includes('AAPL を 10株、買う') && html.includes('3年（書かれた文から読み取った期間）'))
  const empty = renderToStaticMarkup(React.createElement(PremiseChain, { symbol: 'AAPL', shares: 10, thesis: null, catalyst: null, exitRule: null, exitRuleRaw: null, plannedHold: null }))
  const eItems = empty.split(/<li(?=[\s>])/).slice(1)
  check('PremiseChain（未記入）: 前提・期間・注目・降りる条件が「書かれていません」（中空の三角・--warning-ink）・結論には無し', [0, 2, 3, 4].every(i => eItems[i].includes('data-status="missing"') && eItems[i].includes('<polygon') && eItems[i].includes('text-warning-ink')) && !eItems[1].includes('data-status') && count(empty.slice(0, empty.indexOf('凡例') > 0 ? empty.indexOf('凡例') : empty.length), '書かれていません') >= 4)
  check('PremiseChain（未記入）: 壊れず、「確かめようがありません」は付けない（書かれていないものは確かめようが無い以前の状態）', !eItems.slice(0, 5).some(x => x.includes('data-status="unverifiable"')))
  check('PremiseChain: 「決めていなかった」は原文を出し、状態は「書かれていません」', (() => { const h = renderToStaticMarkup(React.createElement(PremiseChain, { ...full, exitRule: null, exitRuleRaw: '決めていなかった' })); const it = h.split(/<li(?=[\s>])/).slice(1); return it[4].includes('決めていなかった') && it[4].includes('data-status="missing"') })())
  check('PremiseChain: 4つの状態は形で区別（塗りの丸／斜線の丸／中空の丸／中空の三角）・凡例は固定順', (() => {
    const legend = html.slice(html.lastIndexOf('<ul'))
    const order = [...legend.matchAll(/data-status="(\w+)"/g)].map(m => m[1])
    return j(order) === j(STATUS_ORDER) && legend.includes('<circle cx="7" cy="7" r="5" fill="currentColor"') && legend.includes('<line x1="3.5"') && legend.includes('<polygon') && count(legend, 'fill="none"') >= 3
  })())
  check('PremiseChain: 画面語は4つだけ', j(STATUS_LABEL) === j({ confirmed: '確認できた', broken: '事実と違いました', unverifiable: '確かめようがありません', missing: '書かれていません' }))
  check('PremiseChain: --danger／--success を使わない（赤を使わない）', !RED.test(html) && !RED.test(empty))
  check('PremiseChain: 凡例の注記に「出典の付いた資料と突き合わせられたときだけ」・「まだ」を書かない', html.includes('出典の付いた資料と突き合わせられたときだけ出します') && !/まだ/.test(html))
  const src = read('components/review/PremiseChain.tsx')
  check("PremiseChain.tsx: 'use client'・fetch／Date.now を持たない", /^'use client'/.test(src) && !stripComments(src).includes('fetch(') && !stripComments(src).includes('Date.now'))
}
{
  const p: PlanVsActualBarsProps = { planned: { days: 1095, label: '3年' }, entryAt: ENTRY, exitAt: null, today: ENTRY + 45 * DAY, initialWidth: 640 }
  const html = renderToStaticMarkup(React.createElement(PlanVsActualBars, p))
  check('PlanVsActualBars: role="img"＋aria-label に予定と実際', /<figure role="img" aria-label="予定していた期間 3年（1095日）と、実際に持っていた期間 45日（保有中）を同じ横軸で並べた図/.test(html))
  check('PlanVsActualBars: 予定は点線の枠（fill none・stroke-dasharray・--muted）、実際は塗り（SERIES.you #5681DC）', /<rect[^>]*fill="none"[^>]*stroke="var\(--muted\)"[^>]*stroke-dasharray="4 3"/.test(html) && /<rect[^>]*fill="#5681DC"/.test(html) && count(html, '<rect') === 2)
  check('PlanVsActualBars: 直接ラベル「予定 3年（1,095日）」「実際 45日（保有中）」', html.includes('予定 3年（1,095日）') && html.includes('実際 45日（保有中）'))
  check('PlanVsActualBars: 横軸は左端「買った日 2026-08-10」と右端「予定の終わり 2029-08-09」だけ（目盛り線なし＝<line は軸1本＋端の2本）', html.includes('買った日 2026-08-10') && html.includes('予定の終わり 2029-08-09') && count(html, '<line') === 3, String(count(html, '<line')))
  check('PlanVsActualBars: 凡例（2系列）', html.includes('予定していた期間（書かれた文から読み取った）') && html.includes('実際に持っていた期間'))
  check('PlanVsActualBars: 良し悪しの語・色が無い', !RED.test(html) && !/長すぎ|短すぎ|守れ|正しかった/.test(html))
  const closedHtml = renderToStaticMarkup(React.createElement(PlanVsActualBars, { ...p, planned: { days: 14, label: '2週間' }, exitAt: ENTRY + 40 * DAY }))
  check('PlanVsActualBars（売却済み・実際の方が長い）: 「実際 40日」・右端は「売った日 2026-09-19」', closedHtml.includes('実際 40日<') && closedHtml.includes('売った日 2026-09-19') && !closedHtml.includes('保有中'))
  const src = read('components/review/PlanVsActualBars.tsx')
  check("PlanVsActualBars.tsx: 'use client'・Date.now／fetch を持たない（今日はページが渡す）", /^'use client'/.test(src) && !stripComments(src).includes('Date.now') && !stripComments(src).includes('fetch('))
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('■ 5. ページ（app/review/[recordId]/page.tsx）')
{
  const raw = read(PAGE)
  const page = stripComments(raw)
  check("'use client'・params は Promise を use() で受ける（Next 16 の規約）", /^'use client'/.test(raw) && page.includes('params: Promise<{ recordId: string }>') && page.includes('use(params)'))
  check('uuid の形でなければ notFound()（use(params) の直後）', page.includes('UUID_RE.test(recordId)) notFound()') && page.indexOf('use(params)') < page.indexOf('UUID_RE.test(recordId)) notFound()'))
  check('自分の記録に無い id も notFound()', page.includes('if (record === null) notFound()'))
  check('注釈: app/review/backfill（固定の区切り）が動的な区切りより優先される', raw.includes('app/review/backfill') && raw.includes('優先'))
  check(`バッジ「このサイトは良し悪しを判定しません」を常時（BADGE 定数・「まだ」を書かない）`, page.includes("'このサイトは良し悪しを判定しません'") && page.includes('{BADGE}') && !page.includes('判定：まだ'))
  check('フッターの固定文', page.includes("'このサイトは、あなたの判断の良し悪しを判定しません。出しているのは、あなたが書いたことと、実際に起きたことの記録だけです。'") && page.includes('{FOOTER}'))
  check('期間が読めたときだけ「あなたが書いた期間は◯◯です。◯◯後にこの記録をもう一度開くと、そのときまでの株価が並びます。」・読めなければ「予定していた期間は、書かれた文からは読み取れません。」', page.includes('後にこの記録をもう一度開くと、そのときまでの株価が並びます。') && page.includes("'予定していた期間は、書かれた文からは読み取れません。'") && !page.includes('3年後'))
  check('「書かれていません」（未記入でも壊れない）', page.includes("'書かれていません'"))
  check('固定文言「過去の分布であり、将来を予測するものではありません」（--muted・12px＝text-caption）', page.includes("'過去の分布であり、将来を予測するものではありません'") && page.includes('<p className="text-caption text-muted">{DISTRIBUTION_NOTE}</p>'))
  check('基準率の各項目の直下に 対象期間／日足 N本／Yahoo Finance／取得 …', page.includes('対象期間 {r.window.from}〜{r.window.to}／日足 {r.window.bars.toLocaleString()}本／{PRICE_SOURCE}／{fetched}') && page.includes("'取得時点が分かりません'"))
  check('3枚のカード: 見立て／注目／降りる条件（「＝間違いだと分かったら降りる条件」）', page.includes('heading="見立て"') && page.includes('heading="注目"') && page.includes('heading="降りる条件"') && page.includes('hint="＝間違いだと分かったら降りる条件"'))
  check('分割売り「◯回に分けて売っています（最後は M/D）」', page.includes('回に分けて売っています（最後は '))
  check('売っていれば「売るときに、あなたが書いたこと」', page.includes('売るときに、あなたが書いたこと'))
  check('節の並び: ヘッダー → あなたが書いたこと → ロジックの検証 → 言ったこと vs やったこと → 起きたことの頻度 → 数字 → フッター', (() => {
    const idx = ['{BADGE}', '>あなたが書いたこと<', '>ロジックの検証<', '>言ったこと vs やったこと<', '>起きたことの頻度<', '>あなたの記録の数字<', '{FOOTER}'].map(s => page.indexOf(s))
    return idx.every(i => i > 0) && idx.every((v, i) => i === 0 || v > idx[i - 1])
  })())
  check('§6（逆の見方）と §7（次の問い）は節ごと出さない（見出しも無い）', !/逆の見方|次の問い|反対の見方|counterView|questions/.test(page))
  check('PremiseChain・PlanVsActualBars・PriceSincePanel（無変更で再利用）を使う', page.includes('<PremiseChain') && page.includes('<PlanVsActualBars') && page.includes('<PriceSincePanel'))
  check('日足は /api/stocks/{symbol}/history?period=5y（実データ）・取得時点は応答の Date ヘッダ・読めなければ null', page.includes('/history?period=5y') && page.includes("res.headers.get('date')") && page.includes('Number.isNaN(at) ? null : at') && !/mock/i.test(page))
  check('買値は「あなたの記録では」と出所を書く（表示だけ）', page.includes('あなたの記録では 買 '))
  check('幅は一覧と同じ max-w-[760px]・本文 max-w-[42rem]・フォントを足さない', page.includes('max-w-[760px]') && page.includes('max-w-[42rem]') && !/font-\[|@fontsource|next\/font/.test(page))
  check('--danger／text-danger／text-success を使わない', !RED.test(page))
  check('lib/ai-trader・lib/investors を import しない（app/review/** 全体）', walk('app/review').every(f => !/from ['"]@\/lib\/(?:ai-trader|investors)/.test(stripComments(read(f)))))
  check('未ログインは一覧と同じ案内（「ログインして記録を読み返す」）', page.includes('ログインして記録を読み返す') && page.includes('signedIn === false'))
  check('読み込み中は動かない薄い枠（aria-busy・animate-pulse を使わない）', page.includes('aria-busy="true"') && !page.includes('animate-pulse'))
  check('損益は最下部・色なし（pnl === 0 なら text-muted、それ以外 text-ink）', page.includes("pnl === 0 ? 'text-muted' : 'text-ink'") && page.lastIndexOf('>あなたの記録の数字<') > page.indexOf('>起きたことの頻度<'))
  check('点数・ランク・評価の語が無い（識別子・文字列）', !/\bscore\b|点数|採点|得点|\d点|評価|ランク|偏差/i.test(page))
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('■ 6. 禁止語（DECISIONS 2026-09-30 (8) の画面語・注釈は落とす・免責の固定文は除外）')
const FORBIDDEN = /勝てる|予測|おすすめ|べきでした|正解|スコア|\d点|点数|正しかった|間違いだった|的中|当たった|外れた|見本|お手本|判断ミス|穴|不足|甘い|改善|よくある|珍しい|意外|判定します|判定できます|崩れた/
for (const f of NEW_FILES) {
  const src = stripComments(read(f)).replace(/過去の分布であり、将来を予測するものではありません/g, '')
  const w = FORBIDDEN.exec(src)?.[0]
  check(`${f}: 禁止語が無い`, !w, w)
}
for (const f of NEW_FILES) {
  const src = stripComments(read(f))
  const w = /守れた|守れなかった|判断の質|良い判断|悪い判断/.exec(src)?.[0]
  check(`${f}: 「守れた」「判断の質」の類が無い`, !w, w)
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('■ 7. 導線・sitemap・DESIGN.md・SKILL.md')
{
  const list = stripComments(read('app/review/page.tsx'))
  check('一覧の各カードに「この1件をくわしく読み返す →」の文字リンク1本（/review/${recordId}）・id は lib/review/record.ts の matchRecordId から', list.includes('この1件をくわしく読み返す →') && list.includes('href={`/review/${recordId}`}') && list.includes("from '@/lib/review/record'") && list.includes('matchRecordId(records, j)') && count(list, 'この1件をくわしく読み返す →') === 1)
  const sitemap = stripComments(read('app/sitemap.ts'))
  check('app/sitemap.ts に /review/ の個別ページが無い（ログインが要る面は載せない）', !/\/review\/[^'"]/.test(sitemap) && sitemap.includes("'/review'"))
  check('scripts/check-review.ts に導線の検査がある', read('scripts/check-review.ts').includes('この1件をくわしく読み返す →'))
  const design = read('DESIGN.md')
  check('DESIGN.md §6-15 に「1件のふりかえり」の節（判定バッジ・状態を色で表さない・基準率の出所併記）', design.includes('1件のふりかえり') && design.includes('このサイトは良し悪しを判定しません') && design.includes('状態を色で表さない') && design.includes('対象期間') && design.includes('取得時点'))
  const skill = read('.claude/skills/investsim-conventions/SKILL.md')
  check('SKILL.md のページ表に /review/[recordId]', skill.includes('/review/[recordId]'))
  check('禁止ファイルに触れていない（judgement.ts・PriceSincePanel.tsx・exit-rule.ts・reason.ts・features.ts・next.config.ts・sitemap.ts が存在し、S2b の目印を保つ）',
    read('components/review/PriceSincePanel.tsx').includes('const H = 96') && read('lib/review/exit-rule.ts').includes('export function isNoRule') && read('lib/trade/reason.ts').includes('export function parseReason') && exists('lib/features.ts') && exists('next.config.ts'))
}

console.log('')
console.log(`PASS ${passed} 件 / FAIL ${failed} 件`)
if (failed) process.exit(1)
console.log('すべてPASS')
