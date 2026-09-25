// 投資家のルールブック（lib/investors/rulebooks/）の検査（2026-09-17 S1）。
//
//  - ルールID が固定の一覧（buffett.B1〜B8）と一致し、重複が無い（消す・改名すると赤）
//  - 画面に出る文字の字数: title ≤10／plain ≤30／portrait 各 ≤40／question ≤60 で全角「？」終わり
//  - 画面に出る項目に禁止語（forbidden.ts）・「私」・かぎかっこ「」・英語の引用符が無い
//  - データルールの metric が FundamentalsData のキーに実在し、単位が METRIC_UNIT と一致する（debtToEquity は yahooPct だけ）
//  - 各ルールに照合済みの出典が1つ以上／publishedRules が照合待ちだけのルールを返さない
//  - evaluate の境界値（ROE 0.15／D/E 50／FCF 0／NaN／業種の除外・不明）と、言葉のルールを返さないこと
//  - app/ と components/ は lib/investors/rulebooks を index（@/lib/investors/rulebooks）経由でだけ import する（S2 で画面が使う）
//  - データルールの指標名 metricLabel と数直線の scale（min < max・目安が範囲内・1冊で最大2つ）（2026-09-18）
//  - 情報（合否なし）: 業種（sector）が引けない銘柄の数。B4 がそれらで常に「判定できない」になる
//
// ネットワーク不要。検査に使う財務の値は境界値を試すための合成値で、製品コードには入れない（原則9の範囲内）。
//
// 実行: npx tsx scripts/check-rulebook.ts

import fs from 'fs'
import path from 'path'
import type { FundamentalsData } from '../types'
import buffett from '../lib/investors/rulebooks/buffett'
import { evaluate, evaluateRule, METRIC_UNIT } from '../lib/investors/rulebooks/evaluate'
import { getRulebook, publishedRules, dataRules, judgmentRules, RULEBOOK_INVESTOR_IDS } from '../lib/investors/rulebooks'
import { RULE_STATE_LABEL, UNDECIDABLE_REASON_LABEL } from '../lib/investors/rulebooks/types'
import type { DataRule, Rule, Rulebook, SourceRef } from '../lib/investors/rulebooks/types'
import { FORBIDDEN_IN_OUTPUT, NOT_ON_SCREEN, forbiddenWordsIn } from '../lib/investors/rulebooks/forbidden'
import { US_UNIVERSE } from '../lib/market/us-universe'
import { UNIVERSE as AI_UNIVERSE, UNIVERSE_JP as AI_UNIVERSE_JP } from '../lib/ai-trader/universe'

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
const len = (s: string) => Array.from(s).length

// ── 1. ルールID ──
console.log('■ ルールID（固定・重複なし）')
{
  const EXPECTED_IDS = ['buffett.B1', 'buffett.B2', 'buffett.B3', 'buffett.B4', 'buffett.B5', 'buffett.B6', 'buffett.B7', 'buffett.B8']
  const ids = buffett.rules.map(r => r.id)
  check('すべて ^buffett\\.B[1-8]$ の形', ids.every(id => /^buffett\.B[1-8]$/.test(id)), ids.join(','))
  check('重複なし', new Set(ids).size === ids.length, ids.join(','))
  check('固定の一覧 B1〜B8 と順序まで一致（消す・改名すると赤）', JSON.stringify(ids) === JSON.stringify(EXPECTED_IDS), ids.join(','))
  check('investorId は buffett', buffett.investorId === 'buffett')
  check('version は buffett@2026-09-18（見た目の作り直しで文言を変えた）', buffett.version === 'buffett@2026-09-18', buffett.version)
  check('getRulebook(buffett) が同じ本を返す', getRulebook('buffett') === buffett)
  check('ルールブックの無い投資家は undefined', getRulebook('soros') === undefined)
  check('RULEBOOK_INVESTOR_IDS は [buffett]', JSON.stringify(RULEBOOK_INVESTOR_IDS) === JSON.stringify(['buffett']))
  const kinds = buffett.rules.map(r => r.kind)
  check('データルールは B3・B4・B7 の3つ', JSON.stringify(dataRules(buffett.rules).map(r => r.id)) === JSON.stringify(['buffett.B3', 'buffett.B4', 'buffett.B7']), kinds.join(','))
  check('言葉のルールは B1・B2・B5・B6・B8 の5つ', JSON.stringify(judgmentRules(buffett.rules).map(r => r.id)) === JSON.stringify(['buffett.B1', 'buffett.B2', 'buffett.B5', 'buffett.B6', 'buffett.B8']))
  check('B8 だけが exit（降りる側）', buffett.rules.filter(r => r.phase === 'exit').map(r => r.id).join() === 'buffett.B8')
}

// ── 2. 字数 ──
console.log('■ 字数（画面に出る文字）')
{
  for (const r of buffett.rules) {
    check(`${r.id} title ≤10字「${r.title}」`, len(r.title) <= 10, `${len(r.title)}字`)
    check(`${r.id} plain ≤30字`, len(r.plain) <= 30, `${len(r.plain)}字: ${r.plain}`)
    check(`${r.id} question ≤60字`, len(r.question) <= 60, `${len(r.question)}字`)
    check(`${r.id} question は全角「？」で終わる`, r.question.endsWith('？'), r.question)
    check(`${r.id} belief がある（空でない）`, r.belief.trim().length > 0)
  }
  const p = buffett.portrait
  check('portrait.weighs ≤40字', len(p.weighs) <= 40, `${len(p.weighs)}字`)
  check('portrait.ignores ≤40字', len(p.ignores) <= 40, `${len(p.ignores)}字`)
  check('portrait.horizon ≤40字', len(p.horizon) <= 40, `${len(p.horizon)}字`)
  check('corePhilosophy が1つ以上', buffett.corePhilosophy.length >= 1)
  check('avoids が2つ', buffett.avoids.length === 2, String(buffett.avoids.length))
}

// ── 3. 禁止語・「私」・かぎかっこ・英語の引用 ──
console.log('■ 禁止語・「私」・かぎかっこ・英語の引用（画面に出る項目だけ。lookFor / tension は対象外）')
{
  // 画面に出る（出しうる）項目。lookFor / tension（AI 向けの内部データ）と unverifiedSayings（記録用）は含めない
  const screenTexts: { where: string; text: string }[] = []
  for (const r of buffett.rules) {
    screenTexts.push({ where: `${r.id}.title`, text: r.title })
    screenTexts.push({ where: `${r.id}.plain`, text: r.plain })
    screenTexts.push({ where: `${r.id}.belief`, text: r.belief })
    screenTexts.push({ where: `${r.id}.question`, text: r.question })
    if (r.kind === 'data') screenTexts.push({ where: `${r.id}.gapNote`, text: r.gapNote })
  }
  screenTexts.push({ where: 'portrait.weighs', text: buffett.portrait.weighs })
  screenTexts.push({ where: 'portrait.ignores', text: buffett.portrait.ignores })
  screenTexts.push({ where: 'portrait.horizon', text: buffett.portrait.horizon })
  buffett.corePhilosophy.forEach((t, i) => screenTexts.push({ where: `corePhilosophy[${i}]`, text: t }))
  buffett.avoids.forEach((a, i) => screenTexts.push({ where: `avoids[${i}].text`, text: a.text }))
  Object.entries(RULE_STATE_LABEL).forEach(([k, v]) => screenTexts.push({ where: `RULE_STATE_LABEL.${k}`, text: v }))
  Object.entries(UNDECIDABLE_REASON_LABEL).forEach(([k, v]) => screenTexts.push({ where: `UNDECIDABLE_REASON_LABEL.${k}`, text: v }))

  check(`検査対象の文字列が ${screenTexts.length} 件（8ルール×4〜5 ＋ portrait 3 ＋ 哲学 ＋ avoids 2 ＋ 状態の語 4 ＋ 理由の語 3）`, screenTexts.length === 8 * 4 + 3 + 3 + buffett.corePhilosophy.length + 2 + 4 + 3, String(screenTexts.length))
  check('UNDECIDABLE_REASON_LABEL は3つ（no-data / excluded-sector / unknown-sector）',
    JSON.stringify(Object.keys(UNDECIDABLE_REASON_LABEL).sort()) === JSON.stringify(['excluded-sector', 'no-data', 'unknown-sector'])
    && UNDECIDABLE_REASON_LABEL['no-data'] === 'データが取れないため' && UNDECIDABLE_REASON_LABEL['excluded-sector'] === '金融業は借入が事業の一部のため' && UNDECIDABLE_REASON_LABEL['unknown-sector'] === '業種が分からないため')
  for (const { where, text } of screenTexts) {
    const hits = forbiddenWordsIn(text)
    check(`${where}: 禁止語なし`, hits.length === 0, `${hits.join('/')} in「${text}」`)
    check(`${where}: 「私」なし`, !text.includes('私'), text)
    check(`${where}: かぎかっこ「」『』なし`, !/[「」『』]/.test(text), text)
    check(`${where}: 英語の引用符 " “ ” なし`, !/["“”]/.test(text), text)
  }
  // 一次資料で見つからない言葉が画面の項目に紛れていない
  for (const saying of buffett.unverifiedSayings) {
    const key = saying.slice(0, 6)
    check(`unverifiedSayings「${key}…」が画面の項目に出ていない`, !screenTexts.some(t => t.text.includes(key)))
  }
  check('unverifiedSayings に2つ記録されている（ルール1: 損をするな／分散は無知）',
    buffett.unverifiedSayings.length === 2 && buffett.unverifiedSayings.some(s => s.includes('損をするな')) && buffett.unverifiedSayings.some(s => s.includes('分散')))

  // forbidden.ts 自体
  check('FORBIDDEN_IN_OUTPUT は14語', FORBIDDEN_IN_OUTPUT.length === 14, String(FORBIDDEN_IN_OUTPUT.length))
  check('NOT_ON_SCREEN は6語', NOT_ON_SCREEN.length === 6, String(NOT_ON_SCREEN.length))
  check('2つの一覧に重複が無い', new Set([...FORBIDDEN_IN_OUTPUT, ...NOT_ON_SCREEN]).size === FORBIDDEN_IN_OUTPUT.length + NOT_ON_SCREEN.length)
  check('forbiddenWordsIn は含まれる語を全部返す', JSON.stringify(forbiddenWordsIn('この株は必ず上がるのでおすすめです')) === JSON.stringify(['おすすめ', '必ず', '上がる']))
  check('forbiddenWordsIn は無ければ空', forbiddenWordsIn('事業を理解できるか').length === 0)
  check('forbiddenWordsIn は一覧を指定できる（画面用の語だけ）', JSON.stringify(forbiddenWordsIn('診断のおすすめ', NOT_ON_SCREEN)) === JSON.stringify(['診断']))
  check('「私は」「私なら」が禁止語に入っている', FORBIDDEN_IN_OUTPUT.includes('私は') && FORBIDDEN_IN_OUTPUT.includes('私なら'))
}

// ── 4. metric の実在・単位 ──
console.log('■ データルールの metric・単位')
{
  // types/index.ts の FundamentalsData のキーを実行時に読む（型では keyof で担保。実行時も突き合わせる）
  const src = fs.readFileSync(path.join(ROOT, 'types/index.ts'), 'utf8')
  const block = /export interface FundamentalsData \{([\s\S]*?)\n\}/.exec(src)?.[1] ?? ''
  const keys = new Set(
    block.split('\n')
      .map(l => /^\s*([A-Za-z_]\w*)\??:/.exec(l)?.[1])
      .filter((k): k is string => Boolean(k)),
  )
  check('types/index.ts から FundamentalsData のキーが読めた（roe / debtToEquity / freeCashflow を含む）',
    keys.has('roe') && keys.has('debtToEquity') && keys.has('freeCashflow'), [...keys].join(','))
  check('METRIC_UNIT のキーが FundamentalsData のキーに全部ある', Object.keys(METRIC_UNIT).every(k => keys.has(k)),
    Object.keys(METRIC_UNIT).filter(k => !keys.has(k)).join(','))
  check('FundamentalsData の全キーに METRIC_UNIT がある（項目を足したらここも足す）', [...keys].every(k => k in METRIC_UNIT),
    [...keys].filter(k => !(k in METRIC_UNIT)).join(','))
  check('METRIC_UNIT.debtToEquity は yahooPct', METRIC_UNIT.debtToEquity === 'yahooPct')
  check('METRIC_UNIT.freeCashflow は amount（通貨の実額）', METRIC_UNIT.freeCashflow === 'amount')
  check('METRIC_UNIT.roe は ratio', METRIC_UNIT.roe === 'ratio')

  for (const r of dataRules(buffett.rules)) {
    check(`${r.id}: checks が1つ以上`, r.checks.length >= 1)
    for (const c of r.checks) {
      check(`${r.id}: metric '${c.metric}' が FundamentalsData に実在`, keys.has(c.metric))
      check(`${r.id}: unit '${c.unit}' が METRIC_UNIT['${c.metric}'] と一致`, METRIC_UNIT[c.metric] === c.unit, `expected ${METRIC_UNIT[c.metric]}`)
      if (c.metric === 'debtToEquity') check(`${r.id}: debtToEquity は yahooPct だけ`, c.unit === 'yahooPct', c.unit)
      check(`${r.id}: value が有限の数`, Number.isFinite(c.value))
    }
    check(`${r.id}: thresholdOrigin は approximation（原文に数値は無い）`, r.thresholdOrigin === 'approximation')
    check(`${r.id}: metricLabel がある（1〜6字。例 ROE／D/E／FCF）`, typeof r.metricLabel === 'string' && r.metricLabel.length >= 1 && r.metricLabel.length <= 6, r.metricLabel)
    if (r.scale) {
      check(`${r.id}: scale.min < scale.max`, r.scale.min < r.scale.max, JSON.stringify(r.scale))
      check(`${r.id}: 目安（checks の value）が scale の範囲内`, r.checks.every(c => c.value >= r.scale!.min && c.value <= r.scale!.max), JSON.stringify({ scale: r.scale, checks: r.checks.map(c => c.value) }))
      check(`${r.id}: 目安の1つ以上が軸の内側（両端と一致しない。数直線にティックが描ける）`, r.checks.some(c => c.value > r.scale!.min && c.value < r.scale!.max))
    }
    check(`${r.id}: gapNote がある`, r.gapNote.trim().length > 0)
  }
  check('数直線は1画面に最大2本（scale を持つデータルールが2つ以下）', dataRules(buffett.rules).filter(r => r.scale).length <= 2)
  check('scale を持つのは B3（ROE 0〜0.40）と B4（D/E 0〜150 yahooPct）', JSON.stringify(dataRules(buffett.rules).filter(r => r.scale).map(r => [r.id, r.scale])) === JSON.stringify([['buffett.B3', { min: 0, max: 0.4 }], ['buffett.B4', { min: 0, max: 150 }]]))
  check('B7（FCF）は scale を持たない（プラス／マイナスに軸は無い）', (buffett.rules.find(r => r.id === 'buffett.B7') as DataRule).scale === undefined)
  check('metricLabel は ROE／D/E／FCF', JSON.stringify(dataRules(buffett.rules).map(r => r.metricLabel)) === JSON.stringify(['ROE', 'D/E', 'FCF']))
  check('データルールの title は名詞（元手で稼ぐ力／借金の重さ／手元に残る金）', JSON.stringify(dataRules(buffett.rules).map(r => r.title)) === JSON.stringify(['元手で稼ぐ力', '借金の重さ', '手元に残る金']))
  const b4 = buffett.rules.find(r => r.id === 'buffett.B4') as DataRule
  check('B4 の excludeSectors に Financials（us-universe.ts）・Finance（data/universe.json）・Financial Services（Yahoo）の3つ',
    JSON.stringify([...(b4.excludeSectors ?? [])].sort()) === JSON.stringify(['Finance', 'Financial Services', 'Financials']), JSON.stringify(b4.excludeSectors))
  check('B4 の目安に D/E 0 以上がある（自己資本がマイナスの会社を「満たす」にしない: reviewer W1）',
    b4.checks.some(c => c.metric === 'debtToEquity' && c.op === 'gte' && c.value === 0 && c.unit === 'yahooPct'))
  check('B4 の目安に D/E 50 以下がある（yahooPct）', b4.checks.some(c => c.metric === 'debtToEquity' && c.op === 'lte' && c.value === 50 && c.unit === 'yahooPct'))
  check('B4 は下限と上限の2つで combine all', b4.checks.length === 2 && b4.combine === 'all')
  check('B4 の gapNote に自己資本マイナスと REIT の注記', b4.gapNote.includes('自己資本がマイナス') && b4.gapNote.includes('REIT'))
  const b3 = buffett.rules.find(r => r.id === 'buffett.B3') as DataRule
  check('B3 の目安は ROE ≥ 0.15（ratio）', b3.checks[0].metric === 'roe' && b3.checks[0].op === 'gte' && b3.checks[0].value === 0.15 && b3.checks[0].unit === 'ratio')
  const b7 = buffett.rules.find(r => r.id === 'buffett.B7') as DataRule
  check('B7 の目安は FCF > 0（amount）', b7.checks[0].metric === 'freeCashflow' && b7.checks[0].op === 'gt' && b7.checks[0].value === 0 && b7.checks[0].unit === 'amount')
  // D/E の /100 が evaluate.ts 以外の rulebooks 配下のコードに無い（注釈は除く。「/100 しない」と書いてある注釈を誤検知しないため）。
  // 文字列リテラルの中の // （URL の https:// など）を注釈と取り違えないよう、文字列を読み飛ばしながら注釈だけ落とす（reviewer S-3）
  const stripComments = (code: string): string => {
    let out = ''
    let i = 0
    while (i < code.length) {
      const c = code[i]
      const n = code[i + 1]
      if (c === '"' || c === "'" || c === '`') {
        out += c; i++
        while (i < code.length && code[i] !== c) {
          if (code[i] === '\\') { out += code[i]; i++ }
          out += code[i] ?? ''; i++
        }
        out += code[i] ?? ''; i++
        continue
      }
      if (c === '/' && n === '/') { while (i < code.length && code[i] !== '\n') i++; continue }
      if (c === '/' && n === '*') { i += 2; while (i < code.length && !(code[i] === '*' && code[i + 1] === '/')) i++; i += 2; continue }
      out += c; i++
    }
    return out
  }
  check('stripComments: 文字列の中の // は残し、行末の注釈は落とす',
    stripComments("const u = 'https://x/100' // /100 の注釈").includes('https://x/100') && !stripComments("const u = 'https://x' // /100").includes('注釈') && !/\/\s*100/.test(stripComments("const a = 1 // / 100")))
  check('stripComments: /* */ の中も落とす', !stripComments('const a = 1 /* / 100 */').includes('100'))
  const dir = path.join(ROOT, 'lib/investors/rulebooks')
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.ts') && f !== 'evaluate.ts')) {
    const code = stripComments(fs.readFileSync(path.join(dir, f), 'utf8'))
    check(`rulebooks/${f}: D/E の換算（/ 100）をコードに書いていない`, !/\/\s*100\b/.test(code))
  }
  check('evaluate.ts には換算（yahooPctToRatio の / 100）が1か所だけある',
    (stripComments(fs.readFileSync(path.join(dir, 'evaluate.ts'), 'utf8')).match(/\/\s*100\b/g) ?? []).length === 1)
}

// ── 5. 出典 ──
console.log('■ 出典・publishedRules')
{
  const allSources: { where: string; s: SourceRef }[] = []
  for (const r of buffett.rules) r.sources.forEach((s, i) => allSources.push({ where: `${r.id}.sources[${i}]`, s }))
  buffett.avoids.forEach((a, i) => a.sources.forEach((s, j) => allSources.push({ where: `avoids[${i}].sources[${j}]`, s })))
  for (const r of buffett.rules) {
    check(`${r.id}: 照合済みの出典が1つ以上`, r.sources.some(s => s.status === '照合済み'), JSON.stringify(r.sources.map(s => s.status)))
  }
  for (const a of buffett.avoids) {
    check(`avoids「${a.text}」: 照合済みの出典が1つ以上`, a.sources.some(s => s.status === '照合済み'))
  }
  for (const { where, s } of allSources) {
    check(`${where}: url がバークシャー公式`, typeof s.url === 'string' && s.url.startsWith('https://www.berkshirehathaway.com/'), s.url)
    check(`${where}: 位置（locator）がある`, typeof s.locator === 'string' && s.locator.length > 0)
    check(`${where}: 年が妥当（1977〜2025）`, Number.isInteger(s.year) && s.year >= 1977 && s.year <= 2025, String(s.year))
    check(`${where}: 英語原文の抜粋（引用符）が無い`, !/["“”]/.test(`${s.title} ${s.locator ?? ''} ${s.note ?? ''}`))
    // title は letter() が year から作るので「title が year で始まる」は常に真（reviewer W2）。url のファイル名で突き合わせる
    if (s.url?.includes('/letters/')) {
      const file = s.url.split('/letters/')[1] ?? ''
      check(`${where}: 手紙の url のファイル名が対象年度 ${s.year} で始まる`, file.startsWith(String(s.year)), s.url)
    }
  }
  const b6 = buffett.rules.find(r => r.id === 'buffett.B6') as Rule
  check('B6 は1996年の手紙を出典にしない（Mr. Market が無い）', !b6.sources.some(s => s.year === 1996))
  check('B6 の出典は 1987・2008・2014', JSON.stringify(b6.sources.map(s => s.year)) === JSON.stringify([1987, 2008, 2014]))
  const b3 = buffett.rules.find(r => r.id === 'buffett.B3') as Rule
  check('B3 は 1979 と 2014（買収基準）を併記', JSON.stringify(b3.sources.map(s => s.year)) === JSON.stringify([1979, 2014]))
  const b4 = buffett.rules.find(r => r.id === 'buffett.B4') as Rule
  check('B4 の出典は Owner\'s Manual で、主語がバークシャー自身だと注記', b4.sources[0].url?.endsWith('/ownman.pdf') === true && (b4.sources[0].note ?? '').includes('バークシャー自身'))
  const b5 = buffett.rules.find(r => r.id === 'buffett.B5') as Rule
  check('B5 の 2008 はグレアムの言葉の引用だと注記', b5.sources.some(s => s.year === 2008 && (s.note ?? '').includes('グレアム')))

  // publishedRules
  check('publishedRules(buffett) は8つ全部（すべて照合済み）', publishedRules(buffett).length === 8, String(publishedRules(buffett).length))
  const pendingRule: Rule = {
    ...(buffett.rules[0] as Rule),
    id: 'buffett.B1',
    sources: [{ title: '検査用', year: 2000, status: '照合待ち' }],
  }
  const mixedRule: Rule = {
    ...(buffett.rules[1] as Rule),
    sources: [{ title: '検査用', year: 2000, status: '照合待ち' }, { title: '検査用', year: 2001, status: '照合済み' }],
  }
  const noneRule: Rule = {
    ...(buffett.rules[2] as Rule),
    sources: [{ title: '検査用', year: 2000, status: '確証なし' }],
  }
  const copy: Rulebook = { ...buffett, rules: [pendingRule, mixedRule, noneRule, ...buffett.rules.slice(3)] }
  const pub = publishedRules(copy).map(r => r.id)
  check('照合待ちだけのルールは publishedRules に入らない', !pub.includes('buffett.B1'), pub.join(','))
  check('確証なしだけのルールは publishedRules に入らない', !pub.includes('buffett.B3'), pub.join(','))
  check('照合待ちと照合済みが混ざるルールは入る', pub.includes('buffett.B2'), pub.join(','))
  check('残り5つはそのまま入る（合計6）', pub.length === 6, pub.join(','))
  check('元の本は書き換わっていない', publishedRules(buffett).length === 8)
}

// ── 6. evaluate の境界値 ──
console.log('■ evaluate の境界値（合成値。製品コードには入れない）')
{
  const b3 = buffett.rules.find(r => r.id === 'buffett.B3') as DataRule
  const b4 = buffett.rules.find(r => r.id === 'buffett.B4') as DataRule
  const b7 = buffett.rules.find(r => r.id === 'buffett.B7') as DataRule
  const TECH = { sector: 'Technology' }

  console.log('  ROE（B3）')
  check('ROE 0.15 → meets', evaluateRule(b3, { roe: 0.15 }).state === 'meets')
  check('ROE 0.1499 → misses', evaluateRule(b3, { roe: 0.1499 }).state === 'misses')
  check('ROE undefined → undecidable(no-data)', JSON.stringify(evaluateRule(b3, {})) === JSON.stringify({ ruleId: 'buffett.B3', state: 'undecidable', reason: 'no-data' }))
  check('ROE null（JSON 経由）→ undecidable(no-data)', evaluateRule(b3, { roe: null as unknown as number }).reason === 'no-data')
  check('ROE NaN → undecidable(no-data)', evaluateRule(b3, { roe: NaN }).reason === 'no-data')
  check('ROE Infinity → undecidable(no-data)', evaluateRule(b3, { roe: Infinity }).reason === 'no-data')
  check('観測値が返る（metric / value / unit）', JSON.stringify(evaluateRule(b3, { roe: 0.2 }).observed) === JSON.stringify({ metric: 'roe', value: 0.2, unit: 'ratio' }))
  check('B3 は業種に関係なく判定する（sector 無しでも meets）', evaluateRule(b3, { roe: 0.2 }).state === 'meets')

  console.log('  D/E（B4・yahooPct・業種の除外）')
  check('D/E 50（Technology）→ meets', evaluateRule(b4, { debtToEquity: 50 }, TECH).state === 'meets')
  check('D/E 50.1（Technology）→ misses', evaluateRule(b4, { debtToEquity: 50.1 }, TECH).state === 'misses')
  check('D/E 0（Technology）→ meets（0 は有効な値）', evaluateRule(b4, { debtToEquity: 0 }, TECH).state === 'meets')
  check('D/E −120（自己資本がマイナス。MCD など）→ misses（上限だけなら「満たす」に見えた: reviewer W1）', evaluateRule(b4, { debtToEquity: -120 }, TECH).state === 'misses')
  check('D/E −0.1 → misses', evaluateRule(b4, { debtToEquity: -0.1 }, TECH).state === 'misses')
  check('D/E −120 の observed は原値のまま', JSON.stringify(evaluateRule(b4, { debtToEquity: -120 }, TECH).observed) === JSON.stringify({ metric: 'debtToEquity', value: -120, unit: 'yahooPct' }))
  check('sector Financial Services（Yahoo の綴り）→ undecidable(excluded-sector)', evaluateRule(b4, { debtToEquity: 10 }, { sector: 'Financial Services' }).reason === 'excluded-sector')
  check('D/E 78.4 の observed は Yahoo 原値のまま（unit yahooPct。換算しない）', JSON.stringify(evaluateRule(b4, { debtToEquity: 78.4 }, TECH).observed) === JSON.stringify({ metric: 'debtToEquity', value: 78.4, unit: 'yahooPct' }))
  check('D/E undefined（Technology）→ undecidable(no-data)', evaluateRule(b4, {}, TECH).reason === 'no-data')
  check('sector Financials → undecidable(excluded-sector)', JSON.stringify(evaluateRule(b4, { debtToEquity: 10 }, { sector: 'Financials' })) === JSON.stringify({ ruleId: 'buffett.B4', state: 'undecidable', reason: 'excluded-sector' }))
  check('sector Finance（universe.json の綴り）→ undecidable(excluded-sector)', evaluateRule(b4, { debtToEquity: 10 }, { sector: 'Finance' }).reason === 'excluded-sector')
  check('sector の大文字小文字・前後の空白は無視（" financials "）', evaluateRule(b4, { debtToEquity: 10 }, { sector: ' financials ' }).reason === 'excluded-sector')
  check('sector undefined → undecidable(unknown-sector)', JSON.stringify(evaluateRule(b4, { debtToEquity: 10 })) === JSON.stringify({ ruleId: 'buffett.B4', state: 'undecidable', reason: 'unknown-sector' }))
  check('sector 空文字 → undecidable(unknown-sector)', evaluateRule(b4, { debtToEquity: 10 }, { sector: '' }).reason === 'unknown-sector')
  check('業種の除外は値の有無より先（Financials で D/E 無し → excluded-sector）', evaluateRule(b4, {}, { sector: 'Financials' }).reason === 'excluded-sector')
  check('Real Estate は除外しない（判定する）', evaluateRule(b4, { debtToEquity: 120 }, { sector: 'Real Estate' }).state === 'misses')

  console.log('  FCF（B7）')
  check('FCF 0 → misses（gt）', evaluateRule(b7, { freeCashflow: 0 }).state === 'misses')
  check('FCF 1 → meets', evaluateRule(b7, { freeCashflow: 1 }).state === 'meets')
  check('FCF -1 → misses', evaluateRule(b7, { freeCashflow: -1 }).state === 'misses')
  check('FCF undefined → undecidable(no-data)', evaluateRule(b7, {}).reason === 'no-data')
  check('FCF NaN → undecidable(no-data)', evaluateRule(b7, { freeCashflow: NaN }).reason === 'no-data')

  console.log('  evaluate（本ごと）')
  const full: FundamentalsData = { roe: 0.3, debtToEquity: 20, freeCashflow: 1000 }
  const checks = evaluate(buffett, full, TECH)
  check('データルールの3件だけを rules の順で返す（B3・B4・B7）', JSON.stringify(checks.map(c => c.ruleId)) === JSON.stringify(['buffett.B3', 'buffett.B4', 'buffett.B7']), JSON.stringify(checks))
  check('言葉のルール（B1 等）は返さない', !checks.some(c => c.ruleId === 'buffett.B1'))
  check('3件とも meets', checks.every(c => c.state === 'meets'), JSON.stringify(checks))
  check('read 状態はデータの判定からは出ない', !checks.some(c => c.state === 'read'))
  const empty = evaluate(buffett, {}, TECH)
  check('財務が空 {} → 3件とも undecidable(no-data)', empty.length === 3 && empty.every(c => c.state === 'undecidable' && c.reason === 'no-data'), JSON.stringify(empty))
  const noSector = evaluate(buffett, full)
  check('sector 無し → B4 だけ unknown-sector、B3・B7 は判定する', noSector.find(c => c.ruleId === 'buffett.B4')?.reason === 'unknown-sector' && noSector.filter(c => c.ruleId !== 'buffett.B4').every(c => c.state === 'meets'), JSON.stringify(noSector))
  const bank = evaluate(buffett, full, { sector: 'Finance' })
  check('金融業 → B4 だけ excluded-sector', bank.find(c => c.ruleId === 'buffett.B4')?.reason === 'excluded-sector' && bank.filter(c => c.ruleId !== 'buffett.B4').every(c => c.state === 'meets'))
  check('入力の財務データを書き換えない', JSON.stringify(full) === JSON.stringify({ roe: 0.3, debtToEquity: 20, freeCashflow: 1000 }))

  console.log('  combine（合成ルール）')
  const two: DataRule = {
    ...b3,
    id: 'buffett.B3',
    checks: [{ metric: 'roe', op: 'gte', value: 0.15, unit: 'ratio' }, { metric: 'operatingMargin', op: 'gte', value: 0.1, unit: 'ratio' }],
  }
  check('all: 両方満たす → meets', evaluateRule({ ...two, combine: 'all' }, { roe: 0.2, operatingMargin: 0.2 }).state === 'meets')
  check('all: 片方外れ → misses', evaluateRule({ ...two, combine: 'all' }, { roe: 0.2, operatingMargin: 0.05 }).state === 'misses')
  check('any: 片方外れ → meets', evaluateRule({ ...two, combine: 'any' }, { roe: 0.2, operatingMargin: 0.05 }).state === 'meets')
  check('any: 両方外れ → misses', evaluateRule({ ...two, combine: 'any' }, { roe: 0.1, operatingMargin: 0.05 }).state === 'misses')
  check('all: 1つでも値が欠けたら undecidable（もう片方が外れていても）', evaluateRule({ ...two, combine: 'all' }, { roe: 0.1 }).reason === 'no-data')
  check('any: 1つでも値が欠けたら undecidable（もう片方が満たしていても）', evaluateRule({ ...two, combine: 'any' }, { roe: 0.2 }).reason === 'no-data')
  check('observed は最初の check の値', evaluateRule({ ...two, combine: 'all' }, { roe: 0.2, operatingMargin: 0.2 }).observed?.metric === 'roe')

  console.log('  状態の語')
  check('RULE_STATE_LABEL は4つ', Object.keys(RULE_STATE_LABEL).length === 4)
  check('語は 目安を満たす／目安を満たさない／文章で読んだ／判定できない',
    RULE_STATE_LABEL.meets === '目安を満たす' && RULE_STATE_LABEL.misses === '目安を満たさない' && RULE_STATE_LABEL.read === '文章で読んだ' && RULE_STATE_LABEL.undecidable === '判定できない')
  check('状態の語に 合格／採点／点 が無い', !Object.values(RULE_STATE_LABEL).some(v => /合格|採点|点/.test(v)))
}

// ── 7. 画面が import していない ──
console.log('■ 画面・API は rulebooks を index（@/lib/investors/rulebooks）経由でだけ使う')
{
  function walk(dir: string, out: string[] = []): string[] {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p, out)
      else if (/\.(ts|tsx|mts|js|mjs)$/.test(e.name)) out.push(p)
    }
    return out
  }
  // S2 から画面と API が rulebooks を使う。入口は index だけ: 相対パス（'../lib/investors/rulebooks'）や中のファイル直指定
  // （'@/lib/investors/rulebooks/buffett'）は禁止（reviewer S-3。S1 の「参照が無い」検査を S2 に合わせて更新）
  // 2026-09-25 S1c: 禁止語の一覧（forbidden.ts）だけは index を通さず直接 import してよい2つ目の入口にする。
  // 理由: index は buffett のルールブック本体を import しており、トップページ（最も人が来る・client component）から
  // index を読むとルールブックがそのまま入口の JS に入る。forbidden.ts は「画面の文言と AI の出力の禁止語はここ1か所が正」
  // （DECISIONS 2026-09-17）の横断的な部品であって、ルールブックそのものではない。ルールブック（buffett 等）の直指定は引き続き禁止
  const INDEX = '@/lib/investors/rulebooks'
  const FORBIDDEN = '@/lib/investors/rulebooks/forbidden'
  const files = [...walk(path.join(ROOT, 'app')), ...walk(path.join(ROOT, 'components'))]
  const offenders: string[] = []
  const users: string[] = []
  const forbiddenUsers: string[] = []
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8')
    const specs = [...src.matchAll(/(?:from\s*|import\s*\(\s*)['"]([^'"]*investors\/rulebooks[^'"]*)['"]/g)].map(m => m[1])
    const rel = path.relative(ROOT, f).replace(/\\/g, '/')
    if (specs.includes(INDEX)) users.push(rel)
    if (specs.includes(FORBIDDEN)) forbiddenUsers.push(rel)
    if (specs.some(s => s !== INDEX && s !== FORBIDDEN)) offenders.push(`${rel}: ${specs.join(',')}`)
  }
  check(`app/ と components/ の ${files.length} ファイルは rulebooks を '@/lib/investors/rulebooks'（index）か '…/rulebooks/forbidden'（禁止語）経由でだけ import する（相対パス・ルールブック本体の直指定は無い）`, offenders.length === 0, offenders.join(' | '))
  // InvestorPanel は MasterSignals の useRulebookSignals / RULEBOOKS を使うので rulebooks を直接 import しない
  // 2026-09-25 S1c 修正パス: トップの見本の選び方は lib/entry/samples.ts（純関数）へ切り出し、page.tsx は
  // そこを import する。app/・components/ から forbidden.ts を直接使うファイルは無くなった（samples.ts は lib/ なので走査外）
  check('index を使うのは signals の route・MasterSignals・RuleCheckList・InvestorLens・QuestionRail・RulebookView の6ファイル（InvestorPanel は MasterSignals 経由・NumberLine は純描画）。forbidden.ts を直接使う app/・components/ のファイルは無い（トップの選び方は lib/entry/samples.ts 経由）',
    JSON.stringify(users.sort()) === JSON.stringify([
      'app/api/signals/[symbol]/route.ts', 'components/MasterSignals.tsx',
      'components/investors/InvestorLens.tsx', 'components/investors/QuestionRail.tsx',
      'components/investors/RuleCheckList.tsx', 'components/investors/RulebookView.tsx',
    ]) && JSON.stringify(forbiddenUsers.sort()) === JSON.stringify([]), `index=${users.join(',')} forbidden=${forbiddenUsers.join(',')}`)
  // rulebooks 自身も server-only や DB・ネットワーク・AI を持ち込まない（純関数と定数だけ）
  const dir = path.join(ROOT, 'lib/investors/rulebooks')
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.ts'))) {
    const code = fs.readFileSync(path.join(dir, f), 'utf8')
    const bad = /from '(server-only|@anthropic-ai\/sdk|@supabase\/[^']*|@\/lib\/(market|supabase|ai-trader)[^']*|yahoo-finance2)'/.exec(code)?.[1]
    check(`rulebooks/${f}: server-only・AI・DB・市場データを import しない`, bad == null, bad)
    check(`rulebooks/${f}: Math.random / fetch を使わない`, !/Math\.random|\bfetch\(/.test(code))
  }
}

// ── 8. 情報（合否なし）: 業種が引けない銘柄の数 ──
console.log('■ 情報: 業種（sector）が引けない銘柄の数（B4 はそれらで常に「判定できない」になる。S2 の設計用）')
{
  type UniverseFile = { count: number; stocks: { symbol: string; sector?: string }[] }
  const file = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/universe.json'), 'utf8')) as UniverseFile
  const bySymbol = new Map(file.stocks.map(s => [s.symbol, s.sector]))
  const usBySymbol = new Map(US_UNIVERSE.map(s => [s.symbol, s.sector]))
  const noSectorJson = file.stocks.filter(s => !s.sector)
  const jpInJson = file.stocks.filter(s => s.symbol.endsWith('.T'))
  console.log(`  data/universe.json: ${file.stocks.length} 銘柄中、sector 無し ${noSectorJson.length}（例: ${noSectorJson.slice(0, 5).map(s => s.symbol).join(', ')}）／日本株(.T) ${jpInJson.length}`)
  console.log(`  data/universe.json の sector の綴り: ${[...new Set(file.stocks.map(s => s.sector).filter(Boolean))].sort().join(' / ')}`)
  const noSectorUs = US_UNIVERSE.filter(s => !s.sector)
  console.log(`  lib/market/us-universe.ts: ${US_UNIVERSE.length} 銘柄中、sector 無し ${noSectorUs.length}`)
  const resolve = (sym: string) => usBySymbol.get(sym) ?? bySymbol.get(sym)
  const aiUnresolved = AI_UNIVERSE.filter(sym => !resolve(sym))
  console.log(`  lib/ai-trader/universe.ts（/watch の監視 ${AI_UNIVERSE.length} 銘柄）: 両方の一覧で sector が引けない ${aiUnresolved.length}（${aiUnresolved.join(', ')}）`)
  console.log(`    うち日本株(.T) ${AI_UNIVERSE_JP.length}（全部引けない。日本株の一覧に sector が無く、universe.json にも入っていない）`)
  console.log(`    米国株で引けない ${aiUnresolved.filter(s => !s.endsWith('.T')).length}（${aiUnresolved.filter(s => !s.endsWith('.T')).join(', ') || 'なし'}）`)
}

console.log('')
console.log(`PASS ${passed} 件 / FAIL ${failed} 件`)
if (failed) process.exit(1)
console.log('すべてPASS')
