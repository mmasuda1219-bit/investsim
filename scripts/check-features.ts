// 投資家モデル（名人）を画面から隠す仕掛け（S1b・2026-09-25）の検査。
//   $env:PATH = "C:\Program Files\nodejs;$env:PATH"; npx tsx scripts/check-features.ts
//
// 正は DECISIONS.md 2026-09-24「サイトの目的を『再現性の追求』に格上げし、投資家モデルを画面から外し…」の決定(2):
// ファイルは消さず lib/features.ts の SHOW_INVESTOR_MODELS 1つで隠す。検査も同じ定数を読み、期待値をベタ書きしない。
//
// 見るもの:
//  - lib/features.ts が SHOW_INVESTOR_MODELS（boolean）を export している
//  - 画面の3か所がその定数で出し分けている（値に依らず「参照していること」を見る）:
//      /watch の <MasterSignals ×2（app/watch/client.tsx）／/stocks/[symbol] の <InvestorPanel／/learn の ANALYZE_MODE_TABS
//    値ごとの期待（true なら見える・false なら無い）は check-signals-undecidable.ts / check-analyze-s1.ts が同じ定数から導く。
//    ここでは /learn のタブだけ実際に import して「investor の有無 === 定数」を確かめる
//  - 名人の本体（lib/investors/・components/investors/・MasterSignals.tsx・InvestorPanel.tsx・/api/signals の route）が
//    HEAD と比べて無変更（git diff --quiet HEAD -- <path>。未追跡ファイルも無い）＝隠しただけで壊していない
//  - NAV の href・label・順序が不変（原則12。hint の文言は変えてよいが、隠している間は「名人」「投資家」を出さない）

import fs from 'fs'
import path from 'path'
import { spawnSync } from 'child_process'
import { SHOW_INVESTOR_MODELS } from '../lib/features'
import { ANALYZE_MODE_TABS } from '../app/learn/page'

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
/** 注釈を落とす（注釈に書いた名前を「参照している」と誤検知しないため）。文字列の中の // は残す */
const stripTsComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\n]*/g, '$1')
const FEATURES_IMPORT = /import \{ SHOW_INVESTOR_MODELS \} from '@\/lib\/features'/

console.log('■ lib/features.ts')
const features = stripTsComments(read('lib/features.ts'))
check('lib/features.ts: SHOW_INVESTOR_MODELS を export している（boolean）', /export const SHOW_INVESTOR_MODELS\b/.test(features) && typeof SHOW_INVESTOR_MODELS === 'boolean')
console.log(`  情報: SHOW_INVESTOR_MODELS = ${SHOW_INVESTOR_MODELS}（${SHOW_INVESTOR_MODELS ? '名人を出している' : '名人を隠している'}）`)

console.log('■ 画面の3か所が同じ定数で出し分けている')
const watch = stripTsComments(read('app/watch/client.tsx'))
const msTotal = watch.split('<MasterSignals').length - 1
const msGuarded = (watch.match(/\{SHOW_INVESTOR_MODELS && \(\s*<MasterSignals\b/g) ?? []).length
check('/watch: <MasterSignals は2か所とも {SHOW_INVESTOR_MODELS && ( … )} の内側（定数を import している）', FEATURES_IMPORT.test(watch) && msTotal === 2 && msGuarded === 2, `total=${msTotal} guarded=${msGuarded}`)
check('/watch: MasterSignals の import は残っている', watch.includes("import { MasterSignals } from '@/components/MasterSignals'"))
const stock = stripTsComments(read('app/stocks/[symbol]/page.tsx'))
check('/stocks/[symbol]: <InvestorPanel は1か所で {SHOW_INVESTOR_MODELS && ( … )} の内側（定数を import している）',
  FEATURES_IMPORT.test(stock) && stock.split('<InvestorPanel').length - 1 === 1 && /\{SHOW_INVESTOR_MODELS && \(\s*<InvestorPanel symbol=\{symbol\} \/>/.test(stock))
check('/stocks/[symbol]: InvestorPanel の import は残っている', stock.includes("import { InvestorPanel } from '@/components/InvestorPanel'"))
const learn = stripTsComments(read('app/learn/page.tsx'))
check('/learn: ANALYZE_MODE_TABS は配列の書き換えではなく SHOW_INVESTOR_MODELS から導く（3タブの元の配列は残る）',
  FEATURES_IMPORT.test(learn)
    && /export const ANALYZE_MODE_TABS = SHOW_INVESTOR_MODELS\s*\?\s*ALL_ANALYZE_MODE_TABS\s*:\s*ALL_ANALYZE_MODE_TABS\.filter\(t => t\.id !== 'investor'\)/.test(learn)
    && learn.includes("{ id: 'investor', label: '投資家モデル' }"))
check(`/learn: 実際のタブに investor が${SHOW_INVESTOR_MODELS ? 'ある' : '無い'}（定数と一致）`, ANALYZE_MODE_TABS.some(t => t.id === 'investor') === SHOW_INVESTOR_MODELS, ANALYZE_MODE_TABS.map(t => t.id).join(','))
check("/learn: 投資家モデルのパネル（mode === 'investor' の hidden 切替）と InvestorModelPicker は残っている", learn.includes("mode === 'investor' ? 'space-y-6' : 'hidden'") && learn.includes('<InvestorModelPicker'))

console.log('■ 名人の本体は HEAD と比べて無変更')
// `[symbol]` を git の pathspec が文字クラスと読まないよう :(literal) を付ける
const FROZEN = ['lib/investors', 'components/investors', 'components/MasterSignals.tsx', 'components/InvestorPanel.tsx', 'app/api/signals/[symbol]/route.ts']
// 2026-09-25 S1c（S1b レビュー S1）: 存在しないパスは git diff --quiet が 0 で返り、黙って PASS になる。
// 先に git ls-files で「追跡されているファイルが1件以上ある」ことを確かめる（消えた・移動した凍結物を見逃さない）
const untracked = FROZEN.filter(p => {
  const ls = spawnSync('git', ['ls-files', '--', `:(literal)${p}`], { cwd: ROOT, encoding: 'utf8' })
  return ls.status !== 0 || (ls.stdout ?? '').trim() === ''
})
check(`凍結パス ${FROZEN.length} 件はすべて git ls-files に1件以上ある（存在しないパスが黙って PASS しない）`, untracked.length === 0, untracked.join(', '))
for (const p of FROZEN) {
  const diff = spawnSync('git', ['diff', '--quiet', 'HEAD', '--', `:(literal)${p}`], { cwd: ROOT })
  const status = spawnSync('git', ['status', '--porcelain', '--untracked-files=all', '--', `:(literal)${p}`], { cwd: ROOT, encoding: 'utf8' })
  const dirty = (status.stdout ?? '').trim()
  check(`${p}: git diff --quiet HEAD で無変更・未追跡ファイルも無い`,
    diff.status === 0 && status.status === 0 && dirty === '',
    diff.error ? String(diff.error) : diff.status !== 0 ? `差分あり（exit ${diff.status}）` : dirty.replace(/\n/g, ' | '))
}

console.log('■ MasterSignals / InvestorPanel を読み込むファイルは3つだけ（フラグが唯一の門）')
// 2026-09-25 S1c（S1b レビュー S2）: 名人の部品を新しい場所から読み込むと、フラグの外で名人が画面に戻りうる。
// app / components / lib の .ts/.tsx を走査し、import 元が決まった3ファイルだけであることを見る（注釈は落とす）
const IMPORT_RE = /from\s+['"](?:@\/components\/|\.{1,2}\/(?:[^'"]*\/)?)(MasterSignals|InvestorPanel)['"]/g
const importers = new Map<string, string[]>()
const walk = (dir: string) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== '.next') walk(p) }
    else if (/\.tsx?$/.test(e.name)) {
      const src = stripTsComments(fs.readFileSync(p, 'utf8'))
      for (const m of src.matchAll(IMPORT_RE)) {
        const rel = path.relative(ROOT, p).replace(/\\/g, '/')
        importers.set(m[1], [...(importers.get(m[1]) ?? []), rel])
      }
    }
  }
}
for (const d of ['app', 'components', 'lib']) walk(path.join(ROOT, d))
const sortedImporters = (name: string) => [...new Set(importers.get(name) ?? [])].sort()
check('MasterSignals を import するのは app/watch/client.tsx と components/InvestorPanel.tsx だけ',
  JSON.stringify(sortedImporters('MasterSignals')) === JSON.stringify(['app/watch/client.tsx', 'components/InvestorPanel.tsx']), sortedImporters('MasterSignals').join(', '))
check('InvestorPanel を import するのは app/stocks/[symbol]/page.tsx だけ',
  JSON.stringify(sortedImporters('InvestorPanel')) === JSON.stringify(['app/stocks/[symbol]/page.tsx']), sortedImporters('InvestorPanel').join(', '))

console.log('■ NAV（components/SiteNav.tsx）')
const nav = stripTsComments(read('components/SiteNav.tsx'))
const navBody = nav.slice(nav.indexOf('export const NAV = ['), nav.indexOf('] as const'))
const entries = [...navBody.matchAll(/\{ href: '([^']+)',\s+label: '([^']+)',\s+hint: '([^']*)' \}/g)].map(m => ({ href: m[1], label: m[2], hint: m[3] }))
const NAV_FIXED = [['/watch', '見る'], ['/learn', 'まねる'], ['/trade', 'やる'], ['/review', '振り返る']]
check('NAV: href・label・順序が不変（原則12）', JSON.stringify(entries.map(e => [e.href, e.label])) === JSON.stringify(NAV_FIXED), JSON.stringify(entries.map(e => [e.href, e.label])))
check(SHOW_INVESTOR_MODELS ? 'NAV: hint は4本とも空でない' : 'NAV: 隠している間は hint に「名人」「投資家」を出さない（無いものを約束しない）',
  entries.length === 4 && entries.every(e => e.hint.length > 0) && (SHOW_INVESTOR_MODELS || entries.every(e => !/名人|投資家/.test(e.hint))),
  entries.map(e => e.hint).join(' / '))

console.log('')
console.log(`PASS ${passed} 件 / FAIL ${failed} 件`)
if (failed) process.exit(1)
console.log('すべてPASS')
