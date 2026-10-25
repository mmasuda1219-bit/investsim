// トップページ（入口画面）の検査。L2「静かな楽器」（2026-10-14）で建て直し、2026-10-25 に Steep の様式で作る investsim 版
// （DECISIONS.md 同日。ホームの正を quiet-instrument から替えた）に合わせて書き換えた。
//   $env:PATH = "C:\Program Files\nodejs;$env:PATH"; npx tsx scripts/check-entry.ts
//
// 法務の条件（legal-compliance 2026-09-25 (G)・2026-09-28 論点5〜7・2026-09-29）と、ホームの見た目の規則（1px の線・枠・グラデーション・
// すりガラス・番号・小さな上書きラベルを使わない。影は実演パネルの1か所だけ。本文 17px・13px 未満を作らない）を機械で見る。
// **法務の行は 2026-10-25 の書き換えでも一字も緩めていない**（免責・畳まない・薄めない・13px 未満禁止・書かない語・AI推論なし・
// 1円も動きません・騰落率なし・/stocks/ なし・全員同じ・読み口・フッター）。文言を固定した行は、読む範囲（between）だけ新しい節へ移した。
// PASS の合計は S2 出荷時（150件）を下回らない（2026-09-28 の不変条件「検査の合計件数は…下回らない」を引き継ぐ）。
//
// 見るもの:
//  - 免責は共通部品 <Disclaimer part="general" />（DISCLAIMER_TEXT）が末尾・地の上・畳まない・線で区切らない。手書き免責が無い
//  - 画面に使わない語: 見本／お手本／模範／正解例／自動売買／的中／当たった／外れた／正解率、および単独の「答え合わせ」。
//    従来の リスクゼロ／うまくなる／上手くなる／おすすめ／買い時／売り時／無料／今日、名人／投資家、R6・R9・R12 の語。
//    AI 出力向けの禁止語（FORBIDDEN_IN_OUTPUT）も画面の文言に無い（注記の打消し「推奨するものではありません」だけ例外）
//  - ヒーロー: 明朝・2行の見出し（28/44/52px）・支えの1文・主ボタン /trade・文字リンク /review/backfill・騰落率を置かない（R3）・
//    1200px 以上は左に文・右に実演パネル（影はこの1か所だけ＝shadow-float クラス）
//  - 実演パネル（components/entry/DemoPanel.tsx）: reason.ts の問い・3つの状態の移り変わり（1.6秒／5.5秒）・触ると止まる・
//    タブが隠れたら止める・「動きを減らす」で動かさない・保存も送信もしない
//  - 4段（<ol>・番号の文字なし・data-stage が study → compare → write → review）。見出しは labelOf(href)・主張は hintOf(href)
//    学ぶ: {SHOW_LAB_9983 && ( の内側・1社固定の断り（FIXED_COMPANY_NOTE を import）・数字は lib/lab/9983.ts の Sourced から出典と時点つき
//    くらべる: 左右に並べる断片（ここで1回だけ）・「ちがい」・注記（C）
//    書く: この節だけ --wash の面・--brand の文字を置かない
//    振り返り: 押すと読み返しの形に変わる1件・AIの実例2件（AnswerCheckCard）・選び方の1文・注記（C）
//  - 締め: ふつうの一文と1つの動作
//  - 「全員に同じものを同じ順で」: localStorage／sessionStorage／document.cookie／useSearchParams が無く、fetch は /api/entry/examples の1本
//  - 読み口 app/api/entry/examples/route.ts の外形（S2 から変えない）
//  - 見た目: 明朝は h1・h2 だけ（400／500・斜体なし・import は app/(night)/layout.tsx の1行）・角丸 12／16 の2種・色はトークンだけ・
//    --wash と --panel の上の文字のコントラスト（color-mix を手計算）・動きは最初の1画面の入場だけ（スクロールの入場なし）・infinite なし
//  - フッターの枠（R10）・SITE_DESC・lib/entry/samples.ts の関数を実際に呼ぶ
//
// 実ネットワーク不要。ファイルを読むだけ。選び方の純関数の検査は scripts/check-answer-examples.ts。
// 見た目の実測（2行・本文 17px・線・影・動いた要素数）は taste-skill の inspect.mjs（実機ブラウザ）が担う。

import fs from 'fs'
import path from 'path'
import { DISCLAIMER_TEXT } from '../components/ui/Disclaimer'
import { FORBIDDEN_IN_OUTPUT, forbiddenWordsIn } from '../lib/investors/rulebooks/forbidden'
import { firstSentence, isFullyShowable, isShowable, isTextShowable, pickSamples, type SampleDecision } from '../lib/entry/samples'
import { fieldsFor } from '../lib/trade/reason'
import { MIN_ELAPSED_BUSINESS_DAYS } from '../lib/entry/answer-examples'
import { LAB_9983, fyLabel } from '../lib/lab/9983'
import { FIXED_COMPANY_NOTE } from '../lib/lab/fixed-note'
import { formatSignedPercent } from '../lib/lab/money'
import { signWord } from '../lib/lab/display'

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
/** `<div data-ui` で始まる要素の中身（対応する </div> まで）を全部返す。断片が見出しを包んでいないかを見るため */
function dataUiElements(src: string): string[] {
  const out: string[] = []
  let from = 0
  for (;;) {
    const start = src.indexOf('<div data-ui', from)
    if (start < 0) break
    let depth = 0
    let i = start
    while (i < src.length) {
      if (src.startsWith('<div', i) && /[\s>]/.test(src[i + 4] ?? '')) { depth++; i += 4; continue }
      if (src.startsWith('</div>', i)) { depth--; i += 6; if (depth === 0) break; continue }
      i++
    }
    out.push(src.slice(start, i))
    from = start + 1
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
/** 段の説明文（hint）も NAV から読む（navLabel と同じ理由で import しない） */
function navHint(href: string): string {
  const src = stripComments(read('components/SiteNav.tsx'))
  const body = src.slice(src.indexOf('export const NAV = ['), src.indexOf('] as const'))
  const m = new RegExp(`\\{ href: '${href}',\\s+label: '[^']+',\\s+hint: '([^']+)'`).exec(body)
  if (!m) throw new Error(`navHint: ${href} が NAV に無い`)
  return m[1]
}
const PICK_NOTE = '判断日が古い順に、値上がりした例と値下がりした例を1件ずつ。成績のよい判断を選んでいるのではありません。'
const LINE_NOTE = '画面の例です。線は実際の株価から引き、無いときは出しません。'

// 節の切り出し（page の JSX の目印で区切る）
const hero = between(page, 'data-section="hero"', '</section>')
const closing = between(page, 'data-section="closing"', '</section>')
const stagesList = between(page, '<ol className={s.stages}', '</ol>')
const stStudy = between(page, 'data-stage="study"', '</li>')
const stCompare = between(page, 'data-stage="compare"', '</li>')
const stWrite = between(page, 'data-stage="write"', '</li>')
const stReview = between(page, 'data-stage="review"', '</li>')
/** 段の鍵 → 路（見出しと主張は路から引く） */
const STAGES = [['study', '/study', stStudy], ['compare', '/learn', stCompare], ['write', '/trade', stWrite], ['review', '/review', stReview]] as const
const entry = fragments + '\n' + demo
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
check('home.module.css: opacity は 0 と 1 だけ（動きの始点・終点。注記を薄めるための小数の opacity が無い）', !/opacity:\s*0\.\d/.test(homeCss) && count(homeCss, 'opacity: 0;') >= 1 && count(homeCss, 'opacity: 1;') >= 1)
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
  // 2026-10-25: 学ぶ節で描画される文字列（1社固定の断り・hintOf('/study')・出典の文字・期の呼び名）も照合する（page の中では式なので文字列に出てこない）
  const studyRendered = [FIXED_COMPANY_NOTE, navHint('/study'), LAB_9983.netProfit.yoy?.source.label ?? '', LAB_9983.price.changePct.source.label, fyLabel(LAB_9983.company.latestFy)].join('\n')
  const copy = (page + '\n' + entry + '\n' + card + '\n' + studyRendered).split('推奨するものではありません').join('')
  const hits = forbiddenWordsIn(copy, FORBIDDEN_IN_OUTPUT)
  check('トップ・断片・カード・学ぶ節の描画文字列（FIXED_COMPANY_NOTE・hintOf(/study)・出典）: FORBIDDEN_IN_OUTPUT の語が画面の文言に無い（打消しの注記を除く）', hits.length === 0 && studyRendered.includes('この会社を勧めるものではありません'), hits.join(' / '))
}
check('トップ・断片: AI推論を走らせない（/api/ai-session/[id]/tick・/api/analyze を呼ばない）', !/\/tick|\/api\/analyze|anthropic/i.test(page + entry))
check('架空の判断・銘柄を書いていない（AAPL 等のティッカーの直書きがページ・断片に無い）', !/['"](?:AAPL|MSFT|NVDA|TSLA|AMZN|7203\.T|9984\.T)['"]/.test(page + entry))
check('トップ・断片: 番号の段ラベル（01 書く／02 くらべる／03 読み返す）と padStart が無い（スキル「No index numbering」）', !/0[1-3] (?:書く|くらべる|読み返す)/.test(screen) && !/padStart\(/.test(page + entry))
check('トップ・断片: 「01」「02」「03」の文字列を画面に出さない', !/[>"'`]\s*0[1-3]\s*[<"'`]/.test(page + entry))

console.log('■ ヒーロー（R3: 騰落率を置かない）')
const h1 = between(page, '<h1', '</h1>')
check('h1 は「買う理由を書いて、残す。／N営業日後に、読み返す。」の2行（<br /> で切り、N は MIN_ELAPSED_BUSINESS_DAYS）',
  /買う理由を書いて、残す。<br \/>\{MIN_ELAPSED_BUSINESS_DAYS\}営業日後に、読み返す。/.test(h1) && h1.includes('className={`${s.h1} ${s.rise}`}'))
check('h1 は1つだけ（display は1画面に1つ）', count(page, '<h1') === 1)
{
  const lines = h1.replace(/^<h1[^>]*>/, '').replace(/<\/h1>$/, '').split('<br />')
    .map(t => t.replace('{MIN_ELAPSED_BUSINESS_DAYS}', String(MIN_ELAPSED_BUSINESS_DAYS)).trim())
  check('h1 の2行はそれぞれ14字以下（360px の 28px でも2行に収まる長さ）', lines.length === 2 && lines.every(l => [...l].length <= 14), lines.map(l => `${l}（${[...l].length}字）`).join(' / '))
}
check("h1 は明朝（var(--font-display)）・var(--step-display)・太さ var(--weight-display)・斜体なし・行間 1.35・字間 0.01em・palt（vw や clamp で大きくしない）",
  /\.h1 \{[^}]*font-family: var\(--font-display\);[^}]*font-size: var\(--step-display\);[^}]*font-weight: var\(--weight-display\);[^}]*font-style: normal;[^}]*line-height: 1\.35;[^}]*letter-spacing: 0\.01em;[^}]*font-feature-settings: 'palt';/.test(homeCss)
  && !/\.h1 \{[^}]*(?:vw|clamp\()/.test(homeCss))
check('h1 の大きさは 28px（スマホ）→ 44px（768px 以上）→ 52px（1200px 以上）の3つの宣言だけ',
  count(homeCss, /--step-display:\s*\d+px;/g) === 3 && homeCss.includes('--step-display: 28px;')
  && between(homeCss, '@media (min-width: 768px) {\n  .page {', '}').includes('--step-display: 44px;')
  && between(homeCss, '@media (min-width: 1200px) {\n  .page {', '}').includes('--step-display: 52px;'))
check('トップ: text-display（52px / 900）を使わない（ホームの見出しは home.module.css の段階）', !page.includes('text-display') && !entry.includes('text-display'))
check('支えの1文: 「仮想資金の練習です。／売買で実際のお金は1円も動きません。」（作者が <br /> で切る・本文の大きさ 17px・--ink）',
  hero.includes('仮想資金の練習です。<br />売買で実際のお金は1円も動きません。') && /\.support \{[^}]*font-size: var\(--step-body\);[^}]*color: var\(--ink\);/.test(homeCss))
check('主ボタン: /trade「1件目のメモを書く」が s.button（ヒーローに1つ・アクセントはここだけ）', /<Link href="\/trade" className=\{s\.button\}>1件目のメモを書く<\/Link>/.test(hero) && count(hero, 'className={s.button}') === 1)
check('文字リンク: /review/backfill「過去に買った株を記録する →」が s.textLink', /<Link href="\/review\/backfill" className=\{s\.textLink\}>過去に買った株を記録する →<\/Link>/.test(hero))
check('home.module.css: ボタンは1種類（.button: 48px・左右 24px・角丸 var(--radius)・--brand の塗り・600 16px/1・影なし）',
  /\.button \{[^}]*min-height: 48px;[^}]*padding: 0 24px;[^}]*border-radius: var\(--radius\);[^}]*background: var\(--brand\);[^}]*font-size: 16px;[^}]*font-weight: 600;[^}]*line-height: 1;/.test(homeCss) && !/\.button \{[^}]*shadow/.test(homeCss))
check('home.module.css: 角丸は2種類（--radius: 12px＝ボタンと小さな面／--radius-face: 16px＝断片・実演パネル・「書く」の面）。ページ側の角丸はすべてこの2つの var・24px とピル（9999px・999px）が無い',
  homeCss.includes('--radius: 12px;') && homeCss.includes('--radius-face: 16px;')
  && homeCssBlocks.filter(b => !b.selector.includes('data-ui') && /border-radius/.test(b.body)).every(b => /border-radius:\s*var\(--radius(?:-face)?\)/.test(b.body))
  && /\.ui\[data-ui\] \{[^}]*border-radius: var\(--radius-face\)/.test(homeCss) && !/border-radius:\s*(?:24px|9{3,}px|50%)/.test(homeCss))
check('ヒーローに騰落率が無い（changePct・fmtSignedPct・answerSentence・% を置かない＝R3）', hero.length > 0 && !/changePct|fmtSignedPct|answerSentence|%/.test(hero))
check('ヒーローに /stocks/ へのリンクが無い（法務条件。ページ・断片全体でも無い）', !(page + entry).includes('/stocks/'))
check('ヒーロー: 1200px 以上は2列（minmax(0, 620px) 440px・間 44px）・文の列は 620px まで・実演パネルは 48px 下げる（.heroAside translateY(48px)）',
  homeCss.includes('@media (min-width: 1200px) {\n  .hero {\n    display: grid;\n    grid-template-columns: minmax(0, 620px) 440px;\n    gap: 44px;')
  && /\.heroCol \{[^}]*max-width: 620px/.test(homeCss) && /\.heroAside \{[^}]*transform: translateY\(48px\)/.test(homeCss))
check('ヒーロー: 1200px 未満は実演パネルが下端から覗く（.heroPanel 440px まで・--peek 120px（スマホ）／90px（768px 以上）・.heroTop の min-height が 100svh から --peek を引く）。1200px 以上は 100svh を基準にしない',
  /\.heroPanel \{[^}]*width: min\(440px, 100%\)/.test(homeCss) && homeCss.includes('--peek: 90px;') && homeCss.includes('--peek: 120px;')
  && /\.heroTop \{[^}]*min-height: calc\(100svh[^}]*var\(--peek\)/.test(homeCss) && homeCss.includes('.heroTop { min-height: 0; padding-top: 0; }'))
check('ヒーロー: 768px 以上は実演パネルの面が表示中の層の高さに縮む（表示していない層は position: absolute）・下の節がずれないよう .heroAside が 600px を確保する（2026-10-25 1440px の白い空き）',
  homeCss.includes("@media (min-width: 768px) {\n  .heroAside { min-height: 600px; }\n  .heroPanel .stack { position: relative; }\n  .heroPanel .layer:not([data-on]) {\n    position: absolute;"))
check('ヒーロー: 実演パネル <DemoPanel onDraft={setDraft} /> が s.heroPanel の中・入場 s.rise・影は shadow-float クラス（s.heroAside の中）',
  /<div className=\{s\.heroAside\}>\s*<div className=\{`\$\{s\.heroPanel\} \$\{s\.rise\} shadow-float`\} style=\{idx\(3\)\}>\s*<DemoPanel onDraft=\{setDraft\} \/>/.test(hero))
{
  const h2s = [...page.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/g)].map(m => m[1].trim())
  check("ヒーローより下に h1 が無く、h2 は段ごとに1つ（4つ）で中身は {labelOf('/study')}・{labelOf('/learn')}・{labelOf('/trade')}・{labelOf('/review')} がこの順",
    count(page.slice(page.indexOf('<ol className={s.stages}')), '<h1') === 0
    && h2s.join(',') === "{labelOf('/study')},{labelOf('/learn')},{labelOf('/trade')},{labelOf('/review')}", h2s.join(' / '))
}
check('L2 の節見出し（「与えて、返ってくる」「同じ1件が、こう変わる」）と順序の語の h3（まず／つぎに／そして）が残っていない',
  !page.includes('与えて、返ってくる') && !page.includes('同じ1件が、こう変わる') && !/<h3/.test(page))

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
check('DemoPanel: 最初に出すのは記録された1件（useState(2)）で、順は 記録 → 空欄 → 記入例（(a + 1) % LAYERS）。覗きに実際に書かれた文の行が入る（dense・ヒーローの断片と詰めたカードは padding-top 8px・dl は 2px）',
  demo.includes('const [active, setActive] = useState(2)') && demo.includes('setActive(a => (a + 1) % LAYERS)') && demo.includes('dense') && fragments.includes("data-dense={dense ? '' : undefined}")
  && /\.heroPanel \.ui\[data-ui\] \{ padding-top: 8px;/.test(homeCss) && homeCss.includes('.ui[data-ui] .dl[data-dense] { margin-top: 2px; }') && homeCss.includes('.ui[data-ui] .card[data-dense] { padding-top: 8px; }') && fragments.includes("<div className={s.card} data-dense={dense ? '' : undefined}>"))
check('DemoPanel: 詰めた記録の層でも「記入例が入った状態です。」（または自分の文である旨）を同じカードの中に書く', demo.includes("'記入例が入った状態です。'") && demo.includes('あなたが上の欄に書いた文です（保存も送信もしていません）。'))
check('DemoPanel・断片: 保存も送信もしない（fetch／XMLHttpRequest／sendBeacon／localStorage／sessionStorage／cookie が無い）',
  !/fetch\(|XMLHttpRequest|sendBeacon|localStorage|sessionStorage|document\.cookie/.test(entry))
check('DemoPanel: 時刻・乱数で中身を変えない（Date.now／Math.random／new Date が無い）', !/Date\.now|Math\.random|new Date\(/.test(entry))
check('断片: 訪問者の文があるかは isTyped（空欄だけ・記入例のままは false）。画面に出すメモは memoToShow', fragments.includes('export function isTyped(draft: Memo | null): boolean') && fragments.includes('return filled && !same') && fragments.includes('return isTyped(draft) ? (draft as Memo) : EXAMPLE_MEMO'))
check('home.module.css: 隠れている層は visibility: hidden（読み上げ・焦点・inspect の計測から外れる）', /\.layer \{[^}]*visibility: hidden/.test(homeCss) && /\.layer\[data-on\] \{[^}]*visibility: visible/.test(homeCss))

console.log('■ 4段（学ぶ → くらべる → 書く → 振り返り。<ol>・番号の文字なし・見出しは路から引く）')
check('4段は <ol className={s.stages}>（順序は要素で持つ）・data-stage が study → compare → write → review の順',
  stagesList.length > 0 && [...page.matchAll(/data-stage="(\w+)"/g)].map(m => m[1]).join(',') === 'study,compare,write,review')
check('home.module.css: 4段の <ol> は list-style: none（番号の記号を出さない）・節の間は --gap-section', /\.stages \{[^}]*list-style: none/.test(homeCss) && homeCss.includes('.section { margin-top: var(--gap-section); }'))
check('各段は見出し（h2・labelOf）→ 主張（s.lead・hintOf）の順で開く（同じ路から引く）',
  STAGES.every(([key, href, st]) => st.includes(`<h2 id="${key}-heading" className={s.h2}>{labelOf('${href}')}</h2>`) && st.includes(`<p className={s.lead}>{hintOf('${href}')}</p>`)
    && st.indexOf('<h2') < st.indexOf('{hintOf(')), STAGES.filter(([, , st]) => st.length === 0).map(([k]) => k).join(','))
check('段の呼び名は NAV と一致（学ぶ／くらべる／書く／振り返り）・トップで NAV を添字で読まない', navLabel('/study') === '学ぶ' && navLabel('/learn') === 'くらべる' && navLabel('/trade') === '書く' && navLabel('/review') === '振り返り' && !/NAV\[/.test(page))
check('home.module.css: 1200px 以上は各段が「左に文 440px・右に断片 600px まで」（文は常に左＝.stageText が列1・.stageBody が列2）',
  /\.stage \{\s*grid-template-columns: minmax\(0, 440px\) minmax\(0, 600px\);/.test(between(homeCss, '@media (min-width: 1200px) {\n  .stage {', '}')) && homeCss.includes('.stageText { grid-column: 1; }') && homeCss.includes('.stageBody { grid-column: 2; }')
  && /\.stageText \{[^}]*max-width: var\(--col-text\)/.test(homeCss) && /\.stageBody \{[^}]*max-width: var\(--col-wide\)/.test(homeCss) && homeCss.includes('--col-text: 560px;') && homeCss.includes('--col-wide: 760px;'))

console.log('■ 学ぶ（1社固定の題材。数字は lib/lab/9983.ts の Sourced から）')
{
  const gated = /\{SHOW_LAB_9983 && \(([\s\S]*?)<\/li>\s*\)\}/.exec(page)
  check('学ぶ: 節ごと {SHOW_LAB_9983 && ( の内側（false なら <li> ごと消える）・/study へのリンクも内側の1本だけ',
    gated != null && /^\s*<li className=\{`\$\{s\.section\} \$\{s\.stage\}`\} data-stage="study"/.test(gated[1]) && count(page, '"/study"') === 1 && count(gated[1], '"/study"') === 1
    && page.includes("import { SHOW_AI_WATCH, SHOW_LAB_9983 } from '@/lib/features'"))
}
check('学ぶ: 1社固定の断りは /study と同じ定数 FIXED_COMPANY_NOTE を lib/lab/fixed-note.ts から import（文字列で書き直さない。app/study/client.tsx を import しない＝/study の部品をホームの JS に入れない）・h2 の直下・data-ui の外',
  page.includes("import { FIXED_COMPANY_NOTE } from '@/lib/lab/fixed-note'") && !page.includes('@/app/study/client')
  && /<h2 id="study-heading" className=\{s\.h2\}>\{labelOf\('\/study'\)\}<\/h2>\s*<p className=\{s\.fixedNote\}>\{FIXED_COMPANY_NOTE\}<\/p>/.test(stStudy)
  && !page.includes('この会社を勧めるものではありません') && stStudy.indexOf('{FIXED_COMPANY_NOTE}') < stStudy.indexOf('data-ui'))
check('home.module.css: 1社固定の断り（.fixedNote）は本文と同じ 17px・--ink（/study の「リードと同じ大きさ・薄くしない」に寄せる。畳まない・薄めない）',
  /\.fixedNote \{[^}]*font-size: var\(--step-body\);[^}]*color: var\(--ink\);/.test(homeCss) && homeCss.includes('--step-body: 17px;') && !/\.fixedNote \{[^}]*opacity/.test(homeCss))
check('学ぶ: 題材の1行は事実だけ「純利益が増えたと発表された翌営業日に、株価は下がりました。なぜでしょう。」（評価の語「良い」を使わない）',
  stStudy.includes('<p className={s.body}>純利益が増えたと発表された翌営業日に、株価は下がりました。なぜでしょう。</p>') && !/良い|好調|悪い|不調/.test(stStudy))
{
  // 「発表された翌営業日」: 発表日（company.latestAnnouncement）の次の平日が、前日比の日（price.closeDate）。
  // 純利益の前期比の出典（決算短信）の時点も発表日と同じ。祝日は見ない（平日だけで数える近似）
  const ann = LAB_9983.company.latestAnnouncement.value
  const d = new Date(`${ann}T00:00:00Z`)
  do { d.setUTCDate(d.getUTCDate() + 1) } while (d.getUTCDay() === 0 || d.getUTCDay() === 6)
  const nextBiz = d.toISOString().slice(0, 10)
  check('学ぶ: 題材の1行が data と食い違わない（純利益の前期比がプラス・その発表日の次の平日が前日比の日・前日比がマイナス・前期比の出典の時点が発表日）',
    (LAB_9983.netProfit.yoy?.value ?? 0) > 0 && LAB_9983.price.changePct.value < 0 && nextBiz === LAB_9983.price.closeDate && LAB_9983.netProfit.yoy?.source.asOf === ann,
    `${LAB_9983.netProfit.yoy?.value} / ${LAB_9983.price.changePct.value} / 発表 ${ann} → 次の平日 ${nextBiz}・前日比の日 ${LAB_9983.price.closeDate}`)
}
check('学ぶ: 数字は LAB_9983.netProfit.yoy と LAB_9983.price.changePct の .value・出典は .source.label と .source.asOf・期は fyLabel・日は price.closeDate',
  page.includes('const STUDY_NET_PROFIT_YOY = LAB_9983.netProfit.yoy') && page.includes('const STUDY_PRICE_CHANGE = LAB_9983.price.changePct')
  && stStudy.includes('{signedWithWord(STUDY_NET_PROFIT_YOY.value)}') && stStudy.includes('{signedWithWord(STUDY_PRICE_CHANGE.value)}')
  && stStudy.includes('{STUDY_NET_PROFIT_YOY.source.label}・{STUDY_NET_PROFIT_YOY.source.asOf}') && stStudy.includes('{STUDY_PRICE_CHANGE.source.label}・{STUDY_PRICE_CHANGE.source.asOf}')
  && stStudy.includes('{LAB_9983.price.closeDate}') && stStudy.includes('{fyLabel(LAB_9983.company.latestFy)}'))
check('学ぶ: 数字と日付の直書きが無い（25.3・4.04・2026-10-0… がページに無い）', !/25\.3|4\.04|2026-10-0/.test(page))
check('学ぶ: 符号は formatSignedPercent（U+2212）と signWord（語）で示し、色を付けない（signStyle・text-danger・text-success を使わない）',
  page.includes("import { formatSignedPercent } from '@/lib/lab/money'") && page.includes("import { signWord } from '@/lib/lab/display'") && !/signStyle|signColor|text-danger|text-success/.test(page)
  && formatSignedPercent(-4.04) === '\u22124.04%' && signWord(-1) === 'マイナス' && signWord(1) === null)
check('学ぶ: 数字の面は data-ui の1つ・桁をそろえる（.figure は tabular-nums・--ink。色を付けない）・出典と時点は .meta（13px・--muted）',
  count(stStudy, 'data-ui') === 1 && count(stStudy, 'className={s.meta}') === 2 && /\.ui\[data-ui\] \.figure \{[^}]*color: var\(--ink\);[^}]*font-variant-numeric: tabular-nums/.test(homeCss))

console.log('■ くらべる（左右に並べる断片はここで1回だけ）')
check('くらべる: 本文「与えるのは、上の文そのままです。」（面を置かない）・断片＝左右に並べる（CompareView・data-ui）・CompareView はページに1回',
  stCompare.includes('与えるのは、上の文そのままです。') && !stCompare.includes('className={s.call}') && /<div data-ui className=\{s\.ui\}>\s*<CompareView memo=\{memo\} typed=\{typed\} older=\{older\} aiFallback=\{aiFallback\} \/>/.test(stCompare) && count(page, '<CompareView') === 1)
check('CompareView: 左「あなたが書いたこと（記入例）」／右「このサイトのAIが書いたこと」・系列の見分けは線の見本（Swatch: SERIES.you／SERIES.ai）で文字に色を使わない',
  fragments.includes("{typed ? 'あなたが書いたこと' : 'あなたが書いたこと（記入例）'}") && fragments.includes('このサイトのAIが書いたこと') && fragments.includes('<Swatch style={SERIES.you} />') && fragments.includes('<Swatch style={SERIES.ai} />') && !/style=\{\{\s*color/.test(page + entry))
check('CompareView: 「左は記入例、右はこのサイトのAIが実際に書いた記録です。」を明示。自分の文のときは「保存も送信もしていません」の文に替わる',
  fragments.includes("export const PAIR_NOTE_SAMPLE = '左は記入例、右はこのサイトのAIが実際に書いた記録です。'") && fragments.includes('保存も送信もしていません）。右はこのサイトのAIが実際に書いた記録です。') && fragments.includes('{typed ? PAIR_NOTE_TYPED : PAIR_NOTE_SAMPLE}'))
check('CompareView: 右は older（2件のうち判断日が古い方）の理由の全文＋銘柄コード・方向の札・判断日', fragments.includes('{older.reasoning}') && fragments.includes('{older.symbol}・{ACTION_LABEL[older.action]}・判断日 {fmtSlashDate(older.decidedAt)}'))
check('くらべる: 「ちがい」の1文は静的な説明文（差を自動判定して採点しない。「判定しません」）', stCompare.includes('どちらが良いかを、このサイトは判定しません。') && !/changePct|score|点/.test(stCompare))
check('くらべる: 注記（C）が断片の直下・本文の大きさ（s.note。畳まない・薄めない）', stCompare.includes('<p className={s.note}>{NOTE_AI}</p>') && fragments.includes(`export const NOTE_AI =\n  '${NOTE_AI}'`))
check('くらべる: 並べて読む画面は準備中と明示（いまの機能は hintOf(/learn) から。無いものを約束しない）', stCompare.includes("{hintOf('/learn')}ことができます。左右に並べて読む画面は準備中です。") && stCompare.includes("「{labelOf('/learn')}」の画面では"))
check('くらべる: /watch へ「AIの判断を全部読む →」は {SHOW_AI_WATCH && ( の内側（出し分けの規則は scripts/check-watch-reachable.ts）', /\{SHOW_AI_WATCH && \(\s*<Link href="\/watch" className=\{s\.textLink\}>AIの判断を全部読む →<\/Link>\s*\)\}/.test(stCompare))

console.log('■ 書く（心臓。この節だけ --wash の面）')
check('書く: 本文に「理由と、やめる条件を書かないと記録できません」（降りる条件を書かないと記録できない＝このサイトだけの制約）', stWrite.includes('理由と、やめる条件を書かないと記録できません。'))
check('書く: ヒーローの欄に書いた文がそのまま映る（givenOf・問い：答え）・記入例か自分の文かを明示',
  stWrite.includes('{given.map(g => (') && stWrite.includes('<span className={s.soft}>{g.question}：</span>{g.value}') && stWrite.includes('記入例です。上の欄に書くと、ここがその文に入れ替わります。') && stWrite.includes('上の欄に書いた文です。このページの中だけで、保存も送信もしません。'))
check('書く: 断片＝記録された1件（RecordView・data-ui・面の上＝bare）', /<div data-ui className=\{`\$\{s\.ui\} \$\{s\.bare\}`\}>\s*<RecordView memo=\{memo\} typed=\{typed\} \/>/.test(stWrite))
check('RecordView: 見出しは「買ったときに書いたこと」・【見出し】ごとの <dl>・記入例か自分の文かの hint',
  fragments.includes('<p className={s.cardHead}>買ったときに書いたこと</p>') && fragments.includes("{typed ? 'あなたが上の欄に書いた文（このページの中だけ。保存も送信もしていません）' : '記入例が入った状態です'}") && fragments.includes('<dt className={s.dt}>{sec.label ? `【${sec.label}】` : \'（見出しなし）\'}</dt>'))
check('書く: 主ボタン /trade「1件目のメモを書く」（ヒーローと同じ文言・同じ形）', /<Link href="\/trade" className=\{s\.button\}>1件目のメモを書く<\/Link>/.test(stWrite))
check('書く: 淡い青緑の面（s.wash）はこの節の1か所だけ・--wash の参照も home.module.css の .wash の1か所だけ',
  /<li className=\{`\$\{s\.section\} \$\{s\.stage\} \$\{s\.wash\}`\} data-stage="write"/.test(page) && count(page, 's.wash') === 1 && count(homeCss, 'var(--wash)') === 1 && /\.wash \{[^}]*background: var\(--wash\);/.test(homeCss))
check('home.module.css: --wash は color-mix で白（--card）に青緑（--brand）12%（直の色値を書かない）・面は角丸 16・内側 20px（768px 以上 40px）',
  homeCss.includes('--wash: color-mix(in srgb, var(--card), var(--brand) 12%);') && /\.wash \{[^}]*padding: 20px;[^}]*border-radius: var\(--radius-face\);/.test(homeCss) && homeCss.includes('.wash { padding: 40px; }'))
check('書く: --wash の面の上に --brand の文字を置かない（.wash を含むセレクタに color: var(--brand) が無い・必須の印 s.required を出さない）',
  homeCssBlocks.filter(b => b.selector.includes('.wash')).every(b => !/(?:^|[^-])color:\s*var\(--brand/.test(b.body)) && !stWrite.includes('s.required') && !/text-brand/.test(stWrite) && /\.textLink \{[^}]*color: var\(--ink\)/.test(homeCss))

console.log('■ 振り返り（待つこと・押すと読み返しの形に・AIの実例2件）')
check('振り返り: 本文（N営業日ほど経つと…同じことを5回書くと、共通するところを1つだけ出します。）・/review に実物がある',
  stReview.includes('{`${MIN_ELAPSED_BUSINESS_DAYS}営業日ほど経つと、書いたメモを、その後の株価と並べて読み返します。書いたときに何を考えていたかが、そのまま残っています。同じことを5回書くと、共通するところを1つだけ出します。`}')
  && exists('lib/review/patterns.ts') && exists('components/review/PriceSincePanel.tsx'))
check('振り返り: 本文に「待つことが、このサイトの決まりです」（待ち時間はこのサイトの制約）', stReview.includes('待つことが、このサイトの決まりです。'))
check('振り返り: 押す前は記録された1件（RecordView）・「N営業日、待ったことにする」を押すと読み返しの形（RereadView）に変わる',
  /\{waited \? \(\s*<RereadView memo=\{memo\} typed=\{typed\} \/>\s*\) : \(\s*<>\s*<RecordView memo=\{memo\} typed=\{typed\} \/>\s*<button type="button" className=\{s\.uiButton\} onClick=\{\(\) => setWaited\(true\)\}>/.test(stReview)
  && stReview.includes('{MIN_ELAPSED_BUSINESS_DAYS}営業日、待ったことにする'))
check('RereadView: 株価の線は架空で引かない（<svg>／<line>／<path> が無く、線が入る場所を文で示す）・「画面の例です。線は実際の株価から引き、無いときは出しません。」',
  (() => { const v = between(fragments, 'export function RereadView', '\n}\n'); return v.length > 0 && !/<svg|<line|<path/.test(v) && v.includes('{LINE_NOTE}') && v.includes('実際の株価の線が、ここに入ります。') })()
  && fragments.includes(`export const LINE_NOTE = '${LINE_NOTE}'`))
check('RereadView: 「書いたときに何を考えていたかが、そのまま残っています。」・見出し「書いた理由と、その後の株価」', fragments.includes('<p className={s.cardHead}>書いた理由と、その後の株価</p>') && fragments.includes('書いたときに何を考えていたかが、そのまま残っています。'))
check('振り返り: 選び方の1文（一字違わず・small・--ink-2）を実例の上に', stReview.includes('<p className="max-w-[42rem] text-small text-ink-2">{PICK_NOTE}</p>') && page.includes(`const PICK_NOTE = '${PICK_NOTE}'`) && stReview.indexOf('{PICK_NOTE}') < stReview.indexOf('<AnswerCheckCard'))
check('振り返り: AnswerCheckCard を up / down で1件ずつ・1200px 以上は2列ぶんに広がる（s.span）・地の上（bare）',
  page.includes("from '@/components/AnswerCheckCard'") && stReview.includes('<AnswerCheckCard example={examples.up} kind="up" />') && stReview.includes('<AnswerCheckCard example={examples.down} kind="down" />')
  && stReview.includes('className={`${s.stageBody} ${s.span}`}') && homeCss.includes('.span { grid-column: 1 / -1; max-width: none; }'))
check('振り返り: 読み込み中は薄い面2つ・失敗は role="status" の文・無いときは「まだ無い」の文（架空で埋めない）',
  count(stReview, '<Skeleton') === 2 && stReview.includes('<p role="status" className="text-small text-ink-2">{ERROR_LINE}</p>') && stReview.includes("{state === 'empty' && <p className=\"text-small text-ink-2\">{EMPTY_LINE}</p>}"))
check('振り返り: 注記（C）＋「あなたが書いた理由も、「＜labelOf(/review)＞」に残ります。」', stReview.includes("<p className={s.note}>{NOTE_AI} あなたが書いた理由も、「{labelOf('/review')}」に残ります。</p>"))
check('振り返り: 路から引く先は /review で、その呼び名は「振り返り」（NAV と一致）', navLabel('/review') === '振り返り', navLabel('/review'))
check('「まだ無い」の文は N営業日の条件を書く（MIN_ELAPSED_BUSINESS_DAYS から）・「20営業日」の直書きが無い',
  page.includes('const EMPTY_LINE = `並べて見せられるAIの記録は、まだありません（判断日から${MIN_ELAPSED_BUSINESS_DAYS}営業日以上たったものが要ります）。`') && !/20営業日/.test(page + entry) && MIN_ELAPSED_BUSINESS_DAYS === 20)
check('カード: 面は地の上・出所の行がある（R8・R11）・断片の面の上では白い紙（.twoUp > article）', card.includes('rounded-card border border-border p-4') && card.includes('{example.source}') && homeCss.includes('.ui[data-ui] .twoUp > article { background: var(--card); }'))
check('カード: 出所の行と軸の実値は 14px（text-small）。12px（text-caption）が無い（R7・R8: 読めることが目的。L2 2026-10-14）', !card.includes('text-caption') && card.includes('<p className="text-small text-muted tabular-nums">{asOf}{elapsed}。縦の破線は判断日。</p>') && card.includes('justify-between text-small text-muted tabular-nums'))

console.log('■ 注記（C）は AI の記録を出す節それぞれで、断片より後に')
check('注記（C）{NOTE_AI} はページに2つ（くらべる・振り返り＝AIの記録を見せる2つの節）', count(page, '{NOTE_AI}') === 2)
{
  const aiStages = STAGES.filter(([, , st]) => /<CompareView|<AnswerCheckCard/.test(st))
  check('AI の記録を出す節（CompareView／AnswerCheckCard を含む節）それぞれで、最後の断片より後に {NOTE_AI} がある',
    aiStages.length === 2 && aiStages.every(([, , st]) => {
      const lastAi = Math.max(st.lastIndexOf('<CompareView'), st.lastIndexOf('<AnswerCheckCard'))
      return st.indexOf('{NOTE_AI}', lastAi) > lastAi
    }), aiStages.map(([k]) => k).join(','))
  check('AI の記録はヒーロー・学ぶ・書く・締めに出さない（CompareView／AnswerCheckCard は くらべる と 振り返り だけ）',
    !/<CompareView|<AnswerCheckCard/.test(hero + stStudy + stWrite + closing))
}

console.log('■ 締め（ふつうの一文と、1つの動作）')
check('一文「最初の1件は、短くてかまいません。」は <p>（見出しの大きさの文字をこの節に出さない）', /<p className=\{s\.sentence\}>最初の1件は、短くてかまいません。<\/p>/.test(closing) && !/<h[1-6]/.test(closing))
check('一文は 20px・regular・34ch 以内（.sentence）', /\.sentence \{[^}]*max-width: 34ch[^}]*font-size: var\(--step-lead\)[^}]*font-weight: 400/.test(homeCss))
check('締めのボタン: /trade「1件目のメモを書く」（主ボタンと同じ文言・同じ形）＋文字リンク /review/backfill',
  /<Link href="\/trade" className=\{s\.button\}>1件目のメモを書く<\/Link>/.test(closing) && /<Link href="\/review\/backfill" className=\{s\.textLink\}>過去に買った株を記録する →<\/Link>/.test(closing))
check('href="/trade" の直書きはヒーロー・書く・締めの3か所だけ（断片は /trade へ飛ばない。行き先が state で変わらない）', count(page, 'href="/trade"') === 3 && !/href=\{[^}]*\?/.test(page + entry) && !entry.includes('href="/trade"'))
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

console.log('■ 見た目の規則（DECISIONS 2026-10-14 決定(2) の7か所のうち①〜⑤⑦を維持・⑥は 2026-10-25 に1か所だけ許した）')
check('① 番号を落とす（上で確認済み）・② 段ラベルを落とす（見出しの上に小さなラベルの <p> が無い）', !/<p className=\{`?\$?\{?s\.small\}?`?\}>[^<]{1,12}<\/p>\s*<h[23]/.test(page))
check('③ 1px の線・枠を使わない: page・断片の TSX に border-t/b/l/r・h-px・divide-・<hr が無い', !/border-[tblrxy](?![a-z-])|\bh-px\b|\bw-px\b|divide-[xy]|<hr\b/.test(page + entry))
check('③ home.module.css: border は data-ui の内側（.ui[data-ui] …）のセレクタにだけ',
  homeCssBlocks.filter(b => /(^|[^-])border(?!-radius)/.test(b.body)).every(b => b.selector.includes('data-ui')))
check('④ グラデーションを落とす: layout のにじみ（radial-gradient）が無く、page・断片・home.module.css にも gradient が無い', !/gradient/.test(layout + page + entry + homeCss) && layout.includes('return <>{children}</>'))
check('⑤ すりガラスを使わない: backdrop-blur／backdrop-filter が無い', !/backdrop-blur|backdrop-filter/.test(page + entry + homeCss + layout))
check('⑥ 影は実演パネルの1か所だけ: page に shadow-float が1回（ヒーローの s.heroPanel の上）・ほかの shadow が page に無い。断片・layout・home.module.css に shadow が無い（var(--shadow-float) は :root に無く効かないので CSS に書かない）',
  count(page, 'shadow-float') === 1 && count(page, /shadow/g) === 1 && hero.includes('${s.heroPanel} ${s.rise} shadow-float') && !/shadow/.test(entry + homeCss + layout))
check('⑦ 見出しは2行以内: h1 は <br /> で2行に固定・h2 は段の呼び名（4字以内）', count(h1, '<br />') === 1 && ['/study', '/learn', '/trade', '/review'].every(h => navLabel(h).length <= 4))
check('R1: rgb(45 212 191 の直値（明るい青緑）が page・layout・断片に無い（にじみごと撤去）', !/rgb\(45[ _]212[ _]191/.test(screen) && !/#2DD4BF/i.test(homeCss))
check('R4: infinite が無い（page・layout・断片・home.module.css・globals.css）', !/infinite/.test(screen) && !/infinite/.test(homeCss) && !/infinite/.test(css))
check('home.module.css: 色はトークン（var(--…)）だけ・直値の色が無い', !/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(homeCss))
check('home.module.css: 面は不透明（--panel は color-mix で地を 5% 沈めた色。半透明の --surface を注記の面にしない）', homeCss.includes('--panel: color-mix(in srgb, var(--bg), var(--ink) 5%);') && !/\.ui\[data-ui\] \{[^}]*var\(--surface\)/.test(homeCss))
check('home.module.css: 文字の段階（14 / 17 / 20・見出し 26→36・ヒーロー 28→44→52）',
  homeCss.includes('--step-small: 14px;') && homeCss.includes('--step-body: 17px;') && homeCss.includes('--step-lead: 20px;')
  && homeCss.includes('--step-head: 26px;') && between(homeCss, '@media (min-width: 768px) {\n  .page {', '}').includes('--step-head: 36px;') && count(homeCss, /--step-head:\s*\d+px;/g) === 2)
check('home.module.css: 本文は 17px・行間 1.8・--ink（.page）。見出し（.h1・.h2）の字間は 0.01em',
  /\.page \{[^}]*color: var\(--ink\);[^}]*font-size: var\(--step-body\);[^}]*line-height: 1\.8;/.test(homeCss) && /\.h1 \{[^}]*letter-spacing: 0\.01em/.test(homeCss) && /\.h2 \{[^}]*letter-spacing: 0\.01em/.test(homeCss))
check('home.module.css: 小さな上書きラベルを作らない（uppercase が無く、letter-spacing は .h1・.h2 の2か所だけ）',
  !/text-transform:\s*uppercase/.test(homeCss) && homeCssBlocks.filter(b => /letter-spacing/.test(b.body)).map(b => b.selector).join(',') === '.h1,.h2' && !/uppercase|tracking-/.test(page + entry))
check('home.module.css: 節の間は空白だけ（--gap-section 96px／128px）', homeCss.includes('--gap-section: 96px;') && homeCss.includes('--gap-section: 128px;') && homeCss.includes('.section { margin-top: var(--gap-section); }'))
check('home.module.css: アクセント（--brand）はボタンと断片の内側、ほかは .page の --wash の宣言1か所だけ（見出し・線・下線に使わない）',
  homeCssBlocks.filter(b => /var\(--brand\)/.test(b.body)).every(b => /^\.button|data-ui/.test(b.selector) || b.selector.includes('.button')
    || (b.selector === '.page' && count(b.body, 'var(--brand)') === 1 && b.body.includes('--wash: color-mix(in srgb, var(--card), var(--brand) 12%);'))))
check('globals.css: :root のトークン（22個）は変えない（ホーム専用の寸法は home.module.css に閉じる）', count(between(css, ':root {', '\n}'), /^\s{2}--[a-z-]+:/gm) === 22 + 5 && !css.includes('--step-') && !css.includes('--anchor') && !css.includes('--wash') && !css.includes('--radius-face'))

console.log('■ 明朝（h1・h2 だけ。読み込みは app/(night)/layout.tsx の1行）')
check("app/(night)/layout.tsx: import '@fontsource-variable/noto-serif-jp' が1行だけ（app/layout.tsx・globals.css・page には無い＝他の画面は明朝を読まない）",
  count(layout, "import '@fontsource-variable/noto-serif-jp'") === 1 && count(layout, 'noto-serif-jp') === 1 && !rootLayout.includes('noto-serif-jp') && !css.includes('noto-serif-jp') && !page.includes('noto-serif-jp'))
check('package.json: @fontsource-variable/noto-serif-jp を 5.3.1 で持つ（セルフホスト。外部の配信を使わない）', /"@fontsource-variable\/noto-serif-jp": "\^?5\.3\.1"/.test(read('package.json')))
check("home.module.css: 明朝は --font-display（'Noto Serif JP Variable', serif）で、使うのは .h1・.h2 だけ",
  homeCss.includes("--font-display: 'Noto Serif JP Variable', serif;") && homeCssBlocks.filter(b => b.body.includes('var(--font-display)')).map(b => b.selector).join(',') === '.h1,.h2'
  && count(homeCss, 'Noto Serif JP') === 1)
check('home.module.css: 明朝の太さは 400／500 だけ（40px 未満は 500＝h2 は 26・36px とも 500、h1 は 28px で 500・44／52px で 400）・斜体なし',
  [...homeCss.matchAll(/--weight-(?:head|display):\s*(\d+);/g)].map(m => m[1]).join(',') === '500,500,400'
  && count(homeCss, /--weight-head:/g) === 1 && homeCss.includes('--step-head: 26px;') && homeCss.includes('--step-display: 28px;')
  && !/font-style:\s*(?:italic|oblique)/.test(homeCss) && !/<em\b|<i\b|italic/.test(page))

console.log('■ 面の上の文字のコントラスト（color-mix を sRGB の成分ごとの線形補間で手計算。色の正は globals.css の :root）')
{
  const rootBody = between(css, ':root {', '\n}')
  const hexOf = (name: string): number[] => {
    const m = new RegExp(`${name}:\\s*#([0-9A-Fa-f]{6})\\b`).exec(rootBody)
    if (!m) throw new Error(`${name} が :root に無い（#RRGGBB で）`)
    return [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16))
  }
  /** color-mix(in srgb, A, B p%) = A × (1 − p) + B × p（成分ごと） */
  const mix = (a: number[], b: number[], p: number) => a.map((v, i) => v * (1 - p) + b[i] * p)
  const lum = (c: number[]) => {
    const [r, g, b] = c.map(v => { const x = v / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4 })
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const ratio = (a: number[], b: number[]) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05) }
  const pctOf = (decl: RegExp): number => { const m = decl.exec(homeCss); return m ? Number(m[1]) / 100 : NaN }
  const washP = pctOf(/--wash: color-mix\(in srgb, var\(--card\), var\(--brand\) (\d+)%\);/)
  const panelP = pctOf(/--panel: color-mix\(in srgb, var\(--bg\), var\(--ink\) (\d+)%\);/)
  const [card, bg, ink, ink2, muted, brand] = ['--card', '--bg', '--ink', '--ink-2', '--muted', '--brand'].map(hexOf)
  const wash = mix(card, brand, washP)
  const panel = mix(bg, ink, panelP)
  const fmt = (n: number) => n.toFixed(2)
  for (const [faceName, face] of [['--wash', wash], ['--panel', panel]] as const) {
    for (const [inkName, c] of [['--ink', ink], ['--ink-2', ink2], ['--muted', muted]] as const) {
      const r = ratio(c, face)
      check(`${inkName} の文字は ${faceName} の上で 4.5 以上（${fmt(r)}）`, r >= 4.5, fmt(r))
    }
  }
  const rb = ratio(brand, wash)
  check(`--brand（主ボタンの塗り）と --wash の差は 3.0 以上（部品の見分け・${fmt(rb)}）`, rb >= 3.0, fmt(rb))
  const rw = ratio(wash, bg)
  check(`--wash と地（--bg）は段差として見分けられる（1.05 以上・線ではないので 1.3 は求めない・${fmt(rw)}）`, rw >= 1.05, fmt(rw))
}

console.log('■ 動き（最初の1画面の入場だけ。transform と opacity だけ・待たせない）')
check('スクロールの入場を置かない: data-reveal・IntersectionObserver・useReveal・data-motion が page・断片・CSS に無く、components/entry/useReveal.ts が無い',
  !/data-reveal|IntersectionObserver|useReveal|data-motion/.test(page + entry + homeCss) && !exists('components/entry/useReveal.ts'))
check('home.module.css: 入場は opacity と transform だけ・90ms 刻み（--i × 90ms）・@keyframes は rise の1つ・prefers-reduced-motion: no-preference の中だけ',
  homeCss.includes('animation-delay: calc(var(--i, 0) * 90ms + 120ms);') && count(homeCss, '@keyframes') === 1 && /@keyframes rise \{\s*from \{ opacity: 0; transform: translateY\(18px\); \}\s*to \{ opacity: 1; transform: none; \}/.test(homeCss)
  && /@media \(prefers-reduced-motion: no-preference\) \{\s*\.rise \{/.test(homeCss) && !homeCss.includes('transition-delay: calc(var(--i'))
check('home.module.css: transition は性質を名指し（transition: all が無い）・ease-in（単独）を使わない', !/transition:\s*all/.test(homeCss) && !/[^-\w]ease-in(?!-out)\b/.test(homeCss))
check('トップ: 入場はヒーローの4つ（h1・支えの1文・動作・実演パネル）だけ', count(hero, '${s.rise}') === 4 && count(page, 's.rise') === 4)
check('home.module.css: すべての操作部に押下・ホバー・焦点の反応（.button:active scale・:hover は (hover: hover) の中・:focus-visible は --focus の 2px）',
  homeCss.includes('.button:active { transform: scale(0.97); }') && /@media \(hover: hover\) and \(pointer: fine\) \{\s*\.button:hover \{ background: var\(--brand-strong\); \}/.test(homeCss) && /\.textLink:focus-visible,[\s\S]*?outline: 2px solid var\(--focus\)/.test(homeCss))
{
  const uis = dataUiElements(page)
  check('トップ: data-ui の断片は page に5つ（学ぶ1・くらべる1・書く1・振り返り2）＋DemoPanel に1つで、どれも h1／h2 を包まない',
    uis.length === 5 && count(demo, 'data-ui') === 1 && count(stStudy, 'data-ui') === 1 && count(stCompare, 'data-ui') === 1 && count(stWrite, 'data-ui') === 1 && count(stReview, 'data-ui') === 2
    && uis.every(u => !/<h[12]/.test(u)), `page の data-ui ${uis.length} 個`)
}
check('スマホで横にはみ出さない作り（.stack の子は min-width: 0・.dd は overflow-wrap: anywhere・段の列は minmax(0, 1fr) と min-width: 0）',
  homeCss.includes('.stack > * {\n  grid-area: 1 / 1;\n  min-width: 0;\n}') && /\.ui\[data-ui\] \.dd \{[^}]*overflow-wrap: anywhere/.test(homeCss)
  && /\.stage \{[^}]*grid-template-columns: minmax\(0, 1fr\);/.test(homeCss) && homeCss.includes('.stageText { min-width: 0;') && homeCss.includes('.stageBody { min-width: 0;'))

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
check('DESIGN.md: ホームの h1・h2 だけ Noto Serif JP（§5-2 の書体の表）', design.includes('ホームの h1・h2 だけ Noto Serif JP'))
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
