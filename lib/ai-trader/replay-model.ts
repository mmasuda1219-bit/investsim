// 分析の過程の再生（DESIGN.md §6-19）の計算部分。入力（AISession と回）だけで答えが決まる純関数。
//
// このファイルはクライアント部品（/watch）から読まれる。engine.ts は child_process と server-only を
// 読み込むため実体を import せず、型だけを取る（`import type`）。I/O・環境変数・現在時刻も使わない。
//
// 出どころの印（原則9。各値に必ず付ける）:
//   'record'     … 本番の記録（AISession / TickRecord / DecisionRecord）にある値そのまま
//   'recomputed' … 同じ取得元（chart API の足）から計算し直した値
//   'none'       … 記録に無い。0 や前回値で埋めず、画面は「記録なし」と書く
//
// 回の決め方（DECISIONS.md 2026-09-12）:
//   - AISession.ticks（4a・2026-09-14 の tick から入る）がある回は tick を正とする
//   - tick が無い回は learning.allDecisions の「同じ timestamp のまとまり」を1回と数える
//   - watchlist / holdings / knowledgeShown は「最後に成功した tick の結果」しか残らないので、
//     それに当たる回（stateRound）だけ 'record'、過去の回は 'none'

import type { AISession, AITrade } from './engine'
import type { DecisionRecord } from './memory'
import type { TickRecord, TickStage } from './tick-record'
import type { FundamentalsData } from '@/types'
import { UNIVERSE } from './universe'
import { parseFundamentalsWithMeta, fundamentalsProse, PARSEABLE_FIELDS } from './fundamentals-parse'

// ── 型 ─────────────────────────────────────────────────────────────────────

export type Provenance = 'record' | 'recomputed' | 'none'

/** 値と出どころの組。note は画面に添える短い注記（例「記録の文から。数値そのものは記録なし」）。 */
export interface Sourced<T> {
  value: T
  provenance: Provenance
  note?: string
}

export type Trend = 'up' | 'down' | 'flat'

export interface ReplayRound {
  /** tick の id（`tick_<epoch ms>`）か `decisions_<timestamp>` */
  id: string
  /** tick なら startedAt、無ければ判断の timestamp（ISO） */
  at: string
  source: 'tick' | 'decisions'
  tick?: TickRecord
  /** この回に属する判断（保存順＝プロンプトの銘柄順） */
  decisions: DecisionRecord[]
}

/** chart API（/api/ai-session/[id]/chart/[symbol]）の足。time は epoch 秒・ms・ISO 文字列のどれでもよい。 */
export interface ReplayHistoryBar { time: string | number; close: number }

export interface BuildReplayOptions {
  /** この回で詳しく見る銘柄（pickFocusSymbol）の足。渡すと段2・3 の株価と平均線を再計算する */
  history?: ReplayHistoryBar[]
  /** listReplayRounds(session) の結果。渡すと回の一覧を再計算しない */
  rounds?: ReplayRound[]
}

export interface AiViewBar {
  /** epoch ms */
  time: number
  /** UTC の暦日 YYYY-MM-DD */
  date: string
  close: number
  /** 判断日の足を判断時の価格に置き換えた足 */
  replaced: boolean
}

/** recomputeAiView の結果。AI が判断時に見ていたはずの3か月の足と平均線。 */
export interface AiView {
  bars: AiViewBar[]
  closes: number[]
  /** bars と同じ長さ。計算できない先頭は null（0 で埋めない） */
  ma20: (number | null)[]
  ma50: (number | null)[]
  last: { price: number; ma20: number | null; ma50: number | null }
  trend: Trend | null
  provenance: 'recomputed' | 'none'
  /** 判断価格に置き換えた足の位置（判断日の足が無ければ null） */
  replacedIndex: number | null
  /** 窓の外で捨てた足の本数 */
  dropped: { before: number; after: number }
  window: { from: string; to: string }
  /** 足の先頭が窓の始まりに届いておらず、3か月の先頭が欠けている（chart API は今から6か月分なので古い回で起きる） */
  headMissing: boolean
}

interface StageBase {
  no: number
  title: string
  /** 段全体の印（見本の帯の右上） */
  provenance: Provenance
  /** 印の横の短い文言（例「記録から（結果のみ）」「平均線は再計算」） */
  sourceLabel: string
  /** 所要時間（ms）。tick の stages から。無ければ none */
  ms: Sourced<number | null>
}

export interface ReplayUniverseRow {
  symbol: string
  changePercent: number | null
  rank: number | null
  /** 株価を取得できたか。記録が無ければ null */
  ok: boolean | null
}

export interface CandidatesStage extends StageBase {
  key: 'candidates'
  /** 格子に並べる監視銘柄（tick があればその順、無ければ universe.ts） */
  universe: string[]
  rows: Sourced<ReplayUniverseRow[]>
  /** 株価を取得できた銘柄数 */
  fetched: Sourced<number | null>
  /** 値動きの大きさで選ばれた候補（順位順） */
  selected: Sourced<string[]>
  /** 候補に無く、保有中だから分析対象に足した銘柄（tick の記録） */
  heldAdded: Sourced<string[]>
  /** 保有中（session.holdings。最後に成功した回だけ record） */
  held: Sourced<string[]>
  /** 分析対象。complete=false は「判断のある銘柄だけ分かっている」 */
  analysed: { symbols: string[]; provenance: Provenance; complete: boolean; note?: string }
}

export interface MaterialsStage extends StageBase {
  key: 'materials'
  symbol: string | null
  /** 取得した日足の本数 */
  bars: Sourced<number | null>
  fundamentals: {
    /** 取得できた項目数（判断の fundamentals 文字列を厳密に読んだ数） */
    count: Sourced<number | null>
    total: number
    /** 取得できたか（tick の記録。判断の文字列しか無い回は count から分かる） */
    ok: Sourced<boolean | null>
    data: Partial<FundamentalsData>
    format: 1 | 2 | null
    /** v1 書式で D/E の単位が判別できない記録 */
    legacy: boolean
    /** AI の1文（書式トークンより前） */
    prose: string
  }
  news: {
    /** 取得した件数（tick の newsCount）。判断には先頭2件しか残らないので tick が無ければ none */
    fetched: Sourced<number | null>
    headlines: Sourced<string[]>
  }
}

export interface TechnicalsText {
  trend: Trend | null
  trendWord: string | null
  /** 例「RSI48 中立」 */
  rsi: string | null
  /** 文に書かれた丸めた値（数値の記録ではない） */
  rsiFromText: number | null
  macd: string | null
  bb: string | null
}

export interface IndicatorsStage extends StageBase {
  key: 'indicators'
  symbol: string | null
  /** 判断時の価格（判断の記録） */
  price: Sourced<number | null>
  ma20: Sourced<number | null>
  ma50: Sourced<number | null>
  rsi14: Sourced<number | null>
  macd: Sourced<{ macd: number; signal: number; histogram: number } | null>
  bb: Sourced<{ upper: number; middle: number; lower: number } | null>
  /** 並び（価格・MA20・MA50 の大小）。計算値から作る */
  trend: Sourced<Trend | null>
  /** 判断の technicals 文字列から読み取れた語 */
  fromText: TechnicalsText & { provenance: Provenance }
  /** 計算した並びと記録の文が一致するか（どちらかが無ければ null） */
  trendMatchesText: boolean | null
}

export interface KnowledgeStage extends StageBase {
  key: 'knowledge'
  items: Sourced<Array<{ id: string; title: string }>>
}

export interface AiStage extends StageBase {
  key: 'ai'
  /** 実際に材料を渡した銘柄 */
  symbolsSent: Sourced<string[]>
  model: Sourced<string | null>
  inputTokens: Sourced<number | null>
  outputTokens: Sourced<number | null>
  stopReason: Sourced<string | null>
  promptChars: Sourced<number | null>
  responseChars: Sourced<number | null>
  expected: Sourced<number | null>
  returned: Sourced<number | null>
}

export interface DecisionRow {
  symbol: string
  action: DecisionRecord['action'] | null
  confidence: DecisionRecord['confidence'] | null
  price: number | null
  reasoning: string | null
  /** 'none' は「分析対象だが判断の記録なし」 */
  provenance: 'record' | 'none'
  /** 保有中か。分からなければ null */
  held: boolean | null
}

export interface FocusDecision {
  symbol: string
  action: DecisionRecord['action']
  confidence: DecisionRecord['confidence']
  price: number
  reasoning: string
  technicals: string
  fundamentalsProse: string
  newsHeadlines: string[]
  /** 判断時点の保有（取得日・取得単価・株数）。最後に成功した回だけ。同じ回で売買した銘柄は導けないので none */
  holding: Sourced<{ entryAt: string; avgCost: number; shares: number } | null>
  /** 判断時の価格と取得単価から計算した損益率（%）。導出値なので recomputed */
  holdingPnlPct: Sourced<number | null>
}

export interface DecisionsStage extends StageBase {
  key: 'decisions'
  rows: DecisionRow[]
  /** 返ってきた判断の数（record） */
  returned: number
  /** AI に渡した銘柄数（engine の decisionsExpected＝材料の取得に成功した数）。tick が無い回は none（watchlist は取得失敗の銘柄も含む） */
  expected: Sourced<number | null>
  focus: FocusDecision | null
  /** 失敗した tick（timeout / error / empty）。判断は記録されていない */
  failure: { stopReason: string; note: string | null } | null
}

export interface ReplayTrade {
  timestamp: string
  symbol: string
  action: AITrade['action']
  shares: number
  price: number
  total: number
  reason: string
}

export interface TradesStage extends StageBase {
  key: 'trades'
  trades: Sourced<ReplayTrade[]>
}

export type ReplayStage =
  | CandidatesStage | MaterialsStage | IndicatorsStage | KnowledgeStage | AiStage | DecisionsStage | TradesStage

export interface ReplayModel {
  round: {
    id: string
    at: string
    source: 'tick' | 'decisions'
    /** session の watchlist / holdings / knowledgeShown がこの回の結果か（最後に成功した回） */
    isStateRound: boolean
    /** 第N回。最後に成功した回だけ tickCount から分かる。過去の回は null */
    tickNumber: number | null
  }
  summary: { universe: number; analysed: number | null; decided: number }
  /** この回で詳しく見る銘柄（段2・3・6 の中心）。判断も材料も無い回は null */
  focusSymbol: string | null
  /** この回で詳しく見る銘柄の再計算した足（opts.history を渡したときだけ） */
  chart: AiView | null
  totalMs: Sourced<number | null>
  /** 段1〜6（売買があれば7）。順番は engine.ts の処理順 */
  stages: ReplayStage[]
}

// ── 共通 ──────────────────────────────────────────────────────────────────

const FAILED_STOP_REASONS = new Set(['timeout', 'error', 'empty'])
/** finishedAt が無い（保存前に落ちた）tick の窓 */
const TICK_WINDOW_FALLBACK_MS = 10 * 60_000
/** 最後に成功した回と session.lastTickAt がこれ以上離れていたら tickNumber を付けない */
const TICK_NUMBER_TOLERANCE_MS = 10 * 60_000
/** 足の先頭が窓の始まりからこれ以上遅れていたら「先頭が欠けている」（土日と連休ぶんは許す） */
const HEAD_TOLERANCE_MS = 5 * 86_400_000

export const PROVENANCE_LABEL: Record<Provenance, string> = {
  record: '記録から',
  recomputed: '同じ取得元から計算し直した',
  none: '記録なし',
}

function ms(iso: string | null | undefined): number {
  if (!iso) return NaN
  return Date.parse(iso)
}

function sortKey(iso: string): number {
  const v = Date.parse(iso)
  return Number.isFinite(v) ? v : -Infinity
}

function rec<T>(value: T, note?: string): Sourced<T> {
  return note ? { value, provenance: 'record', note } : { value, provenance: 'record' }
}
function calc<T>(value: T, note?: string): Sourced<T> {
  return note ? { value, provenance: 'recomputed', note } : { value, provenance: 'recomputed' }
}
function none<T>(value: T, note?: string): Sourced<T> {
  return note ? { value, provenance: 'none', note } : { value, provenance: 'none' }
}

/** tick が AI の返事を得られなかった（timeout/error）か。empty は返事があり tickCount も進むので含めない。 */
function tickThrew(tick: TickRecord | undefined): boolean {
  return !!tick && !!tick.ai && (tick.ai.stopReason === 'timeout' || tick.ai.stopReason === 'error')
}

export function trendOf(price: number | null, ma20: number | null, ma50: number | null): Trend | null {
  if (price == null || ma20 == null || ma50 == null) return null
  if (!Number.isFinite(price) || !Number.isFinite(ma20) || !Number.isFinite(ma50)) return null
  if (price > ma20 && ma20 > ma50) return 'up'
  if (price < ma20 && ma20 < ma50) return 'down'
  return 'flat'
}

// ── 回の一覧 ──────────────────────────────────────────────────────────────

function groupDecisions(session: AISession): Map<string, DecisionRecord[]> {
  const groups = new Map<string, DecisionRecord[]>()
  for (const d of session.learning?.allDecisions ?? []) {
    if (!d || typeof d.timestamp !== 'string') continue
    const g = groups.get(d.timestamp)
    if (g) g.push(d); else groups.set(d.timestamp, [d])
  }
  return groups
}

/**
 * 再生できる回の一覧（新しい順）。
 * ticks がある回は tick を正とし、allDecisions の同時刻群のうち tick の startedAt〜finishedAt に
 * 入るものは tick 側に含める（二重に数えない）。tick が無い回は同時刻群そのもの。
 */
export function listReplayRounds(session: AISession): ReplayRound[] {
  const groups = groupDecisions(session)
  const used = new Set<string>()
  const rounds: ReplayRound[] = []

  for (const tick of session.ticks ?? []) {
    if (!tick || typeof tick.startedAt !== 'string') continue
    const start = ms(tick.startedAt)
    const endRaw = ms(tick.finishedAt)
    const end = Number.isFinite(endRaw) ? endRaw : start + TICK_WINDOW_FALLBACK_MS
    const decisions: DecisionRecord[] = []
    if (Number.isFinite(start)) {
      for (const [ts, g] of groups) {
        if (used.has(ts)) continue
        const t = ms(ts)
        if (t >= start && t <= end) { used.add(ts); decisions.push(...g) }
      }
    }
    rounds.push({ id: tick.id, at: tick.startedAt, source: 'tick', tick, decisions })
  }
  for (const [ts, g] of groups) {
    if (used.has(ts)) continue
    rounds.push({ id: `decisions_${ts}`, at: ts, source: 'decisions', decisions: g })
  }
  rounds.sort((a, b) => sortKey(b.at) - sortKey(a.at))
  return rounds
}

/**
 * session の watchlist / holdings / knowledgeShown が結果として残っている回（最後に成功した回）。
 * rounds（listReplayRounds の結果）を渡すと再計算しない。
 */
export function findStateRound(session: AISession, rounds?: ReplayRound[]): ReplayRound | null {
  for (const r of rounds ?? listReplayRounds(session)) {
    if (!tickThrew(r.tick)) return r
  }
  return null
}

/** 判断時点の保有についての情報。 */
interface HeldInfo {
  /** 判断時点で保有していたと分かる銘柄 */
  held: Set<string>
  /** true なら held に無い銘柄は「保有していなかった」。false なら不明（null） */
  complete: boolean
  /** 保有の有無そのものが導けない銘柄（買いの約定があるのに保有が無い＝記録が食い違う） */
  unknown: Set<string>
  /** 保有していたが、判断時点の取得単価・株数が導けない銘柄（同じ回で買い増し・売り） */
  dataUnknown: Set<string>
  provenance: Provenance
  note?: string
}

function heldAt(info: HeldInfo | null, symbol: string): boolean | null {
  if (!info) return null
  if (info.unknown.has(symbol)) return null
  if (info.held.has(symbol)) return true
  return info.complete ? false : null
}

/**
 * 判断時点の保有。
 *  - state round: session.holdings は売買後の状態なので、同じ回の売買から戻す。
 *      判断時点の保有 = holdings − {この回の buy で entryAt が約定と同時刻の銘柄（新規買い）} ∪ {この回の sell の銘柄}
 *    engine は新規買いの entryAt に約定と同じ now を書き、買い増しでは entryAt を変えず、売りでは保有を消す。
 *    買い増し・売りの銘柄は判断時点の取得単価・株数が導けないので dataUnknown。
 *  - state でない tick 回: heldAdded（候補に入らなかった保有）だけ分かる。engine の heldAdded = combined − candidates
 *    なので、値動きの候補にも入った保有銘柄は heldAdded に無く、不明（null）として扱う。
 *  - それ以外の過去の回: 不明（null）
 */
function heldInfoFor(session: AISession, round: ReplayRound, isStateRound: boolean): HeldInfo | null {
  if (isStateRound) {
    const holdings = session.holdings ?? {}
    const held = new Set(Object.keys(holdings))
    const unknown = new Set<string>()
    const dataUnknown = new Set<string>()
    let derived = false
    for (const t of tradesInRound(session, round)) {
      derived = true
      const h = holdings[t.symbol]
      if (t.action === 'buy') {
        if (h && h.entryAt === t.timestamp) held.delete(t.symbol)   // 新規買い: 判断時点は未保有
        else if (h) dataUnknown.add(t.symbol)                        // 買い増し: 保有だが単価・株数は判断後の値
        else { held.delete(t.symbol); unknown.add(t.symbol) }        // 買ったのに保有が無い: 記録が食い違う
      } else {
        held.add(t.symbol)                                           // 売り: 判断時点は保有（記録は消えている）
        dataUnknown.add(t.symbol)
      }
    }
    return derived
      ? { held, complete: true, unknown, dataUnknown, provenance: 'recomputed', note: '同じ回の売買から判断時点の保有に戻した' }
      : { held, complete: true, unknown, dataUnknown, provenance: 'record' }
  }
  if (round.tick) {
    return {
      held: new Set(round.tick.heldAdded), complete: false, unknown: new Set(), dataUnknown: new Set(),
      provenance: 'record', note: '保有から足した銘柄だけ分かる。候補にも入った保有銘柄は分からない',
    }
  }
  return null
}

/**
 * この回で詳しく見る銘柄。判断のある保有銘柄の先頭、無ければ判断の先頭。判断が無い回（失敗 tick）は材料の先頭。
 * 保有が分からない回は「保有継続（hold）」の判断を保有の代わりに使う。
 * ⑤-2 の画面は、これで決めた銘柄の足を chart API から取り、opts.history に渡す。
 * rounds（listReplayRounds の結果）を渡すと再計算しない。
 */
export function pickFocusSymbol(session: AISession, round: ReplayRound, rounds?: ReplayRound[]): string | null {
  const isStateRound = findStateRound(session, rounds)?.id === round.id
  return pickFocus(round, heldInfoFor(session, round, isStateRound))
}

function pickFocus(round: ReplayRound, info: HeldInfo | null): string | null {
  const ds = round.decisions
  if (ds.length === 0) {
    const tick = round.tick
    if (!tick) return null
    return tick.contexts.find(c => !c.error)?.symbol ?? tick.selected[0] ?? tick.heldAdded[0] ?? null
  }
  const known = info ? ds.find(d => info.held.has(d.symbol)) : undefined
  if (known) return known.symbol
  if (!info || !info.complete) {
    const proxy = ds.find(d => d.action === 'hold')
    if (proxy) return proxy.symbol
  }
  return ds[0].symbol
}

// ── 判断の technicals 文字列 ────────────────────────────────────────────────

const RE_TREND = /(上昇トレンド|下落トレンド|横ばい)/
const RE_RSI = /RSI\s*(\d{1,3})(?:\s*(買われすぎ|売られすぎ|中立))?/
const RE_MACD = /MACD\s*(強気|弱気)/
const RE_BB = /BB\s*(上限超え|下限割れ|内)/

/** engine.ts が作る語（「RSI48 中立」「MACD弱気」…）と、AI がそれを言い換えた文の両方から語だけを拾う。 */
export function readTechnicalsText(text: string | null | undefined): TechnicalsText {
  const out: TechnicalsText = { trend: null, trendWord: null, rsi: null, rsiFromText: null, macd: null, bb: null }
  if (!text) return out
  const t = RE_TREND.exec(text)
  if (t) {
    out.trendWord = t[1]
    out.trend = t[1] === '上昇トレンド' ? 'up' : t[1] === '下落トレンド' ? 'down' : 'flat'
  }
  const r = RE_RSI.exec(text)
  if (r) {
    const v = Number(r[1])
    if (v >= 0 && v <= 100) {
      out.rsiFromText = v
      out.rsi = r[2] ? `RSI${r[1]} ${r[2]}` : `RSI${r[1]}`
    }
  }
  const m = RE_MACD.exec(text)
  if (m) out.macd = `MACD${m[1]}`
  const b = RE_BB.exec(text)
  if (b) out.bb = `BB${b[1]}`
  return out
}

// ── 株価の再計算 ──────────────────────────────────────────────────────────

function toMs(time: string | number): number {
  if (typeof time === 'number') return time < 1e11 ? time * 1000 : time
  return Date.parse(time)
}

function isoDate(t: number): string {
  return new Date(t).toISOString().slice(0, 10)
}

/** 単純移動平均。lib/technicals の calcMA と同じ丸め（小数2桁）。先頭の period-1 本は null。 */
function sma(closes: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null)
  let sum = 0
  for (let i = 0; i < closes.length; i++) {
    sum += closes[i]
    if (i >= period) sum -= closes[i - period]
    if (i >= period - 1) out[i] = parseFloat((sum / period).toFixed(2))
  }
  return out
}

function emptyAiView(decidedAt: string, price: number, fromMs: number): AiView {
  return {
    bars: [], closes: [], ma20: [], ma50: [],
    last: { price, ma20: null, ma50: null },
    trend: null, provenance: 'none', replacedIndex: null,
    dropped: { before: 0, after: 0 },
    window: { from: Number.isFinite(fromMs) ? new Date(fromMs).toISOString() : '', to: decidedAt },
    headMissing: false,
  }
}

/**
 * chart API の足から「AI が判断時に見ていた3か月」を作り直す。
 *  - 窓は判断日の3か月前（UTC の暦日の始まり）〜判断時刻。engine の getHistory(symbol,'3mo') はおよそ3か月で、
 *    取得元により数本差がある（yahoo2 は約95日、twelvedata は70本）。3か月前の日付は Date.UTC の月末繰り越しに
 *    従う（例: 5/31 の3か月前は 2/31 → 3/3、閏年は 3/2）。これを仕様とする
 *  - chart API は今から6か月分しか返さないので、3か月より前の回は窓の先頭が欠ける（headMissing=true）
 *  - 判断日より後の足は捨てる（AI が見ていない値を混ぜない）
 *  - 判断した日の足は、その日の終値ではなく判断時の価格（decisionPrice）に置き換える。終値は判断より
 *    後に決まるため。判断時刻より前に始まった同じ暦日（UTC）の足だけが対象
 *  - MA50 が計算できない先頭 49 本は null（0 で埋めない）
 */
export function recomputeAiView(
  history: ReplayHistoryBar[] | null | undefined,
  decidedAt: string,
  decisionPrice: number,
): AiView {
  const decidedMs = ms(decidedAt)
  if (!Number.isFinite(decidedMs)) return emptyAiView(decidedAt, decisionPrice, NaN)
  const d = new Date(decidedMs)
  const fromMs = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 3, d.getUTCDate())
  if (!history || history.length === 0) return emptyAiView(decidedAt, decisionPrice, fromMs)

  const normalized = history
    .map(b => ({ time: toMs(b.time), close: Number(b.close) }))
    .filter(b => Number.isFinite(b.time) && Number.isFinite(b.close))
    .sort((a, b) => a.time - b.time)
  const headMissing = normalized.length > 0 && normalized[0].time > fromMs + HEAD_TOLERANCE_MS

  let before = 0
  let after = 0
  const bars: AiViewBar[] = []
  for (const b of normalized) {
    if (b.time < fromMs) { before++; continue }
    if (b.time > decidedMs) { after++; continue }
    bars.push({ time: b.time, date: isoDate(b.time), close: b.close, replaced: false })
  }
  if (bars.length === 0) {
    const v = emptyAiView(decidedAt, decisionPrice, fromMs)
    v.dropped = { before, after }
    v.headMissing = headMissing
    return v
  }

  let replacedIndex: number | null = null
  const lastBar = bars[bars.length - 1]
  const priceOk = Number.isFinite(decisionPrice) && decisionPrice > 0
  if (priceOk && lastBar.date === isoDate(decidedMs)) {
    lastBar.close = decisionPrice
    lastBar.replaced = true
    replacedIndex = bars.length - 1
  }

  const closes = bars.map(b => b.close)
  const ma20 = sma(closes, 20)
  const ma50 = sma(closes, 50)
  const lastMa20 = ma20[ma20.length - 1] ?? null
  const lastMa50 = ma50[ma50.length - 1] ?? null
  return {
    bars, closes, ma20, ma50,
    last: { price: decisionPrice, ma20: lastMa20, ma50: lastMa50 },
    trend: priceOk ? trendOf(decisionPrice, lastMa20, lastMa50) : null,
    provenance: 'recomputed',
    replacedIndex,
    dropped: { before, after },
    window: { from: new Date(fromMs).toISOString(), to: decidedAt },
    headMissing,
  }
}

// ── 段ごとの表示モデル ────────────────────────────────────────────────────

function stageMs(tick: TickRecord | undefined, name: TickStage['name']): Sourced<number | null> {
  const s = tick?.stages.find(st => st.name === name)
  if (!s) return none(null)
  return rec(s.ms, s.note)
}

function tradesInRound(session: AISession, round: ReplayRound): ReplayTrade[] {
  const trades = session.trades ?? []
  const decisionTs = new Set(round.decisions.map(d => d.timestamp))
  let start = NaN
  let end = NaN
  if (round.tick) {
    start = ms(round.tick.startedAt)
    const e = ms(round.tick.finishedAt)
    end = Number.isFinite(e) ? e : start + TICK_WINDOW_FALLBACK_MS
  }
  const out: ReplayTrade[] = []
  for (const t of trades) {
    if (!t || typeof t.timestamp !== 'string') continue
    const tm = ms(t.timestamp)
    const inWindow = Number.isFinite(start) && tm >= start && tm <= end
    if (!(decisionTs.has(t.timestamp) || t.timestamp === round.at || inWindow)) continue
    out.push({
      timestamp: t.timestamp, symbol: t.symbol, action: t.action,
      shares: t.shares, price: t.price, total: t.total, reason: t.reason ?? '',
    })
  }
  return out
}

/**
 * 1回ぶんの「段ごとの表示モデル」。値の出どころは各 Sourced の provenance で示す。
 * opts.history（この回で詳しく見る銘柄の足）を渡すと、tick の記録が無い回でも株価と平均線を再計算する。
 * opts.rounds（listReplayRounds の結果）を渡すと回の一覧を再計算しない。
 */
export function buildReplayModel(
  session: AISession,
  round: ReplayRound,
  opts: BuildReplayOptions = {},
): ReplayModel {
  const tick = round.tick
  const decisions = round.decisions
  const stateRound = findStateRound(session, opts.rounds)
  const isStateRound = stateRound?.id === round.id
  const held = heldInfoFor(session, round, isStateRound)
  const focusSymbol = pickFocus(round, held)
  const focusDecision = focusSymbol ? decisions.find(d => d.symbol === focusSymbol) ?? null : null
  const focusCtx = focusSymbol ? tick?.contexts.find(c => c.symbol === focusSymbol && !c.error) ?? null : null
  const failure = tick?.ai && FAILED_STOP_REASONS.has(tick.ai.stopReason)
    ? { stopReason: tick.ai.stopReason, note: tick.stages.find(s => s.name === 'ai')?.note ?? null }
    : null

  // 第N回: 最後に成功した回だけ tickCount から分かる（allDecisions は判断0件の回を含まないため逆算できない）
  let tickNumber: number | null = null
  if (isStateRound && typeof session.tickCount === 'number') {
    const last = ms(session.lastTickAt)
    const at = round.decisions[0] ? ms(round.decisions[0].timestamp) : ms(round.at)
    if (Number.isFinite(last) && Number.isFinite(at) && Math.abs(last - at) <= TICK_NUMBER_TOLERANCE_MS) {
      tickNumber = session.tickCount
    }
  }

  // ── 1 候補を選ぶ
  const universe = tick ? tick.universe.map(r => r.symbol) : [...UNIVERSE]
  const rows: Sourced<ReplayUniverseRow[]> = tick
    ? rec(tick.universe.map(r => ({ symbol: r.symbol, changePercent: r.changePercent, rank: r.rank, ok: r.ok })))
    : none(UNIVERSE.map(symbol => ({ symbol, changePercent: null, rank: null, ok: null })),
        '各銘柄の変化率と順位は記録に残っていない')
  const fetched: Sourced<number | null> = tick ? rec(tick.universe.filter(r => r.ok).length) : none(null)
  const selected: Sourced<string[]> = tick ? rec(tick.selected) : none([], '値動きで選ばれた候補は記録に残っていない')
  const heldAdded: Sourced<string[]> = tick ? rec(tick.heldAdded) : none([])
  const heldList: Sourced<string[]> = held && held.complete
    ? { value: [...held.held], provenance: held.provenance, ...(held.note ? { note: held.note } : {}) }
    : none([], tick ? '候補にも入った保有銘柄は分からない（保有から足した銘柄は heldAdded に）' : 'この回の時点の保有は記録に残っていない')

  let analysed: CandidatesStage['analysed']
  if (tick) {
    analysed = { symbols: [...tick.selected, ...tick.heldAdded], provenance: 'record', complete: true }
  } else if (isStateRound && Array.isArray(session.watchlist) && session.watchlist.length > 0) {
    analysed = { symbols: [...session.watchlist], provenance: 'record', complete: true }
  } else {
    analysed = {
      symbols: decisions.map(d => d.symbol), provenance: 'none', complete: false,
      note: '判断のある銘柄だけ分かる。分析対象の全体は記録に残っていない',
    }
  }
  const candidates: CandidatesStage = {
    key: 'candidates', no: 1,
    title: `${universe.length}銘柄の株価を取り、値動きの大きい順に選ぶ`,
    provenance: tick ? 'record' : analysed.provenance,
    sourceLabel: tick ? '記録から' : isStateRound ? '記録から（結果のみ）' : '判断のある銘柄だけ記録あり',
    ms: stageMs(tick, 'candidates'),
    universe, rows, fetched, selected, heldAdded, held: heldList, analysed,
  }

  // ── この回で詳しく見る銘柄の足（tick が無い回の株価・平均線）
  const chart: AiView | null = opts.history && focusSymbol && focusDecision
    ? recomputeAiView(opts.history, focusDecision.timestamp, focusDecision.price)
    : null

  // ── 2 材料を集める
  const parsed = parseFundamentalsWithMeta(focusDecision?.fundamentals)
  const fundCount = Object.keys(parsed.data).length
  const bars: Sourced<number | null> = focusCtx
    ? rec(focusCtx.bars)
    : chart && chart.provenance === 'recomputed'
      ? calc(chart.bars.length, chart.headMissing
          ? '同じ取得元の足を判断日までのおよそ3か月に切り直した（取得できた足が窓の途中から始まり、先頭が欠けている）'
          : '同じ取得元の足を判断日までのおよそ3か月に切り直した')
      : none(null)
  const materials: MaterialsStage = {
    key: 'materials', no: 2,
    title: focusSymbol ? `${focusSymbol} の株価3か月分・会社の数字・ニュース` : '株価3か月分・会社の数字・ニュース',
    provenance: focusCtx ? 'record' : chart?.provenance === 'recomputed' ? 'recomputed' : focusDecision ? 'record' : 'none',
    sourceLabel: focusCtx ? '記録から' : chart?.provenance === 'recomputed' ? '株価は再取得' : focusDecision ? '会社の数字とニュースは記録から' : '記録なし',
    ms: stageMs(tick, 'contexts'),
    symbol: focusSymbol,
    bars,
    fundamentals: {
      count: focusDecision ? rec(fundCount) : none(null),
      total: PARSEABLE_FIELDS.length,
      ok: focusCtx ? rec(focusCtx.fundamentalsOk) : focusDecision ? calc(fundCount > 0, '判断の文字列に項目があるかで判定') : none(null),
      data: parsed.data,
      format: focusDecision ? parsed.format : null,
      legacy: !!parsed.legacy,
      prose: fundamentalsProse(focusDecision?.fundamentals),
    },
    news: {
      fetched: focusCtx ? rec(focusCtx.newsCount) : none(null, '取得した件数は記録に残っていない（判断には先頭2件だけ残る）'),
      headlines: focusCtx ? rec(focusCtx.newsHeadlines) : focusDecision ? rec(focusDecision.newsHeadlines ?? []) : none([]),
    },
  }

  // ── 3 指標を計算
  const text = readTechnicalsText(focusDecision?.technicals)
  const price: Sourced<number | null> = focusDecision ? rec(focusDecision.price) : none(null)
  let ma20: Sourced<number | null>
  let ma50: Sourced<number | null>
  let rsi14: Sourced<number | null>
  let macd: IndicatorsStage['macd']
  let bb: IndicatorsStage['bb']
  if (focusCtx) {
    ma20 = rec(focusCtx.ma20)
    ma50 = rec(focusCtx.ma50)
    rsi14 = rec(focusCtx.rsi14)
    macd = rec(focusCtx.macd)
    bb = rec(focusCtx.bb)
  } else {
    const hasChart = chart?.provenance === 'recomputed'
    ma20 = hasChart ? calc(chart!.last.ma20, '同じ株価から再計算') : none(null)
    ma50 = hasChart
      ? calc(chart!.last.ma50, chart!.last.ma50 == null ? '3か月分では50本に足りない' : '3か月分では最後の数日しか計算できない')
      : none(null)
    rsi14 = none(null, text.rsi ? '記録の文から。数値そのものは記録なし' : undefined)
    macd = none(null, text.macd ? '記録の文から。数値そのものは記録なし' : undefined)
    bb = none(null, text.bb ? '記録の文から。数値そのものは記録なし' : undefined)
  }
  const trendValue = trendOf(price.value, ma20.value, ma50.value)
  const trendProv: Provenance = trendValue == null ? 'none'
    : price.provenance === 'record' && ma20.provenance === 'record' && ma50.provenance === 'record' ? 'record'
      : 'recomputed'
  const trend: Sourced<Trend | null> = { value: trendValue, provenance: trendProv }
  const indicators: IndicatorsStage = {
    key: 'indicators', no: 3,
    title: '平均線・過熱・勢いを計算する',
    provenance: focusCtx ? 'record' : chart?.provenance === 'recomputed' ? 'recomputed' : (text.trendWord || text.rsi || text.macd) ? 'record' : 'none',
    sourceLabel: focusCtx ? '記録から' : chart?.provenance === 'recomputed' ? '平均線は再計算' : (text.trendWord || text.rsi || text.macd) ? '記録の文から（数値は記録なし）' : '記録なし',
    ms: none(null, '指標の計算は「材料を集める」の所要時間に含まれる'),
    symbol: focusSymbol,
    price, ma20, ma50, rsi14, macd, bb, trend,
    fromText: { ...text, provenance: focusDecision ? 'record' : 'none' },
    trendMatchesText: trendValue != null && text.trend != null ? trendValue === text.trend : null,
  }

  // ── 4 知識を読む
  const knowledgeItems: Sourced<Array<{ id: string; title: string }>> = tick
    ? rec(tick.knowledge.map(k => ({ id: k.id, title: k.title })))
    : isStateRound && Array.isArray(session.knowledgeShown)
      ? rec(session.knowledgeShown.map(k => ({ id: k.id, title: k.title })))
      : none([], 'この回に提示した知識は記録に残っていない')
  const knowledge: KnowledgeStage = {
    key: 'knowledge', no: 4,
    title: '過去に学んだ知識から、今回に関係するものを選ぶ',
    provenance: knowledgeItems.provenance,
    sourceLabel: PROVENANCE_LABEL[knowledgeItems.provenance],
    ms: stageMs(tick, 'knowledge'),
    items: knowledgeItems,
  }

  // ── 5 AI に聞く
  // 実際に AI に渡した銘柄は「材料の取得に成功した銘柄」（engine の enriched）。tick が無い回の watchlist は
  // 取得に失敗した銘柄も含むので、渡した数の代わりにしない（none）。
  const sentUnknownNote = analysed.complete
    ? `分析対象は${analysed.symbols.length}銘柄。実際に AI に渡した数は記録なし（材料の取得に失敗した銘柄は渡していない）`
    : '分析対象の全体も、実際に AI に渡した数も記録なし'
  const symbolsSent: Sourced<string[]> = tick
    ? rec(tick.contexts.filter(c => !c.error).map(c => c.symbol))
    : none([], sentUnknownNote)
  const ai = tick?.ai ?? null
  const expected: Sourced<number | null> = ai ? rec(ai.decisionsExpected) : none(null, sentUnknownNote)
  const aiStage: AiStage = {
    key: 'ai', no: 5,
    title: tick
      ? `${symbolsSent.value.length}銘柄分の材料をまとめて、1回で AI に渡す`
      : analysed.complete
        ? `分析対象${analysed.symbols.length}銘柄の材料をまとめて、1回で AI に渡す`
        : '分析対象の材料をまとめて、1回で AI に渡す',
    provenance: ai ? 'record' : 'none',
    sourceLabel: ai ? '記録から' : '渡した銘柄数・所要時間・モデルは記録なし',
    ms: ai ? rec(ai.ms) : stageMs(tick, 'ai'),
    symbolsSent,
    model: ai ? rec(ai.model) : none(null),
    inputTokens: ai ? rec(ai.inputTokens) : none(null),
    outputTokens: ai ? rec(ai.outputTokens) : none(null),
    stopReason: ai ? rec(ai.stopReason) : none(null),
    promptChars: ai ? rec(ai.promptChars) : none(null),
    responseChars: ai ? rec(ai.responseChars) : none(null),
    expected,
    returned: ai ? rec(ai.decisionsReturned) : rec(decisions.length),
  }

  // ── 6 判断
  const rowsOut: DecisionRow[] = []
  const seen = new Set<string>()
  const orderedSymbols = analysed.complete ? analysed.symbols : decisions.map(d => d.symbol)
  const toRow = (symbol: string, d: DecisionRecord | undefined): DecisionRow => d
    ? { symbol, action: d.action, confidence: d.confidence, price: d.price, reasoning: d.reasoning ?? '', provenance: 'record', held: heldAt(held, symbol) }
    : { symbol, action: null, confidence: null, price: null, reasoning: null, provenance: 'none', held: heldAt(held, symbol) }
  for (const symbol of orderedSymbols) {
    if (seen.has(symbol)) continue
    seen.add(symbol)
    rowsOut.push(toRow(symbol, decisions.find(x => x.symbol === symbol)))
  }
  for (const d of decisions) {
    if (seen.has(d.symbol)) continue
    seen.add(d.symbol)
    rowsOut.push(toRow(d.symbol, d))
  }
  let focus: FocusDecision | null = null
  if (focusDecision) {
    const sym = focusDecision.symbol
    let holding: FocusDecision['holding']
    let holdingPnlPct: FocusDecision['holdingPnlPct'] = none(null)
    const h = isStateRound ? (session.holdings ?? {})[sym] : undefined
    if (isStateRound && held) {
      if (held.dataUnknown.has(sym) || held.unknown.has(sym)) {
        holding = none(null, '同じ回で売買しているため、判断時点の取得単価・株数は記録から導けない')
      } else if (h && held.held.has(sym)) {
        holding = rec({ entryAt: h.entryAt, avgCost: h.avgCost, shares: h.shares })
        holdingPnlPct = h.avgCost > 0 && Number.isFinite(focusDecision.price)
          ? calc(parseFloat((((focusDecision.price - h.avgCost) / h.avgCost) * 100).toFixed(2)), '判断時の価格と取得単価から計算')
          : none(null)
      } else {
        holding = rec(null, '判断時点では保有していない')
      }
    } else if (held && held.held.has(sym)) {
      holding = none(null, '保有していたが、この回の時点の取得単価・株数は記録に残っていない')
    } else {
      holding = none(null, 'この回の時点の保有は記録に残っていない')
    }
    focus = {
      symbol: sym,
      action: focusDecision.action,
      confidence: focusDecision.confidence,
      price: focusDecision.price,
      reasoning: focusDecision.reasoning ?? '',
      technicals: focusDecision.technicals ?? '',
      fundamentalsProse: fundamentalsProse(focusDecision.fundamentals),
      newsHeadlines: focusDecision.newsHeadlines ?? [],
      holding,
      holdingPnlPct,
    }
  }
  const decisionsStage: DecisionsStage = {
    key: 'decisions', no: 6,
    title: failure
      ? '返ってきた判断　なし'
      : expected.value != null ? `返ってきた判断　${decisions.length} / ${expected.value} 銘柄` : `返ってきた判断　${decisions.length} 銘柄`,
    provenance: decisions.length > 0 ? 'record' : 'none',
    sourceLabel: failure ? '判断は記録されていない' : decisions.length > 0 ? '記録から' : '記録なし',
    ms: none(null, '判断の受け取りは「AI に聞く」の所要時間に含まれる'),
    rows: rowsOut,
    returned: decisions.length,
    expected,
    focus,
    failure,
  }

  const stages: ReplayStage[] = [candidates, materials, indicators, knowledge, aiStage, decisionsStage]

  // ── 7 売買（この回に約定があるときだけ）
  const trades = tradesInRound(session, round)
  if (trades.length > 0) {
    stages.push({
      key: 'trades', no: 7,
      title: `判断にもとづいて売買する　${trades.length}件`,
      provenance: 'record',
      sourceLabel: '記録から',
      ms: stageMs(tick, 'trade'),
      trades: rec(trades),
    })
  }

  const total = tick && Number.isFinite(ms(tick.startedAt)) && Number.isFinite(ms(tick.finishedAt))
    ? rec(Math.max(0, ms(tick.finishedAt) - ms(tick.startedAt)), '保存直前まで')
    : none(null)

  return {
    round: { id: round.id, at: round.at, source: round.source, isStateRound, tickNumber },
    summary: {
      universe: universe.length,
      analysed: analysed.complete ? analysed.symbols.length : null,
      decided: decisions.length,
    },
    focusSymbol,
    chart,
    totalMs: total,
    stages,
  }
}
