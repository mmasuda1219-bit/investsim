// ⑤-1: 分析の過程の再生の計算部分（lib/ai-trader/replay-model.ts）の純関数スモークテスト。
//   $env:PATH = "C:\Program Files\nodejs;$env:PATH"; npx tsx scripts/check-replay-model.ts [ai-session.json のパス]
//
// 本番複製（GET /api/ai-session の JSON。配列でも1件でも可）はパス引数か AI_SESSION_JSON 環境変数で渡す。
// 渡されなければその節は「未実行」と報告し、残りの検査（tick を組んだ複製・株価の再計算・文の読み取り・
// import の検査）だけを行う。本番には書き込まない（読むのは手元のファイルだけ）。
// 2026-09-11 取得の複製（lastTickAt=2026-09-11T17:52:47.609Z）のときは値まで突き合わせ、
// それ以外の複製では構造の不変条件だけを検査する。複製に ticks があれば「ticks なし」前提の検査は省く。
import fs from 'node:fs'
import path from 'node:path'
import {
  listReplayRounds, buildReplayModel, recomputeAiView, pickFocusSymbol, findStateRound,
  readTechnicalsText, trendOf,
  type ReplayHistoryBar, type ReplayStage, type CandidatesStage, type MaterialsStage,
  type IndicatorsStage, type KnowledgeStage, type AiStage, type DecisionsStage, type TradesStage,
  LEGACY_CHANGE_NOTE, LEGACY_CHANGE_NOTE_SHORT, LEGACY_CHANGE_NOTE_ZERO, showsLegacyChangeNote,
  classifyEmptyReply, readStopFromAiNote, type EmptyReplyKind,
} from '../lib/ai-trader/replay-model'
import os from 'node:os'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import {
  emptyTickRecord, makeStage, decisionIdFor, skippedTickAI, AI_SKIPPED_NOTE, AI_SKIPPED_KNOWLEDGE_NOTE,
  type TickRecord,
} from '../lib/ai-trader/tick-record'
import { UNIVERSE } from '../lib/ai-trader/universe'
import type { AIDecision, AISession, AITrade, Holding } from '../lib/ai-trader/engine'

let failed = 0
let passed = 0
function check(name: string, ok: boolean, detail = '') {
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : `  ${detail}`}`)
  if (ok) passed++; else failed++
}

function stage<T extends ReplayStage>(stages: ReplayStage[], key: T['key']): T {
  const s = stages.find(x => x.key === key)
  if (!s) throw new Error(`stage ${key} not found`)
  return s as T
}

// ── 検査用の足（土日を飛ばした日足。time は epoch 秒・13:30 UTC＝米国市場の始まり） ──
function weekdayBars(
  fromIso: string, toIso: string,
  closeAt: (i: number) => number,
  kind: 'sec' | 'ms' | 'str' = 'sec',
): ReplayHistoryBar[] {
  const out: ReplayHistoryBar[] = []
  const end = Date.parse(toIso)
  let i = 0
  for (let t = Date.parse(fromIso); t <= end; t += 86_400_000) {
    const d = new Date(t)
    const dow = d.getUTCDay()
    if (dow === 0 || dow === 6) continue
    const at = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 13, 30)
    const time = kind === 'sec' ? Math.floor(at / 1000) : kind === 'ms' ? at : d.toISOString().slice(0, 10)
    out.push({ time, close: parseFloat(closeAt(i).toFixed(2)) })
    i++
  }
  return out
}

function loadSession(): AISession | null {
  const p = process.argv[2] ?? process.env.AI_SESSION_JSON
  if (!p) return null
  const raw = JSON.parse(fs.readFileSync(path.resolve(p), 'utf8'))
  const s = Array.isArray(raw) ? raw[0] : (raw.session ?? raw)
  return s as AISession
}

const session = loadSession()
const SNAPSHOT_LAST_TICK = '2026-09-11T17:52:47.609Z'
const isSnapshot = session?.lastTickAt === SNAPSHOT_LAST_TICK

// 9/11 の複製と同じ形の最小セッション（判断7件・保有5・watchlist 8）。複製が無いか別日のときの B 節の土台
function syntheticSession(): AISession {
  const ts = '2026-09-11T17:52:47.464Z'
  const mk = (symbol: string, action: 'hold' | 'watch', price: number) => ({
    id: `d_${symbol}`, timestamp: ts, symbol, action, price, confidence: 'high' as const,
    reasoning: '検査用', technicals: '上昇トレンド（価格>MA20>MA50）・MACD強気・RSI68中立。',
    fundamentals: 'PER=20.6x | ROE=12.2% | fmt=2', newsHeadlines: ['[0h前] a (x)', '[1h前] b (y)'],
  })
  const hold = (name: string, entryAt: string, avgCost: number): Holding =>
    ({ shares: 10, avgCost, name, entryAt, entryReasoning: '', entryTechnicals: '', entryFundamentals: '' })
  return {
    id: 's', startedAt: '2026-07-01T00:00:00.000Z', lastTickAt: SNAPSHOT_LAST_TICK, tickCount: 72,
    capital: 100000, cash: 20000, totalValue: 100000, pnl: 0, pnlPct: 0, marketContext: '',
    holdings: {
      CVX: hold('Chevron', '2026-08-10T20:21:51.799Z', 194.91), XOM: hold('Exxon', '2026-07-14T16:43:51.576Z', 114.24),
      ADBE: hold('Adobe', '2026-08-11T18:10:58.989Z', 264.46), COST: hold('Costco', '2026-07-14T16:43:51.576Z', 910.4),
      GOOGL: hold('Alphabet', '2026-08-03T18:59:34.721Z', 375.64),
    },
    trades: [], decisions: [], watchlist: ['9984.T', 'INTC', 'AMD', 'GOOGL', 'CVX', 'XOM', 'ADBE', 'COST'],
    learning: {
      closedTrades: [],
      allDecisions: [mk('CVX', 'hold', 213.805), mk('XOM', 'hold', 165.45), mk('ADBE', 'hold', 252.8), mk('GOOGL', 'hold', 340.51),
        mk('COST', 'hold', 904.085), mk('INTC', 'watch', 103.63), mk('AMD', 'watch', 517.2)],
      lessons: [], fundamentalInsights: [], newsInsights: [], causalChains: [], tradingBiases: [], strategyNotes: [],
      lastLearnTickCount: 0, patterns: [],
      stats: { totalTrades: 0, wins: 0, losses: 0, winRate: 0, avgGainPct: 0, avgLossPct: 0, totalPnl: 0, bestTrade: null, worstTrade: null },
    },
    equityHistory: [], benchmarkStart: null,
    stats: { daysRunning: 0, maxValue: 0, minValue: 0, maxDrawdownPct: 0, annualizedReturnPct: 0, sharpeRatio: 0, totalTradeCount: 0, winRate: 0 },
    knowledgeShown: [],
  }
}

// ══════════════════════════════════════════════════════════════════════════
console.log('A. 本番複製')
if (!session) {
  console.log('  未実行: 複製のパスを引数か AI_SESSION_JSON で渡してください')
} else {
  const all = session.learning?.allDecisions ?? []
  const distinctTs = new Set(all.map(d => d.timestamp)).size
  const tickCount = session.ticks?.length ?? 0
  const noTicks = tickCount === 0
  const rounds = listReplayRounds(session)
  console.log(`  複製: tickCount=${session.tickCount} allDecisions=${all.length} 同時刻群=${distinctTs} trades=${(session.trades ?? []).length} ticks=${tickCount}${isSnapshot ? '（9/11 の複製・値まで突き合わせる）' : '（別日の複製・構造だけ検査）'}`)

  check('回は新しい順', rounds.every((r, i) => i === 0 || Date.parse(rounds[i - 1].at) >= Date.parse(r.at)))
  check('判断を二重に数えない（各回の判断の合計 = allDecisions）', rounds.reduce((n, r) => n + r.decisions.length, 0) === all.length)
  check('回の数 ≤ 同時刻群 + ticks', rounds.length <= distinctTs + tickCount, `${rounds.length}`)
  if (noTicks) check('回の数 = allDecisions の同時刻群の数（ticks が無いので）', rounds.length === distinctTs, `${rounds.length}`)
  if (noTicks) check('全回が decisions 由来', rounds.every(r => r.source === 'decisions' && !r.tick))

  if (!noTicks) {
    console.log('  複製に ticks があるため、ticks なし前提の検査は省略（tick 回は B 節で検査）')
  } else {
    const snapshot = JSON.stringify(session)
    const latest = rounds[0]
    const m = buildReplayModel(session, latest)
    check('session を変更しない', JSON.stringify(session) === snapshot)
    check('JSON にできる', JSON.stringify(m).length > 0)
    check('rounds を渡しても同じ結果（再計算しない）', JSON.stringify(buildReplayModel(session, latest, { rounds })) === JSON.stringify(m)
      && findStateRound(session, rounds)?.id === latest.id && pickFocusSymbol(session, latest, rounds) === m.focusSymbol)
    check('段は 1〜6 の順（この回は売買なし → 段7なし）', m.stages.map(s => s.no).join(',') === '1,2,3,4,5,6', m.stages.map(s => s.no).join(','))

    const c1 = stage<CandidatesStage>(m.stages, 'candidates')
    const c2 = stage<MaterialsStage>(m.stages, 'materials')
    const c3 = stage<IndicatorsStage>(m.stages, 'indicators')
    const c4 = stage<KnowledgeStage>(m.stages, 'knowledge')
    const c5 = stage<AiStage>(m.stages, 'ai')
    const c6 = stage<DecisionsStage>(m.stages, 'decisions')

    check('最新の回は state round（watchlist/holdings/knowledgeShown がこの回の結果）', m.round.isStateRound)
    check('段1 監視銘柄は universe.ts の 40', c1.universe.length === UNIVERSE.length && c1.universe.length === 40, `${c1.universe.length}`)
    check('段1 各銘柄の変化率と順位は none', c1.rows.provenance === 'none' && c1.rows.value.every(r => r.rank === null && r.changePercent === null))
    check('段1 所要時間は none', c1.ms.provenance === 'none' && c1.ms.value === null)
    check('段1 分析対象 = session.watchlist（record・complete）', c1.analysed.provenance === 'record' && c1.analysed.complete
      && c1.analysed.symbols.join(',') === (session.watchlist ?? []).join(','), c1.analysed.symbols.join(','))
    check('段1 保有中 = session.holdings（この回に売買が無ければ record）', c1.held.provenance === 'record'
      && c1.held.value.join(',') === Object.keys(session.holdings ?? {}).join(','))
    check('段1 候補は none', c1.selected.provenance === 'none')
    check('段2 足の本数は none（history 未指定）', c2.bars.provenance === 'none' && c2.bars.value === null)
    check('段2 会社の数字の取得可否は文字列からの導出＝recomputed', c2.fundamentals.ok.provenance === 'recomputed')
    check('段3 MA20・RSI の数値は none', c3.ma20.provenance === 'none' && c3.rsi14.provenance === 'none')
    check('段4 知識は record', c4.items.provenance === 'record')
    check('段5 モデル・所要時間は none', c5.model.provenance === 'none' && c5.ms.provenance === 'none')
    check('段5 渡した銘柄数・期待件数は none（watchlist は材料取得に失敗した銘柄も含む）', c5.symbolsSent.provenance === 'none'
      && c5.symbolsSent.value.length === 0 && !!c5.symbolsSent.note && c5.expected.provenance === 'none' && c5.expected.value === null)
    check('段5 返答数は record', c5.returned.provenance === 'record' && c5.returned.value === latest.decisions.length)
    check('段6 失敗なし', c6.failure === null)
    check('段6 行数 = 分析対象の数（判断が無い銘柄も行にする）', c6.rows.length === c1.analysed.symbols.length, `${c6.rows.length}`)
    check('段6 分母（期待件数）は none・注記あり', c6.expected.provenance === 'none' && c6.expected.value === null && !!c6.expected.note)
    check('総所要時間は none', m.totalMs.provenance === 'none')
    check('画面向けの文言に「注目銘柄」を使わない', !JSON.stringify(m).includes('注目銘柄'))

    if (isSnapshot) {
      check('最新の回は 2026-09-11T17:52:47.464Z', latest.at === '2026-09-11T17:52:47.464Z', latest.at)
      check('判断7件（CVX XOM ADBE GOOGL COST INTC AMD）', latest.decisions.map(d => d.symbol).join(' ') === 'CVX XOM ADBE GOOGL COST INTC AMD',
        latest.decisions.map(d => d.symbol).join(' '))
      check('第72回', m.round.tickNumber === 72, `${m.round.tickNumber}`)
      check('分析対象8銘柄', c1.analysed.symbols.length === 8 && m.summary.analysed === 8)
      check('保有中5', c1.held.value.length === 5)
      check('詳しく見る銘柄は判断のある保有銘柄の先頭 = CVX', m.focusSymbol === 'CVX' && pickFocusSymbol(session, latest) === 'CVX', `${m.focusSymbol}`)
      check('段2 会社の数字 13/13（record）', c2.fundamentals.count.provenance === 'record' && c2.fundamentals.count.value === 13 && c2.fundamentals.total === 13,
        `${c2.fundamentals.count.value}`)
      check('段2 fmt=2・v1 の注記なし', c2.fundamentals.format === 2 && !c2.fundamentals.legacy)
      check('段2 AI の1文がある', c2.fundamentals.prose.startsWith('PER20.6x妥当'), c2.fundamentals.prose.slice(0, 30))
      check('段2 ニュース見出し2件（record）・取得件数は none', c2.news.headlines.provenance === 'record' && c2.news.headlines.value.length === 2 && c2.news.fetched.provenance === 'none')
      check('段3 判断時の価格 213.805（record）', c3.price.provenance === 'record' && c3.price.value === 213.805)
      check('段3 文から: 上昇トレンド・RSI68 中立・MACD強気（record）', c3.fromText.provenance === 'record'
        && c3.fromText.trend === 'up' && c3.fromText.rsi === 'RSI68 中立' && c3.fromText.rsiFromText === 68 && c3.fromText.macd === 'MACD強気',
        JSON.stringify(c3.fromText))
      check('段3 並びは計算できないので none', c3.trend.provenance === 'none' && c3.trend.value === null)
      check('段4 知識0件が record', c4.items.value.length === 0)
      check('段5 見出しは分析対象8銘柄', c5.title === '分析対象8銘柄の材料をまとめて、1回で AI に渡す', c5.title)
      check('段6 見出しは「返ってきた判断　7 銘柄」（分母は記録なし）', c6.title === '返ってきた判断　7 銘柄', c6.title)
      const jp = c6.rows.find(r => r.symbol === '9984.T')
      check('段6 9984.T は「判断の記録なし」（none）', !!jp && jp.provenance === 'none' && jp.action === null)
      check('段6 record の行が7', c6.rows.filter(r => r.provenance === 'record').length === 7)
      check('段6 行の並びは分析対象の順', c6.rows.map(r => r.symbol).join(',') === (session.watchlist ?? []).join(','))
      check('段6 保有の行に held=true（5）・残りは false', c6.rows.filter(r => r.held === true).length === 5 && c6.rows.filter(r => r.held === false).length === 3)
      check('段6 詳しく見る銘柄の保有は record（8/10 に 194.91）', c6.focus?.holding.provenance === 'record'
        && c6.focus?.holding.value?.entryAt === '2026-08-10T20:21:51.799Z' && c6.focus?.holding.value?.avgCost === 194.91)
      check('段6 損益は判断価格と取得単価から +9.69%（recomputed）', c6.focus?.holdingPnlPct.value === 9.69 && c6.focus?.holdingPnlPct.provenance === 'recomputed',
        `${c6.focus?.holdingPnlPct.value}`)

      // 検査用の足を渡すと、株価と平均線が「再計算」の印で入る（値は検査用。本番の CVX の足ではない）
      const fake = weekdayBars('2026-05-20', '2026-09-16', i => 200 + i * 0.1 + (i % 5))
      const mh = buildReplayModel(session, latest, { history: fake })
      const h2 = stage<MaterialsStage>(mh.stages, 'materials')
      const h3 = stage<IndicatorsStage>(mh.stages, 'indicators')
      check('history を渡すと段2 足の本数が recomputed', h2.bars.provenance === 'recomputed' && (h2.bars.value ?? 0) > 60, `${h2.bars.value}`)
      check('history を渡すと段3 MA20/MA50 が recomputed・RSI は none のまま', h3.ma20.provenance === 'recomputed' && h3.ma50.provenance === 'recomputed'
        && h3.ma20.value !== null && h3.rsi14.provenance === 'none')
      check('段3 並びは recomputed', h3.trend.provenance === 'recomputed' && h3.trend.value !== null)
      check('chart の最後の足が判断価格 213.805 に置き換わる', mh.chart?.replacedIndex === (mh.chart?.bars.length ?? 0) - 1
        && mh.chart?.bars[mh.chart.bars.length - 1].close === 213.805)
      check('段2 印は「株価は再取得」・先頭は欠けていない', h2.sourceLabel === '株価は再取得' && mh.chart?.headMissing === false, h2.sourceLabel)

      // 過去の回（ADBE の買いがある回）
      const past = rounds.find(r => r.at === '2026-08-11T18:10:58.989Z')
      check('過去の回 2026-08-11T18:10:58.989Z がある', !!past)
      if (past) {
        const pm = buildReplayModel(session, past)
        const p1 = stage<CandidatesStage>(pm.stages, 'candidates')
        const p4 = stage<KnowledgeStage>(pm.stages, 'knowledge')
        const p5 = stage<AiStage>(pm.stages, 'ai')
        const p6 = stage<DecisionsStage>(pm.stages, 'decisions')
        const p7 = pm.stages.find(s => s.key === 'trades') as TradesStage | undefined
        check('過去の回: state round ではない・第N回は null', !pm.round.isStateRound && pm.round.tickNumber === null)
        check('過去の回: 段7 が出る（ADBE 買い1件・record）', !!p7 && p7.trades.provenance === 'record' && p7.trades.value.length === 1
          && p7.trades.value[0].symbol === 'ADBE' && p7.trades.value[0].action === 'buy', JSON.stringify(p7?.trades.value))
        check('過去の回: 段の順 1〜7', pm.stages.map(s => s.no).join(',') === '1,2,3,4,5,6,7')
        check('過去の回: 保有中は none・行の held は null', p1.held.provenance === 'none' && p1.held.value.length === 0 && p6.rows.every(r => r.held === null))
        check('過去の回: 分析対象は判断のある銘柄だけ（none・complete=false）', p1.analysed.provenance === 'none' && !p1.analysed.complete && p1.analysed.symbols.length === 7)
        check('過去の回: 段4 知識は none', p4.items.provenance === 'none')
        check('過去の回: 段5 渡した銘柄・期待は none', p5.symbolsSent.provenance === 'none' && p5.expected.provenance === 'none')
        check('過去の回: 段6 見出しに「/ N」を付けない', p6.title === '返ってきた判断　7 銘柄' && p6.expected.value === null, p6.title)
        check('過去の回: 詳しく見る銘柄は hold の先頭（GOOGL）', pm.focusSymbol === 'GOOGL', `${pm.focusSymbol}`)
        check('過去の回: 詳しく見る銘柄の保有は none', p6.focus?.holding.provenance === 'none' && p6.focus?.holdingPnlPct.provenance === 'none')
        check('過去の回: 段1 印は「判断のある銘柄だけ記録あり」', p1.sourceLabel === '判断のある銘柄だけ記録あり', p1.sourceLabel)
        // 3か月より前の回に「今から6か月」の足を渡すと、窓の先頭が欠けていることが分かる
        const recent = weekdayBars('2026-07-20', '2026-09-16', i => 250 + (i % 7))
        const pmh = buildReplayModel(session, past, { history: recent })
        check('過去の回: 6か月の足では窓の先頭が欠ける（headMissing）', pmh.chart?.headMissing === true
          && stage<MaterialsStage>(pmh.stages, 'materials').bars.note?.includes('先頭が欠けている') === true)
      }
      check('売買のある回は段7、無い回は6段（全回）', rounds.every(r => {
        const mm = buildReplayModel(session, r, { rounds })
        const has = (session.trades ?? []).some(t => t.timestamp === r.at)
        return (mm.stages.length === 7) === has
      }))
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════
console.log('B. ticks あり（検査用の TickRecord を複製に足す）')
// 9/11 の複製があればそれを、無いか別日なら同じ形の最小セッションを土台にする（銘柄名を決め打ちで検査するため）
const base: AISession = session && isSnapshot ? session : syntheticSession()
console.log(`  土台: ${session && isSnapshot ? '9/11 の複製' : '最小セッション（検査用）'}`)
{
  const all = base.learning.allDecisions
  const latestTs = all[0].timestamp
  const latestGroup = all.filter(d => d.timestamp === latestTs)
  const distinctTs = new Set(all.map(d => d.timestamp)).size

  // 成功した tick（最新の判断群を startedAt〜finishedAt に含む）
  const T0 = Date.parse(latestTs) - 42_000
  const t1: TickRecord = emptyTickRecord(T0)
  t1.universe = UNIVERSE.map((symbol, i) => i === 39
    ? { symbol, changePercent: null, ok: false, rank: null }
    : { symbol, changePercent: Number(((i % 7) - 3 + i / 100).toFixed(2)), ok: true, rank: i + 1 })
  t1.selected = ['9984.T', 'INTC', 'AMD', 'GOOGL']
  t1.heldAdded = ['CVX', 'XOM', 'ADBE', 'COST']
  t1.contexts = [...t1.selected, ...t1.heldAdded].map(symbol => ({
    symbol, bars: 63, ma20: 205.1, ma50: 198.4, rsi14: 68.2,
    macd: { macd: 2.1, signal: 1.9, histogram: 0.2 }, bb: { upper: 220, middle: 205.1, lower: 190 },
    fundamentalsOk: true, newsCount: 5, newsHeadlines: [1, 2, 3, 4, 5].map(k => `[${k}h前] ${symbol} headline ${k} (Reuters)`),
  }))
  t1.knowledge = [{ id: 'km_1', title: '買う前に降りる条件を決める' }, { id: 'km_2', title: '分からないときは見送る' }]
  t1.ai = { model: 'claude-haiku-4-5-20251001', inputTokens: 5120, outputTokens: 1980, stopReason: 'end_turn', ms: 21_345,
    decisionsReturned: 7, decisionsExpected: 8, promptChars: 7100, responseChars: 3900 }
  t1.stages = [
    makeStage('candidates', T0, T0 + 3200, true, '39/40銘柄の株価を取得・候補4件・保有から4件'),
    makeStage('contexts', T0 + 3200, T0 + 9800, true, '8/8銘柄の材料を取得'),
    makeStage('knowledge', T0 + 9800, T0 + 10100, true, '48件から2件を提示'),
    makeStage('ai', T0 + 10100, T0 + 31450, true),
    makeStage('trade', T0 + 31450, T0 + 33900, true, '約定0件'),
  ]
  t1.decisionIds = latestGroup.map(d => decisionIdFor(d.symbol, latestTs))
  t1.finishedAt = new Date(T0 + 45_000).toISOString()

  const withTick: AISession = { ...base, ticks: [t1] }
  const rounds = listReplayRounds(withTick)
  check('tick が同時刻群を吸収して回の数は増えない', rounds.length === distinctTs, `${rounds.length} vs ${distinctTs}`)
  check('最新の回は tick 由来で、判断は同時刻群の全件', rounds[0].source === 'tick' && rounds[0].tick === t1 && rounds[0].decisions.length === latestGroup.length)
  check('判断を二重に数えない', rounds.reduce((n, r) => n + r.decisions.length, 0) === all.length)
  check('回の at は tick の startedAt', rounds[0].at === t1.startedAt)

  const m = buildReplayModel(withTick, rounds[0])
  const c1 = stage<CandidatesStage>(m.stages, 'candidates')
  const c2 = stage<MaterialsStage>(m.stages, 'materials')
  const c3 = stage<IndicatorsStage>(m.stages, 'indicators')
  const c4 = stage<KnowledgeStage>(m.stages, 'knowledge')
  const c5 = stage<AiStage>(m.stages, 'ai')
  const c6 = stage<DecisionsStage>(m.stages, 'decisions')
  check('state round・第72回', m.round.isStateRound && m.round.tickNumber === 72, `${m.round.tickNumber}`)
  check('段1 変化率と順位が record・失敗行は null のまま', c1.rows.provenance === 'record' && c1.rows.value[0].rank === 1
    && c1.rows.value[39].rank === null && c1.rows.value[39].ok === false)
  check('段1 取得 39/40（record）', c1.fetched.provenance === 'record' && c1.fetched.value === 39)
  check('段1 候補4・保有から4・分析対象8（record・complete）', c1.selected.value.length === 4 && c1.heldAdded.value.length === 4
    && c1.analysed.provenance === 'record' && c1.analysed.complete && c1.analysed.symbols.length === 8)
  check('段1 所要時間 3200ms（record・note 付き）', c1.ms.provenance === 'record' && c1.ms.value === 3200 && !!c1.ms.note)
  check('段1 印は「記録から」', c1.sourceLabel === '記録から' && c1.provenance === 'record')
  check('段1 保有中は session.holdings（state round・売買なし → record）', c1.held.provenance === 'record' && c1.held.value.length === 5)
  check('詳しく見る銘柄は保有の判断の先頭（CVX）', m.focusSymbol === 'CVX', `${m.focusSymbol}`)
  check('段2 足 63 本（record）', c2.bars.provenance === 'record' && c2.bars.value === 63)
  check('段2 ニュース取得5件・見出し5件（record）', c2.news.fetched.provenance === 'record' && c2.news.fetched.value === 5 && c2.news.headlines.value.length === 5)
  check('段2 会社の数字の取得可否は tick から（record）', c2.fundamentals.ok.provenance === 'record' && c2.fundamentals.ok.value === true)
  check('段2 所要時間 6600ms', c2.ms.value === 6600)
  check('段3 MA20/MA50/RSI/MACD/BB が record', c3.ma20.provenance === 'record' && c3.ma20.value === 205.1 && c3.ma50.value === 198.4
    && c3.rsi14.value === 68.2 && c3.macd.value?.histogram === 0.2 && c3.bb.value?.upper === 220)
  check('段3 並びは記録値から（上昇・record）・記録の文と一致', c3.trend.provenance === 'record' && c3.trend.value === 'up' && c3.trendMatchesText === true)
  check('段4 知識2件（record）・所要 300ms', c4.items.provenance === 'record' && c4.items.value.length === 2 && c4.ms.value === 300)
  check('段5 モデル・トークン・stop_reason・所要が record', c5.model.value === 'claude-haiku-4-5-20251001' && c5.inputTokens.value === 5120
    && c5.stopReason.value === 'end_turn' && c5.ms.provenance === 'record' && c5.ms.value === 21_345)
  check('段5 渡した銘柄 = error の無い context（8・record）・期待8（record）', c5.symbolsSent.provenance === 'record' && c5.symbolsSent.value.length === 8
    && c5.expected.provenance === 'record' && c5.expected.value === 8)
  check('段6 期待8（record）・返答は判断の件数・見出しに「/ 8」', c6.expected.value === 8 && c6.expected.provenance === 'record'
    && c6.returned === latestGroup.length && c6.failure === null && c6.title === `返ってきた判断　${latestGroup.length} / 8 銘柄`)
  check('段6 判断の無い分析対象は「記録なし」の行', c6.rows.filter(r => r.provenance === 'none').length === 8 - latestGroup.length)
  check('段6 GOOGL は候補にも保有にも入るが held=true（state round は holdings から）', c6.rows.find(r => r.symbol === 'GOOGL')?.held === true)
  check('総所要時間 45000ms（record）', m.totalMs.provenance === 'record' && m.totalMs.value === 45_000)
  check('段7 なし（約定0）', !m.stages.some(s => s.key === 'trades'))

  // 失敗した tick（timeout）。判断は無く、watchlist/knowledgeShown は前の値に戻っている
  const T2 = Date.parse('2026-09-12T13:30:00.000Z')
  const t2: TickRecord = emptyTickRecord(T2)
  t2.universe = t1.universe
  t2.selected = ['NVDA', 'TSLA', 'COIN', 'PLTR']
  t2.heldAdded = ['CVX', 'XOM', 'ADBE', 'COST', 'GOOGL']
  t2.contexts = [...t2.selected, ...t2.heldAdded].map((symbol, i) => i === 0
    ? { symbol, bars: 0, ma20: null, ma50: null, rsi14: null, macd: null, bb: null, fundamentalsOk: false, newsCount: 0, newsHeadlines: [], error: 'Real quote unavailable' }
    : { symbol, bars: 63, ma20: 1, ma50: 1, rsi14: 50, macd: null, bb: null, fundamentalsOk: true, newsCount: 3, newsHeadlines: ['[1h前] x (y)'] })
  t2.knowledge = [{ id: 'km_1', title: '買う前に降りる条件を決める' }]
  t2.ai = { model: 'claude-haiku-4-5-20251001', inputTokens: null, outputTokens: null, stopReason: 'timeout', ms: 35_004,
    decisionsReturned: 0, decisionsExpected: 8, promptChars: 6200, responseChars: null }
  t2.stages = [
    makeStage('candidates', T2, T2 + 3000, true, '40/40銘柄の株価を取得・候補4件・保有から5件'),
    makeStage('contexts', T2 + 3000, T2 + 9000, true, '8/9銘柄の材料を取得'),
    makeStage('knowledge', T2 + 9000, T2 + 9200, true, '48件から1件を提示'),
    makeStage('ai', T2 + 9200, T2 + 44_204, false, 'Claude timed out after 35000ms'),
  ]
  t2.finishedAt = new Date(T2 + 44_300).toISOString()

  const withFailed: AISession = { ...base, ticks: [t2, t1] }
  const rounds3 = listReplayRounds(withFailed)
  check('失敗 tick は判断0件の回として先頭に立つ', rounds3.length === distinctTs + 1 && rounds3[0].tick === t2 && rounds3[0].decisions.length === 0)
  check('state round は失敗 tick を飛ばして直前の成功した tick', findStateRound(withFailed)?.tick === t1)

  const fm = buildReplayModel(withFailed, rounds3[0])
  const f1 = stage<CandidatesStage>(fm.stages, 'candidates')
  const f2 = stage<MaterialsStage>(fm.stages, 'materials')
  const f4 = stage<KnowledgeStage>(fm.stages, 'knowledge')
  const f5 = stage<AiStage>(fm.stages, 'ai')
  const f6 = stage<DecisionsStage>(fm.stages, 'decisions')
  check('失敗 tick: state round ではない・第N回 null', !fm.round.isStateRound && fm.round.tickNumber === null)
  check('失敗 tick: 段6 は理由付きの「記録なし」', f6.failure?.stopReason === 'timeout' && f6.failure?.note === 'Claude timed out after 35000ms'
    && f6.sourceLabel === '判断は記録されていない' && f6.title === '返ってきた判断　なし', JSON.stringify(f6.failure))
  check('失敗 tick: 分析対象9の行がすべて none', f6.rows.length === 9 && f6.rows.every(r => r.provenance === 'none'))
  check('失敗 tick: 段1 は record（走査は終わっている）', f1.rows.provenance === 'record' && f1.analysed.complete && f1.analysed.symbols.length === 9)
  check('失敗 tick: 保有中は none（session.holdings はこの回の結果ではない）・heldAdded は record', f1.held.provenance === 'none' && f1.heldAdded.provenance === 'record' && f1.heldAdded.value.length === 5)
  check('失敗 tick: heldAdded の銘柄は held=true、候補の銘柄は不明（null・false と断定しない）',
    f6.rows.filter(r => r.held === true).map(r => r.symbol).join(',') === 'CVX,XOM,ADBE,COST,GOOGL'
    && ['NVDA', 'TSLA', 'COIN', 'PLTR'].every(s => f6.rows.find(r => r.symbol === s)?.held === null))
  check('失敗 tick: 詳しく見る銘柄は error の無い材料の先頭（TSLA）', fm.focusSymbol === 'TSLA', `${fm.focusSymbol}`)
  check('失敗 tick: 段2 会社の数字の件数は none・取得可否は record', f2.fundamentals.count.provenance === 'none' && f2.fundamentals.ok.provenance === 'record')
  check('失敗 tick: 段4 知識1件は record', f4.items.provenance === 'record' && f4.items.value.length === 1)
  check('失敗 tick: 段5 stop_reason=timeout・トークン null（record）', f5.stopReason.value === 'timeout' && f5.inputTokens.provenance === 'record' && f5.inputTokens.value === null)
  check('失敗 tick: 段5 渡した銘柄は error を除いた8', f5.symbolsSent.value.length === 8 && !f5.symbolsSent.value.includes('NVDA'))
  check('失敗 tick: 段7 なし', !fm.stages.some(s => s.key === 'trades'))

  const okAgain = buildReplayModel(withFailed, rounds3[1])
  check('失敗 tick の直前の成功 tick は state round のまま・第72回', okAgain.round.isStateRound && okAgain.round.tickNumber === 72)

  // state でない成功 tick（あとに別の成功 tick がある）: 保有は heldAdded だけ分かる
  const later: TickRecord = emptyTickRecord(T2)
  later.ai = { ...t1.ai!, decisionsReturned: 0, decisionsExpected: 0, stopReason: 'empty' }
  later.finishedAt = new Date(T2 + 40_000).toISOString()
  const olderOk = buildReplayModel({ ...base, ticks: [later, t1] }, listReplayRounds({ ...base, ticks: [later, t1] })[1])
  const o6 = stage<DecisionsStage>(olderOk.stages, 'decisions')
  check('state でない tick 回: heldAdded の銘柄は true、候補にも入った保有銘柄（GOOGL）は null',
    !olderOk.round.isStateRound && o6.rows.find(r => r.symbol === 'CVX')?.held === true && o6.rows.find(r => r.symbol === 'GOOGL')?.held === null
    && o6.rows.find(r => r.symbol === 'INTC')?.held === null)
  check('state でない tick 回: 詳しく見る銘柄（CVX）の保有は「保有していたが単価・株数は記録なし」の none',
    olderOk.focusSymbol === 'CVX' && o6.focus?.holding.provenance === 'none' && o6.focus?.holding.note?.includes('保有していたが') === true)

  // finishedAt が無い tick（保存前に落ちた）は 10 分の窓で同時刻群を拾う
  const t3: TickRecord = emptyTickRecord(Date.parse(latestTs) - 7 * 60_000)
  t3.finishedAt = null
  const rounds4 = listReplayRounds({ ...base, ticks: [t3] })
  check('finishedAt 無しの tick は 10 分の窓で同時刻群を吸収', rounds4.length === distinctTs && rounds4[0].tick === t3 && rounds4[0].decisions.length === latestGroup.length)
  const t3far: TickRecord = emptyTickRecord(Date.parse(latestTs) - 20 * 60_000)
  t3far.finishedAt = null
  const rounds5 = listReplayRounds({ ...base, ticks: [t3far] })
  check('窓の外の tick は吸収せず別の回', rounds5.length === distinctTs + 1 && rounds5[0].source === 'decisions' && rounds5[1].tick === t3far)

  // 返事はあったが判断0件（empty）は tickCount が進む＝state round
  const t4: TickRecord = emptyTickRecord(T2)
  t4.ai = { ...t2.ai!, stopReason: 'empty', inputTokens: 5000, outputTokens: 10, responseChars: 20 }
  t4.finishedAt = t2.finishedAt
  check('stopReason=empty の tick は state round', findStateRound({ ...base, ticks: [t4, t1] })?.tick === t4)
  const em = buildReplayModel({ ...base, ticks: [t4, t1] }, listReplayRounds({ ...base, ticks: [t4, t1] })[0])
  check('empty の段6 は理由付きの「記録なし」', stage<DecisionsStage>(em.stages, 'decisions').failure?.stopReason === 'empty')

  check('旧セッション（learning 無し・ticks 無し）でも落ちない', listReplayRounds({ ...base, learning: undefined as unknown as AISession['learning'], ticks: undefined }).length === 0)
}

// ══════════════════════════════════════════════════════════════════════════
console.log('B2. 判断時点の保有（state round の session.holdings は売買後の状態なので、同じ回の売買から戻す）')
{
  const clone = (): AISession => JSON.parse(JSON.stringify(base))
  const all = base.learning.allDecisions
  const ts = all[0].timestamp
  const trade = (symbol: string, action: AITrade['action'], price: number): AITrade => ({
    timestamp: ts, symbol, name: symbol, action, shares: 10, price, total: price * 10, reason: '検査用',
    technicals: '', fundamentals: '', news: [], sources: [],
  })
  const putFirst = (s: AISession, symbol: string) => {
    const a = s.learning.allDecisions
    s.learning.allDecisions = [...a.filter(d => d.timestamp === ts && d.symbol === symbol), ...a.filter(d => !(d.timestamp === ts && d.symbol === symbol))]
  }

  // この回で INTC を新規に買い（entryAt = 約定時刻）、GOOGL を買い増し（entryAt は 8/03 のまま）、COST を売った（保有から消えている）
  const v = clone()
  v.holdings.INTC = { shares: 10, avgCost: 103.63, name: 'Intel', entryAt: ts, entryReasoning: '', entryTechnicals: '', entryFundamentals: '' }
  v.holdings.GOOGL = { ...v.holdings.GOOGL, shares: v.holdings.GOOGL.shares + 10 }
  delete v.holdings.COST
  v.trades = [trade('INTC', 'buy', 103.63), trade('GOOGL', 'buy', 340.51), trade('COST', 'sell', 904.085), ...v.trades]
  const rounds = listReplayRounds(v)
  const m = buildReplayModel(v, rounds[0], { rounds })
  const c1 = stage<CandidatesStage>(m.stages, 'candidates')
  const c6 = stage<DecisionsStage>(m.stages, 'decisions')
  const heldOf = (s: string) => c6.rows.find(r => r.symbol === s)?.held
  check('state round のまま・段7 に3件', m.round.isStateRound && (m.stages.find(s => s.key === 'trades') as TradesStage | undefined)?.trades.value.length === 3)
  check('段1 保有中は売買から戻した（recomputed・注記あり）', c1.held.provenance === 'recomputed' && !!c1.held.note, c1.held.provenance)
  check('新規買いの INTC は判断時点では未保有（false）', !c1.held.value.includes('INTC') && heldOf('INTC') === false)
  check('売った COST は判断時点では保有（true）', c1.held.value.includes('COST') && heldOf('COST') === true)
  check('買い増しの GOOGL は保有（true）', c1.held.value.includes('GOOGL') && heldOf('GOOGL') === true)
  check('売買の無い CVX は保有・AMD は未保有', heldOf('CVX') === true && heldOf('AMD') === false)
  check('判断時点の保有は CVX XOM ADBE GOOGL COST の5', c1.held.value.length === 5, c1.held.value.join(','))
  check('詳しく見る銘柄は CVX（保有の記録 record・損益 recomputed）', m.focusSymbol === 'CVX'
    && c6.focus?.holding.provenance === 'record' && c6.focus?.holdingPnlPct.provenance === 'recomputed')

  // 詳しく見る銘柄が買い増し／売りの銘柄なら、判断時点の取得単価・株数は導けない
  const g = clone(); g.holdings = v.holdings; g.trades = v.trades; putFirst(g, 'GOOGL')
  const g6 = stage<DecisionsStage>(buildReplayModel(g, listReplayRounds(g)[0]).stages, 'decisions')
  check('買い増しした GOOGL を詳しく見ると、保有は none（導けない）・損益も none',
    g6.focus?.symbol === 'GOOGL' && g6.focus?.holding.provenance === 'none' && g6.focus?.holding.value === null
    && g6.focus?.holding.note?.includes('導けない') === true && g6.focus?.holdingPnlPct.provenance === 'none')
  const c = clone(); c.holdings = v.holdings; c.trades = v.trades; putFirst(c, 'COST')
  const c6b = stage<DecisionsStage>(buildReplayModel(c, listReplayRounds(c)[0]).stages, 'decisions')
  check('売った COST を詳しく見ると、保有は none（記録が消えている）', c6b.focus?.symbol === 'COST' && c6b.focus?.holding.provenance === 'none' && c6b.focus?.holding.value === null)

  // 買いの約定があるのに保有が無い（記録の食い違い）は不明＝null
  const x = clone()
  x.trades = [trade('AMD', 'buy', 517.2), ...x.trades]
  const x6 = stage<DecisionsStage>(buildReplayModel(x, listReplayRounds(x)[0]).stages, 'decisions')
  check('買いの約定があるのに保有が無い銘柄は null（断定しない）', x6.rows.find(r => r.symbol === 'AMD')?.held === null)

  // 未保有の銘柄を詳しく見る（判断群の先頭を watch の INTC にし、保有の判断を消す）
  const w = clone()
  w.learning.allDecisions = w.learning.allDecisions.filter(d => !(d.timestamp === ts && d.action === 'hold'))
  const w6 = stage<DecisionsStage>(buildReplayModel(w, listReplayRounds(w)[0]).stages, 'decisions')
  check('未保有の銘柄を詳しく見ると、保有は「判断時点では保有していない」（record・null）', w6.focus?.symbol === 'INTC'
    && w6.focus?.holding.provenance === 'record' && w6.focus?.holding.value === null && w6.focus?.holdingPnlPct.value === null)

  // 売買の無い回は record のまま
  const p = buildReplayModel(base, listReplayRounds(base)[0])
  check('売買の無い state round は保有が record', stage<CandidatesStage>(p.stages, 'candidates').held.provenance === 'record')
}

// ══════════════════════════════════════════════════════════════════════════
console.log('C. recomputeAiView（判断時刻からおよそ3か月・判断日の足は判断価格・後の足は捨てる）')
{
  const decidedAt = '2026-09-11T17:52:47.464Z'
  const price = 340.51
  const closeAt = (i: number) => 330 + Math.sin(i / 5) * 12 + i * 0.05
  const bars = weekdayBars('2026-05-20', '2026-09-16', closeAt)
  const v = recomputeAiView(bars, decidedAt, price)
  const last = v.bars[v.bars.length - 1]
  console.log(`  足 ${bars.length} 本 → 窓の中 ${v.bars.length} 本（前 ${v.dropped.before}・後 ${v.dropped.after} を捨てた）`)
  check('印は recomputed', v.provenance === 'recomputed')
  check('判断日の足が判断価格に置き換わる', last.date === '2026-09-11' && last.replaced && last.close === price && v.replacedIndex === v.bars.length - 1)
  check('closes の最後も判断価格', v.closes[v.closes.length - 1] === price && v.last.price === price)
  check('判断日より後の足は捨てる（9/14・9/15・9/16 の3本）', v.dropped.after === 3 && v.bars.every(b => b.date <= '2026-09-11'))
  check('3か月より前の足は窓に入らない（6/11 から）', v.bars[0].date === '2026-06-11' && v.dropped.before > 0 && v.window.from === '2026-06-11T00:00:00.000Z', `${v.bars[0].date} from=${v.window.from}`)
  check('足の先頭が窓の始まりに届いていれば headMissing=false', v.headMissing === false)
  check('置き換えた足以外は元の終値のまま', v.bars.slice(0, -1).every((b, i) => !b.replaced && b.close === bars[v.dropped.before + i].close))
  check('MA50 は最初の49本が null・50本目から数値', v.ma50.length === v.bars.length && v.ma50.slice(0, 49).every(x => x === null) && typeof v.ma50[49] === 'number')
  check('MA20 は最初の19本が null・20本目から数値', v.ma20.slice(0, 19).every(x => x === null) && typeof v.ma20[19] === 'number')
  check('0 で埋めていない', !v.ma50.includes(0) && !v.ma20.includes(0))
  const manual20 = parseFloat((v.closes.slice(-20).reduce((s, c) => s + c, 0) / 20).toFixed(2))
  const manual50 = parseFloat((v.closes.slice(-50).reduce((s, c) => s + c, 0) / 50).toFixed(2))
  check('MA20/MA50 の最後は置き換え後の終値の単純平均（小数2桁）', v.last.ma20 === manual20 && v.last.ma50 === manual50, `${v.last.ma20} vs ${manual20} / ${v.last.ma50} vs ${manual50}`)
  check('並びは価格・MA20・MA50 から', v.trend === trendOf(price, v.last.ma20, v.last.ma50) && v.trend !== null)
  check('MA20 の途中の値も単純平均', v.ma20[30] === parseFloat((v.closes.slice(11, 31).reduce((s, c) => s + c, 0) / 20).toFixed(2)))

  // chart API は今から6か月分しか返さないので、3か月より前の回では窓の先頭が欠ける
  const recent = weekdayBars('2026-07-20', '2026-09-16', closeAt)
  const old = recomputeAiView(recent, '2026-08-11T18:10:58.989Z', 264.46)
  check('窓の先頭が欠けていれば headMissing=true（前に捨てた足は 0・窓は 5/11 から）', old.headMissing === true && old.dropped.before === 0
    && old.bars[0].date === '2026-07-20' && old.window.from === '2026-05-11T00:00:00.000Z')
  // 月末の繰り越し: 5/31 の3か月前は 2/31 → 3/3（2026 年は閏年でない）
  const eom = recomputeAiView(weekdayBars('2026-02-01', '2026-06-05', closeAt), '2026-05-31T15:00:00.000Z', 100)
  check('3か月前の日付は Date.UTC の月末繰り越し（5/31 → 3/3）', eom.window.from === '2026-03-03T00:00:00.000Z', eom.window.from)

  // 判断が場が開く前（13:00 UTC）なら、その日の足はまだ無い＝置き換えない・捏造しない
  const early = recomputeAiView(bars, '2026-09-11T13:00:00.000Z', price)
  check('場が開く前の判断: 当日の足は入らず置き換えなし', early.bars[early.bars.length - 1].date === '2026-09-10' && early.replacedIndex === null && early.dropped.after === 4)

  // time が ISO の日付文字列・epoch ms でも同じ
  const strBars = weekdayBars('2026-05-20', '2026-09-16', closeAt, 'str')
  const vs = recomputeAiView(strBars, decidedAt, price)
  check('time が YYYY-MM-DD でも同じ本数・同じ置き換え', vs.bars.length === v.bars.length && vs.replacedIndex === v.replacedIndex && vs.last.ma20 === v.last.ma20)
  const msBars = weekdayBars('2026-05-20', '2026-09-16', closeAt, 'ms')
  const vm = recomputeAiView(msBars, decidedAt, price)
  check('time が epoch ms でも同じ', vm.bars.length === v.bars.length && vm.last.ma50 === v.last.ma50)

  // 並びが乱れた入力でも時刻順に直す
  const shuffled = [...bars].reverse()
  const vr = recomputeAiView(shuffled, decidedAt, price)
  check('入力の並びに依存しない', vr.bars.map(b => b.date).join() === v.bars.map(b => b.date).join())

  // 短い足（30本）: MA50 は全部 null
  const short = weekdayBars('2026-08-01', '2026-09-11', closeAt)
  const vsh = recomputeAiView(short, decidedAt, price)
  check('足が50本未満なら MA50 は全部 null・last.ma50 も null・並びは null', vsh.ma50.every(x => x === null) && vsh.last.ma50 === null && vsh.trend === null)

  check('足が無ければ none', recomputeAiView([], decidedAt, price).provenance === 'none' && recomputeAiView(undefined, decidedAt, price).bars.length === 0)
  check('判断時刻が読めなければ none', recomputeAiView(bars, 'not-a-date', price).provenance === 'none')
  const bad = recomputeAiView(bars, decidedAt, 0)
  check('判断価格が 0 以下なら置き換えない・並びは null', bad.replacedIndex === null && bad.trend === null && !bad.bars[bad.bars.length - 1].replaced)
  check('入力の配列を変更しない', bars[bars.length - 4].close !== price && JSON.stringify(bars) === JSON.stringify(weekdayBars('2026-05-20', '2026-09-16', closeAt)))
}

// ══════════════════════════════════════════════════════════════════════════
console.log('D. 判断の technicals 文字列から語を読む')
{
  const a = readTechnicalsText('上昇トレンド（価格>MA20>MA50）・MACD強気・RSI68中立。短期過熱なし。')
  check('AI の言い換え文: 上昇・RSI68 中立・MACD強気', a.trend === 'up' && a.rsi === 'RSI68 中立' && a.rsiFromText === 68 && a.macd === 'MACD強気' && a.bb === null)
  const b = readTechnicalsText('下落トレンド(価格<MA20<MA50) | RSI48 中立 | MACD弱気 | BB内')
  check('engine の書式: 下落・RSI48 中立・MACD弱気・BB内', b.trend === 'down' && b.rsi === 'RSI48 中立' && b.macd === 'MACD弱気' && b.bb === 'BB内')
  const c = readTechnicalsText('横ばい・レンジ・RSI35売られすぎ間近・MACD弱気転換で一時的な調整可能性。')
  check('横ばい・売られすぎ・弱気転換', c.trend === 'flat' && c.rsi === 'RSI35 売られすぎ' && c.macd === 'MACD弱気')
  const d = readTechnicalsText('データ不足 | RSI不足')
  check('読めなければ null（数字を作らない）', d.trend === null && d.rsi === null && d.rsiFromText === null && d.macd === null)
  check('空・undefined', readTechnicalsText('').rsi === null && readTechnicalsText(undefined).trend === null)
  check('RSI の範囲外は捨てる', readTechnicalsText('RSI999').rsiFromText === null)
}

// ══════════════════════════════════════════════════════════════════════════
console.log('E. クライアント安全（engine.ts / memory.ts は import type だけ）')
{
  const src = fs.readFileSync(path.resolve(__dirname, '../lib/ai-trader/replay-model.ts'), 'utf8')
  const lines = src.split('\n')
  const engineImports = lines.filter(l => /from\s+'\.\/(engine|memory)'/.test(l))
  check('engine.ts / memory.ts の import 行がある', engineImports.length === 2, `${engineImports.length}`)
  check('その行はすべて import type', engineImports.every(l => /^\s*import\s+type\s/.test(l)), engineImports.join(' / '))
  // 読み込み先はコメントでなく import の指定子だけで判定する（コメントに「child_process を読むから型だけ」と書いてある）
  const specifiers = [...src.matchAll(/(?:from\s+|^\s*import\s+)'([^']+)'/gm)].map(m => m[1])
  check('読み込み先は engine / memory / tick-record / universe / fundamentals-parse / @/types だけ',
    specifiers.length > 0 && specifiers.every(s => ['./engine', './memory', './tick-record', './universe', './fundamentals-parse', '@/types'].includes(s)),
    specifiers.join(', '))
  check('child_process / server-only / store / next を読まない', !specifiers.some(s => /child_process|server-only|\/store$|^next/.test(s)))
  const code = lines.filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
  check('Date.now / fetch / process.env を使わない（純関数）', !/Date\.now\(|fetch\(|process\.env/.test(code))
  // 画面向けの文字列（引用符の中）に RULES #8/#15 の「注目銘柄」を使わない
  const strings = [...src.matchAll(/'([^'\n]*)'|`([^`\n]*)`/g)].map(m => m[1] ?? m[2])
  check('文字列に「注目銘柄」を使わない（「この回で詳しく見る銘柄」に）', !strings.some(s => s.includes('注目銘柄')))
}

// ══════════════════════════════════════════════════════════════════════════
console.log('F. 変化率の基準の印（2026-09-16 スライスB・印の無い記録にだけ注記する）')
{
  const fbase = syntheticSession()
  const ts = '2026-09-15T18:00:00.000Z'
  const T0 = Date.parse(ts) - 30_000
  const syms = ['GOOGL', 'CVX', 'XOM']

  const mkRec = (symbol: string) => ({
    id: `d_${symbol}`, timestamp: ts, symbol, action: 'watch' as const, price: 100,
    confidence: 'medium' as const, reasoning: '検査用', technicals: '', fundamentals: '',
    newsHeadlines: [] as string[],
  })
  const mkAI = (symbol: string, marked: boolean, tickId: string | undefined): AIDecision => {
    const d: AIDecision = {
      symbol, name: symbol, action: 'watch', price: 100, change: symbol === 'XOM' ? 0 : 1.25,
      reasoning: '', newsInfluence: '', news: [], technicals: '', fundamentals: '',
      confidence: 'medium', sources: [], decidedAt: new Date(Date.parse(ts) - 1).toISOString(),
    }
    if (tickId) d.tickId = tickId
    if (marked) d.changeBasis = 'prev-close-v1'
    return d
  }
  const mkTick = (marked: boolean): TickRecord => {
    const t = emptyTickRecord(T0)
    t.universe = UNIVERSE.map((symbol, i) => ({ symbol, changePercent: i === 0 ? 0 : 1.5, ok: true, rank: i + 1 }))
    t.selected = [...syms]
    t.stages = [makeStage('candidates', T0, T0 + 3000, true)]
    t.decisionIds = syms.map(x => decisionIdFor(x, ts))
    t.finishedAt = new Date(T0 + 40_000).toISOString()
    if (marked) t.changeBasis = 'prev-close-v1'
    return t
  }
  const mkSession = (o: { tick: boolean; tickMark?: boolean; decMark?: boolean }): AISession => {
    const ticks: TickRecord[] = []
    let tickId: string | undefined
    if (o.tick) { const t = mkTick(!!o.tickMark); ticks.push(t); tickId = t.id }
    return {
      ...fbase, ticks,
      decisions: syms.map(x => mkAI(x, !!o.decMark, tickId)),
      learning: { ...fbase.learning, allDecisions: syms.map(mkRec) },
      watchlist: [...syms],
    }
  }
  const modelOf = (sess: AISession) => {
    const rs = listReplayRounds(sess)
    return { m: buildReplayModel(sess, rs[0]), r: rs[0] }
  }

  // (b) tick にも判断にも印がある回 → 注記なし
  {
    const sess = mkSession({ tick: true, tickMark: true, decMark: true })
    const { m } = modelOf(sess)
    const c1 = stage<CandidatesStage>(m.stages, 'candidates')
    const c6 = stage<DecisionsStage>(m.stages, 'decisions')
    check('印つき（tick・判断とも）: 回・段1・段6すべて prev-close-v1（注記なし）',
      m.round.changeBasis === 'prev-close-v1' && c1.changeBasis === 'prev-close-v1' && c6.changeBasis === 'prev-close-v1',
      `${m.round.changeBasis} / ${c1.changeBasis} / ${c6.changeBasis}`)
    check('印つき: 段1の40行すべてに印・段6の判断行すべてに印',
      c1.rows.value.length === 40 && c1.rows.value.every(r => r.changeBasis === 'prev-close-v1')
      && c6.rows.filter(r => r.provenance === 'record').length === 3
      && c6.rows.every(r => r.changeBasis === 'prev-close-v1'))
  }

  // (a) どちらにも印が無い回 → 注記あり
  {
    const sess = mkSession({ tick: true })
    const snap = JSON.stringify(sess)
    const { m } = modelOf(sess)
    const c1 = stage<CandidatesStage>(m.stages, 'candidates')
    const c6 = stage<DecisionsStage>(m.stages, 'decisions')
    check('印なし（tick・判断とも）: 回・段1・段6すべて null（注記あり）',
      m.round.changeBasis === null && c1.changeBasis === null && c6.changeBasis === null)
    check('印なし: 段1の40行・段6の3行すべて null（0.00% の行も含む）',
      c1.rows.value.every(r => r.changeBasis === null) && c6.rows.every(r => r.changeBasis === null)
      && c1.rows.value[0].changePercent === 0)
    check('保存値を1バイトも書き換えない', JSON.stringify(sess) === snap)
  }

  // (c-1) tick だけに印がある
  {
    const { m } = modelOf(mkSession({ tick: true, tickMark: true }))
    const c1 = stage<CandidatesStage>(m.stages, 'candidates')
    const c6 = stage<DecisionsStage>(m.stages, 'decisions')
    check('tick だけ印: 段1は印つき・段6は印なし・回は null（1つでも欠ければ注記側）',
      c1.changeBasis === 'prev-close-v1' && c6.changeBasis === null && m.round.changeBasis === null,
      `${c1.changeBasis} / ${c6.changeBasis} / ${m.round.changeBasis}`)
  }

  // (c-2) 判断だけに印がある
  {
    const { m } = modelOf(mkSession({ tick: true, decMark: true }))
    const c1 = stage<CandidatesStage>(m.stages, 'candidates')
    const c6 = stage<DecisionsStage>(m.stages, 'decisions')
    check('判断だけ印: 段1は tick の印に従って null・段6は印つき・回は null',
      c1.changeBasis === null && c6.changeBasis === 'prev-close-v1' && m.round.changeBasis === null,
      `${c1.changeBasis} / ${c6.changeBasis} / ${m.round.changeBasis}`)
    check('判断だけ印: 段1の行（tick の universe）は null のまま',
      c1.rows.value.every(r => r.changeBasis === null))
  }

  // (c-3) 判断の一部だけに印（混在）は印なし扱い
  {
    const sess = mkSession({ tick: true, tickMark: true, decMark: true })
    delete sess.decisions[1].changeBasis
    const { m } = modelOf(sess)
    const c6 = stage<DecisionsStage>(m.stages, 'decisions')
    check('判断の一部だけ印: 段6は null（混ざったら印なし扱い）・その行だけ null',
      c6.changeBasis === null && c6.rows.find(r => r.symbol === 'CVX')?.changeBasis === null
      && c6.rows.find(r => r.symbol === 'GOOGL')?.changeBasis === 'prev-close-v1')
  }

  // tick が無い回（段1は判断の記録から補う）
  {
    const { m } = modelOf(mkSession({ tick: false, decMark: true }))
    const c1 = stage<CandidatesStage>(m.stages, 'candidates')
    check('tick なし・判断に印: 段1は判断の印を使う・回も印つき',
      c1.changeBasis === 'prev-close-v1' && m.round.changeBasis === 'prev-close-v1', `${c1.changeBasis}`)
    const { m: m2 } = modelOf(mkSession({ tick: false }))
    check('tick なし・判断に印なし: 段1・回とも null',
      stage<CandidatesStage>(m2.stages, 'candidates').changeBasis === null && m2.round.changeBasis === null)
  }

  // (d) 同じ銘柄が短い間に2回判断された回（tick なし＝decidedAt の近さで照合する経路）。
  //     旧実装は「判断時刻との差が±60秒に入るか」だけで見ていたため、1件の判断が2つの回の両方に
  //     一致しえた（2026-09-16 レビュー指摘1）。いまは幅を 5 秒に狭め、さらに「最も近い回」だけが採る。
  {
    const sym = 'GOOGL'
    const t1 = Date.parse('2026-09-15T18:00:00.000Z')
    const mkGroup = (at: number) => [{
      id: `d_${sym}_${at}`, timestamp: new Date(at).toISOString(), symbol: sym, action: 'watch' as const,
      price: 100, confidence: 'medium' as const, reasoning: '検査用', technicals: '', fundamentals: '',
      newsHeadlines: [] as string[],
    }]
    const mkAt = (at: number, marked: boolean): AIDecision => {
      const d: AIDecision = {
        symbol: sym, name: sym, action: 'watch', price: 100, change: 1.25,
        reasoning: '', newsInfluence: '', news: [], technicals: '', fundamentals: '',
        confidence: 'medium', sources: [], decidedAt: new Date(at).toISOString(),
      }
      if (marked) d.changeBasis = 'prev-close-v1'
      return d
    }
    // 回は2つ（t1 と t1+gap）。ticks は無いので decidedAt の近さだけで照合される
    const twoRounds = (gapMs: number, ai: AIDecision[]): AISession => ({
      ...fbase, ticks: [], decisions: ai,
      learning: { ...fbase.learning, allDecisions: [...mkGroup(t1), ...mkGroup(t1 + gapMs)] },
      watchlist: [sym], holdings: {},
    })
    const modelAt = (sess: AISession, at: number) => {
      const r = listReplayRounds(sess).find(x => Date.parse(x.at) === at)
      if (!r) throw new Error(`round ${new Date(at).toISOString()} not found`)
      return buildReplayModel(sess, r)
    }
    const basisAt = (sess: AISession, at: number) => {
      const m = modelAt(sess, at)
      return { round: m.round.changeBasis, dec: stage<DecisionsStage>(m.stages, 'decisions').changeBasis }
    }

    // (d-1) 60秒差・判断は1件（古い回のもの）。旧実装ではこの1件が新しい回にも一致していた
    {
      const sess = twoRounds(60_000, [mkAt(t1 + 2, true)])
      const older = basisAt(sess, t1)
      const newer = basisAt(sess, t1 + 60_000)
      check('60秒差・判断1件: 近い回だけ印つき',
        older.dec === 'prev-close-v1' && older.round === 'prev-close-v1', `${older.dec} / ${older.round}`)
      check('60秒差・判断1件: 遠い回には印が付かない（注記が出る）',
        newer.dec === null && newer.round === null, `${newer.dec} / ${newer.round}`)
    }

    // (d-2) 90秒差・判断2件（回ごとに1件・印の有無が違う）。取り違えずそれぞれ自分の回に付く
    {
      const sess = twoRounds(90_000, [mkAt(t1 + 90_000 + 2, false), mkAt(t1 + 2, true)])
      const older = basisAt(sess, t1)
      const newer = basisAt(sess, t1 + 90_000)
      check('90秒差・判断2件: 印つきの判断は古い回にだけ付く',
        older.dec === 'prev-close-v1' && newer.dec === null, `${older.dec} / ${newer.dec}`)
      const snap = JSON.stringify(sess)
      modelAt(sess, t1); modelAt(sess, t1 + 90_000)
      check('90秒差・判断2件: 保存値を1バイトも書き換えない', JSON.stringify(sess) === snap)
    }

    // (d-3) 差が同点（ちょうど中間）のときは時刻の早い回のものとする＝両方の回には付けない
    {
      const sess = twoRounds(6_000, [mkAt(t1 + 3_000, true)])
      const older = basisAt(sess, t1)
      const newer = basisAt(sess, t1 + 6_000)
      check('同点（中間の時刻）: 早い回にだけ付き、両方には付かない',
        older.dec === 'prev-close-v1' && newer.dec === null, `${older.dec} / ${newer.dec}`)
    }
  }

  // (e) 段1の注記は「変化率の数字が画面に出ている回」だけに出す（2026-09-16 レビュー指摘3）
  {
    const plain = stage<CandidatesStage>(modelOf(mkSession({ tick: true })).m.stages, 'candidates')
    check('印なし・変化率がある回: 段1の注記が立つ', showsLegacyChangeNote(plain) === true)
    const marked = stage<CandidatesStage>(modelOf(mkSession({ tick: true, tickMark: true })).m.stages, 'candidates')
    check('印つきの回: 段1の注記は立たない', showsLegacyChangeNote(marked) === false)
    const allFailed = mkSession({ tick: true })
    for (const r of allFailed.ticks?.[0]?.universe ?? []) { r.ok = false; r.changePercent = null; r.rank = null }
    const failedStage = stage<CandidatesStage>(modelOf(allFailed).m.stages, 'candidates')
    check('全行 取得できず（ok:false）の回: 印は無いが段1の注記は立たない（数字が無いのに注記しない）',
      failedStage.changeBasis === null && failedStage.rows.value.length === 40
      && failedStage.rows.value.every(r => r.changePercent == null) && showsLegacyChangeNote(failedStage) === false)
    const oneOk = mkSession({ tick: true })
    for (const [i, r] of (oneOk.ticks?.[0]?.universe ?? []).entries()) {
      if (i > 0) { r.ok = false; r.changePercent = null; r.rank = null }
    }
    check('1銘柄だけ取れた回: 段1の注記は立つ',
      showsLegacyChangeNote(stage<CandidatesStage>(modelOf(oneOk).m.stages, 'candidates')) === true)
    const noTick = stage<CandidatesStage>(modelOf(mkSession({ tick: false })).m.stages, 'candidates')
    check('tick の無い回: 段1の行は記録なし＝注記は立たない', showsLegacyChangeNote(noTick) === false)
  }

  // 注記の文言（RULES.md の禁止語を使わない・断定しない）
  {
    const banned = ['おすすめ', '買い時', '注目銘柄', '勝率', 'AIが当てた']
    const all = [LEGACY_CHANGE_NOTE, LEGACY_CHANGE_NOTE_SHORT, LEGACY_CHANGE_NOTE_ZERO]
    check('注記に禁止語がない', all.every(t => !banned.some(b => t.includes(b))))
    check('注記は断定せず「可能性」と書く', all.every(t => t.includes('可能性')))
    check('注記に基準の日付（2026-09-16）が入る', LEGACY_CHANGE_NOTE.includes('2026-09-16') && LEGACY_CHANGE_NOTE_SHORT.includes('2026-09-16'))
    check('段1の注記は 0.00% の但し書きも含む', LEGACY_CHANGE_NOTE.includes('0.00%') && LEGACY_CHANGE_NOTE_ZERO.includes('0.00%'))
  }

  // (a) 本番複製（印がまだ1件も無い＝全回に注記が出る）
  if (session) {
    const rs = listReplayRounds(session)
    const models = rs.map(r => buildReplayModel(session, r))
    const nullRounds = models.filter(m => m.round.changeBasis === null).length
    const markedTicks = (session.ticks ?? []).filter(t => t.changeBasis).length
    const markedDecisions = (session.decisions ?? []).filter(d => d.changeBasis).length
    console.log(`  複製: 回=${rs.length} 印の無い回=${nullRounds} 印つき tick=${markedTicks} 印つき判断=${markedDecisions}`)
    check('複製の印の有無と回の印が一致する', models.every(m =>
      m.round.changeBasis === null || (markedTicks > 0 || markedDecisions > 0)))
    if (markedTicks === 0 && markedDecisions === 0) {
      check('印がまだ無い複製では全回に注記が立つ', nullRounds === rs.length, `${nullRounds}/${rs.length}`)
      const rows = models.flatMap(m => stage<DecisionsStage>(m.stages, 'decisions').rows)
      check('複製の判断行もすべて印なし', rows.length > 0 && rows.every(r => r.changeBasis === null), `${rows.length}行`)
    }
    // 複製に印を足した写しでは立たない
    const marked: AISession = JSON.parse(JSON.stringify(session))
    for (const t of marked.ticks ?? []) t.changeBasis = 'prev-close-v1'
    for (const d of marked.decisions ?? []) d.changeBasis = 'prev-close-v1'
    const mrs = listReplayRounds(marked)
    const mm = mrs.map(r => buildReplayModel(marked, r))
    const withTick = mm.filter((_, i) => mrs[i].source === 'tick')
    check('印を足した写し: tick 由来の回は注記が立たない',
      withTick.length > 0 && withTick.every(m => m.round.changeBasis === 'prev-close-v1'),
      `${withTick.filter(m => m.round.changeBasis === 'prev-close-v1').length}/${withTick.length}`)
    check('印を足しても元の複製は変わらない', (session.ticks ?? []).every(t => !t.changeBasis))
  } else {
    console.log('  未実行（本番複製なし）: (a) の節は複製のパスを渡すと実行します')
  }
}

// ══════════════════════════════════════════════════════════════════════════
console.log("G. AI を呼ばなかった回（材料0件・stopReason 'skipped'・2026-09-17）と、旧記録（timeout / empty）の不変")
// 3種の tick を同じ形で作る。skipped は engine.ts の runTick が積む形（tick-record.ts の skippedTickAI・note）
const G_T = Date.parse('2026-09-18T13:30:00.000Z')
function gTick(kind: 'skipped' | 'timeout' | 'empty'): TickRecord {
  const t = emptyTickRecord(G_T)
  if (kind === 'skipped') {
    // 40銘柄すべて前日比が取れず候補なし・保有2銘柄だけ分析したが材料も取れなかった回
    t.universe = UNIVERSE.map(symbol => ({ symbol, changePercent: null, ok: false, rank: null }))
    t.selected = []
    t.heldAdded = ['CVX', 'XOM']
    t.contexts = t.heldAdded.map(symbol => ({ symbol, bars: 0, ma20: null, ma50: null, rsi14: null, macd: null, bb: null, fundamentalsOk: false, newsCount: 0, newsHeadlines: [], error: 'Real quote unavailable' }))
    t.knowledge = []
    t.ai = skippedTickAI()
    t.stages = [
      makeStage('candidates', G_T, G_T + 3000, false, '前日比を取得できた銘柄が無く（0/40銘柄）、候補なし・保有銘柄だけを分析（2件）'),
      makeStage('contexts', G_T + 3000, G_T + 9000, false, '0/2銘柄の材料を取得'),
      makeStage('knowledge', G_T + 9000, G_T + 9000, true, AI_SKIPPED_KNOWLEDGE_NOTE),
      makeStage('ai', G_T + 9000, G_T + 9000, false, AI_SKIPPED_NOTE),
      makeStage('trade', G_T + 9000, G_T + 9500, true, '約定0件・評価額の株価取得に失敗2銘柄（取得単価で代用）'),
    ]
    t.finishedAt = new Date(G_T + 9600).toISOString()
    return t
  }
  t.universe = UNIVERSE.map((symbol, i) => i === 39
    ? { symbol, changePercent: null, ok: false, rank: null }
    : { symbol, changePercent: Number(((i % 7) - 3 + i / 100).toFixed(2)), ok: true, rank: i + 1 })
  t.selected = ['NVDA', 'TSLA']
  t.heldAdded = ['CVX', 'XOM']
  t.contexts = [...t.selected, ...t.heldAdded].map((symbol, i) => i === 0
    ? { symbol, bars: 0, ma20: null, ma50: null, rsi14: null, macd: null, bb: null, fundamentalsOk: false, newsCount: 0, newsHeadlines: [], error: 'Real quote unavailable' }
    : { symbol, bars: 63, ma20: 1, ma50: 1, rsi14: 50, macd: null, bb: null, fundamentalsOk: true, newsCount: 3, newsHeadlines: ['[1h前] x (y)'] })
  t.knowledge = [{ id: 'km_1', title: '買う前に降りる条件を決める' }]
  t.ai = kind === 'timeout'
    ? { model: 'claude-haiku-4-5-20251001', inputTokens: null, outputTokens: null, stopReason: 'timeout', ms: 40_004, decisionsReturned: 0, decisionsExpected: 3, promptChars: 6200, responseChars: null }
    : { model: 'claude-haiku-4-5-20251001', inputTokens: 5000, outputTokens: 10, stopReason: 'empty', ms: 12_000, decisionsReturned: 0, decisionsExpected: 3, promptChars: 6200, responseChars: 20 }
  t.stages = [
    makeStage('candidates', G_T, G_T + 3000, true, '39/40銘柄の前日比を取得・候補2件・保有から2件'),
    makeStage('contexts', G_T + 3000, G_T + 9000, true, '3/4銘柄の材料を取得'),
    makeStage('knowledge', G_T + 9000, G_T + 9200, true, '48件から1件を提示'),
    makeStage('ai', G_T + 9200, G_T + 49_204, false, kind === 'timeout' ? 'Claude timed out after 40000ms' : '返事あり(stop=end_turn, 20字)だが判断を1件も救出できず'),
  ]
  if (kind === 'empty') t.stages.push(makeStage('trade', G_T + 49_204, G_T + 49_500, true, '約定0件'))
  t.finishedAt = new Date(G_T + 49_600).toISOString()
  return t
}
const gBase = syntheticSession()
function gModel(kind: 'skipped' | 'timeout' | 'empty') {
  const s: AISession = { ...gBase, ticks: [gTick(kind)] }
  const rounds = listReplayRounds(s)
  return { s, rounds, m: buildReplayModel(s, rounds[0], { rounds }) }
}
{
  const { s, rounds, m } = gModel('skipped')
  const c4 = stage<KnowledgeStage>(m.stages, 'knowledge')
  const c5 = stage<AiStage>(m.stages, 'ai')
  const c6 = stage<DecisionsStage>(m.stages, 'decisions')
  check('skipped: 判断0件の回として先頭に立つ（tick 由来）', rounds[0].source === 'tick' && rounds[0].decisions.length === 0)
  check('skipped: 失敗ではないので state round（tickCount が進んだ回。watchlist / holdings はこの回の結果）', findStateRound(s, rounds)?.id === rounds[0].id && m.round.isStateRound)
  check('skipped: 段は 1〜6（売買なし）', m.stages.map(x => x.no).join(',') === '1,2,3,4,5,6', m.stages.map(x => x.no).join(','))
  check('skipped: 段4・段5・段6 の skipped が true', c4.skipped === true && c5.skipped === true && c6.skipped === true)
  check("skipped: 段6 failure は null（'skipped' は失敗扱いに入れない）", c6.failure === null, JSON.stringify(c6.failure))
  check('skipped: 段5 見出しは「材料 0件のため AI に渡さない」', c5.title === '材料を取得できた銘柄が0件のため、AI に渡さない', c5.title)
  check('skipped: 段5 渡した銘柄 0（record）・期待 0（record）・所要 0ms（record）',
    c5.symbolsSent.provenance === 'record' && c5.symbolsSent.value.length === 0 && c5.expected.provenance === 'record' && c5.expected.value === 0
    && c5.ms.provenance === 'record' && c5.ms.value === 0)
  check("skipped: 段5 model / stopReason は記録の値そのまま（'none' / 'skipped'）＝画面が和文にする", c5.model.value === 'none' && c5.stopReason.value === 'skipped' && c5.stopReason.provenance === 'record')
  check('skipped: 段5 トークン・文字数は null（record）', c5.inputTokens.value === null && c5.outputTokens.value === null && c5.promptChars.value === null && c5.responseChars.value === null)
  check('skipped: 段6 見出し「返ってきた判断　なし」・印「AI には聞いていない」', c6.title === '返ってきた判断　なし' && c6.sourceLabel === 'AI には聞いていない', `${c6.title} / ${c6.sourceLabel}`)
  check('skipped: 段6 の行は保有2銘柄（分析対象）で判断は none・保有中 true', c6.rows.length === 2 && c6.rows.every(r => r.provenance === 'none' && r.held === true))
  check('skipped: 段4 知識 0 件（record）・所要 0ms', c4.items.provenance === 'record' && c4.items.value.length === 0 && c4.ms.value === 0)
  check('skipped: 詳しく見る銘柄は保有の先頭（CVX）・材料は記録なし', m.focusSymbol === 'CVX' && stage<MaterialsStage>(m.stages, 'materials').provenance === 'none')
  check('skipped: 段6 の focus は無い（判断が無い）', c6.focus === null)
  const json = JSON.stringify(m)
  // 文字列の値（キーではない）を全部集める。'skipped' を含む値は記録の stopReason の 1 つだけ＝見出し・印・注記には使っていない
  const strings: string[] = []
  const walk = (v: unknown) => {
    if (typeof v === 'string') strings.push(v)
    else if (Array.isArray(v)) v.forEach(walk)
    else if (v && typeof v === 'object') Object.values(v).forEach(walk)
  }
  walk(m)
  check("skipped: モデルの文字列の値で英語の skipped を含むのは記録の stopReason の値 1 つだけ（文言には使わない）",
    JSON.stringify(strings.filter(s => /skipped/i.test(s))) === '["skipped"]', JSON.stringify(strings.filter(s => /skipped/i.test(s))))
  check("skipped: モデルの文言に「打ち切」が無い（打ち切りではなく、聞いていない）", !/打ち切/.test(json))
  check('skipped: 文言に禁止語（おすすめ・買い時・注目銘柄・勝率）が無い', !['おすすめ', '買い時', '注目銘柄', '勝率'].some(w => json.includes(w)))
}
{
  // 旧記録（timeout / empty）は変更前と同じ値のまま（2026-09-17 の変更前に取った値と突き合わせる）
  for (const kind of ['timeout', 'empty'] as const) {
    const { s, rounds, m } = gModel(kind)
    const c4 = stage<KnowledgeStage>(m.stages, 'knowledge')
    const c5 = stage<AiStage>(m.stages, 'ai')
    const c6 = stage<DecisionsStage>(m.stages, 'decisions')
    check(`${kind}: 段4・段5・段6 の skipped は false`, c4.skipped === false && c5.skipped === false && c6.skipped === false)
    check(`${kind}: 段6 failure は stopReason '${kind}' と段 'ai' の note（変更前と同じ）`,
      c6.failure?.stopReason === kind && c6.failure?.note === (kind === 'timeout' ? 'Claude timed out after 40000ms' : '返事あり(stop=end_turn, 20字)だが判断を1件も救出できず'), JSON.stringify(c6.failure))
    check(`${kind}: 段6 見出し「返ってきた判断　なし」・印「判断は記録されていない」（変更前と同じ）`, c6.title === '返ってきた判断　なし' && c6.sourceLabel === '判断は記録されていない')
    check(`${kind}: 段5 見出しは「3銘柄分の材料をまとめて、1回で AI に渡す」（変更前と同じ）`, c5.title === '3銘柄分の材料をまとめて、1回で AI に渡す', c5.title)
    check(`${kind}: 段5 stopReason '${kind}'（record）・期待 3`, c5.stopReason.value === kind && c5.expected.value === 3)
    check(`${kind}: state round か（timeout は直前の回・empty はこの回）`, kind === 'timeout' ? !m.round.isStateRound : m.round.isStateRound)
    check(`${kind}: 段6 の行は分析対象4銘柄すべて none`, c6.rows.length === 4 && c6.rows.every(r => r.provenance === 'none'))
    check(`${kind}: session を変更しない`, JSON.stringify(s.ticks) === JSON.stringify([gTick(kind)]))
    void rounds
  }
}
{
  // 実装の守り: 失敗扱いの集合に 'skipped' を足していない（足すと段6が「打ち切られ」と書く）
  const src = fs.readFileSync(path.resolve(__dirname, '../lib/ai-trader/replay-model.ts'), 'utf8')
  const line = src.split('\n').find(l => /const FAILED_STOP_REASONS\s*=/.test(l)) ?? ''
  check("FAILED_STOP_REASONS は timeout / error / empty の3つで、'skipped' を含まない",
    /new Set\(\['timeout', 'error', 'empty'\]\)/.test(line) && !line.includes('skipped'), line.trim())
  check("tickThrew（state round の判定）は timeout / error だけを見る（'skipped' も 'empty' も進んだ回）",
    /stopReason === 'timeout' \|\| tick\.ai\.stopReason === 'error'\)/.test(src) && !/tickThrew[\s\S]{0,200}skipped/.test(src))
  check("skipped の判定は tick-record.ts の isAiSkipped を使う（'skipped' の文字列を手書きしない）",
    src.includes("import { isAiSkipped, type ChangeBasis, type TickRecord, type TickStage } from './tick-record'")
    && !/['"]skipped['"]/.test(src.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')))
}

// ══════════════════════════════════════════════════════════════════════════
console.log('H. 部品の静的描画（ReplayStages を react-dom/server で描き、文言を確かめる。next build / next dev は使わない）')
{
  type RenderKit = {
    React: typeof import('react')
    renderToStaticMarkup: (el: unknown) => string
    ReplayStages: (props: Record<string, unknown>) => unknown
    planFor: (m: unknown) => unknown[]
    completePhase: (plan: unknown[]) => unknown
  }
  let kit: RenderKit | null = null
  try {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const React = require('react') as RenderKit['React']
    const { renderToStaticMarkup } = require('react-dom/server') as { renderToStaticMarkup: RenderKit['renderToStaticMarkup'] }
    const stagesMod = require('../components/watch/replay/ReplayStages') as { default: RenderKit['ReplayStages']; planFor: RenderKit['planFor'] }
    const clockMod = require('../components/watch/replay/useReplayClock') as { completePhase: RenderKit['completePhase'] }
    /* eslint-enable @typescript-eslint/no-require-imports */
    kit = { React, renderToStaticMarkup, ReplayStages: stagesMod.default, planFor: stagesMod.planFor, completePhase: clockMod.completePhase }
  } catch (e) {
    check('部品（ReplayStages / useReplayClock / react-dom）を読み込めた', false, e instanceof Error ? e.message : String(e))
  }
  if (kit) {
    const render = (kind: 'skipped' | 'timeout' | 'empty') => {
      const { m } = gModel(kind)
      const plan = kit!.planFor(m)
      const phase = kit!.completePhase(plan)
      const html = kit!.renderToStaticMarkup(kit!.React.createElement(kit!.ReplayStages as never, { model: m, phase, history: 'ready', markers: [], instant: false }))
      const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
      return { html, text, plan: plan as Array<{ key: string; steps: Array<{ key: string; ms: number }> }> }
    }
    const sk = render('skipped')
    check('skipped: 描画できる（段 6 つ）', (sk.html.match(/data-stage="/g) ?? []).length === 6)
    check("skipped: 画面に英語の 'skipped' が出ない", !/skipped/i.test(sk.text), sk.text.match(/.{0,40}skipped.{0,40}/i)?.[0])
    check("skipped: 画面に 'none'（model の目印）が文字として出ない", !/\bnone\b/.test(sk.text))
    check('skipped: 「打ち切られ」「打ち切り」が出ない', !/打ち切/.test(sk.text))
    check('skipped: 段5 に「AI は呼ばなかった」', sk.text.includes('AI は呼ばなかった'))
    check('skipped: 段5 に返事の行（「返事:」「所要時間は記録なし」「モデル」「終わり方」「トークン」「判断の数」）が無い',
      !['返事:', '所要時間は記録なし', 'モデル', '終わり方', 'トークン', '判断の数'].some(w => sk.text.includes(w)), sk.text.match(/返事:|所要時間は記録なし|モデル|終わり方|トークン|判断の数/)?.[0])
    check('skipped: 段6 に「材料が0件のため AI には聞いていません」', sk.text.includes('材料が0件のため AI には聞いていません'))
    check('skipped: 段4 に「知識は読んでいません」（「今回は 0 件」とは書かない）', sk.text.includes('知識は読んでいません') && !sk.text.includes('今回は 0 件'))
    check('skipped: 段6 の行は「材料を取得できず」（「判断の記録なし」とは書かない）', sk.text.includes('材料を取得できず') && !sk.text.includes('判断の記録なし'))
    const aiPlan = sk.plan.find(p => p.key === 'ai')
    check('skipped: 再生の計画で段5は「考えている」時間を置かない（gather 0・think 0.6 秒）', aiPlan?.steps.map(s => `${s.key}:${s.ms}`).join(',') === 'gather:0,think:600', JSON.stringify(aiPlan))

    // 旧記録: timeout は変更前と同じ文。empty（stop=end_turn・渡した3銘柄）は 2026-09-18 から出し分けて中立の文（I 節）
    const em = render('empty')
    const to = render('timeout')
    check('empty(stop=end_turn): 段6 は「AI の返事に、使える判断が1件もありませんでした」（2026-09-18〜。打ち切られとは書かない）',
      em.text.includes('AI の返事に、使える判断が1件もありませんでした') && !/打ち切られ/.test(em.text))
    check('timeout: 段6 は変更前どおり「…（時間切れで打ち切り（timeout）・Claude timed out after 40000ms）」',
      to.text.includes('AI の返事が打ち切られ、この回の判断は記録なし（時間切れで打ち切り（timeout）・Claude timed out after 40000ms）'))
    check('empty / timeout: 段5 の返事の行と表（終わり方・判断の数）は変更前どおり出る',
      [em.text, to.text].every(t => t.includes('返事:') && t.includes('終わり方') && t.includes('判断の数')))
    check('empty / timeout: 「AI は呼ばなかった」「AI には聞いていません」は出ない', [em.text, to.text].every(t => !t.includes('AI は呼ばなかった') && !t.includes('AI には聞いていません')))
    check('empty / timeout: 段5 の計画は変更前どおり think 1.8 秒', [em.plan, to.plan].every(p => p.find(x => x.key === 'ai')?.steps.find(s => s.key === 'think')?.ms === 1800))
  }
}

// ══════════════════════════════════════════════════════════════════════════
// 静的描画の道具（H と同じ。I / J でも使うので関数に）。next build / next dev は使わない
type RenderKit = {
  React: typeof import('react')
  renderToStaticMarkup: (el: unknown) => string
  ReplayStages: (props: Record<string, unknown>) => unknown
  planFor: (m: unknown) => unknown[]
  completePhase: (plan: unknown[]) => unknown
  listReplayRounds: typeof listReplayRounds
  buildReplayModel: typeof buildReplayModel
}
/* eslint-disable @typescript-eslint/no-require-imports */
function loadKit(root: string): RenderKit {
  const React = require('react') as RenderKit['React']
  const { renderToStaticMarkup } = require('react-dom/server') as { renderToStaticMarkup: RenderKit['renderToStaticMarkup'] }
  const stagesMod = require(path.join(root, 'components/watch/replay/ReplayStages')) as { default: RenderKit['ReplayStages']; planFor: RenderKit['planFor'] }
  const clockMod = require(path.join(root, 'components/watch/replay/useReplayClock')) as { completePhase: RenderKit['completePhase'] }
  const modelMod = require(path.join(root, 'lib/ai-trader/replay-model')) as { listReplayRounds: RenderKit['listReplayRounds']; buildReplayModel: RenderKit['buildReplayModel'] }
  return { React, renderToStaticMarkup, ReplayStages: stagesMod.default, planFor: stagesMod.planFor, completePhase: clockMod.completePhase,
    listReplayRounds: modelMod.listReplayRounds, buildReplayModel: modelMod.buildReplayModel }
}
/* eslint-enable @typescript-eslint/no-require-imports */
/** その kit の replay-model で回を組み、その kit の ReplayStages で描く（完成状態）。回ごとの HTML */
function renderSession(kit: RenderKit, s: AISession): string[] {
  const rounds = kit.listReplayRounds(s)
  return rounds.map(r => {
    const m = kit.buildReplayModel(s, r, { rounds })
    const phase = kit.completePhase(kit.planFor(m))
    return kit.renderToStaticMarkup(kit.React.createElement(kit.ReplayStages as never, { model: m, phase, history: 'ready', markers: [], instant: false }))
  })
}
const htmlText = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
/** data-stage ごとの HTML 片（見出し＋本文）。段の中だけを見るための切り分け */
function stageHtml(html: string, key: string): string {
  const i = html.indexOf(`data-stage="${key}"`)
  if (i < 0) return ''
  const j = html.indexOf('data-stage="', i + 1)
  return j < 0 ? html.slice(i) : html.slice(i, j)
}
const PROJECT_ROOT = path.resolve(__dirname, '..')

// ══════════════════════════════════════════════════════════════════════════
console.log("I. 'empty' の旧記録の出し分け（2026-09-18・表示の文だけ。保存値は書き換えない）")
// gTick('empty') と同じ形で、記録の中の手掛かり（TickAI.decisionsExpected・段 'ai' の note の stop=）だけを変える
type EmptyVariant = 'no-symbols' | 'max-tokens' | 'end-turn' | 'cli' | 'no-note' | 'stop-unknown'
const EMPTY_VARIANTS: Array<{ v: EmptyVariant; kind: EmptyReplyKind; expect: string; truncated: boolean }> = [
  { v: 'no-symbols',   kind: 'no-symbols', expect: 'AI に渡した銘柄が0件だったため、判断は返ってきませんでした', truncated: false },
  { v: 'max-tokens',   kind: 'max-tokens', expect: 'AI の返事が打ち切られ、この回の判断は記録なし（返事の上限に達して打ち切られ、判断を1件も読めなかった）', truncated: true },
  { v: 'end-turn',     kind: 'other',      expect: 'AI の返事に、使える判断が1件もありませんでした', truncated: false },
  { v: 'cli',          kind: 'other',      expect: 'AI の返事に、使える判断が1件もありませんでした', truncated: false },
  { v: 'no-note',      kind: 'unknown',    expect: 'AI の返事に、使える判断が1件もありませんでした', truncated: false },
  { v: 'stop-unknown', kind: 'unknown',    expect: 'AI の返事に、使える判断が1件もありませんでした', truncated: false },
]
function iTick(v: EmptyVariant): TickRecord {
  const t = gTick('empty')
  const ai = t.ai as NonNullable<TickRecord['ai']>
  const aiStage = t.stages.find(s => s.name === 'ai') as NonNullable<TickRecord['stages'][number]>
  switch (v) {
    case 'no-symbols':
      // 材料0件でも呼んでいた時期の回: 候補なし・保有2銘柄の材料も取れず decisionsExpected 0。AI は空の配列（2字）を返した
      t.selected = []
      t.contexts = t.heldAdded.map(symbol => ({ symbol, bars: 0, ma20: null, ma50: null, rsi14: null, macd: null, bb: null, fundamentalsOk: false, newsCount: 0, newsHeadlines: [], error: 'Real quote unavailable' }))
      t.ai = { ...ai, decisionsExpected: 0, promptChars: 3100, responseChars: 2, outputTokens: 3 }
      aiStage.note = '返事あり(stop=end_turn, 2字)だが判断を1件も救出できず'
      break
    case 'max-tokens':
      t.ai = { ...ai, outputTokens: 3500, responseChars: 9000 }
      aiStage.note = '返事あり(stop=max_tokens, 9000字)だが判断を1件も救出できず'
      break
    case 'end-turn': break // gTick('empty') そのもの（stop=end_turn, 20字）
    case 'cli':
      t.ai = { ...ai, model: 'cli', inputTokens: null, outputTokens: null }
      aiStage.note = '返事あり(stop=cli, 20字)だが判断を1件も救出できず'
      break
    case 'no-note': delete aiStage.note; break
    case 'stop-unknown': aiStage.note = '返事あり(stop=unknown, 20字)だが判断を1件も救出できず'; break
  }
  return t
}
{
  // 純関数
  check("readStopFromAiNote: engine の note から stop= を読む", readStopFromAiNote('返事あり(stop=max_tokens, 9000字)だが判断を1件も救出できず') === 'max_tokens'
    && readStopFromAiNote('返事あり(stop=end_turn)だが判断の組み立てに失敗') === 'end_turn' && readStopFromAiNote('3銘柄中 2 件のみ救出 (stop=cli)') === 'cli')
  check('readStopFromAiNote: 無い・読めない → null', readStopFromAiNote(undefined) === null && readStopFromAiNote(null) === null && readStopFromAiNote('Claude timed out after 40000ms') === null)
  check("classifyEmptyReply: decisionsExpected 0 は note より優先して 'no-symbols'", classifyEmptyReply({ decisionsExpected: 0 }, '返事あり(stop=max_tokens, 2字)だが…') === 'no-symbols')
  check("classifyEmptyReply: max_tokens → 'max-tokens'／end_turn・cli → 'other'／無し・unknown → 'unknown'",
    classifyEmptyReply({ decisionsExpected: 3 }, '返事あり(stop=max_tokens, 9000字)') === 'max-tokens'
    && classifyEmptyReply({ decisionsExpected: 3 }, '返事あり(stop=end_turn, 20字)') === 'other'
    && classifyEmptyReply({ decisionsExpected: 3 }, '返事あり(stop=cli, 20字)') === 'other'
    && classifyEmptyReply({ decisionsExpected: 3 }, undefined) === 'unknown'
    && classifyEmptyReply({ decisionsExpected: 3 }, '返事あり(stop=unknown, 5字)') === 'unknown')

  let kit: RenderKit | null = null
  try { kit = loadKit(PROJECT_ROOT) } catch (e) { check('部品を読み込めた', false, e instanceof Error ? e.message : String(e)) }
  const NO_ENGLISH = /\b(empty|max_tokens|end_turn|skipped|unknown)\b/i
  for (const { v, kind, expect, truncated } of EMPTY_VARIANTS) {
    const s: AISession = { ...gBase, ticks: [iTick(v)] }
    const rounds = listReplayRounds(s)
    const m = buildReplayModel(s, rounds[0], { rounds })
    const c6 = stage<DecisionsStage>(m.stages, 'decisions')
    check(`${v}: 段6 failure は stopReason 'empty'・emptyKind '${kind}'`, c6.failure?.stopReason === 'empty' && c6.failure?.emptyKind === kind, JSON.stringify(c6.failure))
    check(`${v}: skipped ではない・見出し「返ってきた判断　なし」・印「判断は記録されていない」`, c6.skipped === false && c6.title === '返ってきた判断　なし' && c6.sourceLabel === '判断は記録されていない')
    check(`${v}: session（保存値）を変更しない`, JSON.stringify(s.ticks) === JSON.stringify([iTick(v)]))
    if (!kit) continue
    const html = renderSession(kit, s)[0]
    const text = htmlText(html)
    const seg6 = htmlText(stageHtml(html, 'decisions'))
    check(`${v}: 段6 に「${expect}」`, seg6.includes(expect), seg6.slice(0, 200))
    check(`${v}: 「打ち切られ」が${truncated ? '出る' : '出ない'}（画面全体）`, /打ち切られ/.test(text) === truncated, text.match(/.{0,30}打ち切られ.{0,30}/)?.[0])
    check(`${v}: 画面に英語の empty / max_tokens / end_turn / skipped / unknown が出ない`, !NO_ENGLISH.test(text), text.match(new RegExp(`.{0,30}${NO_ENGLISH.source}.{0,30}`, 'i'))?.[0])
    check(`${v}: 段5 の終わり方は「返事はあったが判断を1件も読めなかった」（英語なし）`, htmlText(stageHtml(html, 'ai')).includes('終わり方 返事はあったが判断を1件も読めなかった'))
    check(`${v}: 「AI は呼ばなかった」「AI には聞いていません」は出ない（呼んだ回）`, !text.includes('AI は呼ばなかった') && !text.includes('AI には聞いていません'))
  }
  // 出し分けの実装の守り: 4 つの文は ReplayStages の EMPTY_REPLY_TEXT に集約し、段6 の失敗の行だけがそれを使う
  const stagesSrc = fs.readFileSync(path.resolve(__dirname, '../components/watch/replay/ReplayStages.tsx'), 'utf8')
  const codeLines = stagesSrc.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l))
  const truncLines = codeLines.filter(l => l.includes('打ち切られ'))
  check('ReplayStages: コード行で「打ち切られ」を書くのは EMPTY_REPLY_TEXT.maxTokens と timeout / error の既定文の 2 行だけ（JSX に直書きしない）',
    truncLines.length === 2 && truncLines.some(l => l.includes('maxTokens:')) && truncLines.some(l => l.includes('return `AI の返事が打ち切られ、この回の判断は記録なし（${stopReasonLabel'))
    && !/<p[^>]*>\s*AI の返事が打ち切られ/.test(stagesSrc),
    truncLines.map(l => l.trim().slice(0, 60)).join(' / '))

  // ③の reviewer の suggestion: skipped の回は段4・段5 の見出しに「実測 0.0秒」を出さず、段4 の見出しも変える
  {
    const { m, s } = gModel('skipped')
    const c4 = stage<KnowledgeStage>(m.stages, 'knowledge')
    check('skipped: 段4 の見出しは「AI を呼ばないため、知識は読まない」', c4.title === 'AI を呼ばないため、知識は読まない', c4.title)
    check('skipped: 段4 の ms は記録の 0（モデルは変えず、画面が出さない）', c4.ms.provenance === 'record' && c4.ms.value === 0)
    if (kit) {
      const html = renderSession(kit, s)[0]
      const seg = (k: string) => htmlText(stageHtml(html, k))
      check('skipped: 段4・段5 の見出しに「実測」が無い', !seg('knowledge').includes('実測') && !seg('ai').includes('実測'), `${seg('knowledge').slice(0, 120)} / ${seg('ai').slice(0, 120)}`)
      check('skipped: 段1・段2 には「実測」が残る（隠すのは呼ばなかった段だけ）', seg('candidates').includes('実測 3.0秒') && seg('materials').includes('実測 6.0秒'),
        `${seg('candidates').slice(0, 100)} / ${seg('materials').slice(0, 100)}`)
      check('skipped: 段4 に見出し「AI を呼ばないため、知識は読まない」', seg('knowledge').includes('AI を呼ばないため、知識は読まない'))
      check("skipped: 画面に英語の skipped / empty が出ない", !NO_ENGLISH.test(htmlText(html)))
    }
    // 変更前の固定文が skipped 以外では残る
    const { m: mt } = gModel('timeout')
    check('timeout: 段4 の見出しは変更前どおり「過去に学んだ知識から、今回に関係するものを選ぶ」', stage<KnowledgeStage>(mt.stages, 'knowledge').title === '過去に学んだ知識から、今回に関係するものを選ぶ')
  }
}

// ══════════════════════════════════════════════════════════════════════════
// 変更前の版（BASELINE_COMMIT ＝ ③「材料が0件の回は AI を呼ばない」出荷時点。この出し分け（2026-09-18）の直前）の
// 描画部品を git から一時ディレクトリに取り出し、同じ記録を両方の版で描いて HTML を突き合わせる。
// 一時ディレクトリは os.tmpdir() 直下に作り、終わったら消す。node_modules は junction（Windows の
// ディレクトリの近道。中身は複製しない）で借り、消すときは junction だけ外す（先の node_modules には触れない）。
const BASELINE_COMMIT = '7979c39'
const BASELINE_FILES = [
  'components/watch/replay/ReplayStages.tsx', 'components/watch/replay/ReplayChart.tsx', 'components/watch/replay/useReplayClock.ts',
  'components/chartTheme.ts',
  'lib/ai-trader/replay-model.ts', 'lib/ai-trader/tick-record.ts', 'lib/ai-trader/universe.ts', 'lib/ai-trader/ai-config.ts',
  'lib/ai-trader/fundamentals-parse.ts',
]
console.log(`J. 'empty' 以外の旧記録（timeout / error / 判断つき / 一部打ち切り / tick なし）の描画は変更前（${BASELINE_COMMIT}）とバイト一致`)
function withBaselineKit<T>(fn: (kit: RenderKit) => T): T | null {
  try {
    execFileSync('git', ['cat-file', '-e', `${BASELINE_COMMIT}^{commit}`], { cwd: PROJECT_ROOT, stdio: 'ignore' })
  } catch {
    console.log(`  未実行: git で ${BASELINE_COMMIT} を読めない（浅い複製か git なし）`)
    return null
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'investsim-replay-baseline-'))
  const dirPosix = dir.replace(/\\/g, '/')
  const junction = path.join(dir, 'node_modules')
  try {
    for (const f of BASELINE_FILES) {
      const src = execFileSync('git', ['show', `${BASELINE_COMMIT}:${f}`], { cwd: PROJECT_ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
      // '@/…' は tsconfig の paths（cwd 基準）で今の版に解決されてしまうので、取り出した木の絶対パスに書き換える。
      // tsx は tsconfig の jsx: react-jsx をプロジェクトの中のファイルにしか当てないため、外に置いた .tsx は古い方式
      // （React.createElement）に変換される。React を読み込んでおけばどちらの方式でも動く（描画結果は同じ）
      const rewritten = (f.endsWith('.tsx') ? "import React from 'react'\n" : '') + src.replace(/from '@\//g, `from '${dirPosix}/`)
      const out = path.join(dir, f)
      fs.mkdirSync(path.dirname(out), { recursive: true })
      fs.writeFileSync(out, rewritten)
    }
    fs.symlinkSync(path.join(PROJECT_ROOT, 'node_modules'), junction, 'junction')
    return fn(loadKit(dir))
  } finally {
    // junction を先に外してから残りを消す（rmSync は junction の先に入らないが、念のため順序で守る）
    try { fs.unlinkSync(junction) } catch { try { fs.rmdirSync(junction) } catch { /* 作られていない */ } }
    let junctionGone = false
    try { fs.lstatSync(junction) } catch { junctionGone = true }
    if (junctionGone) fs.rmSync(dir, { recursive: true, force: true })
    else console.log(`  警告: ${junction} を外せなかったので一時ディレクトリを残す`)
  }
}
/** 判断つき（end_turn・3/3）／一部打ち切り（max_tokens・2/3）／error の tick を gTick('empty') の形から作る */
function jTick(kind: 'error' | 'decided' | 'partial'): { tick: TickRecord; decisions: AIDecision[]; records: AISession['learning']['allDecisions'] } {
  const t = gTick('empty')
  const ai = t.ai as NonNullable<TickRecord['ai']>
  const decidedAt = new Date(G_T + 21_200).toISOString()
  const syms = kind === 'partial' ? ['TSLA', 'CVX'] : ['TSLA', 'CVX', 'XOM']
  const mkDecision = (symbol: string, i: number): AIDecision => ({
    symbol, name: symbol, action: i === 0 ? 'watch' : 'hold', price: 100 + i, change: 1.5 - i, changeBasis: 'prev-close-v1',
    reasoning: `検査用の理由 ${symbol}`, newsInfluence: '', news: [], technicals: '上昇トレンド（価格>MA20>MA50）・RSI55中立。',
    fundamentals: 'PER=20.6x | ROE=12.2% | fmt=2', confidence: 'medium', sources: [], knowledgeRefs: [], tickId: t.id, decidedAt,
  })
  const mkRecord = (symbol: string, i: number) => ({
    id: `d_${symbol}_${G_T}`, timestamp: new Date(G_T + 21_202).toISOString(), symbol, action: (i === 0 ? 'watch' : 'hold') as 'watch' | 'hold', price: 100 + i,
    confidence: 'medium' as const, reasoning: `検査用の理由 ${symbol}`, technicals: '上昇トレンド（価格>MA20>MA50）・RSI55中立。',
    fundamentals: 'PER=20.6x | ROE=12.2% | fmt=2', newsHeadlines: ['[1h前] x (y)'],
  })
  const aiStage = t.stages.find(s => s.name === 'ai') as NonNullable<TickRecord['stages'][number]>
  if (kind === 'error') {
    t.ai = { ...ai, inputTokens: null, outputTokens: null, stopReason: 'error', ms: 1200, responseChars: null }
    aiStage.ok = false; aiStage.note = 'Error: 500 Internal Server Error'
    t.stages = t.stages.filter(s => s.name !== 'trade')
    return { tick: t, decisions: [], records: [] }
  }
  t.ai = { ...ai, outputTokens: kind === 'partial' ? 3500 : 2800, stopReason: kind === 'partial' ? 'max_tokens' : 'end_turn', decisionsReturned: syms.length, responseChars: 4000 }
  t.changeBasis = 'prev-close-v1'
  aiStage.ok = true
  if (kind === 'partial') aiStage.note = '3銘柄中 2 件のみ救出 (stop=max_tokens)'; else delete aiStage.note
  t.decisionIds = syms.map(s => decisionIdFor(s, decidedAt))
  return { tick: t, decisions: syms.map(mkDecision), records: syms.map(mkRecord) }
}
function jSession(kind: 'timeout' | 'error' | 'decided' | 'partial' | 'no-tick' | 'empty' | 'skipped'): AISession {
  if (kind === 'no-tick') return { ...gBase, ticks: [] }
  if (kind === 'timeout' || kind === 'empty' || kind === 'skipped') return { ...gBase, ticks: [gTick(kind)] }
  const { tick, decisions, records } = jTick(kind)
  return {
    ...gBase, ticks: [tick], decisions, lastTickAt: tick.finishedAt as string, tickCount: 73,
    learning: { ...gBase.learning, allDecisions: [...records, ...gBase.learning.allDecisions] },
  }
}
{
  const cur = loadKit(PROJECT_ROOT)
  const kinds = ['timeout', 'error', 'decided', 'partial', 'no-tick'] as const
  const curHtml = Object.fromEntries(kinds.map(k => [k, renderSession(cur, jSession(k))])) as Record<typeof kinds[number], string[]>
  const curEmpty = renderSession(cur, jSession('empty'))
  const curSkipped = renderSession(cur, jSession('skipped'))
  check('判断つき: 段6 は 3/3 で失敗なし（比較の題材が意図どおり）', (() => {
    const s = jSession('decided'); const r = listReplayRounds(s); const m = buildReplayModel(s, r[0], { rounds: r }); const c6 = stage<DecisionsStage>(m.stages, 'decisions')
    return c6.failure === null && c6.returned === 3 && c6.expected.value === 3 && c6.rows.filter(x => x.provenance === 'record').length === 3
  })())
  check('一部打ち切り: 段6 は 2/3・失敗なし・段5 の終わり方は「返事の上限で打ち切り（max_tokens）」のまま（empty ではないので変えない）', (() => {
    const s = jSession('partial'); const r = listReplayRounds(s); const m = buildReplayModel(s, r[0], { rounds: r }); const c6 = stage<DecisionsStage>(m.stages, 'decisions')
    return c6.failure === null && c6.returned === 2 && c6.expected.value === 3 && htmlText(curHtml.partial[0]).includes('終わり方 返事の上限で打ち切り（max_tokens）')
  })())
  check('error: 段6 は変更前どおり「AI の返事が打ち切られ、この回の判断は記録なし（呼び出しに失敗（error）・Error: 500 Internal Server Error）」',
    htmlText(curHtml.error[0]).includes('AI の返事が打ち切られ、この回の判断は記録なし（呼び出しに失敗（error）・Error: 500 Internal Server Error）'))
  check('tick なし: 回が 1 つ描ける', curHtml['no-tick'].length === 1 && (curHtml['no-tick'][0].match(/data-stage="/g) ?? []).length === 6)

  const base = withBaselineKit(kit => ({
    html: Object.fromEntries(kinds.map(k => [k, renderSession(kit, jSession(k))])) as Record<typeof kinds[number], string[]>,
    empty: renderSession(kit, jSession('empty')),
    skipped: renderSession(kit, jSession('skipped')),
  }))
  if (base) {
    const md5 = (s: string) => crypto.createHash('md5').update(s).digest('hex').slice(0, 12)
    for (const k of kinds) {
      const same = curHtml[k].length === base.html[k].length && curHtml[k].every((h, i) => h === base.html[k][i])
      check(`${k}: 変更前（${BASELINE_COMMIT}）と HTML がバイト一致（${curHtml[k].length} 回・md5 ${curHtml[k].map(md5).join(',')}）`, same,
        same ? '' : `今 ${curHtml[k].map(md5).join(',')} / 前 ${base.html[k].map(md5).join(',')}`)
    }
    // 比較が本物であることの確認: 出し分けの対象（empty）と skipped は変更前と違う HTML になる
    check("検査の妥当性: 'empty'（stop=end_turn）は変更前と HTML が違う（変更前は「打ち切られ…（empty）」）", curEmpty[0] !== base.empty[0] && /打ち切られ/.test(htmlText(base.empty[0])) && !/打ち切られ/.test(htmlText(curEmpty[0])))
    check("検査の妥当性: 'skipped' は変更前と HTML が違う（段4 の見出し・実測の札）", curSkipped[0] !== base.skipped[0] && htmlText(stageHtml(base.skipped[0], 'knowledge')).includes('実測 0.0秒') && !htmlText(stageHtml(curSkipped[0], 'knowledge')).includes('実測'))
  }
}

console.log('')
console.log(`PASS ${passed} 件 / FAIL ${failed} 件`)
if (failed) { process.exit(1) }
console.log('すべてPASS')
