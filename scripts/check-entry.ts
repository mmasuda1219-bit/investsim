// トップページ（入口画面）の検査。L2「静かな楽器」（2026-10-14・DECISIONS.md 同日「ホーム（L2）は design-taste-frontend スキルの規則を優先する」）で全面的に建て直した。
//   $env:PATH = "C:\Program Files\nodejs;$env:PATH"; npx tsx scripts/check-entry.ts
//
// 法務の条件（legal-compliance 2026-09-25 (G)・2026-09-28 論点5〜7・2026-09-29）と、スキルのハウスルール（1px の線・枠・グラデーション・
// 休んでいるものへの影・番号・小さな上書きラベルを使わない。本文 17px・13px 未満を作らない）を機械で見る。
// PASS の合計は S2 出荷時（150件）を下回らない（2026-09-28 の不変条件「検査の合計件数は…下回らない」を引き継ぐ）。
//
// 見るもの:
//  - 免責は共通部品 <Disclaimer part="general" />（DISCLAIMER_TEXT）が末尾・地の上・畳まない・線で区切らない。手書き免責が無い
//  - 画面に使わない語: 見本／お手本／模範／正解例／自動売買／的中／当たった／外れた／正解率、および単独の「答え合わせ」。
//    従来の リスクゼロ／うまくなる／上手くなる／おすすめ／買い時／売り時／無料／今日、名人／投資家、R6・R9・R12 の語。
//    AI 出力向けの禁止語（FORBIDDEN_IN_OUTPUT）も画面の文言に無い（注記の打消し「推奨するものではありません」だけ例外）
//  - ヒーロー: 27px・2行の見出し（どの幅でも大きくしない）・支えの1文・主ボタン /trade・文字リンク /review/backfill・騰落率を置かない（R3）
//  - 実演パネル（components/entry/DemoPanel.tsx）: reason.ts の問い・3つの状態の移り変わり（1.6秒／5.5秒）・触ると止まる・
//    タブが隠れたら止める・「動きを減らす」で動かさない・保存も送信もしない
//  - 節1「与えて、返ってくる」: 順序の語（まず／つぎに／そして）・番号なし・記録された1件／左右に並べる／実例2件（AnswerCheckCard ×2）
//  - 節2「同じ1件が、こう変わる」: 3つの状態（書いた日／その直後／N営業日後）・真ん middle の1つは押すと3つ目に変わる・線は架空で引かない
//  - 節3: ふつうの一文と1つの動作（見出しの大きさの文字を出さない）
//  - 「全員に同じものを同じ順で」: localStorage／sessionStorage／document.cookie／useSearchParams が無く、fetch は /api/entry/examples の1本
//  - 読み口 app/api/entry/examples/route.ts の外形（S2 から変えない）
//  - ハウスルール: にじみ（radial-gradient）撤去・影なし・線なし（data-ui の内側を除く）・角丸1種類・文字段階5つ・色はトークンだけ・
//    動きは transform と opacity だけ・opacity:0 で待たせない・infinite なし
//  - フッターの枠（R10）・SITE_DESC・lib/entry/samples.ts の関数を実際に呼ぶ
//
// 実ネットワーク不要。ファイルを読むだけ。選び方の純関数の検査は scripts/check-answer-examples.ts。
// 見た目の実測（27px・2行・本文 17px・線・影・動いた要素数）は design-taste-frontend の inspect.mjs（実機ブラウザ）が担う。

import fs from 'fs'
import path from 'path'
import { DISCLAIMER_TEXT } from '../components/ui/Disclaimer'
import { FORBIDDEN_IN_OUTPUT, forbiddenWordsIn } from '../lib/investors/rulebooks/forbidden'
import { firstSentence, isFullyShowable, isShowable, isTextShowable, pickSamples, type SampleDecision } from '../lib/entry/samples'
import { fieldsFor } from '../lib/trade/reason'
import { MIN_ELAPSED_BUSINESS_DAYS } from '../lib/entry/answer-examples'

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
// 注釈を落としたコード（注釈に書いた「『今日』は書かない」を誤検知しないため）。文字列の中の // は残す（check-signals-undecidable.ts と同じ）
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
const count = (s: string, needle: string | RegExp) => (typeof needle === 'string' ? s.split(needle).length - 1 : (s.match(needle) ?? []).length)
/** `from` 以降で最初の `to` までを切り出す（無ければ空） */
function between(s: string, from: string, to: string): string {
  const i = s.indexOf(from)
  if (i < 0) return ''
  const j = s.indexOf(to, i + from.length)
  return j < 0 ? '' : s.slice(i, j + to.length)
}
/** CSS をセレクタ→本文の組に分ける（@media の入れ子は中身を平らに読む。ハウスルールの「data-ui の内側だけ」を見分けるため） */
function cssBlocks(css: string): { selector: string; body: string }[] {
  const out: { selector: string; body: string }[] = []
  const re = /([^{}]+)\{([^{}]*)\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(css))) {
    const selector = m[1].trim()
    if (selector.startsWith('@')) continue
    out.push({ selector, body: m[2] })
  }
  return out
}

const pageRaw = read('app/(night)/page.tsx')
const page = stripComments(pageRaw)
const layout = stripComments(read('app/(night)/layout.tsx'))
const rootLayout = stripComments(read('app/layout.tsx'))
const css = read('app/globals.css').replace(/\/\*[\s\S]*?\*\//g, '')
const homeCss = read('components/entry/home.module.css').replace(/\/\*[\s\S]*?\*\//g, '')
const fragments = stripComments(read('components/entry/fragments.tsx'))
const demo = stripComments(read('components/entry/DemoPanel.tsx'))
const reveal = stripComments(read('components/entry/useReveal.ts'))
const disclaimer = stripComments(read('components/ui/Disclaimer.tsx'))
const samplesSrc = stripComments(read('lib/entry/samples.ts'))
const card = stripComments(read('components/AnswerCheckCard.tsx'))
const route = exists('app/api/entry/examples/route.ts') ? stripComments(read('app/api/entry/examples/route.ts')) : ''

const NOTE_AI = 'これは、このサイトのAIが仮想資金で出した判断の記録です。▲▼はAIの判断の分類で、特定の銘柄の売買を推奨するものではありません。'

/** 段の呼び名を components/SiteNav.tsx の NAV から**読む**（import しない＝SiteNav は 'use client' で
 *  StockSearch・AuthMenu を引き込むため、検査から素で呼ばない）。並びと呼び名の正は NAV で、
 *  ここは「ホームの文が路から引けているか」を確かめるためだけに使う（2026-10-19 S-L1b） */
function navLabel(href: string): string {
  // 注釈を落としてから切り出す（注釈の中に NAV の例を書くと拾ってしまう＝2026-10-20 レビュー S9）
  const src = stripComments(read('components/SiteNav.tsx'))
  const body = src.slice(src.indexOf('export const NAV = ['), src.indexOf('] as const'))
  const m = new RegExp(`\\{ href: '${href}',\\s+label: '([^']+)'`).exec(body)
  if (!m) throw new Error(`navLabel: ${href} が NAV に無い`)
  return m[1]
}
const PICK_NOTE = '判断日が古い順に、値上がりした例と値下がりした例を1件ずつ。成績のよい判断を選んでいるのではありません。'
const LINE_NOTE = '画面の例です。線は実際の株価から引き、無いときは出しません。'

// 節の切り出し（page の JSX の目印で区切る）
const hero = between(page, 'data-section="hero"', '</section>')
const how = between(page, 'data-section="how"', '</section>')
const states = between(page, 'data-section="states"', '</section>')
const closing = between(page, 'data-section="closing"', '</section>')
const exWrite = between(how, 'data-exchange="write"', '</li>')
const exCompare = between(how, 'data-exchange="compare"', '</li>')
const exWait = between(how, 'data-exchange="wait"', '</li>')
const entry = fragments + '\n' + demo + '\n' + reveal
const screen = page + '\n' + layout + '\n' + entry + '\n' + card
const homeCssBlocks = cssBlocks(homeCss)

console.log('■ 免責（DISCLAIMER_TEXT）と手書き免責の撤去（§6-11・R7・R11）')
check('トップ: <Disclaimer part="general" /> を1回以上（共通部品）', count(page, '<Disclaimer part="general" />') >= 1 && page.includes("from '@/components/ui/Disclaimer'"))
check('Disclaimer: part="general" で DISCLAIMER_TEXT を出す（文言は部品の定数。ページで作り直さない）', disclaimer.includes("part !== 'investor' ? DISCLAIMER_TEXT") && DISCLAIMER_TEXT.length > 100)
check('トップ: 免責は末尾・締めの節の後・地の上（data-ui の外）・線で区切らない（border-t を使わない）',
  /<div className=\{s\.disclaimer\} data-section="disclaimer">\s*<Disclaimer part="general" \/>\s*<\/div>\s*<\/div>\s*\)\s*\}/.test(page)
  && page.indexOf('data-section="closing"') < page.indexOf('data-section="disclaimer"') && !page.includes('border-t'))
check('home.module.css: 免責の列は軸の上・560px（.disclaimer）', homeCss.includes('.disclaimer { margin-left: var(--anchor); max-width: 560px; }'))
check('トップ・layout・断片: 「投資助言・代理業には該当しません」の自己断定が無い', !screen.includes('該当しません'))
check('トップ: 旧の手書き免責「InvestSim は投資判断を練習するためのシミュレーターです」が無い', !screen.includes('InvestSim は投資判断を練習するためのシミュレーターです'))
check('トップ・layout・断片・カード: <details> を使わない（免責・注記を畳まない＝R7）', !screen.includes('<details'))
check('トップ・断片・カード: 注記・免責に opacity を足していない（R7）', !/opacity-\d|opacity:/.test(page + entry) && !/opacity-\d|opacity:/.test(card))
check('home.module.css: opacity は 0 と 1 だけ（動きの始点・終点。注記を薄めるための小数の opacity が無い）', !/opacity:\s*0\.\d/.test(homeCss) && count(homeCss, 'opacity: 0;') >= 2 && count(homeCss, 'opacity: 1;') >= 2)
check('トップ・断片: 13px 未満の文字を作らない（text-caption・text-[1?px] を使わない。断片の内側も 13px 以上）', !/text-caption|text-\[(?:[0-9]|1[0-2])px\]/.test(page + entry) && !/font-size:\s*(?:[0-9]|1[0-2])px/.test(homeCss))
check('断片: 注記は --muted か --ink-2 の 13px 以上（.uiNote 14px・.dt/.meta 13px）', /\.ui\[data-ui\] \.uiNote \{[^}]*font-size: 14px/.test(homeCss) && /\.ui\[data-ui\] \.meta \{[^}]*font-size: 13px/.test(homeCss))

console.log('■ 書かない語（法務 (G)・2026-09-29・DESIGN §7）')
for (const w of ['リスクゼロ', 'うまくなる', '上手くなる', 'おすすめ', '買い時', '売り時', '無料', '今日']) {
  check(`トップ・layout・断片・カード: 「${w}」が 0 件`, !screen.includes(w))
}
for (const w of ['見本', 'お手本', '模範', '正解例', '自動売買', '的中', '当たった', '外れた', '正解率']) {
  check(`トップ・layout・断片・カード: 「${w}」が 0 件（legal-compliance 2026-09-29）`, !screen.includes(w))
}
check('「答え合わせ」を使うなら同じ節に「正解を出すのはこのサイトではありません」（使っていなければ合格）',
  !screen.includes('答え合わせ') || screen.includes('正解を出すのはこのサイトではありません'))
const OLD_WORDING = ['AIと名人と自分', 'まずAIの判断を見てみる', 'AIも、同じ形式で理由を書いています', '投資判断の練習場', '買う理由を書いて残し、あとで株価と読み返す。', 'できることは3つ', 'AIは、いまこう考えています', '4つの段階', 'このサイトは、3つの画面でできています', '株を売り買いする前に、その理由を書いて残す場所です。']
const oldHits = OLD_WORDING.filter(w => screen.includes(w))
check('トップ: 旧文言（S1c・S1・S2 の見出し・分類ラベル・旧節見出し）が残っていない', oldHits.length === 0, oldHits.join(' / '))
check('トップ・layout・断片・カード: 「名人」「投資家」の語が無い（名人を隠している間・注釈を除く）', !/名人|投資家/.test(screen))
check('トップ: 見出しに「再現」を入れない（法務: 変化を約束する語にしない）', !between(page, '<h1', '</h1>').includes('再現'))
check('トップ・断片・カード: 断定・将来の語（儲か／必ず／勝て／稼）が無い（R6）', !/儲か|必ず|勝て|稼/.test(screen))
check('トップ・layout・断片・カード: 急かす語（今だけ／先着／残り）・記章の語（認証／公式／保証／安心）が無い（R9・R12）', !/今だけ|先着|残り[0-9０-９]|認証|公式|保証|安心/.test(screen))
check('トップ・断片: 採点の語（採点／点数／合格／診断／アドバイス／助言／相談）が無い（良し悪しを判定しない）', !/採点|点数|合格|診断|アドバイス|助言|相談/.test(page + entry))
{
  // AI 出力向けの禁止語も画面の文言に無い。注記の打消し（「推奨するものではありません」）だけ例外
  const copy = (page + '\n' + entry + '\n' + card).split('推奨するものではありません').join('')
  const hits = forbiddenWordsIn(copy, FORBIDDEN_IN_OUTPUT)
  check('トップ・断片・カード: FORBIDDEN_IN_OUTPUT の語が画面の文言に無い（打消しの注記を除く）', hits.length === 0, hits.join(' / '))
}
check('トップ・断片: AI推論を走らせない（/api/ai-session/[id]/tick・/api/analyze を呼ばない）', !/\/tick|\/api\/analyze|anthropic/i.test(page + entry))
check('架空の判断・銘柄を書いていない（AAPL 等のティッカーの直書きがページ・断片に無い）', !/['"](?:AAPL|MSFT|NVDA|TSLA|AMZN|7203\.T|9984\.T)['"]/.test(page + entry))
check('トップ・断片: 番号の段ラベル（01 書く／02 くらべる／03 読み返す）と padStart が無い（スキル「No index numbering」）', !/0[1-3] (?:書く|くらべる|読み返す)/.test(screen) && !/padStart\(/.test(page + entry))
check('トップ・断片: 「01」「02」「03」の文字列を画面に出さない', !/[>"'`]\s*0[1-3]\s*[<"'`]/.test(page + entry))

console.log('■ ヒーロー（設計図 §6「Column on one line」・R3: 騰落率を置かない）')
const h1 = between(page, '<h1', '</h1>')
check('h1 は「買う理由を書いて、残す。／N営業日後に、読み返す。」の2行（<br /> で切り、N は MIN_ELAPSED_BUSINESS_DAYS）',
  /買う理由を書いて、残す。<br \/>\{MIN_ELAPSED_BUSINESS_DAYS\}営業日後に、読み返す。/.test(h1) && h1.includes('className={`${s.h1} ${s.rise}`}'))
check('h1 は1つだけ（display は1画面に1つ）', count(page, '<h1') === 1)
check('h1 の大きさは 27px・medium・行間 1.25（home.module.css の .h1 と --step-display。vw や clamp で大きくしない）',
  /\.h1 \{[^}]*font-size: var\(--step-display\)[^}]*font-weight: 500[^}]*line-height: 1\.25/.test(homeCss)
  && homeCss.includes('--step-display: 24px;') && homeCss.includes('--step-display: 27px;') && !/\.h1 \{[^}]*(?:vw|clamp\()/.test(homeCss))
check('トップ: text-display（52px / 900）を使わない（この設計図だけの例外: 見出しは本文よりわずかに大きいだけ）', !page.includes('text-display') && !entry.includes('text-display'))
check('支えの1文: 「仮想資金の練習です。／売買で実際のお金は1円も動きません。」（作者が <br /> で切る・やわらかい方のインク）',
  hero.includes('仮想資金の練習です。<br />売買で実際のお金は1円も動きません。') && /\.support \{[^}]*color: var\(--ink-2\)/.test(homeCss))
check('主ボタン: /trade「1件目のメモを書く」が s.button（ヒーローに1つ・アクセントはここだけ）', /<Link href="\/trade" className=\{s\.button\}>1件目のメモを書く<\/Link>/.test(hero) && count(hero, 'className={s.button}') === 1)
check('文字リンク: /review/backfill「過去に買った株を記録する →」が s.textLink', /<Link href="\/review\/backfill" className=\{s\.textLink\}>過去に買った株を記録する →<\/Link>/.test(hero))
check('home.module.css: ボタンは1種類（.button: --brand の塗り・角丸 var(--radius)・44px 以上・影なし）',
  /\.button \{[^}]*min-height: 44px[^}]*border-radius: var\(--radius\)[^}]*background: var\(--brand\)/.test(homeCss) && !/\.button \{[^}]*shadow/.test(homeCss))
check('home.module.css: 角丸は1種類（--radius: 4px。ページ側の角丸はすべて var(--radius)）',
  homeCss.includes('--radius: 4px;') && homeCssBlocks.filter(b => !b.selector.includes('data-ui') && /border-radius/.test(b.body)).every(b => /border-radius:\s*var\(--radius\)/.test(b.body)))
check('ヒーローに騰落率が無い（changePct・fmtSignedPct・answerSentence・% を置かない＝R3）', hero.length > 0 && !/changePct|fmtSignedPct|answerSentence|%/.test(hero))
check('ヒーローに /stocks/ へのリンクが無い（法務条件。ページ・断片全体でも無い）', !(page + entry).includes('/stocks/'))
check('ヒーロー: 列は 380px・軸は左から 27%（≥1200px）・右半分は空ける（.heroCol max-width 380px・--anchor に 27vw）',
  /\.heroCol \{[^}]*max-width: 380px/.test(homeCss) && homeCss.includes('calc(27vw - 24px') && /\.heroTop \{[^}]*padding-top: calc\(30svh/.test(homeCss))
check('ヒーロー: 実演パネルが下端から覗く（.heroPanel 368px・--peek 90px（パソコン）／120px（スマホ）・.heroTop の min-height が --peek を引く）',
  /\.heroPanel \{[^}]*width: min\(368px, 100%\)/.test(homeCss) && homeCss.includes('--peek: 90px;') && homeCss.includes('--peek: 120px;') && /\.heroTop \{[^}]*min-height: calc\(100svh[^}]*var\(--peek\)/.test(homeCss))
check('ヒーロー: 実演パネル <DemoPanel onDraft={setDraft} /> が s.heroPanel の中・入場 s.rise', /<div className=\{`\$\{s\.heroPanel\} \$\{s\.rise\}`\} style=\{idx\(3\)\}>\s*<DemoPanel onDraft=\{setDraft\} \/>/.test(hero))
check('ヒーローより下に h1 が無く、h2 は「与えて、返ってくる」「同じ1件が、こう変わる」の2つ', count(page.slice(page.indexOf('data-section="how"')), '<h1') === 0 && count(page, '<h2') === 2)

console.log('■ 実演パネル（components/entry/DemoPanel.tsx・訪問者ができる1つのこと）')
const buyFields = fieldsFor('buy')
check("断片: 問いは lib/trade/reason.ts の fieldsFor('buy')（ページ・断片で記入例・問いを書き直さない）",
  fragments.includes("export const BUY_FIELDS: ReasonFieldSpec[] = fieldsFor('buy')") && buyFields.every(f => !(page + entry).includes(f.placeholder) && !(page + entry).includes(`>${f.question}<`)))
check('断片: 記入例は reason.ts の placeholder（EXAMPLE_MEMO）・組み立てと分解は製品の composeFrom／parseReason',
  fragments.includes('export const EXAMPLE_MEMO: Memo = Object.fromEntries(BUY_FIELDS.map(f => [f.key, f.placeholder]))') && fragments.includes('return parseReason(composeFrom(BUY_FIELDS, memo))'))
check('WriteForm: <label htmlFor>＋<textarea value={values[f.key]…} placeholder={f.placeholder}>（絵ではなく本物のマークアップ）',
  fragments.includes('<label htmlFor={id} className={s.label}>') && fragments.includes("value={values[f.key] ?? ''}") && fragments.includes('placeholder={f.placeholder}') && fragments.includes('{f.question}'))
check('WriteForm: 必須／任意の印（（必須）は --brand・（任意）は --muted）', fragments.includes('<span className={s.required}>（必須）</span>') && fragments.includes('<span className={s.optional}>（任意）</span>') && /\.ui\[data-ui\] \.required \{ color: var\(--brand\); \}/.test(homeCss))
check('WriteForm: 「この内容で記録する」は <button type="button" aria-disabled="true">・disabled にしない・aria-hidden を付けない（読み上げで読めてよい）',
  /<button type="button" aria-disabled="true" tabIndex=\{-1\} className=\{s\.submit\}>この内容で記録する<\/button>/.test(fragments) && !/\sdisabled(?:\s|=|>)/.test(fragments) && !fragments.includes('aria-hidden="true" className'))
// 2026-10-19 S-L1b: 添字 NAV[0] から**路で引く** labelOf('/trade') に替えた（4段にすると NAV[0] は「学ぶ」になり、この文が嘘になる）
check('WriteForm: 記入例であることの注記（SAMPLE_NOTE）は「記入例が入った状態です。この画面では押せません。実際に書くのは「＜labelOf(/trade)＞」（上のボタン）。」',
  fragments.includes("export const SAMPLE_NOTE = `記入例が入った状態です。この画面では押せません。実際に書くのは「${labelOf('/trade')}」（上のボタン）。`") && fragments.includes('{note && <p className={s.uiNote}>{SAMPLE_NOTE}</p>}'))
check('WriteForm: SAMPLE_NOTE の路から引く先は /trade で、その呼び名は「書く」（NAV と一致）',
  navLabel('/trade') === '書く', navLabel('/trade'))
check('DemoPanel: 3つの層（空欄／記入例／記録）が s.layer・data-on・inert で切り替わる', count(demo, 'className={s.layer}') === 3 && count(demo, 'data-on={active ===') === 3 && count(demo, 'inert={active !==') >= 3)
check('DemoPanel: 5.5秒ずつ留まり（HOLD_MS = 5500）、1.6秒かけて入れ替わる（.layer の transition: opacity 1600ms）',
  demo.includes('const HOLD_MS = 5500') && /\.layer \{[^}]*transition: opacity 1600ms ease, visibility 0s linear 1600ms/.test(homeCss))
check('DemoPanel: 触ると止まる（locked で効果を抜ける・hold が setLocked(true)）・書いた文を onDraft で親へ渡す',
  demo.includes('if (locked) return') && demo.includes('setLocked(true)') && demo.includes('onDraft(next)') && demo.includes('onFocus={() => hold(0)}') && demo.includes('onFocus={() => hold(1)}'))
check('DemoPanel: タブが隠れたら止める（visibilitychange・document.hidden）・後始末で clearTimeout',
  demo.includes("document.addEventListener('visibilitychange', onVisibility)") && demo.includes('if (!document.hidden) setActive') && demo.includes('window.clearTimeout(timer)') && demo.includes("document.removeEventListener('visibilitychange', onVisibility)"))
check('DemoPanel: 「動きを減らす」設定では最初の1つだけを出し、動かさない（matchMedia(prefers-reduced-motion: reduce) で効果を抜ける・.layer の transition: none）',
  demo.includes("if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return") && /@media \(prefers-reduced-motion: reduce\) \{\s*\.layer \{ transition: none; \}/.test(homeCss))
check('DemoPanel: 記録の層を押すと書く前に戻る（指1本・いつでも書ける）', demo.includes('onClick={() => { if (active === 2) hold(0) }}'))
check('DemoPanel: 最初に出すのは記録された1件（useState(2)）で、順は 記録 → 空欄 → 記入例（(a + 1) % LAYERS）。覗き（上 90px）に実際に書かれた文の行が入る（dense・ヒーローの断片と詰めたカードは padding-top 8px・dl は 2px）',
  demo.includes('const [active, setActive] = useState(2)') && demo.includes('setActive(a => (a + 1) % LAYERS)') && demo.includes('dense') && fragments.includes("data-dense={dense ? '' : undefined}")
  && homeCss.includes('.heroPanel .ui[data-ui] { padding-top: 8px; }') && homeCss.includes('.ui[data-ui] .dl[data-dense] { margin-top: 2px; }') && homeCss.includes('.ui[data-ui] .card[data-dense] { padding-top: 8px; }') && fragments.includes("<div className={s.card} data-dense={dense ? '' : undefined}>"))
check('DemoPanel: 詰めた記録の層でも「記入例が入った状態です。」（または自分の文である旨）を同じカードの中に書く', demo.includes("'記入例が入った状態です。'") && demo.includes('あなたが上の欄に書いた文です（保存も送信もしていません）。'))
check('DemoPanel・断片・useReveal: 保存も送信もしない（fetch／XMLHttpRequest／sendBeacon／localStorage／sessionStorage／cookie が無い）',
  !/fetch\(|XMLHttpRequest|sendBeacon|localStorage|sessionStorage|document\.cookie/.test(entry))
check('DemoPanel: 時刻・乱数で中身を変えない（Date.now／Math.random／new Date が無い）', !/Date\.now|Math\.random|new Date\(/.test(entry))
check('断片: 訪問者の文があるかは isTyped（空欄だけ・記入例のままは false）。画面に出すメモは memoToShow', fragments.includes('export function isTyped(draft: Memo | null): boolean') && fragments.includes('return filled && !same') && fragments.includes('return isTyped(draft) ? (draft as Memo) : EXAMPLE_MEMO'))
check('home.module.css: 隠れている層は visibility: hidden（読み上げ・焦点・inspect の計測から外れる）', /\.layer \{[^}]*visibility: hidden/.test(homeCss) && /\.layer\[data-on\] \{[^}]*visibility: visible/.test(homeCss))

console.log('■ 節1「与えて、返ってくる」（設計図 §7-1。順序の語で示す・番号なし）')
check('h2「与えて、返ってくる」が s.h2・入場 data-reveal', /<h2 id="how-heading" className=\{s\.h2\} data-reveal style=\{idx\(0\)\}>与えて、返ってくる<\/h2>/.test(how))
check('3つのやりとりは <ol>（順序は要素で持つ）・data-exchange が write → compare → wait の順',
  how.includes('<ol className={s.exchanges}>') && [...how.matchAll(/data-exchange="(\w+)"/g)].map(m => m[1]).join(',') === 'write,compare,wait')
check('各やりとりは順序の語で始まる文（まず／つぎに／そして）の h3 で開く',
  /<h3 className=\{s\.h3\}[^>]*>まず、買う理由を書く。<\/h3>/.test(exWrite) && /<h3 className=\{s\.h3\}[^>]*>つぎに、このサイトのAIが書いたものと並べる。<\/h3>/.test(exCompare)
  && /<h3 className=\{s\.h3\}[^>]*>そして、\{MIN_ELAPSED_BUSINESS_DAYS\}営業日ほど待つ。<\/h3>/.test(exWait))
check('home.module.css: やりとりは 88px 間隔・返ってくるものは 56px 字下げ（≥768px）・h3 は 20px medium',
  homeCss.includes('.exchange + .exchange { margin-top: 88px; }') && /\.response \{[^}]*margin-left: var\(--indent\)/.test(homeCss) && homeCss.includes('--indent: 56px;') && /\.h3 \{[^}]*font-size: var\(--step-lead\)[^}]*font-weight: 500/.test(homeCss))
check('まず: 本文に「理由と、やめる条件を書かないと記録できません」（降りる条件を書かないと記録できない＝このサイトだけの制約）', exWrite.includes('理由と、やめる条件を書かないと記録できません。'))
check('まず: 与えるもの＝上の欄に書いた文そのまま（givenOf・問い：答え）・記入例か自分の文かを明示',
  exWrite.includes('{given.map(g => (') && exWrite.includes('<span className={s.soft}>{g.question}：</span>{g.value}') && exWrite.includes('記入例です。上の欄に書くと、ここがその文に入れ替わります。') && exWrite.includes('上の欄に書いた文です。このページの中だけで、保存も送信もしません。'))
check('まず: 返ってくるもの＝記録された1件（RecordView・data-ui・地の上＝bare）', /<div data-ui className=\{`\$\{s\.ui\} \$\{s\.bare\}`\}>\s*<RecordView memo=\{memo\} typed=\{typed\} \/>/.test(exWrite))
check('RecordView: 見出しは「買ったときに書いたこと」・【見出し】ごとの <dl>・記入例か自分の文かの hint',
  fragments.includes('<p className={s.cardHead}>買ったときに書いたこと</p>') && fragments.includes("{typed ? 'あなたが上の欄に書いた文（このページの中だけ。保存も送信もしていません）' : '記入例が入った状態です'}") && fragments.includes('<dt className={s.dt}>{sec.label ? `【${sec.label}】` : \'（見出しなし）\'}</dt>'))
check('つぎに: 与えるのは上の文そのまま（面を置かない）・返ってくるもの＝左右に並べる（CompareView・data-ui）',
  exCompare.includes('与えるのは、上の文そのままです。') && !exCompare.includes('className={s.call}') && /<div data-ui className=\{s\.ui\}>\s*<CompareView memo=\{memo\} typed=\{typed\} older=\{older\} aiFallback=\{aiFallback\} \/>/.test(exCompare))
check('CompareView: 左「あなたが書いたこと（記入例）」／右「このサイトのAIが書いたこと」・系列の見分けは線の見本（Swatch: SERIES.you／SERIES.ai）で文字に色を使わない',
  fragments.includes("{typed ? 'あなたが書いたこと' : 'あなたが書いたこと（記入例）'}") && fragments.includes('このサイトのAIが書いたこと') && fragments.includes('<Swatch style={SERIES.you} />') && fragments.includes('<Swatch style={SERIES.ai} />') && !/style=\{\{\s*color/.test(page + entry))
check('CompareView: 「左は記入例、右はこのサイトのAIが実際に書いた記録です。」を明示。自分の文のときは「保存も送信もしていません」の文に替わる',
  fragments.includes("export const PAIR_NOTE_SAMPLE = '左は記入例、右はこのサイトのAIが実際に書いた記録です。'") && fragments.includes('保存も送信もしていません）。右はこのサイトのAIが実際に書いた記録です。') && fragments.includes('{typed ? PAIR_NOTE_TYPED : PAIR_NOTE_SAMPLE}'))
check('CompareView: 右は older（2件のうち判断日が古い方）の理由の全文＋銘柄コード・方向の札・判断日', fragments.includes('{older.reasoning}') && fragments.includes('{older.symbol}・{ACTION_LABEL[older.action]}・判断日 {fmtSlashDate(older.decidedAt)}'))
check('つぎに: 「ちがい」の1文は静的な説明文（差を自動判定して採点しない。「判定しません」）', exCompare.includes('どちらが良いかを、このサイトは判定しません。') && !/changePct|score|点/.test(exCompare))
check('つぎに: 注記（C）が断片の直下・本文の大きさ（s.note。畳まない・薄めない）', exCompare.includes('<p className={s.note}>{NOTE_AI}</p>') && fragments.includes(`export const NOTE_AI =\n  '${NOTE_AI}'`))
check('つぎに: 並べて読む画面は準備中と明示（いまの機能は hintOf(/learn) から。無いものを約束しない）', exCompare.includes("{hintOf('/learn')}ことができます。左右に並べて読む画面は準備中です。") && exCompare.includes("「{labelOf('/learn')}」の画面では"))
check('つぎに: /watch へ「AIの判断を全部読む →」は {SHOW_AI_WATCH && ( の内側（出し分けの規則は scripts/check-watch-reachable.ts）', /\{SHOW_AI_WATCH && \(\s*<Link href="\/watch" className=\{s\.textLink\}>AIの判断を全部読む →<\/Link>\s*\)\}/.test(exCompare))
check('そして: 与えるもの＝待つこと（N営業日ほど経つと…同じことを5回書くと、共通するところを1つだけ出します。）・/review に実物がある',
  exWait.includes('{`${MIN_ELAPSED_BUSINESS_DAYS}営業日ほど経つと、書いたメモを、その後の株価と並べて読み返します。書いたときに何を考えていたかが、そのまま残っています。同じことを5回書くと、共通するところを1つだけ出します。`}')
  && exists('lib/review/patterns.ts') && exists('components/review/PriceSincePanel.tsx'))
check('そして: 本文に「待つことが、このサイトの決まりです」（待ち時間はこのサイトの制約）', exWait.includes('待つことが、このサイトの決まりです。'))
check('そして: 選び方の1文（一字違わず・small・--ink-2）を実例の上に', exWait.includes('<p className="max-w-[42rem] text-small text-ink-2">{PICK_NOTE}</p>') && page.includes(`const PICK_NOTE = '${PICK_NOTE}'`) && exWait.indexOf('{PICK_NOTE}') < exWait.indexOf('<AnswerCheckCard'))
check('そして: 返ってくるもの＝AnswerCheckCard を up / down で1件ずつ・760px に広がる（s.wide）・地の上（bare）',
  page.includes("from '@/components/AnswerCheckCard'") && exWait.includes('<AnswerCheckCard example={examples.up} kind="up" />') && exWait.includes('<AnswerCheckCard example={examples.down} kind="down" />')
  && exWait.includes('className={`${s.response} ${s.wide}`}') && homeCss.includes('.wide { width: min(760px, calc(100% - var(--indent))); }'))
check('そして: 読み込み中は薄い面2つ・失敗は role="status" の文・無いときは「まだ無い」の文（架空で埋めない）',
  count(exWait, '<Skeleton') === 2 && exWait.includes('<p role="status" className="text-small text-ink-2">{ERROR_LINE}</p>') && exWait.includes("{state === 'empty' && <p className=\"text-small text-ink-2\">{EMPTY_LINE}</p>}"))
check('そして: 注記（C）＋「あなたが書いた理由も、「＜labelOf(/review)＞」に残ります。」', exWait.includes("<p className={s.note}>{NOTE_AI} あなたが書いた理由も、「{labelOf('/review')}」に残ります。</p>"))
check('そして: 路から引く先は /review で、その呼び名は「振り返り」（NAV と一致）', navLabel('/review') === '振り返り', navLabel('/review'))
check('「まだ無い」の文は N営業日の条件を書く（MIN_ELAPSED_BUSINESS_DAYS から）・「20営業日」の直書きが無い',
  page.includes('const EMPTY_LINE = `並べて見せられるAIの記録は、まだありません（判断日から${MIN_ELAPSED_BUSINESS_DAYS}営業日以上たったものが要ります）。`') && !/20営業日/.test(page + entry) && MIN_ELAPSED_BUSINESS_DAYS === 20)
check('カード: 面は地の上・出所の行がある（R8・R11）・断片の面の上では白い紙（.twoUp > article）', card.includes('rounded-card border border-border p-4') && card.includes('{example.source}') && homeCss.includes('.ui[data-ui] .twoUp > article { background: var(--card); }'))
check('カード: 出所の行と軸の実値は 14px（text-small）。12px（text-caption）が無い（R7・R8: 読めることが目的。L2 2026-10-14）', !card.includes('text-caption') && card.includes('<p className="text-small text-muted tabular-nums">{asOf}{elapsed}。縦の破線は判断日。</p>') && card.includes('justify-between text-small text-muted tabular-nums'))

console.log('■ 節2「同じ1件が、こう変わる」（設計図 §7-2「One row, three states」）')
check('h2「同じ1件が、こう変わる」が s.h2・軸の上（s.axis）', /<h2 id="states-heading" className=\{`\$\{s\.h2\} \$\{s\.axis\}`\} data-reveal style=\{idx\(0\)\}>同じ1件が、こう変わる<\/h2>/.test(states))
check('3つの複製は <ol>・data-state が written → after → later の順', states.includes('<ol className={s.showcase}>') && [...states.matchAll(/data-state="(\w+)"/g)].map(m => m[1]).join(',') === 'written,after,later')
check('状態の語は 書いた日／その直後／N営業日後（左の列・右揃え・やわらかいインク。スマホでは複製の下）',
  states.includes('<p className={s.stateWord}>書いた日</p>') && states.includes("{waited ? `${MIN_ELAPSED_BUSINESS_DAYS}営業日後` : 'その直後'}") && states.includes('<p className={s.stateWord}>{MIN_ELAPSED_BUSINESS_DAYS}営業日後</p>')
  && /\.stateWord \{[^}]*order: 2/.test(homeCss) && /\.stateWord \{[^}]*text-align: right/.test(homeCss) && /\.stateWord \{[^}]*color: var\(--ink-2\)/.test(homeCss))
check('複製は 640px・56px 間隔（≥768px）・何も枠に入れない（.copy の grid に 640px・.copy + .copy 56px）', homeCss.includes('grid-template-columns: calc(var(--anchor) - 24px) minmax(0, 640px);') && homeCss.includes('.copy + .copy { margin-top: 56px; }'))
check('書いた日＝記録された1件（RecordView・data-ui・地の上）', /data-state="written"[\s\S]*?<div className=\{`\$\{s\.copyBody\} \$\{s\.ui\} \$\{s\.bare\}`\} data-ui>\s*<RecordView memo=\{memo\} typed=\{typed\} \/>/.test(states))
check('その直後＝左右に並べる（CompareView）＋生きている1つ: 「N営業日、待ったことにする」を押すと3つ目の状態（RereadView）に変わる',
  states.includes('<button type="button" className={s.uiButton} onClick={() => setWaited(true)}>') && states.includes('{MIN_ELAPSED_BUSINESS_DAYS}営業日、待ったことにする') && /\{waited \? \(\s*<RereadView memo=\{memo\} typed=\{typed\} \/>\s*\) : \(\s*<CompareView/.test(states))
check('N営業日後＝読み返す（RereadView・data-ui・地の上）', /data-state="later"[\s\S]*?<div className=\{`\$\{s\.copyBody\} \$\{s\.ui\} \$\{s\.bare\}`\} data-ui>\s*<RereadView memo=\{memo\} typed=\{typed\} \/>/.test(states))
check('RereadView: 株価の線は架空で引かない（<svg>／<line>／<path> が無く、線が入る場所を文で示す）・「画面の例です。線は実際の株価から引き、無いときは出しません。」',
  (() => { const v = between(fragments, 'export function RereadView', '\n}\n'); return v.length > 0 && !/<svg|<line|<path/.test(v) && v.includes('{LINE_NOTE}') && v.includes('実際の株価の線が、ここに入ります。') })()
  && fragments.includes(`export const LINE_NOTE = '${LINE_NOTE}'`))
check('RereadView: 「書いたときに何を考えていたかが、そのまま残っています。」・見出し「書いた理由と、その後の株価」', fragments.includes('<p className={s.cardHead}>書いた理由と、その後の株価</p>') && fragments.includes('書いたときに何を考えていたかが、そのまま残っています。'))
check('節2 の直下にも注記（C）（AIの記録を見せる節の直下＝3か所目）', states.includes('<p className={`${s.note} ${s.axis}`}>{NOTE_AI}</p>') && count(page, '{NOTE_AI}') === 3)

console.log('■ 節3「ふつうの一文と、1つの動作」（設計図 §7-3）')
check('一文「最初の1件は、短くてかまいません。」は <p>（見出しの大きさの文字をこの節に出さない）', /<p className=\{s\.sentence\} data-reveal style=\{idx\(0\)\}>最初の1件は、短くてかまいません。<\/p>/.test(closing) && !/<h[1-6]/.test(closing))
check('一文は 20px・regular・34ch 以内（.sentence）', /\.sentence \{[^}]*max-width: 34ch[^}]*font-size: var\(--step-lead\)[^}]*font-weight: 400/.test(homeCss))
check('締めのボタン: /trade「1件目のメモを書く」（主ボタンと同じ文言・同じ形）＋文字リンク /review/backfill',
  /<Link href="\/trade" className=\{s\.button\}>1件目のメモを書く<\/Link>/.test(closing) && /<Link href="\/review\/backfill" className=\{s\.textLink\}>過去に買った株を記録する →<\/Link>/.test(closing))
check('href="/trade" の直書きは主ボタンと締めの2か所だけ（断片は /trade へ飛ばない。行き先が state で変わらない）', count(page, 'href="/trade"') === 2 && !/href=\{[^}]*\?/.test(page + entry) && !entry.includes('href="/trade"'))
check('締めの上下に決めた空白（.cta の padding-top／bottom は svh）', /\.cta \{[^}]*padding-top: \d+svh[^}]*padding-bottom: \d+svh/.test(homeCss))
check('ボタンの文言は「押すと何が起きるか」の動詞（OK／送信／次へ を使わない）', !/>\s*(OK|送信|次へ)\s*</.test(page + entry))

console.log('■ 全員に同じものを同じ順で（法務 C3〜C5・設計制約8）')
check('トップ・断片: localStorage／sessionStorage／document.cookie／useSearchParams が無い', !/localStorage|sessionStorage|document\.cookie|useSearchParams/.test(page + entry))
check('トップ: fetch は /api/entry/examples の1本だけ（断片に fetch が無い）', count(page, 'fetch(') === 1 && page.includes("fetch('/api/entry/examples', { signal: ctrl.signal })") && !entry.includes('fetch('))
check('トップ: 時刻・乱数で中身を変えない（Date.now／Math.random／new Date が無い）', !/Date\.now|Math\.random|new Date\(/.test(page))
check('トップ: くらべる節の1件は判断日が古い方（成績＝changePct で選ばない）・選び方を画面で作り直していない（.sort／.filter が無い）',
  page.includes('examples.up.decidedAt < examples.down.decidedAt') && !/changePct\s*[<>]/.test(page) && !/\.sort\(|\.filter\(/.test(page))
check("トップ: 状態は loading / ready / empty / error の4つ・catch は 'error'・HTTP が ok でないと throw・形が違えば throw",
  page.includes("type HomeState = 'loading' | 'ready' | 'empty' | 'error'") && page.split('\n').filter(l => l.includes('.catch(')).every(l => l.includes("setState('error')")) && page.includes('if (!r.ok) throw') && page.includes('if (!isExamplesBody(body)) throw'))
check('トップ: AbortController で時間切れ（15秒）・アンマウントで abort と clearTimeout', page.includes('new AbortController()') && page.includes('FETCH_TIMEOUT_MS = 15_000') && page.includes('return () => { alive = false; clearTimeout(timer); ctrl.abort() }'))
check('トップ: 実例1件の形も確かめる（changePct・elapsedBusinessDays が数・bars が配列・action が ACTION_LABEL のキー）', page.includes("typeof e.changePct === 'number' && typeof e.elapsedBusinessDays === 'number'") && page.includes('Array.isArray(e.bars) && e.bars.every(isBar)') && page.includes("typeof e.action === 'string' && e.action in ACTION_LABEL"))
check('トップ: error は文で出す（role="status"・ERROR_LINE）。「まだ無い」の文（EMPTY_LINE）とは別・失敗を「無い」と見せない',
  page.includes("const ERROR_LINE = 'AIの判断の記録を読み込めませんでした。記録が消えたわけではありません。時間をおいて、ページを読み込み直してください。'") && page.includes('<p role="status" className="text-small text-ink-2">{ERROR_LINE}</p>'))
check('トップ: 読み込み中は薄い面（Skeleton・aria-busy）で、回り続ける動きを持たない（R4）', page.includes('aria-busy="true"') && !/animate-(?:spin|pulse|ping|bounce)/.test(page + entry) && /\.ui\[data-ui\] \.skeleton \{[^}]*background: var\(--card\)/.test(homeCss))

console.log('■ 読み口 app/api/entry/examples/route.ts の外形')
check('route: ファイルがあり GET だけを export（POST 等は無い・use client 無し）', route.length > 0 && route.includes('export async function GET()') && !/export async function (?:POST|PUT|DELETE|PATCH)/.test(route) && !route.includes('use client'))
check('route: 成功は CDN 1時間＋stale-while-revalidate 1日', route.includes("'public, s-maxage=3600, stale-while-revalidate=86400'"))
check('route: 候補が無い／条件を満たさない → 200 で { examples: null }', route.includes('const body: ExamplesBody = { examples: null }') && route.includes("return NextResponse.json(body, { headers: { 'Cache-Control': CACHE_1H } })"))
check('route: 失敗は 502＋no-store＋和文（失敗を「無い」と見せない。原因はサーバーのログにだけ）', route.includes('status: 502') && route.includes("'Cache-Control': 'no-store'") && route.includes("const READ_FAILED_MESSAGE = 'AIの判断の記録を読み込めませんでした'") && route.includes('console.error('))
check('route: データ源は ai_sessions の blob（listSessions → learning.allDecisions）。ai_decisions の表は読まない', route.includes("import { listSessions } from '@/lib/ai-trader/store'") && route.includes('s.learning.allDecisions') && !/ai_decisions|AI_DECISIONS_TABLE|decision-store/.test(route))
check('route: 日足は getHistory(symbol, period, { allowMock: false })（実データのみ）。getQuote を呼ばない（出所と時刻を1つに＝R8）', route.includes('getHistory(c.symbol, period, { allowMock: false })') && !route.includes('getQuote'))
check('route: 騰落率は日足の系列から出す（判断日の終値 → 最終足の終値）', route.includes('changePct: ((last.close - base.close) / base.close) * 100') && route.includes('const base = bars[baseIdx]'))
check('route: 騰落率に記録側の価格（c.price）を使っていない（実際の株価と食い違うため・原則9）', !/changePct[^\n]*c\.price/.test(route))
check('route: 騰落率の起点にした足の日付（baseAsOf）を返し、判断日より後の足が無い候補は外す（0 で埋めない）', route.includes('baseAsOf: isoDate(barMs(base))') && route.includes('if (baseIdx < 0) continue'))
check('route: 選び方は lib/entry/answer-examples.ts の純関数（pickAnswerExamples・isEligible）を使う', route.includes("from '@/lib/entry/answer-examples'") && route.includes('pickAnswerExamples(enriched)') && route.includes('.filter(isEligible)'))
check('route: 古い順に足していく（並べ替えの鍵は decidedAt → symbol → reasoning）', route.includes('a.decidedAt !== b.decidedAt') && route.includes('a.symbol !== b.symbol') && route.includes('a.reasoning < b.reasoning'))
check('route: 社名を返さない（Example に name が無い）', !/\bname\b/.test(between(route, 'export interface Example', '\n}')))
check('route: 出所は Yahoo Finance（source）・最終足の日付（priceAsOf）を返す', route.includes("const PRICE_SOURCE = 'Yahoo Finance'") && route.includes('priceAsOf: isoDate(barMs(last))'))
check('route: 銘柄ごとの取得失敗は飛ばして数え、1件も取れなければ throw（「無い」に倒さない）', route.includes('failures++') && route.includes('if (failures > 0 && fetched === 0) throw new Error('))
check('route: AI推論を走らせない（anthropic・runTick・callClaude を呼ばない）', !/anthropic|runTick|callClaude/i.test(route))
check('route: 営業日は土日を除いて数える（getUTCDay が 0・6 でない日）＝事前の絞り込みだけに使う', route.includes('if (dow !== 0 && dow !== 6) n++'))
check('route: 画面に出す経過日数と 20 の判定は日足の本数から（bars.length - 1 - baseIdx）',
  route.includes('const tradingDaysAfter = bars.length - 1 - baseIdx') && route.includes('if (tradingDaysAfter < MIN_ELAPSED_BUSINESS_DAYS) continue') && route.includes('elapsedBusinessDays: tradingDaysAfter'))
check('route: 本番で service-role が無ければ 502 に倒す（設定漏れを「まだ無い」に化けさせない）', route.includes("process.env.NODE_ENV === 'production' && !hasServiceRole()"))

console.log('■ ハウスルール（design-taste-frontend。DECISIONS 2026-10-14 決定(2) の7か所）')
check('① 番号を落とす（上で確認済み）・② 段ラベルを落とす（見出しの上に小さなラベルの <p> が無い）', !/<p className=\{`?\$?\{?s\.small\}?`?\}>[^<]{1,12}<\/p>\s*<h[23]/.test(page))
check('③ 1px の線・枠を使わない: page・断片の TSX に border-t/b/l/r・h-px・divide-・<hr が無い', !/border-[tblrxy](?![a-z-])|\bh-px\b|\bw-px\b|divide-[xy]|<hr\b/.test(page + entry))
check('③ home.module.css: border は data-ui の内側（.ui[data-ui] …）のセレクタにだけ',
  homeCssBlocks.filter(b => /(^|[^-])border(?!-radius)/.test(b.body)).every(b => b.selector.includes('data-ui')))
check('④ グラデーションを落とす: layout のにじみ（radial-gradient）が無く、page・断片・home.module.css にも gradient が無い', !/gradient/.test(layout + page + entry + homeCss) && layout.includes('return <>{children}</>'))
check('⑤ すりガラスを使わない: backdrop-blur／backdrop-filter が無い', !/backdrop-blur|backdrop-filter/.test(page + entry + homeCss + layout))
check('⑥ 休んでいるものに影・発光を置かない: shadow が無い（主ボタンの発光も落とした＝R1 の許可2か所の1つ）', !/shadow/.test(page + entry + homeCss + layout))
check('⑦ 見出しは2行以内: h1 は <br /> で2行に固定・h2 は 2〜4語（9〜11字）', count(h1, '<br />') === 1 && ['与えて、返ってくる', '同じ1件が、こう変わる'].every(t => t.length <= 11))
check('R1: rgb(45 212 191 の直値（明るい青緑）が page・layout・断片に無い（にじみごと撤去）', !/rgb\(45[ _]212[ _]191/.test(screen) && !/#2DD4BF/i.test(homeCss))
check('R4: infinite が無い（page・layout・断片・home.module.css・globals.css）', !/infinite/.test(screen) && !/infinite/.test(homeCss) && !/infinite/.test(css))
check('home.module.css: 色はトークン（var(--…)）だけ・直値の色が無い', !/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(homeCss))
check('home.module.css: 面は不透明（--panel は color-mix で地を 5% 沈めた色。半透明の --surface を注記の面にしない）', homeCss.includes('--panel: color-mix(in srgb, var(--bg), var(--ink) 5%);') && !/\.ui\[data-ui\] \{[^}]*var\(--surface\)/.test(homeCss))
check('home.module.css: 文字の段階は5つ（14 / 17 / 20 / 27 / 28）', homeCss.includes('--step-small: 14px;') && homeCss.includes('--step-body: 17px;') && homeCss.includes('--step-lead: 20px;') && homeCss.includes('--step-head: 28px;') && homeCss.includes('--step-display: 27px;'))
check('home.module.css: 本文は 17px・行間 1.5・--ink（.page）。見出しの字間は 0', /\.page \{[^}]*font-size: var\(--step-body\)[^}]*line-height: 1\.5/.test(homeCss) && /\.h1 \{[^}]*letter-spacing: 0/.test(homeCss) && /\.h2 \{[^}]*letter-spacing: 0/.test(homeCss))
check('home.module.css: 小さな上書きラベルを作らない（uppercase・letter-spacing の正の値が無い）', !/text-transform:\s*uppercase|letter-spacing:\s*0\.\d/.test(homeCss) && !/uppercase|tracking-/.test(page + entry))
check('home.module.css: 節の間は空白だけ（--gap-section 96px／120px）', homeCss.includes('--gap-section: 96px;') && homeCss.includes('--gap-section: 120px;') && homeCss.includes('.section { margin-top: var(--gap-section); }'))
check('home.module.css: アクセント（--brand）の塗りはボタンと断片の内側だけ（見出し・線・下線に使わない）',
  homeCssBlocks.filter(b => /var\(--brand\)/.test(b.body)).every(b => /^\.button|data-ui/.test(b.selector) || b.selector.includes('.button')))
check('globals.css: :root のトークン（22個）は変えない（ホーム専用の寸法は home.module.css に閉じる）', count(between(css, ':root {', '\n}'), /^\s{2}--[a-z-]+:/gm) === 22 + 5 && !css.includes('--step-') && !css.includes('--anchor'))

console.log('■ 動き（スキル step 9: 入場・反応・移り変わり。transform と opacity だけ・待たせない）')
check('useReveal: IntersectionObserver で1度だけ（unobserve）・root に data-motion="on" を付けてから隠す・無ければ全部にすぐ data-in',
  reveal.includes('new IntersectionObserver(') && reveal.includes('io.unobserve(e.target)') && reveal.includes("el.setAttribute('data-motion', 'on')") && reveal.includes("for (const t of targets) t.setAttribute('data-in', '')"))
check('useReveal: 「動きを減らす」では隠さない（matchMedia(prefers-reduced-motion: reduce) で data-in を付けて終える）', reveal.includes("window.matchMedia('(prefers-reduced-motion: reduce)').matches") && reveal.indexOf('calm ||') < reveal.indexOf("el.setAttribute('data-motion', 'on')"))
check('home.module.css: 隠した状態は .page[data-motion="on"] の下・prefers-reduced-motion: no-preference の中だけ（script が無ければ全部見える）',
  /@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*?\.page\[data-motion="on"\] \[data-reveal\]:not\(\[data-in\]\) \{\s*opacity: 0;\s*transform: translateY\(24px\);/.test(homeCss) && count(homeCss, '[data-reveal]:not([data-in])') === 1)
check('home.module.css: 入場は opacity と transform だけ・60〜90ms 刻み（--i × 80ms／90ms）・@keyframes は rise の1つ',
  homeCss.includes('transition-delay: calc(var(--i, 0) * 80ms);') && homeCss.includes('animation-delay: calc(var(--i, 0) * 90ms + 120ms);') && count(homeCss, '@keyframes') === 1 && /@keyframes rise \{\s*from \{ opacity: 0; transform: translateY\(18px\); \}\s*to \{ opacity: 1; transform: none; \}/.test(homeCss))
check('home.module.css: transition は性質を名指し（transition: all が無い）・ease-in（単独）を使わない', !/transition:\s*all/.test(homeCss) && !/[^-\w]ease-in(?!-out)\b/.test(homeCss))
check('トップ: ヒーローの入場は4つ（h1・支えの1文・動作・実演パネル）・節の入場は data-reveal が 16 以上・useReveal(root)',
  count(hero, '${s.rise}') === 4 && count(page, 'data-reveal') >= 16 && page.includes('useReveal(root)') && page.includes('<div ref={root} className={s.page}>'))
check('home.module.css: すべての操作部に押下・ホバー・焦点の反応（.button:active scale・:hover は (hover: hover) の中・:focus-visible は --focus の 2px）',
  homeCss.includes('.button:active { transform: scale(0.97); }') && /@media \(hover: hover\) and \(pointer: fine\) \{\s*\.button:hover \{ background: var\(--brand-strong\); \}/.test(homeCss) && /\.textLink:focus-visible,[\s\S]*?outline: 2px solid var\(--focus\)/.test(homeCss))
check('トップ: data-ui の断片は7つ（実演パネル1・節1に3・節2に3）で、h1／h2 を包まない', count(page, 'data-ui') === 6 && count(demo, 'data-ui') === 1 && !/data-ui[^>]*>[\s\S]{0,200}<h[12]/.test(page))
check('スマホで横にはみ出さない作り（.stack の子は min-width: 0・.dd は overflow-wrap: anywhere・複製は minmax(0, 640px)）', homeCss.includes('.stack > * {\n  grid-area: 1 / 1;\n  min-width: 0;\n}') && /\.ui\[data-ui\] \.dd \{[^}]*overflow-wrap: anywhere/.test(homeCss) && homeCss.includes('grid-template-columns: minmax(0, 640px);'))

console.log('■ フッター（R10）・SITE_DESC・DESIGN.md')
const footer = between(rootLayout, '<footer', '</footer>')
check('app/layout.tsx: フッターの枠に 運営者情報／お問い合わせ／プライバシーポリシー／利用規約（文字・準備中）', ['InvestSim', '運営者情報', 'お問い合わせ', 'プライバシーポリシー', '利用規約', '準備中'].every(w => footer.includes(w)))
const operatorLine = footer.split('\n').find(l => l.includes('運営者情報')) ?? ''
check('app/layout.tsx: 運営者情報／お問い合わせ／プライバシーポリシー／利用規約 の行は <a>・<Link> にしない（行き先が未整備）・small/--muted', operatorLine.length > 0 && !/<a\b|<Link\b/.test(operatorLine) && footer.includes('text-small text-muted'))
check('app/layout.tsx: フッターに /watch への常設リンクが1本ある（{SHOW_AI_WATCH && ( の内側。出し分けの規則は scripts/check-watch-reachable.ts）', count(footer, 'href="/watch"') === 1 && footer.includes('{SHOW_AI_WATCH && ('))
check('app/layout.tsx: 「無料」はフッターの1文だけ・打消しとセット', count(rootLayout, '無料') === 1 && footer.includes('現在は無料で公開しています。将来、有料の機能を作る可能性があります。'))
check('app/(night)/layout.tsx: フッターを持たない・にじみを持たない・children をそのまま返す', !layout.includes('<footer') && !layout.includes('radial-gradient') && layout.includes('return <>{children}</>'))
check("layout: 'use client' を付けていない（Server Component のまま）", !/['"]use client['"]/.test(layout))
const siteDesc = between(rootLayout, 'const SITE_DESC', '\n\n')
check('app/layout.tsx: SITE_DESC に 名人・投資家・無料・リスクゼロ・上手くなる・うまくなる が無い（検索結果と OGP に出る文）', siteDesc.length > 0 && !/名人|投資家|無料|リスクゼロ|上手くなる|うまくなる/.test(siteDesc), siteDesc)
check('app/layout.tsx: SITE_DESC は「実際のお金は1円も動きません」', siteDesc.includes('実際のお金は1円も動きません'))
const design = read('DESIGN.md')
check('DESIGN.md §4-2: 「R1〜R8 は機械で判定できる形」（R9〜R12 は機械判定でない）', design.includes('R1〜R8 は機械で判定できる形にしてあります') && !design.includes('すべて機械で判定できる形にしてあります'))
check('DESIGN.md §4-2 R3: 「ヒーロー（最初の1画面）のカードに騰落率を置かない」', design.includes('ヒーロー（最初の1画面）のカードに騰落率を置かない'))
const SIG_CHECK_NAME = 'globals.css: --axis と --rule-line が :root にある'
check('DESIGN.md §5-1・§10: check-signals-undecidable.ts を行番号（:数字）で参照していない（検査名で参照する）', !/check-signals-undecidable\.ts:\d+/.test(design))
check(`DESIGN.md §5-1・§10: 検査名「${SIG_CHECK_NAME}」で参照している（2か所）`, count(design, `「${SIG_CHECK_NAME}」`) === 2, `×${count(design, `「${SIG_CHECK_NAME}」`)}`)
check('check-signals-undecidable.ts に、その名前の検査が実際にある（DESIGN.md の参照が正しい）', read('scripts/check-signals-undecidable.ts').includes(`check('${SIG_CHECK_NAME}`))

console.log('■ lib/entry/samples.ts（禁止語の判定は1か所）')
check('samples.ts: isTextShowable が forbiddenWordsIn(…, FORBIDDEN_IN_OUTPUT) を呼ぶ唯一の場所。isShowable（冒頭1文）／isFullyShowable（全文）はそれを呼ぶ',
  samplesSrc.includes('return forbiddenWordsIn(text, FORBIDDEN_IN_OUTPUT).length === 0') && count(samplesSrc, 'forbiddenWordsIn(') === 1
  && samplesSrc.includes('return isTextShowable(firstSentence(d.reasoning))') && samplesSrc.includes('return isTextShowable(d.reasoning)') && !/from 'react'|fetch\(|localStorage/.test(samplesSrc))
const CLEAN = 'RSI81買われすぎ＋BB上限超え。'
const BAD_TAIL = `この先は${FORBIDDEN_IN_OUTPUT[FORBIDDEN_IN_OUTPUT.length - 1]}と見る。`
const D = (action: SampleDecision['action'], reasoning = CLEAN + '出来高は平均並み。'): SampleDecision => ({ action, reasoning })
check('firstSentence: 最初の「。」まで／「。」が無ければ全文', firstSentence(CLEAN + '出来高は平均並み。') === CLEAN && firstSentence('句点なし') === '句点なし')
check('isTextShowable: 禁止語を含む文は false・含まない文は true（forbidden.ts の実物の語で）', isTextShowable('この銘柄は上がる。') === false && isTextShowable(CLEAN) === true)
check('isShowable（冒頭1文）と isFullyShowable（全文）の違い: 2文目だけに禁止語 → 冒頭1文は通るが全文は通らない',
  isShowable(D('buy', CLEAN + BAD_TAIL)) === true && isFullyShowable(D('buy', CLEAN + BAD_TAIL)) === false && isFullyShowable(D('buy')) === true)
check('pickSamples: 0件／両方 buy → null。禁止語の件は飛ばす（関数は残しているので壊れていないことだけ見る）',
  pickSamples([]) === null && pickSamples([D('buy'), D('buy')]) === null && (() => { const a = D('buy'), c = D('hold'); const r = pickSamples([a, D('sell', CLEAN + BAD_TAIL), c]); return r !== null && r[0] === a && r[1] === c })())

console.log('')
console.log(`PASS ${passed} 件 / FAIL ${failed} 件`)
if (failed) process.exit(1)
console.log('すべてPASS')
