// トップページ（入口画面）の検査。S2「プレゼン型ホーム」（2026-09-29・DECISIONS.md 同日の2エントリ）で全面的に建て直した。
//   $env:PATH = "C:\Program Files\nodejs;$env:PATH"; npx tsx scripts/check-entry.ts
//
// 法務の条件（legal-compliance 2026-09-25 (G)・2026-09-28 論点5〜7・2026-09-29）と DESIGN.md §3・§4-2 R1〜R8・§5-2・§5-6・§6-11・§6-12 を機械で見る。
// PASS の合計は S1 出荷時（92件）を下回らない（2026-09-28 の不変条件「検査の合計件数は S2 の完了時点で下回らない」）。
//
// 見るもの:
//  - 免責は共通部品 <Disclaimer part="general" />（DISCLAIMER_TEXT）が末尾・地の上・畳まない。手書き免責が無い
//  - 画面に使わない語: 見本／お手本／模範／正解例／自動売買／的中／当たった／外れた／正解率、および単独の「答え合わせ」
//    （使うなら同じ節に「正解を出すのはこのサイトではありません」）。従来の リスクゼロ／うまくなる／上手くなる／おすすめ／買い時／売り時／無料／今日、
//    名人／投資家、R6・R9・R12 の語。AI 出力向けの禁止語（FORBIDDEN_IN_OUTPUT）も画面の文言に無い（注記の打消し「推奨するものではありません」だけ例外）
//  - ヒーロー（最初の1画面）に騰落率が無い（R3・2026-09-29 オーナー判断）。「残るもの（例）」カードは実例が無ければ出さない・水平線を描かない
//  - 主ボタンは1つ・/trade 固定・56px・色付きの影は1か所。締めの再掲は 48px で影なし・同じ文言と行き先
//  - 3段のレール: 並びと段ラベルは NAV から。01 書く は reason.ts の問いを readOnly で／02 くらべる は左が記入例と明示・「ちがい」は静的／
//    03 読み返す は選び方の1文＋AnswerCheckCard ×2。段の間の時間のラベル。入場アニメはヒーローだけ
//  - 「全員に同じものを同じ順で」: localStorage／sessionStorage／document.cookie／useSearchParams が無く、fetch は /api/entry/examples の1本
//  - 読み口 app/api/entry/examples/route.ts の外形: GET だけ・CDN 1時間・null は 200・失敗は 502 no-store・getHistory は allowMock:false・
//    getQuote を呼ばない・ai_decisions を読まない・社名を返さない
//  - R1 色付きの影／R5 にじみ／R4 動き／§5-6 入場アニメ／R7 畳まない・薄くしない／R11 出所と免責は地の上
//  - フッターの枠（R10）・SITE_DESC・/watch の h1・DESIGN.md §3（新構成）と §4-2・§5-2 の文
//  - lib/entry/samples.ts の関数（isTextShowable の1か所・firstSentence・pickSamples）を実際に呼ぶ
//
// 実ネットワーク不要。ファイルを読むだけ。選び方の純関数の検査は scripts/check-answer-examples.ts。

import fs from 'fs'
import path from 'path'
import { DISCLAIMER_TEXT } from '../components/ui/Disclaimer'
import { FORBIDDEN_IN_OUTPUT, forbiddenWordsIn } from '../lib/investors/rulebooks/forbidden'
import { firstSentence, isFullyShowable, isShowable, isTextShowable, pickSamples, type SampleDecision } from '../lib/entry/samples'
import { NAV } from '../components/SiteNav'
import { fieldsFor } from '../lib/trade/reason'

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

const pageRaw = read('app/(night)/page.tsx')
const page = stripComments(pageRaw)
const layout = stripComments(read('app/(night)/layout.tsx'))
const rootLayout = stripComments(read('app/layout.tsx'))
const css = read('app/globals.css').replace(/\/\*[\s\S]*?\*\//g, '')
const disclaimer = stripComments(read('components/ui/Disclaimer.tsx'))
const samplesSrc = stripComments(read('lib/entry/samples.ts'))
const card = stripComments(read('components/AnswerCheckCard.tsx'))
const route = exists('app/api/entry/examples/route.ts') ? stripComments(read('app/api/entry/examples/route.ts')) : ''

const NOTE_AI = 'これは、このサイトのAIが仮想資金で出した判断の記録です。▲▼はAIの判断の分類で、特定の銘柄の売買を推奨するものではありません。'
const PICK_NOTE = '判断日が古い順に、値上がりした例と値下がりした例を1件ずつ。成績のよい判断を選んでいるのではありません。'

// 節の切り出し（page の JSX の目印で区切る）
const hero = between(page, 'data-section="hero"', '</section>')
const stages = between(page, 'aria-labelledby="stages-heading"', '</section>')
const closing = between(page, 'data-section="closing"', '</section>')
const heroCard = between(page, 'function HeroCard', '\nexport default function Home')
const writeFrag = between(page, 'function WriteFragment', '\nfunction CompareFragment')
const compareFrag = between(page, 'function CompareFragment', '\nfunction RereadFragment')
const rereadFrag = page.slice(page.indexOf('function RereadFragment'))
const lower = page.slice(page.indexOf('aria-labelledby="stages-heading"'))
const screen = page + '\n' + layout + '\n' + card

console.log('■ 免責（DISCLAIMER_TEXT）と手書き免責の撤去（§6-11・R7・R11）')
check('トップ: <Disclaimer part="general" /> を1回以上（共通部品）', count(page, '<Disclaimer part="general" />') >= 1 && page.includes("from '@/components/ui/Disclaimer'"))
check('Disclaimer: part="general" で DISCLAIMER_TEXT を出す（文言は部品の定数。ページで作り直さない）', disclaimer.includes("part !== 'investor' ? DISCLAIMER_TEXT") && DISCLAIMER_TEXT.length > 100)
check('トップ: 免責は末尾・border-t の上・地の上（bg-card の中に置かない＝R11）', /<section className="mt-12 max-w-\[760px\] border-t border-border pt-4">\s*<Disclaimer part="general" \/>\s*<\/section>\s*<\/div>\s*\)\s*\}/.test(page))
check('トップ・layout: 「投資助言・代理業には該当しません」の自己断定が無い', !page.includes('該当しません') && !layout.includes('該当しません'))
check('トップ: 旧の手書き免責「InvestSim は投資判断を練習するためのシミュレーターです」が無い', !page.includes('InvestSim は投資判断を練習するためのシミュレーターです'))
check('トップ・layout・カード: <details> を使わない（免責・注記を畳まない＝R7）', !screen.includes('<details'))
check('トップ・カード: 注記・免責に opacity を足していない（R7）', !/opacity-\d|opacity:/.test(page) && !/opacity-\d|opacity:/.test(card))

console.log('■ 書かない語（法務 (G)・2026-09-29・DESIGN §7）')
for (const w of ['リスクゼロ', 'うまくなる', '上手くなる', 'おすすめ', '買い時', '売り時', '無料', '今日']) {
  check(`トップ・layout・カード: 「${w}」が 0 件`, !screen.includes(w))
}
for (const w of ['見本', 'お手本', '模範', '正解例', '自動売買', '的中', '当たった', '外れた', '正解率']) {
  check(`トップ・layout・カード: 「${w}」が 0 件（legal-compliance 2026-09-29）`, !screen.includes(w))
}
check('「答え合わせ」を使うなら同じ節に「正解を出すのはこのサイトではありません」（使っていなければ合格）',
  !screen.includes('答え合わせ') || screen.includes('正解を出すのはこのサイトではありません'))
const OLD_WORDING = ['AIと名人と自分', 'まずAIの判断を見てみる', 'AIも、同じ形式で理由を書いています', '投資判断の練習場', '買う理由を書いて残し、あとで株価と読み返す。', 'できることは3つ', 'AIは、いまこう考えています', '4つの段階']
const oldHits = OLD_WORDING.filter(w => screen.includes(w))
check('トップ: 旧文言（S1c・S1 の見出し・分類ラベル・旧節見出し）が残っていない', oldHits.length === 0, oldHits.join(' / '))
check('トップ・layout・カード: 「名人」「投資家」の語が無い（名人を隠している間・注釈を除く）', !/名人|投資家/.test(screen))
check('トップ: 見出しに「再現」を入れない（法務: 変化を約束する語にしない）', !between(page, '<h1', '</h1>').includes('再現'))
check('トップ・カード: 断定・将来の語（儲か／必ず／勝て／稼）が無い（R6）', !/儲か|必ず|勝て|稼/.test(screen))
check('トップ・layout・カード: 急かす語（今だけ／先着／残り）・記章の語（認証／公式／保証／安心）が無い（R9・R12）', !/今だけ|先着|残り[0-9０-９]|認証|公式|保証|安心/.test(screen))
{
  // AI 出力向けの禁止語も画面の文言に無い。注記の打消し（「推奨するものではありません」）だけ例外
  const copy = (page + '\n' + card).split('推奨するものではありません').join('')
  const hits = forbiddenWordsIn(copy, FORBIDDEN_IN_OUTPUT)
  check('トップ・カード: FORBIDDEN_IN_OUTPUT の語が画面の文言に無い（打消しの注記を除く）', hits.length === 0, hits.join(' / '))
}
check('トップ: AI推論を走らせない（/api/ai-session/[id]/tick・/api/analyze を呼ばない）', !/\/tick|\/api\/analyze|anthropic/i.test(page))
check('架空の判断・銘柄を書いていない（AAPL 等のティッカーの直書きがページに無い）', !/['"](?:AAPL|MSFT|NVDA|TSLA|AMZN|7203\.T)['"]/.test(page))

console.log('■ ヒーロー（R3: 騰落率を置かない）')
const h1 = between(page, '<h1', '</h1>')
check('h1 は display（52px / 1.26 / 900 / -0.035em）・text-balance・文言どおり', h1.includes('text-display text-ink text-balance') && h1.includes('株を売り買いする前に、その理由を書いて残す場所です。'))
check('globals.css: --text-display は 52px / 1.26 / 900 / -0.035em', css.includes('--text-display:               52px;') && css.includes('--text-display--line-height:  1.26;') && css.includes('--text-display--font-weight:  900;') && css.includes('--text-display--letter-spacing: -0.035em;'))
check('h1 は1つだけ（display は1画面に1つ）', count(page, '<h1') === 1)
check('h1: 640px 未満は font-size だけ 40px（className の末尾に max-sm:text-[40px]）', /className=\{`text-display text-ink text-balance \$\{RISE\[0\]\} max-sm:text-\[40px\]`\}/.test(h1) && count(page, 'max-sm:text-[40px]') === 1)
check('リードは h3 の大きさ・400・行間 1.9・--ink-2・最大幅 540px・文言どおり（「実際のお金は1円も動きません」）',
  /text-h3 font-normal leading-\[1\.9\] text-ink-2/.test(hero) && hero.includes('max-w-[540px]') && hero.includes('数週間後、書いた理由と実際の株価を並べて読み返せます。売買で実際のお金は1円も動きません。'))
check('主ボタンの直下に「保存するときだけログインが要ります」（small・--muted）', hero.includes('<p className="mt-2 text-small text-muted">保存するときだけログインが要ります</p>') && hero.indexOf('1件目のメモを書く') < hero.indexOf('保存するときだけログインが要ります'))
check('文字リンク2本: /review/backfill「過去に買った株を、いま記録する」・/watch「AIの判断を読む（ログイン不要）」',
  /<Link href="\/review\/backfill"[^>]*>過去に買った株を、いま記録する<\/Link>/.test(hero) && /<Link href="\/watch"[^>]*>AIの判断を読む（ログイン不要）<\/Link>/.test(hero))
check('ヒーローに騰落率が無い（changePct・fmtSignedPct・answerSentence・% をヒーローとカードの関数に置かない＝R3）',
  hero.length > 0 && heroCard.length > 0 && !/changePct|fmtSignedPct|answerSentence|%/.test(hero + heroCard))
check('「残るもの（例）」カード: 実例が無ければ出さない（{older && <HeroCard}）・読み込み中は薄い枠', hero.includes('{older && <HeroCard example={older} />}') && hero.includes("{state === 'loading' && <Skeleton"))
check('「残るもの（例）」カード: 理由1行 → 折れ線（MiniLine）→ 出所 → 「画面の例です。線は実際の株価から引き、無いときは出しません。」',
  heroCard.indexOf('firstSentence(example.reasoning)') < heroCard.indexOf('<MiniLine')
  && heroCard.includes('{example.source}') && heroCard.includes('画面の例です。線は実際の株価から引き、無いときは出しません。'))
check('「残るもの（例）」カード: 「やめる条件」の水平線を描かない（MiniLine 以外の <line>・<svg> が無い）・地の上（bg-card 無し）・影なし', !/<line|<svg|bg-card|shadow/.test(heroCard))
check('ヒーロー右列は lg 以上で2列（スマホでは下に回る）', hero.includes('lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]'))
check('ヒーローに /stocks/ へのリンクが無い（法務条件。ページ全体でも無い）', !page.includes('/stocks/'))

console.log('■ 主ボタン・focus')
const primary = between(hero, 'href="/trade"', '</Link>')
check('主ボタンは1つ・/trade 固定「1件目のメモを書く」・h-56（h-14）・bg-brand・text-on-brand・hover:bg-brand-strong・rounded-card・font-semibold',
  count(page, 'h-14') === 1 && primary.includes('1件目のメモを書く') && /h-14 [^"]*rounded-card bg-brand [^"]*text-body font-semibold text-on-brand[^"]*hover:bg-brand-strong/.test(primary))
check('主ボタンの発光の影は 0 16px 40px -14px rgb(45 212 191 / .70)', primary.includes('shadow-[0_16px_40px_-14px_rgb(45_212_191_/_.70)]'))
const closingBtn = between(closing, 'href="/trade"', '</Link>')
check('締めの再掲: /trade「1件目のメモを書く」・h-12・bg-brand・色付きの影なし（主ボタンは上の1つ）', closingBtn.includes('1件目のメモを書く') && closingBtn.includes('h-12') && closingBtn.includes('bg-brand') && !closingBtn.includes('shadow'))
check('href="/trade" の直書きは主ボタンと締めの2か所だけ（段の断片は /trade へ飛ばない。行き先が state で変わらない）', count(page, 'href="/trade"') === 2 && !/href=\{[^}]*\?/.test(page))
check('締めの下に「思いつかなければ、過去に買った株を記録するところからでも始められます。」（/review/backfill）', /思いつかなければ、<Link href="\/review\/backfill"[^>]*>過去に買った株を記録する<\/Link>ところからでも始められます。/.test(closing))
check('focus は outline 2px --focus＋offset 2px（box-shadow の内側描画にしない）', page.includes("const FOCUS_RING = 'focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-2'") && !/focus-visible:ring|focus:ring|focus-visible:shadow|focus:shadow/.test(page))
check('ボタンの文言は「押すと何が起きるか」の動詞（OK／送信／次へ を使わない）', !/>\s*(OK|送信|次へ)\s*</.test(page))

console.log('■ 3つの画面とレール（並びは NAV が唯一の出所）')
check('節の見出し「このサイトは、3つの画面でできています」は h2', page.includes('<h2 id="stages-heading" className="text-h2 text-ink">このサイトは、3つの画面でできています</h2>'))
check('「書く → くらべる → 読み返す」は NAV の label から・「上から順に降りてくるだけです。途中でやめても、書いたものは残ります。」',
  stages.includes("{NAV.map(n => n.label).join(' → ')}。上から順に降りてくるだけです。途中でやめても、書いたものは残ります。"))
check('レール: 左端 2px・上が --brand で下に向かって消える（before:w-0.5 before:bg-linear-to-b before:from-brand before:to-transparent）', stages.includes('before:w-0.5 before:bg-linear-to-b before:from-brand before:to-transparent'))
check('3段は NAV.map で描く（段ラベルは番号＋NAV の label）', stages.includes('{NAV.map(({ href, label }, i) => {') && stages.includes("{String(i + 1).padStart(2, '0')} {label}"))
check('STAGE_COPY の鍵は NAV の href と同じ3つ・同じ順', (() => {
  const keys = [...between(page, 'const STAGE_COPY', '\n}\n').matchAll(/^\s{2}'(\/[a-z]+)': \{/gm)].map(m => m[1])
  return JSON.stringify(keys) === JSON.stringify(NAV.map(n => n.href))
})())
check('段の間の時間のラベル: 02 の前に「書いたその日に」・03 の前に「◯営業日ほど経つと」（MIN_ELAPSED_BUSINESS_DAYS から）・01 の前には無い',
  page.includes("'/learn': '書いたその日に'") && page.includes("'/review': `${MIN_ELAPSED_BUSINESS_DAYS}営業日ほど経つと`") && !/'\/trade': '[^']*の/.test(between(page, 'const TIME_LABEL', '\n}')))
check('時間のラベルは細い横線つき（h-px bg-border）', stages.includes('<span className="text-small text-muted">{time}</span>') && stages.includes('h-px flex-1 bg-border'))
check('各段＝左に説明（段ラベル・h3・本文）／右にその画面の断片（md 以上で2列）', stages.includes('md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]') && stages.includes('<h3 className="mt-1 text-h3 text-ink text-balance">{copy.title}</h3>'))
check('3つの断片はそれぞれ1回（WriteFragment / CompareFragment / RereadFragment）',
  stages.includes("{href === '/trade' && <WriteFragment />}") && stages.includes("{href === '/learn' && <CompareFragment") && stages.includes("{href === '/review' && <RereadFragment"))
check('03 の本文: いま出来ることだけを書く（書いたメモを、その後の株価と並べて読み返す）',
  page.includes('営業日ほど経つと、書いたメモを、その後の株価と並べて読み返します。書いたときに何を考えていたかが、そのまま残っています。'))
check('ヒーローより下に h1 が無く、h2 は 3つの画面と締めの2つ', count(lower, '<h1') === 0 && count(lower, '<h2') === 2)

console.log('■ 01 書く（reason.ts の問いを readOnly で）')
const buyFields = fieldsFor('buy')
check("01: 問いは lib/trade/reason.ts の fieldsFor('buy')（ページで記入例・問いを書き直さない）", page.includes("import { fieldsFor } from '@/lib/trade/reason'") && page.includes("const BUY_FIELDS = fieldsFor('buy')") && buyFields.every(f => !page.includes(f.placeholder) && !page.includes(`>${f.question}<`)))
check('01: <label htmlFor>＋readOnly の <textarea value={f.placeholder}>（絵ではなく本物のマークアップ）', writeFrag.includes('<label htmlFor={id}') && writeFrag.includes('readOnly') && writeFrag.includes('value={f.placeholder}') && writeFrag.includes('{f.question}'))
check('01: 必須／任意の印（（必須）は --brand・（任意）は --muted）', writeFrag.includes('<span className="text-brand">（必須）</span>') && writeFrag.includes('<span className="text-muted">（任意）</span>'))
check('01: 「この内容で記録する」は <button type="button">・disabled にしない・tabIndex=-1／aria-hidden を付けない（読み上げで読めてよい）',
  /<button\s+type="button"\s+aria-disabled="true"[^>]*>\s*この内容で記録する\s*<\/button>/.test(writeFrag) && !/\sdisabled(?:\s|=|>)/.test(writeFrag) && !writeFrag.includes('tabIndex') && !writeFrag.includes('aria-hidden'))
check('01: 記入例であることの注記「記入例が入った状態です。この画面では押せません。」', writeFrag.includes('記入例が入った状態です。この画面では押せません。'))
check('01: 断片は bg-card の面（画面の断片であって注記・免責ではない）・影なし', writeFrag.includes('rounded-card border border-border bg-card p-4') && !writeFrag.includes('shadow'))

console.log('■ 02 くらべる（左は記入例と明示・右は実データ・「ちがい」は静的）')
check('02: 左「あなたが書いたこと（記入例）」・右「このサイトのAIが書いたこと」', compareFrag.includes('あなたが書いたこと（記入例）') && compareFrag.includes('このサイトのAIが書いたこと'))
check('02: 「左は記入例、右はこのサイトのAIが実際に書いた記録です。」を画面に明示', compareFrag.includes('左は記入例、右はこのサイトのAIが実際に書いた記録です。'))
check('02: 左は reason.ts の記入例（BUY_FIELDS の label と placeholder）を <dl> で', compareFrag.includes('{BUY_FIELDS.map(f => (') && compareFrag.includes('<dt className="text-caption text-muted">【{f.label}】</dt>') && compareFrag.includes('<dd className="text-small text-ink">{f.placeholder}</dd>'))
check('02: 系列の見分けは線の見本（Swatch: SERIES.you 実線／SERIES.ai 破線）で、文字に色を使わない', compareFrag.includes('<Swatch style={SERIES.you} />') && compareFrag.includes('<Swatch style={SERIES.ai} />') && !/style=\{\{\s*color/.test(page))
check('02: 右は older（2件のうち判断日が古い方）の理由の全文＋銘柄コード・方向の札・判断日', compareFrag.includes('{older.reasoning}') && compareFrag.includes('{older.symbol}・{ACTION_LABEL[older.action]}・判断日 {fmtSlashDate(older.decidedAt)}'))
check('02: 「ちがい」の1文は静的な説明文（差を自動判定して採点しない。「判定しません」）', compareFrag.includes('どちらが良いかを、このサイトは判定しません。') && !/changePct|score|点/.test(compareFrag))
check('02: 選び方の注記「右は、下の 03 に出る2件のうち判断日が古い方です。」', compareFrag.includes('右は、下の 03 に出る2件のうち判断日が古い方です。'))
check('02: 注記（C）（small・--ink-2・地の上）が /watch へのリンクより前にある', compareFrag.includes('<p className="max-w-[42rem] text-small text-ink-2">{NOTE_AI}</p>') && compareFrag.indexOf('{NOTE_AI}') < compareFrag.indexOf('href="/watch"') && page.includes(`const NOTE_AI =\n  '${NOTE_AI}'`))
check('02: /watch へ「AIの判断を全部読む →」', /<Link href="\/watch"[^>]*>AIの判断を全部読む →<\/Link>/.test(compareFrag))
check('02: 並べて読む画面は準備中と明示（いまの機能は NAV[1].hint から。無いものを約束しない）', compareFrag.includes('{NAV[1].hint}') && compareFrag.includes('左右に並べて読む画面は準備中です。'))
check('02: 右列は loading／error／empty で出し分け、error は role="status" の文（失敗を「無い」と見せない）', compareFrag.includes("state === 'loading'") && compareFrag.includes('<p role="status" className="mt-2 text-small text-ink-2">{ERROR_LINE}</p>') && compareFrag.includes('{EMPTY_LINE}'))

console.log('■ 03 読み返す（AnswerCheckCard ×2・選び方の明記）')
check('03: 選び方の1文（一字違わず）を実例の上に', rereadFrag.includes('{PICK_NOTE}') && page.includes(`const PICK_NOTE = '${PICK_NOTE}'`) && rereadFrag.indexOf('{PICK_NOTE}') < rereadFrag.indexOf('<AnswerCheckCard'))
check('03: AnswerCheckCard を up / down で1件ずつ（部品は components/AnswerCheckCard.tsx）', page.includes("from '@/components/AnswerCheckCard'") && rereadFrag.includes('<AnswerCheckCard example={examples.up} kind="up" />') && rereadFrag.includes('<AnswerCheckCard example={examples.down} kind="down" />'))
check('03: 読み込み中は薄い枠2つ・失敗は role="status" の文・無いときは「まだ無い」の文（架空で埋めない）', count(rereadFrag, '<Skeleton') === 2 && rereadFrag.includes('<p role="status" className="text-small text-ink-2">{ERROR_LINE}</p>') && rereadFrag.includes("{state === 'empty' && <p className=\"text-small text-ink-2\">{EMPTY_LINE}</p>}"))
check('03: 注記（C）＋「あなたが書いた理由も、「03 読み返す」に残ります。」', rereadFrag.includes('{NOTE_AI} あなたが書いた理由も、「03 読み返す」に残ります。'))
// S2b で /review に「条件の線・触れたかどうかの文・5件で共通点」を作るまで、ホームで予告しない（原則9・S2 レビュー W3）。
// S2b の出荷と同じコミットで、この検査を「予告がある」に裏返すこと。
check('ホーム: まだ無い機能（条件の線・触れたかどうか・5件で共通点）を予告していない',
  !page.includes('同じことを5回書くと') && !page.includes('触れたかどうか') && !page.includes('これと同じ形で並びます'))
check('03: 「まだ無い」の文は 20営業日の条件を書く（MIN_ELAPSED_BUSINESS_DAYS から）', page.includes('const EMPTY_LINE = `並べて見せられるAIの記録は、まだありません（判断日から${MIN_ELAPSED_BUSINESS_DAYS}営業日以上たったものが要ります）。`'))
check('カード: 面は地の上（bg-card 無し）・出所の行がある（R8・R11）', card.includes('rounded-card border border-border p-4') && !card.includes('bg-card') && card.includes('{example.source}'))

console.log('■ 全員に同じものを同じ順で（法務 C3〜C5・設計制約8）')
check('トップ: localStorage／sessionStorage／document.cookie／useSearchParams が無い', !/localStorage|sessionStorage|document\.cookie|useSearchParams/.test(page))
check('トップ: fetch は /api/entry/examples の1本だけ', count(page, 'fetch(') === 1 && page.includes("fetch('/api/entry/examples', { signal: ctrl.signal })"))
check('トップ: 時刻・乱数で中身を変えない（Date.now／Math.random／new Date が無い）', !/Date\.now|Math\.random|new Date\(/.test(page))
check('トップ: ヒーローと 02 の1件は判断日が古い方（成績＝changePct で選ばない）', page.includes('examples.up.decidedAt < examples.down.decidedAt') && !/changePct\s*[<>]/.test(page))

console.log('■ 読み口 app/api/entry/examples/route.ts の外形')
check('route: ファイルがあり GET だけを export（POST 等は無い・use client 無し）', route.length > 0 && route.includes('export async function GET()') && !/export async function (?:POST|PUT|DELETE|PATCH)/.test(route) && !route.includes('use client'))
check('route: 成功は CDN 1時間＋stale-while-revalidate 1日', route.includes("'public, s-maxage=3600, stale-while-revalidate=86400'"))
check('route: 候補が無い／条件を満たさない → 200 で { examples: null }', route.includes('const body: ExamplesBody = { examples: null }') && route.includes("return NextResponse.json(body, { headers: { 'Cache-Control': CACHE_1H } })"))
check('route: 失敗は 502＋no-store＋和文（失敗を「無い」と見せない。原因はサーバーのログにだけ）', route.includes('status: 502') && route.includes("'Cache-Control': 'no-store'") && route.includes("const READ_FAILED_MESSAGE = 'AIの判断の記録を読み込めませんでした'") && route.includes('console.error('))
check('route: データ源は ai_sessions の blob（listSessions → learning.allDecisions）。ai_decisions の表は読まない', route.includes("import { listSessions } from '@/lib/ai-trader/store'") && route.includes('s.learning.allDecisions') && !/ai_decisions|AI_DECISIONS_TABLE|decision-store/.test(route))
check('route: 日足は getHistory(symbol, period, { allowMock: false })（実データのみ）。getQuote を呼ばない（出所と時刻を1つに＝R8）', route.includes('getHistory(c.symbol, period, { allowMock: false })') && !route.includes('getQuote'))
// 2026-09-29: 記録側の DecisionRecord.price は本番の blob で実際の株価と食い違っていた
// （AMZN 188.25 相当／同日の実際の終値 247.49、9984.T 9,447 相当／実際 6,574）。そこから騰落率を出すと
// 画面に実在しない数字が出る（原則9）。図と同じ日足の系列だけから出すこと。
check('route: 騰落率は日足の系列から出す（判断日の終値 → 最終足の終値）',
  route.includes('changePct: ((last.close - base.close) / base.close) * 100') && route.includes('const base = bars[baseIdx]'))
check('route: 騰落率に記録側の価格（c.price）を使っていない（実際の株価と食い違うため・原則9）',
  !/changePct[^\n]*c\.price/.test(route))
check('route: 騰落率の起点にした足の日付（baseAsOf）を返し、判断日より後の足が無い候補は外す（0 で埋めない）',
  route.includes('baseAsOf: isoDate(barMs(base))') && route.includes('if (baseIdx < 0) continue'))
check('route: 選び方は lib/entry/answer-examples.ts の純関数（pickAnswerExamples・isEligible）を使う', route.includes("from '@/lib/entry/answer-examples'") && route.includes('pickAnswerExamples(enriched)') && route.includes('.filter(isEligible)'))
check('route: 古い順に足していく（並べ替えの鍵は decidedAt → symbol → reasoning）', route.includes('a.decidedAt !== b.decidedAt') && route.includes('a.symbol !== b.symbol') && route.includes('a.reasoning < b.reasoning'))
check('route: 社名を返さない（Example に name が無い）', !/\bname\b/.test(between(route, 'export interface Example', '\n}')))
check('route: 出所は Yahoo Finance（source）・最終足の日付（priceAsOf）を返す', route.includes("const PRICE_SOURCE = 'Yahoo Finance'") && route.includes('priceAsOf: isoDate(barMs(last))'))
// S2 レビュー W2: 1銘柄の取得失敗でこの節を落とさない（最古の候補が上場廃止だと毎回同じ所で落ちる）。
// ただし「1件も取れない」＝取得元の障害は必ず 502 にする（失敗を「無い」と見せない・§6-12）。
check('route: 銘柄ごとの取得失敗は飛ばして数え、1件も取れなければ throw（「無い」に倒さない）',
  route.includes('failures++') && route.includes('if (failures > 0 && fetched === 0) throw new Error('))
check('route: AI推論を走らせない（anthropic・runTick・callClaude を呼ばない）', !/anthropic|runTick|callClaude/i.test(route))
check('route: 営業日は土日を除いて数える（getUTCDay が 0・6 でない日）＝事前の絞り込みだけに使う', route.includes('if (dow !== 0 && dow !== 6) n++'))
// S2 レビュー W1: 土日だけ除く数え方は祝日の分だけ多く出る。画面に出す「N営業日」と 20 の判定は
// 図と同じ日足の本数から数える（祝日の表を持たずに正確・出所も1つ＝R8）。
check('route: 画面に出す経過日数と 20 の判定は日足の本数から（bars.length - 1 - baseIdx）',
  route.includes('const tradingDaysAfter = bars.length - 1 - baseIdx')
  && route.includes('if (tradingDaysAfter < MIN_ELAPSED_BUSINESS_DAYS) continue')
  && route.includes('elapsedBusinessDays: tradingDaysAfter'))
check('route: 本番で service-role が無ければ 502 に倒す（設定漏れを「まだ無い」に化けさせない）',
  route.includes("process.env.NODE_ENV === 'production' && !hasServiceRole()"))

console.log('■ R1 色付きの影・R5 にじみ・R4 動き・§5-6 入場アニメ')
const tealShadows = (screen.match(/shadow-\[[^\]]*rgb\(45_212_191[^\]]*\]/g) ?? [])
check('R1: 色付きの影（rgb(45 212 191）は主ボタンの1か所だけ', tealShadows.length === 1 && tealShadows.includes('shadow-[0_16px_40px_-14px_rgb(45_212_191_/_.70)]'), tealShadows.join(' / '))
check('R1: rgb(45 212 191 の直値はページで1か所（主ボタンの影）・layout で1か所（にじみ）・カードに無い', count(page, 'rgb(45_212_191') === 1 && count(layout, 'rgb(45_212_191') === 1 && count(card, 'rgb(45') === 0)
check('R1: text-shadow・drop-shadow・shadow-float を使わない（光るのは押せるものだけ）', !/text-shadow|drop-shadow|shadow-float/.test(screen))
check('R1: 主ボタン以外に shadow- が無い（layout の 100vmax の地の塗りも無い）', count(screen, 'shadow-[') === 1 && !screen.includes('100vmax'), `shadow-[ ×${count(screen, 'shadow-[')}`)
const radials = screen.match(/radial-gradient\([^\]]*\)/g) ?? []
check('R5: radial-gradient は2つ以下・中心は青緑 .22 と藍 #818CF8（rgb 129 140 248）.16', radials.length === 2 && radials.some(r => r.includes('rgb(45_212_191_/_.22)')) && radials.some(r => r.includes('rgb(129_140_248_/_.16)')), radials.join(' / '))
check('R5: にじみは layout の上端だけ（page には無い）・pointer-events-none・aria-hidden・-z-10・親は isolate', count(page, 'radial-gradient') === 0 && count(layout, 'pointer-events-none') === 2 && count(layout, 'aria-hidden') === 2 && count(layout, '-z-10') === 2 && layout.includes('className="relative isolate"'))
check('R5: にじみが右にはみ出さない（right の値が負でない・overflow-hidden で sticky を壊さない）', !/-right-|right-\[-/.test(layout) && !layout.includes('overflow-hidden'))
check('R4: infinite が無い（page・layout・カード・globals.css）', !/infinite/.test(screen) && !/infinite/.test(css))
check('R4: 読み込み中の枠は動かない（animate-spin／pulse／ping／bounce が無い・aria-busy）', !/animate-(?:spin|pulse|ping|bounce)/.test(screen) && page.includes('aria-busy="true"'))
check('R4: globals.css の @keyframes は rise の1つだけ（translateY(18px)→0・opacity 0→1）', count(css, '@keyframes') === 1 && /@keyframes rise \{\s*from \{ opacity: 0; transform: translateY\(18px\); \}\s*to\s+\{ opacity: 1; transform: none; \}/.test(css))
check('§5-6: animate-rise は .85s・cubic-bezier(.2,.75,.2,1)・backwards', css.includes('--animate-rise: rise .85s cubic-bezier(.2,.75,.2,1) backwards;'))
const rise = between(page, 'const RISE = [', '] as const')
const delays = [...rise.matchAll(/animation-delay:(\d+)ms/g)].map(m => +m[1])
check('§5-6: 入場は最大7要素・65ms 刻み・合計 390ms（≤ 420ms）', count(rise, "'motion-safe:animate-rise") === 7 && JSON.stringify(delays) === JSON.stringify([65, 130, 195, 260, 325, 390]))
check('§5-6: motion-safe: で「動きを減らす」設定では動かさない（animate-rise は motion-safe: 付きだけ）', count(page, 'animate-rise') === count(page, 'motion-safe:animate-rise'))
check('§5-6: 入場はヒーローの5要素だけ（3つの画面より下に RISE が無い）・IntersectionObserver を使わない', !lower.includes('RISE[') && count(hero, 'RISE[') === 5 && !page.includes('IntersectionObserver'), `hero RISE ×${count(hero, 'RISE[')}`)
check('§5-6: ホバーは色だけ 150ms（transition-colors duration-150）・scale を使わない', page.includes('transition-colors duration-150') && !/scale-/.test(screen))
check('スマホで横にはみ出さない作り（断片の列は min-w-0・図は min-w-0 flex-1）', stages.includes('<div className="min-w-0">') && card.includes('min-w-0 flex-1'))

console.log('■ フッター（R10）・SITE_DESC・/watch の h1・DESIGN.md')
const footer = between(rootLayout, '<footer', '</footer>')
check('app/layout.tsx: フッターの枠に 運営者情報／お問い合わせ／プライバシーポリシー／利用規約（文字・準備中）', ['InvestSim', '運営者情報', 'お問い合わせ', 'プライバシーポリシー', '利用規約', '準備中'].every(w => footer.includes(w)))
const operatorLine = footer.split('\n').find(l => l.includes('運営者情報')) ?? ''
check('app/layout.tsx: 運営者情報／お問い合わせ／プライバシーポリシー／利用規約 の行は <a>・<Link> にしない（行き先が未整備）・border-t border-border・small/--muted',
  operatorLine.length > 0 && !/<a\b|<Link\b/.test(operatorLine) && footer.includes('border-t border-border') && footer.includes('text-small text-muted'))
check('app/layout.tsx: フッターに /watch への常設リンクが1本ある（無条件かどうかは scripts/check-watch-reachable.ts）', count(footer, 'href="/watch"') === 1)
check('app/layout.tsx: 「無料」はフッターの1文だけ・打消しとセット', count(rootLayout, '無料') === 1 && footer.includes('現在は無料で公開しています。将来、有料の機能を作る可能性があります。'))
check('app/(night)/layout.tsx: フッターを持たない（root に移したので二重に出さない）', !layout.includes('<footer'))
check("layout: 'use client' を付けていない（viewport は Server Component から）", !/['"]use client['"]/.test(layout))
const siteDesc = between(rootLayout, 'const SITE_DESC', '\n\n')
check('app/layout.tsx: SITE_DESC に 名人・投資家・無料・リスクゼロ・上手くなる・うまくなる が無い（検索結果と OGP に出る文）', siteDesc.length > 0 && !/名人|投資家|無料|リスクゼロ|上手くなる|うまくなる/.test(siteDesc), siteDesc)
check('app/layout.tsx: SITE_DESC は「実際のお金は1円も動きません」', siteDesc.includes('実際のお金は1円も動きません'))
const watch = stripComments(read('app/watch/client.tsx'))
check('/watch: h1 は「AIの判断と、その根拠を読む」（「AIと名人の判断を読む」は無い）', watch.includes('<h1 className="text-h1 text-ink text-balance">AIの判断と、その根拠を読む</h1>') && !watch.includes('AIと名人の判断を読む'))
const design = read('DESIGN.md')
check('DESIGN.md §4-2: 「R1〜R8 は機械で判定できる形」（R9〜R12 は機械判定でない）', design.includes('R1〜R8 は機械で判定できる形にしてあります') && !design.includes('すべて機械で判定できる形にしてあります'))
check('DESIGN.md §4-2 R3: 「ヒーロー（最初の1画面）のカードに騰落率を置かない」', design.includes('ヒーロー（最初の1画面）のカードに騰落率を置かない'))
check('DESIGN.md §5-2: display の行に「640px 未満の大見出しは 40px（行間・太さ・字間は同じ。3行以内に収める）」', design.includes('640px 未満の大見出しは 40px（行間・太さ・字間は同じ。3行以内に収める）'))
const design3 = between(design, '### トップページの構成（上から順に）', '\n## 4. ')
check('DESIGN.md §3: トップページの構成は S2 の構成（ヒーロー → 3つの画面 → レールの3段 → 締め → 免責）・S2 で差し替え予定の断りが消えている',
  design3.includes('S2「プレゼン型ホーム」') && design3.includes('**01 書く**') && design3.includes('**02 くらべる**') && design3.includes('**03 読み返す**') && design3.includes('<Disclaimer part="general" />') && !design3.includes('S2 で差し替え予定'))
check('DESIGN.md §3: 法務の条件を書いてある（ヒーローに騰落率を置かない・左は記入例と明示・「ちがい」は静的・水平線は描かない・使わない語）',
  design3.includes('ヒーローに騰落率を置かない') && design3.includes('左は記入例であることを画面に明示') && design3.includes('静的な説明文') && design3.includes('「やめる条件」の水平線は描かない') && design3.includes('見本／お手本／模範／正解例'))
check('DESIGN.md §3: 旧構成「主ボタンは状態で出し分ける」は廃止と明記・「主ボタンは画面の下に固定」はトップには当てない・C3〜C5 と DECISIONS.md 2026-09-25 への参照',
  design3.includes('廃止') && design3.includes('はトップには当てない') && design3.includes('C3〜C5') && design3.includes('2026-09-25「トップページの入口画面に関する法務の不変条件2つ」') && !design3.includes('3. 主ボタン1つ（状態で出し分ける）'))
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
