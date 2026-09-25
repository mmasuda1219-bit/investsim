// トップページ（入口画面・S1c 2026-09-25）の検査。法務 (G)（legal-compliance 2026-09-25）と DESIGN.md §4-2 R1・R4・R5 を機械で見る。
//   $env:PATH = "C:\Program Files\nodejs;$env:PATH"; npx tsx scripts/check-entry.ts
//
// 見るもの（正は NEXT-STEPS.md「S1c」の節と DESIGN.md §3・§4-2・§5-2・§5-6・§6-11）:
//  - 免責は共通部品 <Disclaimer part="general" />（DISCLAIMER_TEXT）が1回以上。手書き免責（「投資助言・代理業には該当しません」）は無い
//  - 書かない語: 「リスクゼロ」「うまくなる」「上手くなる」「おすすめ」「買い時」「売り時」「無料」「今日」が 0 件（注釈を除く）。
//    旧文言（「AIと名人と自分」「まずAIの判断を見てみる」等）と「名人」「投資家」も 0 件
//  - 注記 (B)（プレビュー②の直下）と (C)（AIの見本の直下）が存在し、<details> の中でなく、small・--ink-2（caption にしない）
//  - /watch へのリンクを持つ節に注記がある（AIの判断を見せる・そこへ送る節。4段階の一列とヘッダーの nav は行き先の案内なので対象外）
//  - 3枚の選択カードが常に描画される（<section aria-labelledby="choose-heading"> から {CHOICES.map( までに && ( / ? ( が無い）・
//    既定は①・選択は React の state だけ（localStorage / sessionStorage / document.cookie / fetch に渡していない。fetch は /api/ai-session/latest の1本だけ）
//  - AI の理由文: プレビュー②は冒頭1文（最初の「。」まで）、見本2件は**全文**に forbiddenWordsIn(…, FORBIDDEN_IN_OUTPUT) を通し、
//    ヒットする件は出さない（2026-09-25 reviewer W1。line-clamp は全文を置いて見た目だけ切る）。選び方は lib/entry/samples.ts（純関数）で、
//    ここでは文字列の一致に加えて **実際に呼んで** 6パターン（0件／1件／2件とも buy／3件全部 buy／2件目に禁止語／3件目で非 buy）の結果を見る
//  - 見本2件は「買い」以外を1件以上含める（無ければ節ごと出さない）
//  - 640px 未満の h1 は 40px（max-sm:text-[40px] を className の末尾に）・DESIGN.md §5-2 に同じ1文・§3 は承認構成（状態で出し分けない）
//  - 押せる文字リンクは全部 min-h-11（44px。empty 状態の「「見る」を開く →」も）
//  - R1: 色付きの影（rgb(45 212 191）は主ボタンと選択中カードの2か所だけ。札に影は無い
//  - R5: radial-gradient は2つ以下・中心の不透明度 .22 まで
//  - R4: infinite が無い。入場アニメは7要素・65ms 刻み・.85s・ファーストビューだけ（下の節には当てない）
//  - 見出しは display（52px / 1.26 / 900 / -0.035em）で「再現」を含まない。リードは h3 の大きさ・400・行間 1.9
//  - フッターの枠（R10）: 運営者情報／お問い合わせ／プライバシーポリシー／利用規約 を文字で（<a> にしない・準備中）
//  - app/layout.tsx の SITE_DESC に名人・投資家・無料・リスクゼロ・上手くなる が無い／ /watch の h1 が新文言
//  - DESIGN.md の小さな直し3件（「R1〜R8 は機械で」・check-signals-undecidable.ts:432 ×2）
//
// 実ネットワーク不要。ファイルを読むだけ。

import fs from 'fs'
import path from 'path'
import { DISCLAIMER_TEXT } from '../components/ui/Disclaimer'
import { FORBIDDEN_IN_OUTPUT, forbiddenWordsIn } from '../lib/investors/rulebooks/forbidden'
import { fieldsFor } from '../lib/trade/reason'
import { firstSentence, isFullyShowable, isShowable, pickSamples, type SampleDecision } from '../lib/entry/samples'

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

const NOTE_B = 'これは、このサイトのAIが仮想資金で出した判断の記録です。特定の銘柄の売買を推奨するものではありません。（取得: '
const NOTE_C_HEAD = 'これは、このサイトのAIが仮想資金で出した判断の記録です（取得: '
const NOTE_C_TAIL = '▲▼はAIの判断の分類で、特定の銘柄の売買を推奨するものではありません。'

// 節の切り出し（page の JSX の目印で区切る）
const firstView = between(page, '<div className="flex flex-col gap-10 lg:flex-row', '</aside>')
const aside = between(page, '<aside', '</aside>')
const lower = page.slice(page.indexOf('<div className="mt-16'))
const stages = between(page, 'aria-labelledby="stages-heading"', '</section>')
const samples = between(page, 'aria-labelledby="samples-heading"', '</section>')
const fnPreviewWrite = between(page, 'function PreviewWrite', '\nfunction PreviewWatch')
const fnPreviewWatch = between(page, 'function PreviewWatch', '\nfunction PreviewReview')
const fnPreviewReview = page.slice(page.indexOf('function PreviewReview'))

console.log('■ 免責（DISCLAIMER_TEXT）と手書き免責の撤去')
check('トップ: <Disclaimer part="general" /> を1回以上（共通部品・§6-11）', count(page, '<Disclaimer part="general" />') >= 1 && page.includes("from '@/components/ui/Disclaimer'"))
check('Disclaimer: part="general" で DISCLAIMER_TEXT を出す（文言は部品の定数。ページで作り直さない）', disclaimer.includes("part !== 'investor' ? DISCLAIMER_TEXT") && DISCLAIMER_TEXT.length > 100)
check('トップ: 免責は下の節（静止の範囲）の末尾・border-t の上', lower.includes('<section className="border-t border-border pt-4">\n          <Disclaimer part="general" />'))
check('トップ・layout: 「投資助言・代理業には該当しません」の自己断定が無い（§6-11）', !page.includes('該当しません') && !layout.includes('該当しません'))
check('トップ: 旧の手書き免責「InvestSim は投資判断を練習するためのシミュレーターです」が無い', !page.includes('InvestSim は投資判断を練習するためのシミュレーターです'))

console.log('■ 書かない語（法務 (G)・DESIGN §7）')
const screen = page + '\n' + layout
for (const w of ['リスクゼロ', 'うまくなる', '上手くなる', 'おすすめ', '買い時', '売り時', '無料', '今日']) {
  check(`トップ・layout: 「${w}」が 0 件`, !screen.includes(w))
}
const OLD_WORDING = ['AIと名人と自分', 'どの判断が正しかったかを', 'うまくなるのはAIではなく', '名人の条件を過去に当ててみる', 'まずAIの判断を見てみる', '上から順に降りてくるだけです', 'AIは、いまこう考えています', 'これはAIの仮想運用の記録であり', '全部の判断と根拠を見る']
const oldHits = OLD_WORDING.filter(w => screen.includes(w))
check('トップ: 旧文言（削除必須の7件＋2件）が残っていない', oldHits.length === 0, oldHits.join(' / '))
check('トップ・layout: 「名人」「投資家」の語が無い（名人を隠している間・注釈を除く）', !/名人|投資家/.test(screen))
check('トップ: 見出しに「再現」を入れない（法務: 変化を約束する語にしない）', !between(page, '<h1', '</h1>').includes('再現'))
check('トップ: 断定・将来の語（儲か／必ず／勝て／稼）が無い（R6）', !/儲か|必ず|勝て|稼/.test(screen))
check('トップ・layout: 急かす語（今だけ／先着／残り）・記章の語（認証／公式／保証／安心）が無い（R9・R12）', !/今だけ|先着|残り[0-9０-９]|認証|公式|保証|安心/.test(screen))

console.log('■ 注記 (B)(C)・畳まない・caption にしない')
check('注記 (B): プレビュー②の帯の直下に文言どおり', page.includes(NOTE_B))
check('注記 (B): small・--ink-2 の <p>（caption・muted にしない）', /<p className="mt-3 text-small text-ink-2">\s*これは、このサイトのAIが仮想資金で出した判断の記録です。特定の銘柄/.test(page))
// 注釈を落とすと JSX の {/* … */} は {} として残るので、その有無を許す
check('注記 (B): 帯（bg-card の div）の外＝地の上に置く（R11）', /<\/div>\s*(\{\}\s*)?\{choice === 'watch' && featured && \(/.test(aside) && aside.indexOf(NOTE_B) > aside.lastIndexOf('rounded-card border border-border bg-card'), 'aside の構造が想定と違う')
check('注記 (B): 取得時点を添える（formatWhen）', page.includes('（取得: {when}）') && page.includes("const when = session ? formatWhen(session.lastTickAt ?? '') : ''"))
check('注記 (C): AIの見本の直下に文言どおり（取得時点＋▲▼の説明）', samples.includes(NOTE_C_HEAD) && samples.includes(NOTE_C_TAIL))
check('注記 (C): small・--ink-2 の <p>', /<p className="max-w-\[42rem\] text-small text-ink-2">\s*これは、このサイトのAIが仮想資金で出した判断の記録です（取得: \{when\}）。▲▼は/.test(samples))
check('トップ・layout: <details> を使わない（免責・注記を畳まない＝R7）', !screen.includes('<details'))
check('トップ: 注記・免責に opacity を足していない（R7）', !/opacity-\d|opacity:/.test(page))
check('/watch へのリンクを持つ節に注記: AIの見本の節（href="/watch"）は注記 (C) を持つ', samples.includes('href="/watch"') && samples.includes(NOTE_C_TAIL))
check('/watch へのリンクを持つ節に注記: プレビュー②（PreviewWatch の空の状態の href="/watch"）は aside に注記 (B) を持つ', fnPreviewWatch.includes('href="/watch"') && aside.includes('<PreviewWatch') && aside.includes(NOTE_B))
check('/watch へのリンクを持つ節に注記: 主ボタンが /watch を指すとき（②選択中）は同じファーストビューに注記 (B) が出る', firstView.includes('href={current.href}') && firstView.includes(NOTE_B) && page.includes("choice === 'watch' && featured && ("))
check('href="/watch" の直書きは AIの見本と PreviewWatch の2か所だけ（それ以外の /watch は CHOICES と NAV）', count(page, 'href="/watch"') === 2 && count(samples, 'href="/watch"') === 1 && count(fnPreviewWatch, 'href="/watch"') === 1)

console.log('■ 3枚の選択カード・保存しない')
const choices = between(page, 'const CHOICES', ']\n')
check('CHOICES は3件（write / watch / review）でこの順', count(choices, "{ id: '") === 3 && /id: 'write'[\s\S]*id: 'watch'[\s\S]*id: 'review'/.test(choices))
check('カードの文言: 自分で書く／AIの判断を読む／あとで読み返す', choices.includes("title: '自分で書く'") && choices.includes("title: 'AIの判断を読む'") && choices.includes("title: 'あとで読み返す'"))
check('カード②の説明は「直近に」（「今日」を固定文字にしない）', choices.includes("hint: 'このサイトのAIが直近にどう考えたかを読む'"))
check('主ボタンの文言と行き先: 理由を書きに行く→/trade／AIの判断を読みに行く→/watch／記録を読み返しに行く→/review',
  /cta: '理由を書きに行く',\s+href: '\/trade'/.test(choices) && /cta: 'AIの判断を読みに行く',\s+href: '\/watch'/.test(choices) && /cta: '記録を読み返しに行く',\s+href: '\/review'/.test(choices))
const mapAt = page.indexOf('{CHOICES.map(')
// <section aria-labelledby="choose-heading"> の開始から {CHOICES.map( までの間に条件描画（&& ( / ? (）が無い＝3枚とも節の直下で無条件に描く
const chooseToMap = between(page, '<section aria-labelledby="choose-heading"', '{CHOICES.map(')
check('3枚は常に描画（{CHOICES.map( が1回・<section aria-labelledby="choose-heading"> から {CHOICES.map( までに && ( / ? ( が無い）',
  mapAt > -1 && count(page, '{CHOICES.map(') === 1 && chooseToMap.length > 0 && !/&&\s*\(|\?\s*\(/.test(chooseToMap), chooseToMap.slice(0, 120))
check("既定は①（useState<Choice>('write')）。時刻・流入元・ログイン状態で変えない（useSearchParams / cookies / Date を選択に使わない）",
  page.includes("useState<Choice>('write')") && !page.includes('useSearchParams') && !page.includes('cookies') && !between(page, 'const [choice', '\n').includes('Date'))
check('カードは <button type="button"> で aria-pressed（色だけに頼らない）', /<button\s+key=\{c\.id\}\s+type="button"\s+aria-pressed=\{selected\}/.test(page))
check('選択中の印は文字「選択中」（text-caption text-brand font-semibold）', page.includes('<span className="shrink-0 pt-1 text-caption font-semibold text-brand">選択中</span>'))
check('選択中: bg-surface＋枠 rgb(45 212 191 / .55)＋発光の影／未選択: bg-card＋border-border（§5-1）',
  page.includes("'border-[rgb(45_212_191_/_.55)] bg-surface shadow-[0_22px_48px_-22px_rgb(45_212_191_/_.55)]'") && page.includes("'border-border bg-card hover:bg-surface'"))
check('カードの高さ 72px 以上（min-h-18）・角丸は rounded-card', page.includes('min-h-18 w-full rounded-card border'))
check('選択を保存しない: localStorage / sessionStorage / document.cookie が無い', !/localStorage|sessionStorage|document\.cookie/.test(page))
const fetchLines = page.split('\n').filter(l => l.includes('fetch('))
check('選択を送らない: fetch は /api/ai-session/latest（GET・本文なし）の1本だけで、choice を渡していない',
  fetchLines.length === 1 && fetchLines[0].includes("fetch('/api/ai-session/latest', { signal: ctrl.signal })") && !fetchLines[0].includes('choice') && !page.includes('method:'))
check('setChoice はカードと文字リンクの onClick の2か所だけ', count(page, 'setChoice(') === 2 && count(page, 'onClick={() => setChoice(') === 2)
check('文字リンク「気になっている株がまだ無ければ…」は <button> で②を選択中にする（ページ遷移しない）',
  /<button\s+type="button"\s+onClick=\{\(\) => setChoice\('watch'\)\}[\s\S]{0,300}気になっている株がまだ無ければ「AIの判断を読む」から/.test(page))

console.log('■ AIの判断の出し方（禁止語・非 buy・札・架空データ無し）')
check('選び方は lib/entry/samples.ts（純関数。React・fetch・保存が無い）。page はそれを import して使うだけ',
  page.includes("import { firstSentence, isShowable, pickSamples } from '@/lib/entry/samples'") && !page.includes('function pickSamples') && !page.includes('function isShowable') && !page.includes('function firstSentence')
  && !/from 'react'|fetch\(|localStorage|sessionStorage/.test(samplesSrc))
check('samples.ts: 冒頭1文（最初の「。」まで）を切り出す firstSentence', samplesSrc.includes("const i = text.indexOf('。')") && samplesSrc.includes('return i < 0 ? text : text.slice(0, i + 1)'))
check('samples.ts: 冒頭1文に forbiddenWordsIn(…, FORBIDDEN_IN_OUTPUT) を通す isShowable（lib/investors/rulebooks/forbidden.ts を import して使うだけ）',
  samplesSrc.includes('forbiddenWordsIn(firstSentence(d.reasoning), FORBIDDEN_IN_OUTPUT).length === 0') && samplesSrc.includes("from '@/lib/investors/rulebooks/forbidden'"))
check('samples.ts: 全文に forbiddenWordsIn(…, FORBIDDEN_IN_OUTPUT) を通す isFullyShowable（見本2件は line-clamp で全文を置くので全文で見る＝W1）',
  samplesSrc.includes('forbiddenWordsIn(d.reasoning, FORBIDDEN_IN_OUTPUT).length === 0'))
check('プレビュー②: 先頭から見て冒頭1文がヒットしない最初の1件（find(isShowable)）。誰が選んでも同じ1件', page.includes('session.decisions.find(isShowable) ?? null'))
check('見本2件: 全文でヒットする件は飛ばす（filter(isFullyShowable)。冒頭1文だけの isShowable にしない）', samplesSrc.includes('decisions.filter(isFullyShowable)') && !samplesSrc.includes('filter(isShowable)'))
check('見本2件: 「買い」以外を1件以上含める分岐（両方 buy なら3件目以降から・無ければ null＝節ごと出さない）',
  samplesSrc.includes("if (a.action !== 'buy' || b.action !== 'buy') return [a, b]") && samplesSrc.includes("rest.find(d => d.action !== 'buy')") && samplesSrc.includes('return other ? [a, other] : null'))
check('見本2件: page は pickSamples(session.decisions) を呼ぶだけ', page.includes('pickSamples(session.decisions)'))

// ── 選び方を実際に呼んで確かめる（文字列の一致だけに頼らない）。合成データは検査の中だけ・製品コードに入れない ──
// 禁止語を含む文は FORBIDDEN_IN_OUTPUT から組み立てる（一覧が変わっても検査が古びない）。冒頭1文は無害・2文目に禁止語、が W1 の形
const CLEAN = 'RSI81買われすぎ＋BB上限超え。'
const BAD_TAIL = `この先は${FORBIDDEN_IN_OUTPUT[FORBIDDEN_IN_OUTPUT.length - 1]}と見る。`
const D = (action: SampleDecision['action'], reasoning = CLEAN + '出来高は平均並み。'): SampleDecision => ({ action, reasoning })
check('firstSentence: 最初の「。」まで／「。」が無ければ全文', firstSentence(CLEAN + '出来高は平均並み。') === CLEAN && firstSentence('句点なし') === '句点なし')
check('isShowable（冒頭1文）と isFullyShowable（全文）の違い: 2文目だけに禁止語 → 冒頭1文は通るが全文は通らない（W1）',
  isShowable(D('buy', CLEAN + BAD_TAIL)) === true && isFullyShowable(D('buy', CLEAN + BAD_TAIL)) === false && isFullyShowable(D('buy')) === true)
check('pickSamples: 0件 → null', pickSamples([]) === null)
check('pickSamples: 1件 → null', pickSamples([D('sell')]) === null)
check('pickSamples: 2件とも buy で3件目なし → null（買いだけは並べない）', pickSamples([D('buy'), D('buy')]) === null)
check('pickSamples: 3件全部 buy → null', pickSamples([D('buy'), D('buy'), D('buy')]) === null)
{
  // 2件目の全文に禁止語（冒頭1文は無害）→ 2件目は飛ばされ、1件目と3件目の2件
  const a = D('buy'), bad = D('sell', CLEAN + BAD_TAIL), c = D('hold')
  const r = pickSamples([a, bad, c])
  check('pickSamples: 2件目の全文に禁止語 → その件を飛ばして [1件目, 3件目]（冒頭1文だけ見る旧版なら bad が残る）', r !== null && r[0] === a && r[1] === c && !r.includes(bad), JSON.stringify(r))
}
{
  const a = D('buy'), b = D('buy'), c = D('watch')
  const r = pickSamples([a, b, c])
  check('pickSamples: 最新2件が buy・3件目で非 buy → [1件目, 3件目]', r !== null && r[0] === a && r[1] === c, JSON.stringify(r))
  const r2 = pickSamples([D('sell'), D('buy'), c])
  check('pickSamples: 1件目が非 buy → そのまま先頭2件', r2 !== null && r2[0].action === 'sell' && r2[1].action === 'buy')
}
check('見本の節は samples が null なら描画しない', page.includes('{samples && (\n          <section aria-labelledby="samples-heading"'))
check('プレビュー②: ▲▼の札を出さない（PreviewWatch に ACTION_LABEL / ACTION_BADGE / ▲ / ▼ が無い）', fnPreviewWatch.length > 0 && !/ACTION_LABEL|ACTION_BADGE|▲|▼/.test(fnPreviewWatch))
check('プレビュー②: 社名＋銘柄は small・--muted の1行（見出しにしない）・冒頭1文は body・--ink・取得時点は caption',
  fnPreviewWatch.includes('<p className="text-small text-muted">{featured.name}（{featured.symbol}）</p>') && fnPreviewWatch.includes('<p className="text-body text-ink">{firstSentence(featured.reasoning)}</p>') && fnPreviewWatch.includes('取得: {when}'))
check('プレビュー②: 候補 0 件は empty と同じ形（仮の文で埋めない）', fnPreviewWatch.includes('if (!featured) {') && fnPreviewWatch.includes('まだAIの判断記録がありません') && !/例[:：]/.test(fnPreviewWatch))
check('プレビュー②: loading（薄い枠・aria-busy）と error（三点＋もう一度読み込む）は既存の形', fnPreviewWatch.includes('aria-busy="true"') && fnPreviewWatch.includes('AIの判断記録を読み込めませんでした') && fnPreviewWatch.includes('onClick={retry}'))
check('プレビュー②: 帯の中に bg-card を重ねない（入れ子禁止・§6-6）', !fnPreviewWatch.includes('bg-card'))
check('見本: 札は無彩色で影なし（ACTION_BADGE に shadow が無い）・line-clamp-2', !between(page, 'const ACTION_BADGE', '\n').includes('shadow') && samples.includes('line-clamp-2'))
check('見本: 見出し行の右は caption（回数を見出しにしない＝R3）', samples.includes('<span className="text-caption text-muted tabular-nums">{when}・{session?.tickCount}回目の判断</span>'))
check('見本: 末尾に <Link href="/watch">AIの判断を全部読む →', /<Link href="\/watch"[^>]*>\s*AIの判断を全部読む →/.test(samples))
check('架空の判断・銘柄を書いていない（AAPL 等のティッカーや「例:」の文がページに無い）', !/['"](?:AAPL|MSFT|NVDA|TSLA|7203\.T)['"]|例[:：]/.test(page))
check('AI推論を走らせない（/api/ai-session/[id]/tick・/api/analyze を呼ばない）', !/\/tick|\/api\/analyze|anthropic/i.test(page))
// 禁止語の検査そのものが動くことを、実物の語で確かめる（forbidden.ts の1か所が正）
check('forbiddenWordsIn: 「上がる」を含む冒頭1文はヒットする／含まない文はヒットしない',
  forbiddenWordsIn('この銘柄は上がる。', FORBIDDEN_IN_OUTPUT).length > 0 && forbiddenWordsIn('RSI81買われすぎ＋BB上限超え。', FORBIDDEN_IN_OUTPUT).length === 0)

console.log('■ プレビュー①③（実物の形だけ・架空の記入例なし）')
check("プレビュー①: lib/trade/reason.ts の fieldsFor('buy') の問いを出す", fnPreviewWrite.includes("fieldsFor('buy')") && fnPreviewWrite.includes('{f.question}') && fieldsFor('buy').length === 3)
check('プレビュー①: 入力欄の見た目を作らない・記入例（placeholder / help）を出さない・押せない', !/<input|<textarea|placeholder|f\.help|<button|<Link|onClick/.test(fnPreviewWrite))
check('プレビュー①: 問いは body・--ink、下に書き込みの罫（border-b border-rule-line。--card の上）', fnPreviewWrite.includes('border-b border-rule-line') && fnPreviewWrite.includes('<p className="text-body text-ink">'))
check('プレビュー③: /review の記録カードの形（①書いた理由 → ②その後の値動き → ③損益）と「あなたの記録はここに並びます」（記録がある人にも偽にならない・S4）・数字なし',
  fnPreviewReview.includes("'① 書いた理由', '② その後の値動き', '③ 損益'") && fnPreviewReview.includes('あなたの記録はここに並びます') && !fnPreviewReview.includes('まだ記録がありません') && !/[$¥][0-9]|[0-9]+%/.test(fnPreviewReview))
check('プレビュー②の empty 状態の「「見る」を開く →」は他の文字リンクと同じ min-h-11（44px）＋FOCUS_RING（W6）',
  /<Link href="\/watch" className=\{`inline-flex min-h-11 items-center rounded-field text-small text-brand hover:underline \$\{FOCUS_RING\}`\}>\s*「見る」を開く →/.test(fnPreviewWatch) && !fnPreviewWatch.includes('inline-block'))
check('プレビューの帯は bg-card＋border-border＋rounded-card＋p-6、外に small/--muted の見出し、右上に caption「実際の画面です」',
  aside.includes('rounded-card border border-border bg-card p-6') && aside.includes('選ぶと、こういうものが出ます') && aside.includes('<p className="shrink-0 text-caption text-muted">実際の画面です</p>'))
check('プレビューは lg で sticky（top 88px）・左 56% / 右 44%・gap 48px', aside.includes('lg:sticky lg:top-22 lg:basis-[44%]') && page.includes('lg:basis-[56%]') && page.includes('lg:flex-row lg:items-start lg:gap-12'))

console.log('■ 見出し・リード・節の見出し')
const h1 = between(page, '<h1', '</h1>')
check('h1 は display（52px / 1.26 / 900 / -0.035em）・text-balance・文言どおり', h1.includes('text-display text-ink text-balance') && h1.includes('買う理由を書いて残し、あとで株価と読み返す。'))
check('globals.css: --text-display は 52px / 1.26 / 900 / -0.035em', css.includes('--text-display:               52px;') && css.includes('--text-display--line-height:  1.26;') && css.includes('--text-display--font-weight:  900;') && css.includes('--text-display--letter-spacing: -0.035em;'))
check('h1 は1つだけ（display は1画面に1つ）', count(page, '<h1') === 1)
check('h1: 640px 未満は font-size だけ 40px（className の末尾に max-sm:text-[40px]。行間・太さ・字間は .text-display から継承＝W2）',
  /className=\{`mt-5 text-display text-ink text-balance \$\{RISE\[1\]\} max-sm:text-\[40px\]`\}/.test(h1) && count(page, 'max-sm:text-[40px]') === 1)
check('リードは h3 の大きさ・400・行間 1.9・--ink-2・最大幅 540px・「実際のお金は1円も動きません」',
  /text-h3 font-normal leading-\[1\.9\] text-ink-2/.test(page) && page.includes('max-w-[540px]') && page.includes('実際のお金は1円も動きません。'))
check('分類ラベル「投資判断の練習場」（small・--muted・入場の1番目）', /<p className=\{`text-small text-muted \$\{RISE\[0\]\}`\}>投資判断の練習場<\/p>/.test(page))
for (const t of ['できることは3つです。どれから始めますか', 'このサイトは4つの段階でできています', 'AIも、同じ形式で理由を書いています', '選ぶと、こういうものが出ます']) {
  check(`節の見出し「${t}」は small・--muted の h2（カードの外）`, new RegExp(`<h2 id="[a-z-]+" className="text-small text-muted">${t}</h2>`).test(page))
}
check('4段階の一列は NAV の label・hint をそのまま・/trade だけ大きい（text-h2・min-h-20）・帯は bg-card＋border', stages.includes('{NAV.map(({ href, label, hint }, i)') && stages.includes("const heart = href === '/trade'") && stages.includes("heart ? 'text-h2' : 'text-h3'") && stages.includes('rounded-card border border-border bg-card'))

console.log('■ 主ボタン・focus')
const primary = between(page, 'href={current.href}', '</Link>')
check('主ボタンは1つ・h-56（h-14）・bg-brand・text-on-brand・hover:bg-brand-strong・rounded-card・font-semibold',
  count(page, 'href={current.href}') === 1 && /h-14 [^"]*rounded-card bg-brand [^"]*text-body font-semibold text-on-brand[^"]*hover:bg-brand-strong/.test(primary))
check('主ボタンの発光の影は 0 16px 40px -14px rgb(45 212 191 / .70)', primary.includes('shadow-[0_16px_40px_-14px_rgb(45_212_191_/_.70)]'))
check('focus は outline 2px --focus＋offset 2px（box-shadow の内側描画にしない）', page.includes("const FOCUS_RING = 'focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-2'") && !/focus-visible:ring|focus:ring|focus-visible:shadow|focus:shadow/.test(page))
check('ボタンの文言は「押すと何が起きるか」の動詞（OK／送信／次へ を使わない）', !/>\s*(OK|送信|次へ)\s*</.test(page))

console.log('■ R1 色付きの影・R5 にじみ・R4 動き・§5-6 入場アニメ')
const tealShadows = (screen.match(/shadow-\[[^\]]*rgb\(45_212_191[^\]]*\]/g) ?? [])
check('R1: 色付きの影（rgb(45 212 191）は主ボタンと選択中カードの2か所だけ', tealShadows.length === 2 && tealShadows.includes('shadow-[0_16px_40px_-14px_rgb(45_212_191_/_.70)]') && tealShadows.includes('shadow-[0_22px_48px_-22px_rgb(45_212_191_/_.55)]'), tealShadows.join(' / '))
check('R1: rgb(45 212 191 の直値はページで3か所（影2＋選択中の枠1）・layout で1か所（にじみ）だけ', count(page, 'rgb(45_212_191') === 3 && count(layout, 'rgb(45_212_191') === 1)
check('R1: text-shadow・drop-shadow・shadow-float を使わない（光るのは押せるものだけ）', !/text-shadow|drop-shadow|shadow-float/.test(screen))
check('R1: 主ボタンと選択中カード以外に shadow- が無い', count(screen, 'shadow-[') === 3 && screen.includes('shadow-[0_0_0_100vmax_var(--bg)]'), `shadow-[ ×${count(screen, 'shadow-[')}`)
const radials = screen.match(/radial-gradient\([^\]]*\)/g) ?? []
check('R5: radial-gradient は2つ以下・中心は青緑 .22 と藍 #818CF8（rgb 129 140 248）.16', radials.length === 2 && radials.some(r => r.includes('rgb(45_212_191_/_.22)')) && radials.some(r => r.includes('rgb(129_140_248_/_.16)')), radials.join(' / '))
check('R5: にじみは layout の上端だけ（page には無い）・pointer-events-none・aria-hidden・-z-10・親は isolate', count(page, 'radial-gradient') === 0 && count(layout, 'pointer-events-none') === 2 && count(layout, 'aria-hidden') === 2 && count(layout, '-z-10') === 2 && layout.includes('className="relative isolate bg-background'))
check('R5: にじみが右にはみ出さない（right の値が負でない・overflow-hidden で sticky を壊さない）', !/-right-|right-\[-/.test(layout) && !layout.includes('overflow-hidden'))
check('R4: infinite が無い（page・layout・globals.css）', !/infinite/.test(screen) && !/infinite/.test(css))
check('R4: globals.css の @keyframes は rise の1つだけ（translateY(18px)→0・opacity 0→1）', count(css, '@keyframes') === 1 && /@keyframes rise \{\s*from \{ opacity: 0; transform: translateY\(18px\); \}\s*to\s+\{ opacity: 1; transform: none; \}/.test(css))
check('§5-6: animate-rise は .85s・cubic-bezier(.2,.75,.2,1)・backwards', css.includes('--animate-rise: rise .85s cubic-bezier(.2,.75,.2,1) backwards;'))
const rise = between(page, 'const RISE = [', '] as const')
const delays = [...rise.matchAll(/animation-delay:(\d+)ms/g)].map(m => +m[1])
check('§5-6: 入場は最大7要素・65ms 刻み・合計 390ms（≤ 420ms）', count(rise, "'motion-safe:animate-rise") === 7 && JSON.stringify(delays) === JSON.stringify([65, 130, 195, 260, 325, 390]))
check('§5-6: motion-safe: で「動きを減らす」設定では動かさない（animate-rise は motion-safe: 付きだけ）', count(page, 'animate-rise') === count(page, 'motion-safe:animate-rise'))
check('§5-6: 入場はファーストビューだけ（4段階より下・PreviewWrite/Watch/Review に RISE が無い）・IntersectionObserver を使わない', !lower.includes('RISE[') && count(firstView, 'RISE[') === 7 && !page.includes('IntersectionObserver'))
check('§5-6: ホバーは色だけ 150ms（transition-colors duration-150）・scale を使わない', page.includes('transition-colors duration-150') && !/scale-/.test(screen))

console.log('■ フッター（R10）・SITE_DESC・/watch の h1・DESIGN.md の直し')
const footer = between(layout, '<footer', '</footer>')
check('layout: フッターの枠に 運営者情報／お問い合わせ／プライバシーポリシー／利用規約（文字・準備中）', ['InvestSim', '運営者情報', 'お問い合わせ', 'プライバシーポリシー', '利用規約', '準備中'].every(w => footer.includes(w)))
check('layout: フッターは <a> にしない（行き先が未整備）・border-t border-border・small/--muted', !footer.includes('<a') && footer.includes('border-t border-border') && footer.includes('text-small text-muted'))
check("layout: 'use client' を付けていない（viewport は Server Component から）", !/['"]use client['"]/.test(layout))
const siteDesc = between(rootLayout, 'const SITE_DESC', '\n\n')
check('app/layout.tsx: SITE_DESC に 名人・投資家・無料・リスクゼロ・上手くなる・うまくなる が無い（検索結果と OGP に出る文）', siteDesc.length > 0 && !/名人|投資家|無料|リスクゼロ|上手くなる|うまくなる/.test(siteDesc), siteDesc)
check('app/layout.tsx: SITE_DESC は「実際のお金は1円も動きません」', siteDesc.includes('実際のお金は1円も動きません'))
const watch = stripComments(read('app/watch/client.tsx'))
check('/watch: h1 は「AIの判断と、その根拠を読む」（「AIと名人の判断を読む」は無い）', watch.includes('<h1 className="text-h1 text-ink text-balance">AIの判断と、その根拠を読む</h1>') && !watch.includes('AIと名人の判断を読む'))
const design = read('DESIGN.md')
check('DESIGN.md §4-2: 「R1〜R8 は機械で判定できる形」（R9〜R12 は機械判定でない）', design.includes('R1〜R8 は機械で判定できる形にしてあります') && !design.includes('すべて機械で判定できる形にしてあります'))
check('DESIGN.md §5-2: display の行に「640px 未満の大見出しは 40px（行間・太さ・字間は同じ。3行以内に収める）」', design.includes('640px 未満の大見出しは 40px（行間・太さ・字間は同じ。3行以内に収める）'))
const design3 = between(design, '### トップページの構成（上から順に）', '\n## 4. ')
check('DESIGN.md §3: トップページの構成は承認構成（3枚の選択カード・全員に同じ3つを同じ順で・既定は①・選択は保存しない）',
  design3.includes('全員に同じ3つを同じ順で出す。既定は①。選択は保存しない') && design3.includes('①自分で書く／②AIの判断を読む／③あとで読み返す') && design3.includes('<Disclaimer part="general" />'))
check('DESIGN.md §3: 旧構成「主ボタンは状態で出し分ける（記録が無い人→01 見る）」は廃止と明記され、現行の項目としては残っていない',
  design3.includes('廃止') && !design3.includes('3. 主ボタン1つ（状態で出し分ける）') && !design3.includes('記録がある人 →「03 やる：続きを書く」'))
check('DESIGN.md §3: 「主ボタンは画面の下に固定」はトップには当てない旨・法務 C3〜C5 と DECISIONS.md 2026-09-25 への参照',
  design3.includes('はトップには当てない') && design3.includes('C3〜C5') && design3.includes('2026-09-25「トップページの入口画面に関する法務の不変条件2つ」'))
check('DESIGN.md §5-1・§10: check-signals-undecidable.ts の行は :432（:428 は残っていない）', count(design, 'check-signals-undecidable.ts:432') === 2 && !design.includes('check-signals-undecidable.ts:428'))
const sigLines = read('scripts/check-signals-undecidable.ts').split('\n')
check('check-signals-undecidable.ts:432 は実際に globals.css の --axis / --rule-line の行（DESIGN.md の参照が正しい）', (sigLines[431] ?? '').includes("check('globals.css: --axis #8D9FB8 と --rule-line #C9D3E0 が :root にある'"), sigLines[431])

console.log('')
console.log(`PASS ${passed} 件 / FAIL ${failed} 件`)
if (failed) process.exit(1)
console.log('すべてPASS')
