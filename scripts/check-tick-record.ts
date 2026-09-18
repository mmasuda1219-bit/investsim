// 4a: tick ごとの過程の記録（lib/ai-trader/tick-record.ts）の純関数スモークテスト。
//   $env:PATH = "C:\Program Files\nodejs;$env:PATH"; npx tsx scripts/check-tick-record.ts
//
// engine.ts は store.ts 経由で `server-only` を静的 import しており tsx から読めないため、
// ここでは記録の型・組み立て・丸め（pushTick）だけを検査する。runTick 本体の通し実行は
// API キーと Supabase が要るので別途（無ければ「未実行」と報告する）。
import {
  pushTick, emptyTickRecord, makeStage, tickIdFor, decisionIdFor,
  TICK_RECORD_LIMIT,
  skippedTickAI, isAiSkipped, AI_SKIPPED_STOP_REASON, AI_SKIPPED_MODEL, AI_SKIPPED_NOTE, AI_SKIPPED_KNOWLEDGE_NOTE,
  type TickRecord, type TickUniverseRow, type TickContext, type TickAI,
} from '../lib/ai-trader/tick-record'

let failed = 0
function check(name: string, ok: boolean, detail = '') {
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : `  ${detail}`}`)
  if (!ok) failed++
}

const T0 = Date.UTC(2026, 8, 11, 13, 30, 0) // 2026-09-11T13:30:00.000Z

console.log('id・参照の書式')
{
  check('id は tick_<epoch ms>', tickIdFor(T0) === `tick_${T0}`, tickIdFor(T0))
  const r = emptyTickRecord(T0)
  check('emptyTickRecord の id と startedAt が同じ時刻', r.id === `tick_${T0}` && r.startedAt === '2026-09-11T13:30:00.000Z', `${r.id} ${r.startedAt}`)
  check('finishedAt は null・ai は null・配列は空', r.finishedAt === null && r.ai === null
    && r.stages.length === 0 && r.universe.length === 0 && r.contexts.length === 0 && r.decisionIds.length === 0)
  const at = '2026-09-11T13:30:41.512Z'
  check('decisionId は symbol@decidedAt', decisionIdFor('7203.T', at) === `7203.T@${at}`, decisionIdFor('7203.T', at))
}

console.log('段（makeStage）')
{
  const s = makeStage('candidates', T0, T0 + 1234, true, '40/40銘柄')
  check('ms は差分', s.ms === 1234, String(s.ms))
  check('startedAt は ISO', s.startedAt === '2026-09-11T13:30:00.000Z', s.startedAt)
  check('note を持つ', s.note === '40/40銘柄')
  const noNote = makeStage('ai', T0, T0 + 5, false)
  check('note 無しは項目ごと落ちる（JSON に "note" が出ない）', !('note' in noNote), JSON.stringify(noNote))
  check('終了が開始より前でも負にならない', makeStage('trade', T0 + 10, T0, true).ms === 0)
}

console.log('pushTick の上限と旧セッション')
{
  const one = emptyTickRecord(T0)
  const fromUndefined = pushTick(undefined, one)
  check('undefined（旧セッション）に1件足すと1件', fromUndefined.length === 1 && fromUndefined[0] === one)
  check('null でも同じ', pushTick(null, one).length === 1)

  let ticks: TickRecord[] | undefined = undefined
  for (let i = 0; i < TICK_RECORD_LIMIT + 5; i++) ticks = pushTick(ticks, emptyTickRecord(T0 + i * 60_000))
  check(`${TICK_RECORD_LIMIT + 5}件足しても ${TICK_RECORD_LIMIT} 件`, ticks!.length === TICK_RECORD_LIMIT, String(ticks!.length))
  check('ticks[0] が最新（decisions/trades と同じ新しい順）', ticks![0].id === tickIdFor(T0 + (TICK_RECORD_LIMIT + 4) * 60_000), ticks![0].id)
  check('最古の5件が丸ごと落ちる', ticks![ticks!.length - 1].id === tickIdFor(T0 + 5 * 60_000), ticks![ticks!.length - 1].id)

  const before = [emptyTickRecord(T0)]
  const snapshot = JSON.stringify(before)
  pushTick(before, emptyTickRecord(T0 + 1))
  check('入力配列を変更しない', JSON.stringify(before) === snapshot && before.length === 1)
  check('TICK_RECORD_LIMIT は 12', TICK_RECORD_LIMIT === 12)
}

console.log('失敗行の null（原則9: 0 や前回値で埋めない）')
{
  const failedRow: TickUniverseRow = { symbol: 'PLTR', changePercent: null, ok: false, rank: null }
  const okRow: TickUniverseRow = { symbol: 'AAPL', changePercent: -1.23, ok: true, rank: 3 }
  check('失敗行は changePercent/rank が null', failedRow.changePercent === null && failedRow.rank === null && !failedRow.ok)
  check('成功行は符号つきの実値', okRow.changePercent === -1.23 && okRow.rank === 3)
  const j = JSON.parse(JSON.stringify(failedRow))
  check('JSON 往復でも null のまま（undefined に化けない）', j.changePercent === null && j.rank === null)

  const failedCtx: TickContext = {
    symbol: 'NVDA', bars: 0, ma20: null, ma50: null, rsi14: null, macd: null, bb: null,
    fundamentalsOk: false, newsCount: 0, newsHeadlines: [], error: 'Real quote unavailable',
  }
  check('材料の失敗行は指標がすべて null・error あり',
    failedCtx.ma20 === null && failedCtx.macd === null && failedCtx.bb === null && !!failedCtx.error)

  const failedAi: TickAI = {
    model: 'claude-haiku-4-5', inputTokens: null, outputTokens: null, stopReason: 'timeout',
    ms: 35_004, decisionsReturned: 0, decisionsExpected: 8, promptChars: 6200, responseChars: null,
  }
  check('AI 失敗はトークン・responseChars が null で stopReason=timeout',
    failedAi.inputTokens === null && failedAi.responseChars === null && failedAi.stopReason === 'timeout')

  // プロンプトを組み立てる前に落ちた経路（AskClaudeError 以外の例外）は promptChars も不明＝null
  const failedBeforePrompt: TickAI = {
    model: 'claude-haiku-4-5', inputTokens: null, outputTokens: null, stopReason: 'error',
    ms: 12, decisionsReturned: 0, decisionsExpected: 8, promptChars: null, responseChars: null,
  }
  const jb = JSON.parse(JSON.stringify(failedBeforePrompt))
  check('プロンプト組み立て前の失敗は promptChars が null（0 で埋めない）・JSON 往復でも null',
    failedBeforePrompt.promptChars === null && jb.promptChars === null && jb.stopReason === 'error')
}

console.log('AI を呼ばなかった回（材料0件・skippedTickAI・2026-09-17）')
{
  const a = skippedTickAI()
  check("stopReason は AI_SKIPPED_STOP_REASON（'skipped'）で、失敗の値（timeout / error / empty）とは別",
    a.stopReason === AI_SKIPPED_STOP_REASON && AI_SKIPPED_STOP_REASON === 'skipped' && !['timeout', 'error', 'empty'].includes(a.stopReason))
  check("model は AI_SKIPPED_MODEL（'none'）で、'cli' や実在のモデル名と混ざらない", a.model === AI_SKIPPED_MODEL && AI_SKIPPED_MODEL === 'none' && !['cli', 'claude-haiku-4-5'].includes(a.model))
  check('所要 0ms・渡した銘柄 0・返事 0（呼んでいない）', a.ms === 0 && a.decisionsExpected === 0 && a.decisionsReturned === 0)
  check('トークン・文字数は null（測っていないので 0 で埋めない）', a.inputTokens === null && a.outputTokens === null && a.promptChars === null && a.responseChars === null)
  check('TickAI の 9 項目だけを持つ（余計なキー・欠けたキーが無い）',
    JSON.stringify(Object.keys(a).sort()) === JSON.stringify(['decisionsExpected', 'decisionsReturned', 'inputTokens', 'model', 'ms', 'outputTokens', 'promptChars', 'responseChars', 'stopReason']),
    Object.keys(a).join(','))
  const j = JSON.parse(JSON.stringify(a)) as TickAI
  check('JSON 往復でも同じ形（null が消えない・ms 0 のまま）', j.stopReason === 'skipped' && j.promptChars === null && j.responseChars === null && j.ms === 0 && j.model === 'none')
  check('毎回新しいオブジェクト（記録どうしで共有しない）', skippedTickAI() !== skippedTickAI() && JSON.stringify(skippedTickAI()) === JSON.stringify(a))

  const timeoutAi: TickAI = { ...a, model: 'claude-haiku-4-5', stopReason: 'timeout', ms: 40_000, decisionsExpected: 8, promptChars: 6200 }
  const emptyAi: TickAI = { ...a, model: 'claude-haiku-4-5', stopReason: 'empty', ms: 12_000, decisionsExpected: 0, inputTokens: 5000, outputTokens: 10, promptChars: 6000, responseChars: 20 }
  const okAi: TickAI = { ...emptyAi, stopReason: 'end_turn', decisionsExpected: 8, decisionsReturned: 8 }
  check('isAiSkipped: skipped の記録だけ true', isAiSkipped(a) === true && isAiSkipped(j) === true)
  check('isAiSkipped: null / undefined（tick なし・ai なし）は false', isAiSkipped(null) === false && isAiSkipped(undefined) === false)
  check("isAiSkipped: 失敗の回（timeout）・'empty'（材料0件で呼んでしまった旧記録も含む）・成功の回は false",
    isAiSkipped(timeoutAi) === false && isAiSkipped(emptyAi) === false && isAiSkipped(okAi) === false)
  check("isAiSkipped は stopReason だけで決める（model が 'none' でも stopReason が違えば false）", isAiSkipped({ ...okAi, model: 'none' }) === false)

  check('段の note は和文で、英語の skipped を含まない', !/skipped/i.test(AI_SKIPPED_NOTE) && !/skipped/i.test(AI_SKIPPED_KNOWLEDGE_NOTE))
  check("段 'ai' の note は「材料 0件」と「AI を呼ばず」を言う", AI_SKIPPED_NOTE.includes('0件') && AI_SKIPPED_NOTE.includes('AI を呼ばず'), AI_SKIPPED_NOTE)
  check("段 'knowledge' の note は「読まず」を言う", AI_SKIPPED_KNOWLEDGE_NOTE.includes('AI を呼ばない') && AI_SKIPPED_KNOWLEDGE_NOTE.includes('読まず'), AI_SKIPPED_KNOWLEDGE_NOTE)
  check('note に「打ち切」を使わない（打ち切りではなく、聞いていない）', !AI_SKIPPED_NOTE.includes('打ち切') && !AI_SKIPPED_KNOWLEDGE_NOTE.includes('打ち切'))

  // engine.ts が積む形: knowledge は ok:true・ai は ok:false、どちらも note 付き（段の並びは candidates → contexts → knowledge → ai → trade）
  const kn = makeStage('knowledge', T0 + 9000, T0 + 9000, true, AI_SKIPPED_KNOWLEDGE_NOTE)
  const ai = makeStage('ai', T0 + 9000, T0 + 9000, false, AI_SKIPPED_NOTE)
  check('段 knowledge は ok:true・所要 0・note 付き', kn.ok && kn.ms === 0 && kn.note === AI_SKIPPED_KNOWLEDGE_NOTE)
  check('段 ai は ok:false・所要 0・note 付き', !ai.ok && ai.ms === 0 && ai.note === AI_SKIPPED_NOTE)
  const r = emptyTickRecord(T0)
  r.ai = skippedTickAI()
  r.stages = [makeStage('candidates', T0, T0 + 3000, false), makeStage('contexts', T0 + 3000, T0 + 9000, false, '0/2銘柄の材料を取得'), kn, ai, makeStage('trade', T0 + 9000, T0 + 9500, true, '約定0件')]
  check('記録に載せても段の並びは 5 つ（candidates, contexts, knowledge, ai, trade）', r.stages.map(s => s.name).join(',') === 'candidates,contexts,knowledge,ai,trade')
  check('記録の JSON に英語の skipped が出るのは stopReason の値だけ（note・model には無い）',
    (JSON.stringify(r).match(/skipped/g) ?? []).length === 1 && JSON.stringify(r).includes('"stopReason":"skipped"'))
}

console.log('1件のサイズ実測（40銘柄・8 contexts・見出し5件ずつ）')
{
  const r = emptyTickRecord(T0)
  const syms = ['AAPL','NVDA','MSFT','GOOGL','AMZN','META','TSLA','JPM','BAC','V','MA','GS','JNJ','LLY','PFE','MRK','XOM','CVX','KO','PG',
    'WMT','COST','MCD','AMD','INTC','ORCL','CRM','NFLX','ADBE','SPY','QQQ','COIN','PLTR','7203.T','6758.T','9984.T','6861.T','8306.T','4063.T','9432.T']
  r.universe = syms.map((symbol, i) => i === 39
    ? { symbol, changePercent: null, ok: false, rank: null }
    : { symbol, changePercent: Number(((i % 7) - 3 + i / 100).toFixed(2)), ok: true, rank: i + 1 })
  r.selected = syms.slice(0, 4)
  r.heldAdded = ['LLY', 'COST', 'ORCL', '7203.T']
  const analysed = [...r.selected, ...r.heldAdded]
  const headline = (s: string, k: number) => `[${k * 3 + 1}h前] ${s} shares slip as investors weigh quarterly results and guidance update (Reuters)`
  r.contexts = analysed.map(symbol => ({
    symbol, bars: 63,
    ma20: 231.47, ma50: 224.9, rsi14: 58.21,
    macd: { macd: 2.1345, signal: 1.9876, histogram: 0.1469 },
    bb: { upper: 245.12, middle: 231.47, lower: 217.82 },
    fundamentalsOk: true, newsCount: 5,
    newsHeadlines: [0, 1, 2, 3, 4].map(k => headline(symbol, k)),
  }))
  r.knowledge = [1, 2, 3, 4, 5, 6].map(i => ({ id: `km_${String(i).padStart(10, '0')}`, title: `投資の原則 ${i}: 買う前に降りる条件を決める` }))
  r.ai = {
    model: 'claude-haiku-4-5-20251001', inputTokens: 5120, outputTokens: 1980, stopReason: 'end_turn',
    ms: 21_345, decisionsReturned: 8, decisionsExpected: 8, promptChars: 7100, responseChars: 3900,
  }
  const decidedAt = '2026-09-11T13:30:41.512Z'
  r.decisionIds = analysed.map(s => decisionIdFor(s, decidedAt))
  r.stages = [
    makeStage('candidates', T0, T0 + 3200, true, '40/40銘柄の株価を取得・候補4件・保有から4件'),
    makeStage('contexts', T0 + 3200, T0 + 9800, true, '8/8銘柄の材料を取得'),
    makeStage('knowledge', T0 + 9800, T0 + 10100, true, '48件から6件を提示'),
    makeStage('ai', T0 + 10100, T0 + 31450, true),
    makeStage('trade', T0 + 31450, T0 + 33900, true, '約定1件'),
  ]
  r.finishedAt = '2026-09-11T13:30:34.000Z'
  const bytes = Buffer.byteLength(JSON.stringify(r), 'utf8')
  console.log(`  1件 = ${bytes.toLocaleString()} bytes (${(bytes / 1024).toFixed(1)} KB) → 12件 = ${(bytes * 12 / 1024).toFixed(0)} KB`)
  check('1件が 20KB 未満', bytes < 20 * 1024, `${bytes} bytes`)
  check('decisionIds が 8 件・書式一致', r.decisionIds.length === 8 && r.decisionIds[0] === `AAPL@${decidedAt}`)
  check('プロンプト本文・返事本文は持たない（キーに prompt/text/response が無い）',
    !/"(prompt|text|response|responseText)"\s*:/.test(JSON.stringify(r)))
}

console.log('')
if (failed) { console.log(`${failed} 件 FAIL`); process.exit(1) }
console.log('すべてPASS')
