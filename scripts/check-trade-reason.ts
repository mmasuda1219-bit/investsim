// 「やる」の理由入力スモーク: 問いへの分解（lib/trade/reason.ts）を検証する。
// - 必須項目が埋まるまで ok にならない／任意項目は空でも通る
// - 組み立てたテキストが API の下限（MIN_REASON）を必ず超える
// - 旧形式（見出しの無い自由記述）を «欠けている» ように見せない
// - 往復（compose → parse）で書いた内容が失われない
// - 買いと売りで問いが違う
//
// 実行: npx tsx scripts/check-trade-reason.ts

import {
  composeReason,
  validateParts,
  parseReason,
  isStructured,
  fieldsFor,
  MIN_THESIS,
  MIN_EXIT,
} from '../lib/trade/reason'
import { MIN_REASON } from '../lib/portfolio'

let failures = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) console.log(`  PASS ${name}`)
  else { failures++; console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`) }
}

const THESIS = '直近の決算で売上が前年比+22%。下げは市場全体に連れられたものと見ている。'
const EXIT = '成長率が15%を割ったら売る'

console.log('問いの定義')
{
  const buy = fieldsFor('buy')
  const sell = fieldsFor('sell')
  check('買いは3問', buy.length === 3, `actual=${buy.length}`)
  check('売りは2問', sell.length === 2, `actual=${sell.length}`)
  check('買いの必須は2問（見立て・降りる条件）', buy.filter(f => f.required).length === 2)
  check('売りの必須は1問', sell.filter(f => f.required).length === 1)
  check('買いと売りで見出しが違う', buy[0].label !== sell[0].label, `${buy[0].label} / ${sell[0].label}`)
  check('主文の下限がAPIの下限と一致', MIN_THESIS === MIN_REASON, `${MIN_THESIS} vs ${MIN_REASON}`)
}

console.log('検証（validateParts）')
{
  check('空は不合格', !validateParts('buy', {}).ok)
  check('見立てだけでは不合格（降りる条件が必須）',
    !validateParts('buy', { thesis: THESIS }).ok)
  check('降りる条件だけでは不合格',
    !validateParts('buy', { exit: EXIT }).ok)
  check('必須2つが埋まれば合格（任意は空のまま）',
    validateParts('buy', { thesis: THESIS, exit: EXIT }).ok)

  const short = validateParts('buy', { thesis: 'あ'.repeat(MIN_THESIS - 1), exit: EXIT })
  check('主文が1文字足りなければ不合格', !short.ok)
  check('足りない項目だけがエラーになる',
    !!short.byKey.thesis && !short.byKey.exit, JSON.stringify(short.byKey))

  const exitShort = validateParts('buy', { thesis: THESIS, exit: 'あ'.repeat(MIN_EXIT - 1) })
  check('降りる条件の下限も効く', !exitShort.ok && !!exitShort.byKey.exit)

  check('売りは主文だけで合格', validateParts('sell', { thesis: THESIS }).ok)
  check('売りは主文が無ければ不合格', !validateParts('sell', { changed: '競合が強かった' }).ok)
}

console.log('組み立て（composeReason）')
{
  const text = composeReason('buy', { thesis: THESIS, exit: EXIT })
  check('見出しが付く', text.startsWith('【見立て】'), text.slice(0, 12))
  check('空の任意項目は行ごと落ちる', !text.includes('【注目】'), text)
  check('必須2つが両方入る', text.includes(THESIS) && text.includes(EXIT))
  check('APIの下限を必ず超える', text.trim().length >= MIN_REASON, `len=${text.trim().length}`)

  const full = composeReason('buy', { thesis: THESIS, catalyst: '次の決算', exit: EXIT })
  check('任意を書けば3行になる', full.split('\n').length === 3, JSON.stringify(full))

  // 空白だけの入力は «書いた» ことにしない
  const blank = composeReason('buy', { thesis: THESIS, catalyst: '   ', exit: EXIT })
  check('空白だけの任意項目は落ちる', !blank.includes('【注目】'))
}

console.log('読み戻し（parseReason）')
{
  const text = composeReason('buy', { thesis: THESIS, catalyst: '次の決算', exit: EXIT })
  const s = parseReason(text)
  check('3区画に分かれる', s.length === 3, `actual=${s.length}`)
  check('見出しが順に取れる',
    s[0].label === '見立て' && s[1].label === '注目' && s[2].label === '降りる条件',
    JSON.stringify(s.map(x => x.label)))
  check('往復で本文が失われない', s[0].value === THESIS && s[2].value === EXIT)
  check('構造化されていると判定できる', isStructured(text))
}

console.log('旧形式（見出しの無い自由記述）')
{
  const legacy = '決算が良く、下げたところを拾う'
  const s = parseReason(legacy)
  check('1区画で返る', s.length === 1, `actual=${s.length}`)
  check('見出しは null', s[0].label === null)
  check('全文がそのまま残る', s[0].value === legacy)
  check('構造化されていないと判定できる', !isStructured(legacy))

  // 複数行の旧形式も1区画にまとめる（途中で切って «欠けたように» 見せない）
  const multi = '決算が良い\nしかも下げている\n拾いたい'
  const m = parseReason(multi)
  check('複数行の旧形式も1区画', m.length === 1 && m[0].value === multi, JSON.stringify(m))

  check('空文字は0区画', parseReason('').length === 0)
}

console.log('利用者が改行を入れた場合')
{
  const text = '【見立て】決算が良い\n売上も伸びている\n【降りる条件】-20%で売る'
  const s = parseReason(text)
  check('続き行は直前の区画にぶら下がる', s.length === 2, `actual=${s.length}`)
  check('続き行の本文が保持される',
    s[0].value === '決算が良い\n売上も伸びている', JSON.stringify(s[0].value))
  check('次の見出しは新しい区画', s[1].label === '降りる条件' && s[1].value === '-20%で売る')
}

console.log('見出しに似た文字を本文に書いた場合')
{
  // 既知でない見出しは «見出しとして扱わない»（利用者の文章を勝手に構造化しない）
  const text = '【メモ】これは自由記述のつもり'
  const s = parseReason(text)
  check('未知の見出しは旧形式として扱う', s.length === 1 && s[0].label === null, JSON.stringify(s))
}

console.log('')
if (failures > 0) {
  console.error(`FAILED: ${failures} 件`)
  process.exit(1)
}
console.log('すべてPASS')
