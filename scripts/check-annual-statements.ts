// 「1年ごとの決算」（/stocks/[symbol]・2026-10-07）の検査。
//   $env:PATH = "C:\Program Files\nodejs;$env:PATH"; npx tsx scripts/check-annual-statements.ts
//
// ※ scripts/check-statements.ts は /report R2（lib/statements/derived.ts）の既存の検査なので、そこには足さず別名にした。
//
// 見るもの（番号は MC 2026-10-07 の計画のまま）:
//  1. parseCompanyFacts を実際に呼ぶ（固定の JSON 断片）: (a) fy が期末日とずれていても end の年でラベル (b) 複数タグが期末日で統合
//     (c) 同じ期末日は filed の新しい方が勝つ (d) 四半期（90 日）が混ざらない (e) OperatingIncomeLoss が無い会社はその項目だけ落ちる
//  2. yoyLine の 6 分岐を実際に呼ぶ。前年がマイナス・ゼロのとき % の数字を返さない。↑↓ を使わない
//  3. barGeometry が正負で同じ倍率
//  4. AnnualStatements.tsx・YearBars.tsx に --success／--danger／text-red／text-green／# 始まりの色が無い
//  5. 禁止語（割安・割高・健全・危険・好調・悪化・改善傾向・優良・要注意・おすすめ・買い時・売り時・スコア・点数・ランク）が無い
//  6. YearBars.tsx に role="img" と aria-label
//  7. 出所の文（SEC EDGAR・10-K・将来を予測するものではありません）が無条件に描かれる
//  8. 見出しが text-h2 text-ink
//  9. マイナス記号が U+2212（ハイフンを使っていない）
//  ほか: 取得口（偽の fetch。通信しない）・API ルートの形・ページの差し込み・MC の実測値（2026-10-07）を固定入力にした整形
//
// 実ネットワーク不要。偽の fetch と合成データは検査の中だけ（製品コードに入れない）。

import fs from 'fs'
import path from 'path'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  ANNUAL_ITEMS, PERIOD_COUNT, parseCompanyFacts, companyFactsUrl, companyFactsCacheKey, fetchAnnualStatements, SEC_COMPANYFACTS_BASE,
  FETCH_TIMEOUT_MS, COMPANYFACTS_CACHE_VERSION,
  type AnnualStatements as AnnualStatementsData, type SecXbrlDeps,
} from '../lib/statements/sec-xbrl'
import { MINUS, barGeometry, formatValue, formatPct, signWord, yoyLine, yearLabel, fiscalYearOf } from '../lib/statements/display'
import { SEC_TICKERS_URL } from '../lib/review/primary-sources/sec'
import type { SourceCache, CacheEntry } from '../lib/review/primary-sources/store'
import { AnnualStatementsView, SECTION_TITLE, SECTION_LEAD, SOURCE_NOTE, TAG_NOTE, EMPTY_TEXT, FAILED_TITLE } from '../components/stocks/AnnualStatements'
import { YearBars } from '../components/stocks/YearBars'

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
const j = (v: unknown) => JSON.stringify(v)
const count = (s: string, needle: string) => s.split(needle).length - 1
/** 注釈を落とす（文字列の中の // は残す。check-primary-sources.ts と同じ） */
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

const LIB = 'lib/statements/sec-xbrl.ts'
const DISPLAY = 'lib/statements/display.ts'
const ROUTE = 'app/api/stocks/[symbol]/statements/route.ts'
const BARS = 'components/stocks/YearBars.tsx'
const SECTION = 'components/stocks/AnnualStatements.tsx'
const PAGE = 'app/stocks/[symbol]/page.tsx'
const NEW_FILES = [LIB, DISPLAY, ROUTE, BARS, SECTION]

// ── 合成データ（検査の中だけ） ───────────────────────────────────────────────
const M = 1e6
type Row = { start?: string; end: string; val: number; form: string; filed: string; fy?: number; fp?: string; accn?: string }
const row = (start: string, end: string, val: number, filed: string, fy: number, form = '10-K'): Row => ({ start, end, val, form, filed, fy, fp: 'FY', accn: `acc-${filed}` })
const units = (unit: string, rows: Row[]) => ({ units: { [unit]: rows } })

/** アップル風: 2017 年度まで SalesRevenueNet、2018 年度から RevenueFromContract…（MC が実際に踏んだ罠3） */
const APPLE_LIKE = {
  cik: 320193,
  entityName: 'Apple Inc.',
  facts: {
    'us-gaap': {
      SalesRevenueNet: units('USD', [
        row('2015-09-27', '2016-09-24', 215_639 * M, '2016-10-26', 2016),
        row('2016-09-25', '2017-09-30', 229_234 * M, '2017-11-03', 2017),
        // 2018 年度の 10-K にも旧タグで 2017 年度の値が載る（同じ end・新しい filed・値は同じ）
        row('2016-09-25', '2017-09-30', 229_234 * M, '2018-11-05', 2018),
      ]),
      RevenueFromContractWithCustomerExcludingAssessedTax: units('USD', [
        row('2017-10-01', '2018-09-29', 265_595 * M, '2018-11-05', 2018),
        // (d) 10-K に載った四半期（90 日）の行は外す
        row('2018-07-01', '2018-09-29', 62_900 * M, '2018-11-05', 2018),
        row('2018-09-30', '2019-09-28', 260_000 * M, '2019-10-31', 2019),
        // (a)(c) fy:2021 の行だが期末日は 2019。filed が新しいのでこちら（訂正後 260_174）が勝つ
        row('2018-09-30', '2019-09-28', 260_174 * M, '2021-10-29', 2021),
        row('2019-09-29', '2020-09-26', 274_515 * M, '2020-10-30', 2020),
        row('2020-09-27', '2021-09-25', 365_817 * M, '2021-10-29', 2021),
        // 10-K/A は採らない（様式は完全一致）
        { ...row('2020-09-27', '2021-09-25', 999 * M, '2022-01-15', 2021, '10-K/A') },
        // 10-Q は採らない
        row('2021-06-27', '2021-09-25', 83_360 * M, '2021-10-29', 2021, '10-Q'),
      ]),
      NetIncomeLoss: units('USD', [
        row('2016-09-25', '2017-09-30', 48_351 * M, '2017-11-03', 2017),
        row('2017-10-01', '2018-09-29', 59_531 * M, '2018-11-05', 2018),
        row('2018-09-30', '2019-09-28', 55_256 * M, '2019-10-31', 2019),
        row('2019-09-29', '2020-09-26', 57_411 * M, '2020-10-30', 2020),
        row('2020-09-27', '2021-09-25', 94_680 * M, '2021-10-29', 2021),
      ]),
      EarningsPerShareDiluted: units('USD/shares', [
        row('2017-10-01', '2018-09-29', 2.98, '2018-11-05', 2018),
        row('2018-09-30', '2019-09-28', 2.97, '2019-10-31', 2019),
        row('2019-09-29', '2020-09-26', 3.28, '2020-10-30', 2020),
        row('2020-09-27', '2021-09-25', 5.61, '2021-10-29', 2021),
      ]),
      // 2017 年度だけ別のタグ（(b) 期末日で統合される）
      EarningsPerShareBasicAndDiluted: units('USD/shares', [
        row('2016-09-25', '2017-09-30', 9.21, '2017-11-03', 2017),
      ]),
      // OperatingIncomeLoss は無い → (e) 営業利益の項目だけ落ちる
    },
  },
}

/** インテル風（MC の実測値 2021〜2025 年度・百万ドル）: 営業利益・純利益がマイナスの年がある */
const INTEL_ENDS = ['2021-12-25', '2022-12-31', '2023-12-30', '2024-12-28', '2025-12-27']
const INTEL_STARTS = ['2020-12-27', '2022-01-01', '2023-01-01', '2023-12-31', '2024-12-29']
const INTEL_OP = [19_456, 2_334, 93, -11_678, -2_214]
const INTEL_NET = [19_868, 8_014, 1_689, -18_756, -267]
const INTEL_EPS = [4.86, 1.94, 0.4, -4.38, -0.06]
const INTEL_REV = [79_024, 63_054, 54_228, 53_101, 52_000]
const intelRows = (vals: number[], scale: number) => INTEL_ENDS.map((end, i) => row(INTEL_STARTS[i], end, vals[i] * scale, `${end.slice(0, 4)}-12-31`.replace(/-12-31$/, '') + '-01-30', Number(end.slice(0, 4)) + 1))
const INTEL_LIKE = {
  cik: 50863,
  entityName: 'INTEL CORP',
  facts: {
    'us-gaap': {
      Revenues: units('USD', intelRows(INTEL_REV, M)),
      OperatingIncomeLoss: units('USD', intelRows(INTEL_OP, M)),
      NetIncomeLoss: units('USD', intelRows(INTEL_NET, M)),
      EarningsPerShareDiluted: units('USD/shares', intelRows(INTEL_EPS, 1)),
    },
  },
}

/** MC の実測値（AAPL 2021〜2025 年度・百万ドル／ドル） */
const AAPL_REV = [365_817, 394_328, 383_285, 391_035, 416_161]
const AAPL_NET = [94_680, 99_803, 96_995, 93_736, 112_010]
const AAPL_EPS = [5.61, 6.11, 6.13, 6.08, 7.46]
const AAPL_ENDS = ['2021-09-25', '2022-09-24', '2023-09-30', '2024-09-28', '2025-09-27']

/** ゴールドマン・サックス風（MC 実測 2026-10-07）: 売上高は RevenuesNetOfInterestExpense だけを持つ（Revenues も契約収益も無い） */
const GS_ENDS = ['2021-12-31', '2022-12-31', '2023-12-31', '2024-12-31', '2025-12-31']
const GS_STARTS = ['2021-01-01', '2022-01-01', '2023-01-01', '2024-01-01', '2025-01-01']
const GS_REV = [59_339, 47_365, 46_254, 53_512, 58_300]
const gsRows = (vals: number[], scale: number) => GS_ENDS.map((end, i) => row(GS_STARTS[i], end, vals[i] * scale, `${Number(end.slice(0, 4)) + 1}-02-20`, Number(end.slice(0, 4))))
const GS_LIKE = {
  cik: 886982,
  entityName: 'GOLDMAN SACHS GROUP INC',
  facts: {
    'us-gaap': {
      RevenuesNetOfInterestExpense: units('USD', gsRows(GS_REV, M)),
      NetIncomeLoss: units('USD', gsRows([21_635, 11_261, 8_516, 14_278, 15_000], M)),
      EarningsPerShareDiluted: units('USD/shares', gsRows([59.45, 30.06, 22.87, 40.54, 43.0], 1)),
    },
  },
}

const DATA_OK: AnnualStatementsData = {
  symbol: 'INTC', cik: '0000050863', entityName: 'INTEL CORP', currency: 'USD', fetchedAt: '2026-10-07T09:00:00.000Z',
  periodEnds: INTEL_ENDS,
  items: [
    { key: 'revenue', label: '売上高', kind: 'money', tags: ['Revenues'], values: INTEL_REV.map(v => v * M) },
    { key: 'operatingIncome', label: '営業利益', kind: 'money', tags: ['OperatingIncomeLoss'], values: INTEL_OP.map(v => v * M) },
    { key: 'netIncome', label: '純利益', kind: 'money', tags: ['NetIncomeLoss'], values: INTEL_NET.map(v => v * M) },
    { key: 'eps', label: '1株あたり利益', kind: 'perShare', tags: ['EarningsPerShareDiluted'], values: INTEL_EPS },
  ],
}

/** 禁止語。「予測」「べき」はレビュー S1 で追加（将来の編集で肯定形の「予測」が入るのを防ぐ） */
const FORBIDDEN = ['割安', '割高', '健全', '危険', '好調', '悪化', '改善傾向', '優良', '要注意', 'おすすめ', '買い時', '売り時', 'スコア', '点数', 'ランク', '予測', 'べき']
/** 唯一の例外: 出所の固定文「将来を予測するものではありません」（否定形・法務の注記）。これだけを取り除いてから禁止語を探す */
const ALLOWED_PHRASE = '将来を予測するものではありません'
const scrub = (s: string) => s.split(ALLOWED_PHRASE).join('')
const forbiddenHits = (s: string) => FORBIDDEN.filter(w => scrub(s).includes(w))
const COLOR_RE = /--success|--danger|text-red|text-green|bg-red|bg-green|text-success|text-danger|#[0-9a-fA-F]{3,8}\b/
const NUM_PCT = /[\d.]+%/

// tsx は CommonJS に変換するので top-level await が使えない → 全体を main() に包む
async function main() {
// ── 0. 対象 ──────────────────────────────────────────────────────────────────
console.log('■ 0. 対象')
for (const f of [...NEW_FILES, PAGE]) check(`${f} がある`, exists(f))
check('既存の scripts/check-statements.ts（/report R2 の検査）を上書きしていない', exists('scripts/check-statements.ts') && read('scripts/check-statements.ts').includes('computeDerived'))

// ── 1. parseCompanyFacts ────────────────────────────────────────────────────
console.log('■ 1. parseCompanyFacts（固定の JSON 断片）')
{
  const p = parseCompanyFacts(APPLE_LIKE)
  check('解析できる', p !== null)
  if (p) {
    check('期末日の昇順・最後の 5 期（2016 年度は落ちる）', j(p.periodEnds) === j(['2017-09-30', '2018-09-29', '2019-09-28', '2020-09-26', '2021-09-25']), j(p.periodEnds))
    const rev = p.items.find(i => i.key === 'revenue')
    const net = p.items.find(i => i.key === 'netIncome')
    const eps = p.items.find(i => i.key === 'eps')
    check('(b) 複数タグが期末日で統合される（2017 年度は SalesRevenueNet・2018 年度から RevenueFromContract…。並びが切れない）',
      !!rev && j(rev.values) === j([229_234 * M, 265_595 * M, 260_174 * M, 274_515 * M, 365_817 * M]), j(rev?.values))
    check('(a) fy:2021 の行でも期末日 2019-09-28 の値として入り、ラベルは 2019年度', !!rev && p.periodEnds[2] === '2019-09-28' && yearLabel(p.periodEnds[2]) === '2019年度' && fiscalYearOf(p.periodEnds[2]) === 2019)
    check('(c) 同じ期末日は filed の新しい方（訂正後 260,174）が勝つ', rev?.values[2] === 260_174 * M)
    check('(d) 10-K に載った四半期（90 日）の行が混ざらない（2018 年度は 265,595 のまま）', rev?.values[1] === 265_595 * M)
    check('10-K/A・10-Q の行は採らない（2021 年度は 365,817 のまま）', rev?.values[4] === 365_817 * M)
    check('(e) OperatingIncomeLoss が無い会社は営業利益の項目だけ落ち、他の 3 項目は残る', p.items.map(i => i.key).join(',') === 'revenue,netIncome,eps', p.items.map(i => i.key).join(','))
    check('純利益は 5 期そろう', !!net && j(net.values) === j([48_351 * M, 59_531 * M, 55_256 * M, 57_411 * M, 94_680 * M]))
    check('1株あたり利益: 2017 年度は EarningsPerShareBasicAndDiluted、2018 年度から EarningsPerShareDiluted（期末日で統合）', !!eps && j(eps.values) === j([9.21, 2.98, 2.97, 3.28, 5.61]), j(eps?.values))
    check('採ったタグを期末日の昇順・重複なしで持つ（売上高=SalesRevenueNet + RevenueFromContract…／1株あたり利益=BasicAndDiluted + Diluted）',
      j(rev?.tags) === j(['SalesRevenueNet', 'RevenueFromContractWithCustomerExcludingAssessedTax']) && j(eps?.tags) === j(['EarningsPerShareBasicAndDiluted', 'EarningsPerShareDiluted']) && j(net?.tags) === j(['NetIncomeLoss']), j(p.items.map(i => i.tags)))
    check('会社名と CIK（10 桁ゼロ埋め）', p.entityName === 'Apple Inc.' && p.cik === '0000320193')
  }
  const gs = parseCompanyFacts(GS_LIKE)
  check('ゴールドマン風: RevenuesNetOfInterestExpense しか無くても売上高の行が出る（最新 58,300 百万ドル・タグ名を持つ）',
    !!gs && gs.items.map(i => i.key).join(',') === 'revenue,netIncome,eps' && gs.items[0].values[4] === 58_300 * M && j(gs.items[0].tags) === j(['RevenuesNetOfInterestExpense']), j(gs?.items.map(i => [i.key, i.tags, i.values[4]])))
  const q = parseCompanyFacts(INTEL_LIKE)
  check('インテル風: 4 項目すべて取れ、マイナスの値がそのまま入る', !!q && q.items.length === 4 && j(q.items.find(i => i.key === 'operatingIncome')?.values) === j(INTEL_OP.map(v => v * M)) && j(q.items.find(i => i.key === 'netIncome')?.values) === j(INTEL_NET.map(v => v * M)) && j(q.items.find(i => i.key === 'eps')?.values) === j(INTEL_EPS))
  // 年ごとの欠け: 最新年の EPS だけ無い → null で残る（項目は落ちない）
  const partial = JSON.parse(JSON.stringify(INTEL_LIKE)) as typeof INTEL_LIKE
  partial.facts['us-gaap'].EarningsPerShareDiluted.units['USD/shares'].pop()
  const pp = parseCompanyFacts(partial)
  check('(罠4) 年ごとの欠けは null で残り、項目は落ちない', !!pp && j(pp.items.find(i => i.key === 'eps')?.values) === j([4.86, 1.94, 0.4, -4.38, null]) && pp.periodEnds.length === 5)
  // 同じ期末日・同じ filed で 2 つのタグ → 先の候補タグ（総収益 Revenues）が勝つ
  const tie = { cik: 1, entityName: 'T', facts: { 'us-gaap': {
    RevenueFromContractWithCustomerExcludingAssessedTax: units('USD', [row('2024-01-01', '2024-12-31', 100, '2025-02-01', 2024)]),
    Revenues: units('USD', [row('2024-01-01', '2024-12-31', 120, '2025-02-01', 2024)]),
  } } }
  check('同じ期末日・同じ filed なら先の候補タグ（Revenues＝総収益）が勝つ', parseCompanyFacts(tie)?.items[0]?.values[0] === 120 && j(parseCompanyFacts(tie)?.items[0]?.tags) === j(['Revenues']))
  // 期間の境界: 300 日・400 日ちょうどは外、301・399 は中
  const dur = (start: string, end: string) => parseCompanyFacts({ facts: { 'us-gaap': { Revenues: units('USD', [row(start, end, 1, '2025-01-01', 2024)]) } } })?.items.length ?? -1
  check('期間 300 日ちょうど・400 日ちょうどは外、301 日・399 日は中', dur('2024-03-06', '2024-12-31') === 0 && dur('2023-11-27', '2024-12-31') === 0 && dur('2024-03-05', '2024-12-31') === 1 && dur('2023-11-28', '2024-12-31') === 1)
  check('start・filed が無い行、val が数値でない行は採らない', parseCompanyFacts({ facts: { 'us-gaap': { Revenues: { units: { USD: [{ end: '2024-12-31', val: 1, form: '10-K', filed: '2025-01-01' }, { start: '2024-01-01', end: '2024-12-31', val: 'x', form: '10-K', filed: '2025-01-01' }, { start: '2024-01-01', end: '2024-12-31', val: 1, form: '10-K' }] } } } } })?.items.length === 0)
  check('形が違う JSON は null・us-gaap が空なら items 空', parseCompanyFacts(null) === null && parseCompanyFacts({}) === null && parseCompanyFacts({ facts: {} }) === null && parseCompanyFacts({ facts: { 'us-gaap': {} } })?.items.length === 0)
  check('6 期あれば最後の 5 期（PERIOD_COUNT）・periods 引数で変えられる', PERIOD_COUNT === 5 && parseCompanyFacts(APPLE_LIKE, ANNUAL_ITEMS, 3)?.periodEnds.length === 3)
  check('候補タグの定義は MC の順（売上高は Revenues 先頭・RevenuesNetOfInterestExpense を含む 5 つ）・EBITDA は無い', ANNUAL_ITEMS.map(d => d.tags.join('|')).join(';') === 'Revenues|RevenueFromContractWithCustomerExcludingAssessedTax|RevenuesNetOfInterestExpense|SalesRevenueNet|RevenueFromContractWithCustomerIncludingAssessedTax;OperatingIncomeLoss;NetIncomeLoss|ProfitLoss;EarningsPerShareDiluted|EarningsPerShareBasicAndDiluted' && !read(LIB).includes('Ebitda') && !read(LIB).toUpperCase().includes('EBITDA ='))
  check('companyFactsUrl は CIK 10 桁ゼロ埋め', companyFactsUrl(320193) === `${SEC_COMPANYFACTS_BASE}CIK0000320193.json`)
}

// ── 2. 整形と yoyLine ───────────────────────────────────────────────────────
console.log('■ 2. 金額の整形（MC の実測値を固定入力に）と yoyLine の分岐')
{
  check('AAPL 売上高 2025 年度 416,161 百万ドル → $416.2B', formatValue(AAPL_REV[4] * M, 'money') === '$416.2B', formatValue(AAPL_REV[4] * M, 'money'))
  check('AAPL 純利益 2021 年度 94,680 百万ドル → $94.7B', formatValue(AAPL_NET[0] * M, 'money') === '$94.7B')
  check('AAPL 1株あたり利益 2025 年度 7.46 → $7.46', formatValue(AAPL_EPS[4], 'perShare') === '$7.46')
  check('AAPL の期末日（9 月末・年ごとに日付が違う）→ 年ラベルは期末日の年（2021年度〜2025年度）', AAPL_ENDS.map(e => yearLabel(e)).join(',') === '2021年度,2022年度,2023年度,2024年度,2025年度' && AAPL_ENDS.map(e => yearLabel(e, true)).join(',') === '21年度,22年度,23年度,24年度,25年度')
  check('INTC 純利益 2025 年度 −267 百万ドル → −$267.0M（U+2212）', formatValue(INTEL_NET[4] * M, 'money') === `${MINUS}$267.0M`, formatValue(INTEL_NET[4] * M, 'money'))
  check('INTC 営業利益 2024 年度 −11,678 百万ドル → −$11.7B', formatValue(INTEL_OP[3] * M, 'money') === `${MINUS}$11.7B`)
  check('INTC 営業利益 2023 年度 93 百万ドル → $93.0M', formatValue(INTEL_OP[2] * M, 'money') === '$93.0M')
  check('INTC 1株あたり利益 2025 年度 −0.06 → −$0.06', formatValue(INTEL_EPS[4], 'perShare') === `${MINUS}$0.06`)
  check('1e6 未満は $X,XXX・ゼロは ±$0', formatValue(123_456, 'money') === '$123,456' && formatValue(0, 'money') === '±$0' && formatValue(0, 'perShare') === '±$0')
  check('999.96M は $1.0B に繰り上げる（$1000.0M を出さない）', formatValue(999_960_000, 'money') === '$1.0B')
  check('signWord: 負→赤字・正→黒字・0→null', signWord(-1) === '赤字' && signWord(1) === '黒字' && signWord(0) === null)
  check('formatPct: +5.4% / −60.1% / ±0.0%', formatPct(AAPL_NET[1] / AAPL_NET[0] - 1) === '+5.4%' && formatPct(1.94 / 4.86 - 1) === `${MINUS}60.1%` && formatPct(0.0004) === '±0.0%')

  const l1 = yoyLine(null, 100, 'money', 2025)
  const l1b = yoyLine(100, null, 'money', 2025)
  const l2 = yoyLine(INTEL_NET[3] * M, INTEL_NET[4] * M, 'money', 2025)
  const l2b = yoyLine(INTEL_OP[3] * M, INTEL_OP[4] * M, 'money', 2025)
  const l2c = yoyLine(-2_214 * M, -11_678 * M, 'money', 2025)
  const l2d = yoyLine(INTEL_EPS[3], INTEL_EPS[4], 'perShare', 2025)
  const l3 = yoyLine(-1 * M, 5 * M, 'money', 2025)
  const l4 = yoyLine(INTEL_NET[2] * M, INTEL_NET[3] * M, 'money', 2024)
  const l5 = yoyLine(0, 5 * M, 'money', 2025)
  const l6 = yoyLine(AAPL_NET[0] * M, AAPL_NET[1] * M, 'money', 2022)
  const l6b = yoyLine(INTEL_EPS[0], INTEL_EPS[1], 'perShare', 2022)
  check('分岐1 どちらか欠け → 「前の年の数字が取れていません。」', l1 === '前の年の数字が取れていません。' && l1b === '2025年度 の数字が取れていません。', `${l1} / ${l1b}`)
  check('分岐2 両方マイナス（INTC 純利益 2024→2025）→ 前の年は −$18.8B。1年で $18.5B 増えました。何%かは出さない',
    l2 === `前の年は ${MINUS}$18.8B。1年で $18.5B 増えました。何%かは、前の年が赤字なので出しません。` && !NUM_PCT.test(l2), l2)
  check('分岐2 両方マイナス（INTC 営業利益 2024→2025）→ $9.5B 増えました', l2b === `前の年は ${MINUS}$11.7B。1年で $9.5B 増えました。何%かは、前の年が赤字なので出しません。` && !NUM_PCT.test(l2b), l2b)
  check('分岐2 両方マイナスで減った → 減りました', l2c.includes('減りました') && !NUM_PCT.test(l2c), l2c)
  check('分岐2 1株あたり（INTC 2024→2025）→ 前の年は −$4.38。1年で $4.32 増えました', l2d === `前の年は ${MINUS}$4.38。1年で $4.32 増えました。何%かは、前の年が赤字なので出しません。`, l2d)
  check('分岐3 前がマイナス・今がプラス → 前の年は赤字（−$1.0M）、2025年度 は黒字（$5.0M）です。', l3 === `前の年は赤字（${MINUS}$1.0M）、2025年度 は黒字（$5.0M）です。` && !NUM_PCT.test(l3), l3)
  check('分岐4 前がプラス・今がマイナス（INTC 純利益 2023→2024）→ 前の年は黒字（$1.7B）、2024年度 は赤字（−$18.8B）です。', l4 === `前の年は黒字（$1.7B）、2024年度 は赤字（${MINUS}$18.8B）です。` && !NUM_PCT.test(l4), l4)
  check('分岐5 前が 0 → 前の年が 0 なので、何%かは出しません。', l5 === '前の年が 0 なので、何%かは出しません。' && !NUM_PCT.test(l5), l5)
  check('分岐6 両方プラス（AAPL 純利益 2021→2022）→ 前の年は $94.7B。前年比 +5.4% です。', l6 === '前の年は $94.7B。前年比 +5.4% です。', l6)
  check('分岐6 両方プラスで減った（INTC EPS 2021→2022）→ 前年比 −60.1%（U+2212）', l6b === `前の年は $4.86。前年比 ${MINUS}60.1% です。`, l6b)
  const all = [l1, l1b, l2, l2b, l2c, l2d, l3, l4, l5, l6, l6b]
  check('前年がマイナス・ゼロのとき % の数字を返さない（分岐 1〜5 すべて）', [l1, l1b, l2, l2b, l2c, l2d, l3, l4, l5].every(s => !NUM_PCT.test(s)))
  check('↑↓ の矢印・ハイフンのマイナスを使わない（全分岐）', all.every(s => !/[↑↓]/.test(s) && !/-\$/.test(s)))
  check('優劣の語が無い（全分岐）', all.every(s => !FORBIDDEN.some(w => s.includes(w))))
}

// ── 3. barGeometry ──────────────────────────────────────────────────────────
console.log('■ 3. barGeometry')
{
  const g = barGeometry([100, -50, null, 0, 25], 58)
  const pos = g.bars[0]!, neg = g.bars[1]!
  check('正負で同じ倍率（k = plotH / (maxPos + maxNeg)）', Math.abs(g.k - 58 / 150) < 1e-12 && Math.abs(pos.h / 100 - neg.h / 50) < 1e-9 && Math.abs(pos.h / 100 - g.k) < 1e-12, j(g))
  check('黒字はゼロ線から上（y = zeroY − h）・赤字はゼロ線から下（y = zeroY）', Math.abs(pos.y + pos.h - g.zeroY) < 1e-9 && !pos.negative && neg.y === g.zeroY && neg.negative)
  check('最大の正の棒の上端が 0・最大の負の棒の下端が plotH', Math.abs(pos.y) < 1e-9 && Math.abs(neg.y + neg.h - 58) < 1e-9)
  check('欠損は null・0 は高さ 0 の棒', g.bars[2] === null && g.bars[3]?.h === 0)
  const z = barGeometry([0, 0, null], 58)
  check('全部 0／欠損なら k = 0・ゼロ線は下端', z.k === 0 && z.zeroY === 58 && z.bars[2] === null)
  const allNeg = barGeometry([-10, -20], 58)
  check('全部マイナスならゼロ線は上端', allNeg.zeroY === 0 && allNeg.bars[1]?.h === 58)
}

// ── 4〜6・8・9. 部品の源と静的描画 ───────────────────────────────────────────
console.log('■ 4. 色: --success／--danger／text-red／text-green／# 始まりの色が無い')
for (const f of [SECTION, BARS]) {
  const src = stripComments(read(f))
  check(`${f}: 色の直値・損益の色が無い`, !COLOR_RE.test(src), (src.match(COLOR_RE) ?? []).join(','))
  check(`${f}: 回り続ける動き（animate-）が無い（check-theme.ts R4 の許可リストに入れない）`, !src.includes('animate-'))
}
check(`${BARS}: --warning-ink も使わない（図の中に注意の色を置かない）`, !read(BARS).includes('warning'))
check(`${SECTION}: --warning-ink は失敗の見出し 1 か所だけ（§6-12）`, count(stripComments(read(SECTION)), 'text-warning-ink') === 1 && /text-warning-ink">\{FAILED_TITLE\}/.test(read(SECTION)))
check(`${BARS}: 黒字＝中空（fill --card・stroke --ink）／赤字＝--ink の塗り`, read(BARS).includes('fill="var(--card)" stroke="var(--ink)" strokeWidth={1}') && read(BARS).includes('fill="var(--ink)" />'))

console.log('■ 5. 禁止語が無い（「予測」「べき」を含む。例外は出所の固定文「将来を予測するものではありません」だけ）')
for (const f of NEW_FILES) {
  const hits = forbiddenHits(read(f))
  check(`${f}: 禁止語が無い（注釈も含めて）`, hits.length === 0, hits.join(','))
}
check('例外は SOURCE_NOTE の否定形 1 か所だけ（肯定形の「予測」は無い）', count(read(SECTION), '予測') === 1 && read(SECTION).includes(ALLOWED_PHRASE) && SOURCE_NOTE.includes(ALLOWED_PHRASE))

console.log('■ 6. YearBars: role="img" と aria-label')
{
  const src = read(BARS)
  check(`${BARS}: role="img" と aria-label がある`, src.includes('role="img"') && src.includes('aria-label={aria}'))
  check(`${BARS}: 'use client'・ResizeObserver＋viewBox（PlanVsActualBars と同じ型）・Date.now／fetch を持たない`, /^'use client'/.test(src) && src.includes('ResizeObserver') && src.includes('viewBox={`0 0 ${W} ${H}`}') && !stripComments(src).includes('Date.now') && !stripComments(src).includes('fetch('))
  const html = renderToStaticMarkup(React.createElement(YearBars, { label: '純利益', ends: INTEL_ENDS, values: INTEL_NET.map(v => v * M), kind: 'money', initialWidth: 640 }))
  check('描画: role="img"＋aria-label に 5 期の値と赤字／黒字の語', /<div role="img" aria-label="純利益の5期の棒グラフ。2021年度 \$19\.9B（黒字）、2022年度 \$8\.0B（黒字）、2023年度 \$1\.7B（黒字）、2024年度 −\$18\.8B（赤字）、2025年度 −\$267\.0M（赤字）。横の線が 0 で/.test(html), html.slice(0, 300))
  check('描画: 棒は 5 本（黒字 3 本は中空・赤字 2 本は塗り）', count(html, '<rect') === 5 && (html.match(/<rect[^>]*fill="var\(--card\)" stroke="var\(--ink\)"/g) ?? []).length === 3 && (html.match(/<rect[^>]*fill="var\(--ink\)"/g) ?? []).length === 2)
  check('描画: ゼロ線は 1 本（--axis）・水平グリッド線は無い', count(html, '<line') === 1 && html.includes('stroke="var(--axis)"'))
  check('描画: 年ラベルは 5 つ・最下段（y=85）に固定・「2025年度」', count(html, 'y="85"') === 5 && html.includes('>2025年度</text>'))
  check('描画: 直接の値ラベルは最新年だけ（−$267.0M）', count(html, '>−$267.0M</text>') === 1 && !html.includes('>$19.9B</text>'))
  // 赤字の年の棒はゼロ線より下（y == zeroY）、黒字の年はゼロ線より上（y + h == zeroY）
  const rects = [...html.matchAll(/<rect x="[^"]+" y="([^"]+)" width="[^"]+" height="([^"]+)"/g)].map(m => ({ y: Number(m[1]), h: Number(m[2]) }))
  const zero = Number(/<line[^>]*y1="([^"]+)"/.exec(html)![1])
  check('描画: 黒字の棒の下端＝ゼロ線・赤字の棒の上端＝ゼロ線（位置で正負）', rects.length === 5 && rects.slice(0, 3).every(r => Math.abs(r.y + r.h - zero) < 0.01) && rects.slice(3).every(r => Math.abs(r.y - zero) < 0.01), j({ rects, zero }))
  const narrow = renderToStaticMarkup(React.createElement(YearBars, { label: '純利益', ends: INTEL_ENDS, values: INTEL_NET.map(v => v * M), kind: 'money', initialWidth: 200 }))
  check('描画: 狭い幅では年ラベルを「25年度」に落とす', narrow.includes('>25年度</text>') && !narrow.includes('>2025年度</text>'))
  const gap = renderToStaticMarkup(React.createElement(YearBars, { label: '1株あたり利益', ends: INTEL_ENDS, values: [4.86, null, 0.4, -4.38, -0.06], kind: 'perShare', initialWidth: 640 }))
  check('描画: 欠損の年は棒を描かずゼロ線上に「—」', count(gap, '<rect') === 4 && gap.includes('>—</text>'))
  const zeroes = renderToStaticMarkup(React.createElement(YearBars, { label: 'x', ends: ['2024-12-31'], values: [0], kind: 'money', initialWidth: 300 }))
  check('描画: 値 0 の年は ±$0 のラベル・棒は描かない', zeroes.includes('>±$0</text>') && count(zeroes, '<rect') === 0)
}

console.log('■ 7・8・9. 節の静的描画: 出所は無条件・見出しは text-h2 text-ink・U+2212')
{
  const ok = renderToStaticMarkup(React.createElement(AnnualStatementsView, { state: { status: 'ok', data: DATA_OK } }))
  const loading = renderToStaticMarkup(React.createElement(AnnualStatementsView, { state: { status: 'loading', slow: false } }))
  const slow = renderToStaticMarkup(React.createElement(AnnualStatementsView, { state: { status: 'loading', slow: true } }))
  const empty = renderToStaticMarkup(React.createElement(AnnualStatementsView, { state: { status: 'empty' } }))
  const failedHtml = renderToStaticMarkup(React.createElement(AnnualStatementsView, { state: { status: 'failed' } }))
  const H2 = `<h2 class="text-h2 text-ink">${SECTION_TITLE}</h2>`
  check('8. 見出しは <h2 className="text-h2 text-ink">1年ごとの決算</h2>（源）', read(SECTION).includes('<h2 className="text-h2 text-ink">{SECTION_TITLE}</h2>') && SECTION_TITLE === '1年ごとの決算')
  check('8. 見出しは 4 状態すべてで描かれる', [ok, loading, slow, empty, failedHtml].every(h => h.includes(H2)))
  check('見出しの直下に 1 回だけ説明の 1 文（text-small text-muted・max-w-[42rem]）', [ok, loading, empty, failedHtml].every(h => count(h, SECTION_LEAD) === 1 && h.includes(`<p class="text-small text-muted max-w-[42rem]">${SECTION_LEAD}</p>`)) && SECTION_LEAD === '塗りつぶした年は赤字（マイナス）、枠だけの年は黒字（プラス）です。横の線が 0 です。')
  check('7. 出所（figcaption・text-caption text-muted）: 会社名・SEC EDGAR・10-K・米国会計基準・連結・米ドル・取得日・各決算期の終了日', /<figcaption class="[^"]*text-caption text-muted[^"]*">/.test(ok) && ok.includes('出所: INTEL CORP（SEC EDGAR・10-K・米国会計基準・連結・米ドル）／2026-10-07 取得／各決算期の終了日: 2021-12-25, 2022-12-31, 2023-12-30, 2024-12-28, 2025-12-27'))
  check('7. 出所の固定文（当社の分析や評価は含まれていません・将来を予測するものではありません）', ok.includes(SOURCE_NOTE) && SOURCE_NOTE.includes('将来を予測するものではありません') && SOURCE_NOTE.includes('当社の分析や評価は含まれていません'))
  check('7. 出所を畳まない・薄くしない（<details・opacity-・figcaption に aria-hidden が無い）', !ok.includes('<details') && !ok.includes('opacity-') && !/<figcaption[^>]*aria-hidden/.test(ok))
  check('7. 出所は条件分岐の外（源で {…&& の内側にない）', /<figcaption className="mx-4 border-t border-border py-3 space-y-1 text-caption text-muted">/.test(read(SECTION)))
  check('帯 1 本（bg-card rounded-card border border-border）の中に mx-4 border-t の区切りで 4 項目。帯の中に帯を入れない', count(ok, 'bg-card rounded-card') === 1 && count(ok, 'mx-4 border-t border-border first:border-t-0 py-4') === 4)
  check('各項目: 項目名（text-small font-semibold text-ink）・最新年の値（text-h1 … tabular-nums）＋語・期末日（text-caption text-muted）・前年比の 1 文（text-small text-ink-2）',
    count(ok, '<p class="text-small font-semibold text-ink">') === 4 && count(ok, 'class="text-h1 tabular-nums text-ink"') === 4 && count(ok, '<p class="text-caption text-muted tabular-nums">2025年度（期末 2025-12-27）</p>') === 4 && count(ok, '<p class="text-small text-ink-2 max-w-[42rem]">') === 4)
  check('最新年の値: 売上高 $52.0B 黒字・営業利益 −$2.2B 赤字・純利益 −$267.0M 赤字・1株あたり利益 −$0.06 赤字', ok.includes('>$52.0B</span><span class="text-small text-muted">黒字</span>') && ok.includes(`>${MINUS}$2.2B</span><span class="text-small text-muted">赤字</span>`) && ok.includes(`>${MINUS}$267.0M</span><span class="text-small text-muted">赤字</span>`) && ok.includes(`>${MINUS}$0.06</span><span class="text-small text-muted">赤字</span>`))
  check('9. マイナスは U+2212（MINUS の文字コードが 0x2212・描画にハイフン＋$ が無い・display.ts にハイフンの符号が無い）', MINUS.length === 1 && MINUS.charCodeAt(0) === 0x2212 && ok.includes(MINUS) && !/-\$/.test(ok) && !stripComments(read(DISPLAY)).includes("'-'") && !stripComments(read(DISPLAY)).includes('`-'))
  check('前年比の 1 文（INTC 2025）: 純利益は「1年で $18.5B 増えました。何%かは…出しません」・営業利益は「$9.5B 増えました」', ok.includes(`前の年は ${MINUS}$18.8B。1年で $18.5B 増えました。何%かは、前の年が赤字なので出しません。`) && ok.includes(`前の年は ${MINUS}$11.7B。1年で $9.5B 増えました。`))
  check('％バッジ・矢印が無い', !/[↑↓]/.test(ok) && !/<span[^>]*>[+−][\d.]+%<\/span>/.test(ok))
  check('棒グラフは 4 つ（role="img"）', count(ok, 'role="img"') === 4)
  check('禁止語・優劣の語が描画に無い', forbiddenHits(ok).length === 0 && !/買い|売り/.test(ok), forbiddenHits(ok).join(','))
  // レビュー 2: 使ったタグ名を出所に無条件で出す
  check('出所: 「使用した項目: 売上高=Revenues／営業利益=OperatingIncomeLoss／純利益=NetIncomeLoss／1株あたり利益=EarningsPerShareDiluted」', ok.includes('使用した項目: 売上高=Revenues／営業利益=OperatingIncomeLoss／純利益=NetIncomeLoss／1株あたり利益=EarningsPerShareDiluted'))
  check('出所: タグ名の行は figcaption の中・条件分岐の外（源）', /<figcaption[^>]*>[\s\S]*?使用した項目: \{data\.items\.map\(it => `\$\{it\.label\}=\$\{it\.tags\.join\(' \+ '\)\}`\)\.join\('／'\)\}[\s\S]*?<\/figcaption>/.test(read(SECTION)) && !/\{[^}]*&&[^}]*使用した項目/.test(read(SECTION)))
  const twoTags: AnnualStatementsData = { ...DATA_OK, items: [{ ...DATA_OK.items[0], tags: ['SalesRevenueNet', 'RevenueFromContractWithCustomerExcludingAssessedTax'] }] }
  const twoHtml = renderToStaticMarkup(React.createElement(AnnualStatementsView, { state: { status: 'ok', data: twoTags } }))
  check('出所: 期末日ごとに別のタグが採られたときは「A + B」で並べる', twoHtml.includes('使用した項目: 売上高=SalesRevenueNet + RevenueFromContractWithCustomerExcludingAssessedTax'))
  // タグ名（英語の識別子）の説明の 1 文。節（figcaption）が出るときは、項目の数・タグの数に依らず必ず「使用した項目」の直後に描く
  const TAG_NOTE_P = `<p class="text-caption text-muted">${TAG_NOTE}</p>`
  const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const afterTags = (h: string) => new RegExp('<figcaption[^>]*>[\\s\\S]*?使用した項目: [^<]*</p>' + escRe(TAG_NOTE_P) + '[\\s\\S]*?</figcaption>').test(h)
  check('出所: 「会社によって、決算書で使う項目の名前が違います。…」が「使用した項目」の直後・figcaption の中に無条件で描かれる（4 項目・3 項目・タグ 2 つのどの場合も）',
    TAG_NOTE === '会社によって、決算書で使う項目の名前が違います。上は、その会社が実際に使っていた名前です。' && [ok, twoHtml].every(afterTags) && count(ok, TAG_NOTE) === 1)
  check('出所: 説明の 1 文は源で条件分岐の外・<details／opacity-／aria-hidden で畳まない・薄めない', read(SECTION).includes('<p className="text-caption text-muted">{TAG_NOTE}</p>') && !/\{[^}]*&&[^}]*TAG_NOTE/.test(read(SECTION)) && !/<p[^>]*(?:opacity-|aria-hidden)[^>]*>\{TAG_NOTE\}/.test(read(SECTION)))
  check('読込中: 動かない骨組み（aria-busy・4 行）。3 秒を超えたら「取得しています」', loading.includes('aria-busy="true"') && count(loading, 'h-[88px]') === 4 && !loading.includes('取得しています') && slow.includes('SEC EDGAR から決算の数値を取得しています'))
  check('空: 10-K のデータに見つからなかったことを書く（仮の数字を出さない）', empty.includes(EMPTY_TEXT) && !empty.includes('<rect') && !empty.includes('$'))
  check('失敗: 何が起きたか（--warning-ink）／データはどうなったか／どうすればいいか（§6-12 の三点）・仮の数字を出さない', failedHtml.includes(`<p class="text-body text-warning-ink">${FAILED_TITLE}</p>`) && failedHtml.includes('代わりの数字は作らず、ここで止めます。') && failedHtml.includes('時間をおいて再読み込みしてください。') && !failedHtml.includes('<rect'))
  // 欠けのある会社（JPM 風: 営業利益が無い）→ その行だけ無い
  const jpm: AnnualStatementsData = { ...DATA_OK, entityName: 'JPMORGAN CHASE & CO', items: DATA_OK.items.filter(i => i.key !== 'operatingIncome') }
  const jpmHtml = renderToStaticMarkup(React.createElement(AnnualStatementsView, { state: { status: 'ok', data: jpm } }))
  check('(罠4) 営業利益が無い会社はその行だけ出ず、節は出る（3 項目）・タグ名の行も 3 項目・説明の 1 文もある', count(jpmHtml, 'role="img"') === 3 && !jpmHtml.includes('営業利益') && jpmHtml.includes(SOURCE_NOTE) && jpmHtml.includes('使用した項目: 売上高=Revenues／純利益=NetIncomeLoss／1株あたり利益=EarningsPerShareDiluted') && afterTags(jpmHtml))
  const src = read(SECTION)
  check(`${SECTION}: 'use client'・sec-xbrl からは型だけ import（store.ts→server-only をクライアントに引き込まない）`, /^'use client'/.test(src) && /import type \{[^}]*\} from '@\/lib\/statements\/sec-xbrl'/.test(src) && !/import \{[^}]*\} from '@\/lib\/statements\/sec-xbrl'/.test(src))
  check(`${SECTION}: .T は節ごと出さない（null）`, src.includes("/\\.T$/i.test(symbol)") && src.includes('if (jp) return null'))
  check(`${SECTION}: API は /api/stocks/[symbol]/statements だけ・Yahoo の getStatements を呼ばない（注釈を除く）`, src.includes('/api/stocks/${encodeURIComponent(symbol)}/statements') && !stripComments(src).includes('getStatements') && !stripComments(src).includes('lib/market'))
  check(`${SECTION}: <details・font-bold・12px 未満の文字が無い`, !src.includes('<details') && !src.includes('font-bold') && !/text-\[(?:[0-9]|1[01])px\]/.test(src))
}

// ── 取得口（偽の fetch・通信しない） ────────────────────────────────────────
console.log('■ 取得口: 偽の fetch で通す（通信しない）')
{
  function memoryCache(): SourceCache & { map: Map<string, CacheEntry> } {
    const map = new Map<string, CacheEntry>()
    return {
      map,
      async get(source, key) { return map.get(`${source}:${key}`) ?? null },
      async put(source, key, payload, fetchedAt) { map.set(`${source}:${key}`, { payload, fetchedAt }) },
    }
  }
  const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  const TICKERS = { '0': { cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.' }, '1': { cik_str: 50863, ticker: 'INTC', title: 'INTEL CORP' } }
  const NOW = Date.parse('2026-10-07T09:00:00.000Z')

  const calls: { url: string; ua: string | undefined }[] = []
  const fakeFetch = (bodies: Record<string, unknown | number>): typeof fetch => (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const headers = init?.headers as Record<string, string> | undefined
    calls.push({ url, ua: headers?.['User-Agent'] })
    const b = bodies[url]
    if (typeof b === 'number') return jsonResponse({ error: 'x' }, b)
    if (b === undefined) return jsonResponse({}, 404)
    return jsonResponse(b)
  }) as typeof fetch
  const deps = (over: Partial<SecXbrlDeps> = {}): SecXbrlDeps => ({
    fetch: fakeFetch({ [SEC_TICKERS_URL]: TICKERS, [companyFactsUrl(320193)]: APPLE_LIKE, [companyFactsUrl(50863)]: INTEL_LIKE }),
    cache: memoryCache(), now: () => NOW, contactEmail: 'dev@example.com', ...over,
  })

  await (async () => {
    calls.length = 0
    const noMail = await fetchAnnualStatements('AAPL', deps({ contactEmail: undefined }))
    check('連絡先（SEC_CONTACT_EMAIL）が無ければ取りに行かず failed', noMail.status === 'failed' && calls.length === 0)
    const jp = await fetchAnnualStatements('7203.T', deps())
    check('.T は empty（not-us）・取りに行かない', jp.status === 'empty' && jp.reason === 'not-us' && calls.length === 0)

    const cache = memoryCache()
    const ok = await fetchAnnualStatements('AAPL', deps({ cache }))
    check('AAPL: ok・4 項目のうち営業利益を除く 3 項目・5 期・会社名・fetchedAt', ok.status === 'ok' && ok.statements.items.map(i => i.key).join(',') === 'revenue,netIncome,eps' && ok.statements.periodEnds.length === 5 && ok.statements.entityName === 'Apple Inc.' && ok.statements.fetchedAt === new Date(NOW).toISOString() && ok.statements.symbol === 'AAPL' && ok.statements.currency === 'USD', j(ok))
    check('User-Agent は investsim (<連絡先>)・取りに行くのは表と companyfacts の 2 本（この順）', calls.length === 2 && calls.every(c => c.ua === 'investsim (dev@example.com)') && calls[0].url === SEC_TICKERS_URL && calls[1].url === companyFactsUrl(320193))
    const tick = cache.map.get('sec:company_tickers')
    const facts = cache.map.get(`sec:${companyFactsCacheKey(320193)}`)
    check('控え: ティッカー表は sec.ts と同じ鍵（sec/company_tickers）に解析後の表・companyfacts は解析後の小さな結果（8 MB の本体を入れない）',
      !!tick && (tick.payload as Record<string, unknown>).AAPL !== undefined && !!facts && 'items' in (facts.payload as object) && !('facts' in (facts.payload as object)))
    check('控えの鍵に版が入る（companyfacts:v1:{CIK}。形を変えたら上げる）', companyFactsCacheKey(320193) === 'companyfacts:v1:0000320193' && COMPANYFACTS_CACHE_VERSION === 'v1' && [...cache.map.keys()].some(k => k === 'sec:companyfacts:v1:0000320193'))
    calls.length = 0
    const again = await fetchAnnualStatements('INTC', deps({ cache }))
    check('2 回目: ティッカー表は控えから（取りに行くのは companyfacts だけ）', again.status === 'ok' && calls.length === 1 && calls[0].url === companyFactsUrl(50863))
    calls.length = 0
    const third = await fetchAnnualStatements('INTC', deps({ cache }))
    check('3 回目: companyfacts も控えから（取りに行かない）・fetchedAt は控えを取った時刻', third.status === 'ok' && calls.length === 0 && third.statements.fetchedAt === new Date(NOW).toISOString())

    const unknown = await fetchAnnualStatements('ZZZZ', deps({ cache }))
    check('SEC の表に無いティッカーは empty（unknown-ticker）', unknown.status === 'empty' && unknown.reason === 'unknown-ticker')

    const noData = await fetchAnnualStatements('AAPL', deps({ fetch: fakeFetch({ [SEC_TICKERS_URL]: TICKERS, [companyFactsUrl(320193)]: { cik: 320193, entityName: 'X', facts: { 'us-gaap': {} } } }) }))
    check('10-K の年次の行が無ければ empty（no-data）', noData.status === 'empty' && noData.reason === 'no-data')

    calls.length = 0
    const c2 = memoryCache()
    const down = await fetchAnnualStatements('AAPL', deps({ cache: c2, fetch: fakeFetch({ [SEC_TICKERS_URL]: TICKERS, [companyFactsUrl(320193)]: 503 }) }))
    const failKey = `sec:${companyFactsCacheKey(320193)}`
    check('companyfacts が 503 → リトライ 1 回のあと failed（empty に化けない）・失敗を控える', down.status === 'failed' && calls.filter(c => c.url === companyFactsUrl(320193)).length === 2 && !!c2.map.get(failKey) && (c2.map.get(failKey)!.payload as { failed?: boolean }).failed === true)
    calls.length = 0
    const stillDown = await fetchAnnualStatements('AAPL', deps({ cache: c2 }))
    check('失敗の控えが新しいうちは取りに行かず failed', stillDown.status === 'failed' && calls.length === 0)
    const later = await fetchAnnualStatements('AAPL', deps({ cache: c2, now: () => NOW + 25 * 60 * 60 * 1000 }))
    check('25 時間後は失敗の控えを捨てて取り直し ok', later.status === 'ok')
  })()

  const lib = stripComments(read(LIB))
  check(`${LIB}: Yahoo を使わない（lib/market・yahoo・getStatements の import が無い）`, !lib.includes('lib/market') && !/yahoo/i.test(lib) && !lib.includes('getStatements'))
  check(`${LIB}: padCik／normalizeTicker／parseTickerMap／SEC_TICKERS_URL／SEC_TICKERS_TTL_MS を sec.ts から再利用（複製しない）`, /import \{[^}]*normalizeTicker[^}]*padCik[^}]*parseTickerMap[^}]*\} from '@\/lib\/review\/primary-sources\/sec'/.test(lib) && !lib.includes('function padCik') && !lib.includes('function parseTickerMap') && !lib.includes('function normalizeTicker'))
  check(`${LIB}: 取得先は data.sec.gov（allowlist の isFetchSourceUrl を通す）`, lib.includes("'https://data.sec.gov/api/xbrl/companyfacts/'") && lib.includes('isFetchSourceUrl(url)'))
  check(`${LIB}: fy／fp を鍵・並びに使わない（end と filed だけ）`, !/\.fy\b/.test(lib) && !/\.fp\b/.test(lib) && lib.includes('r.filed > cur.filed') && lib.includes('byEnd.get(r.end)'))
  check(`${LIB}: 1 回の待ちは 12 秒（2 本 × 2 回 = 最悪 48 秒 < route の 60 秒）`, FETCH_TIMEOUT_MS === 12_000 && lib.includes('AbortSignal.timeout(FETCH_TIMEOUT_MS)') && !lib.includes('20_000'))
}

// ── API ルートとページ ─────────────────────────────────────────────────────
console.log('■ API ルート・ページの差し込み')
{
  const route = stripComments(read(ROUTE))
  check(`${ROUTE}: runtime = 'nodejs'・maxDuration = 60（最悪 48 秒の取得を切らない）`, route.includes("export const runtime = 'nodejs'") && route.includes('export const maxDuration = 60'))
  check(`${ROUTE}: 成功 200 { statements }・取れない 200 { statements: null }・例外 502`, route.includes('json({ statements: r.statements }, 200, CACHE_OK)') && route.includes('json({ statements: null, reason: r.reason }, 200, CACHE_OK)') && route.includes("json({ statements: null, error: 'fetch_failed' }, 502, NO_STORE)"))
  check(`${ROUTE}: Cache-Control: public, max-age=21600, stale-while-revalidate=604800`, route.includes("'public, max-age=21600, stale-while-revalidate=604800'"))
  check(`${ROUTE}: 取得元のエラー本文を応答に載せない（r.error は console.error だけ）`, !/json\([^)]*r\.error/.test(route) && route.includes('console.error(') && count(route, 'r.error') === 1)
  check(`${ROUTE}: データ源は lib/statements/sec-xbrl だけ（lib/market を import しない）`, route.includes("from '@/lib/statements/sec-xbrl'") && !route.includes('lib/market'))

  const page = stripComments(read(PAGE))
  check(`${PAGE}: <AnnualStatements symbol={symbol} /> を 1 回差し込む（import あり）`, count(page, '<AnnualStatements symbol={symbol} />') === 1 && page.includes("import { AnnualStatements } from '@/components/stocks/AnnualStatements'"))
  check(`${PAGE}: h1 は text-h1 text-ink（text-2xl font-bold を直した）・font-bold が無い`, count(page, '<h1 className="text-h1 text-ink">{symbol}</h1>') === 2 && !page.includes('font-bold') && !page.includes('text-2xl'))
  check(`${PAGE}: 既存の getQuote(symbol, { allowMock: false }) と catch は変えていない`, page.includes('getQuote(symbol, { allowMock: false })') && page.includes('の株価を取得できませんでした: ${err instanceof Error ? err.message : String(err)}') && page.includes('<EarningsPanel symbol={symbol} />'))
}

console.log('')
console.log(`PASS ${passed} 件 / FAIL ${failed} 件`)
if (failed) process.exit(1)
console.log('すべてPASS')
}

main().catch(e => { console.error(e); process.exit(1) })
