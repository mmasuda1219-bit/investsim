// tick（AI が1回ぶん判断する処理）ごとの「過程の記録」。DESIGN.md §6-19「分析の過程の再生」の材料。
//
// 置き場所の決定（DECISIONS.md 2026-09-11「分析の過程は AISession.ticks に別配列で記録する」）:
//  - AISession.ticks に TickRecord を直近 TICK_RECORD_LIMIT 件だけ持つ。判断（AIDecision）側には
//    tickId / decidedAt の2つだけ足し、走査結果・所要時間・テクニカル数値・AI の usage はこちらに寄せる。
//  - プロンプト全文と AI の返事の本文は保存しない（文字数・トークン数・stop_reason だけ）。
//  - 原則9: 取得に失敗した行は ok:false・数値は null。0 や前回値で埋めない。
//
// このファイルは純関数と型だけ（I/O・環境変数・engine.ts への依存を持たない）。
// engine.ts は store.ts 経由で `server-only` を静的 import しており tsx から読めないため、
// scripts/check-tick-record.ts はここだけを読んで検査する。

export interface TickStage {
  /** engine.ts の runTick の実処理順と1対1。'save' は保存そのものの段で、この記録自体を保存する
   *  ため所要時間を中に書けず、現状は積まない（finishedAt が保存直前の時刻）。 */
  name: 'candidates' | 'contexts' | 'knowledge' | 'ai' | 'trade' | 'save'
  startedAt: string
  ms: number
  ok: boolean
  note?: string
}

/** 監視母集団（40銘柄）の1行。quote 取得に失敗した行は ok:false・changePercent/rank は null。 */
export interface TickUniverseRow {
  symbol: string
  changePercent: number | null
  ok: boolean
  /** |前日比%| の大きい順の順位（1始まり）。失敗行は null。 */
  rank: number | null
}

/** 分析対象1銘柄ぶんの材料。数値は buildStockContext が実際に計算した最新値（算出不能は null）。 */
export interface TickContext {
  symbol: string
  bars: number
  ma20: number | null
  ma50: number | null
  rsi14: number | null
  macd: { macd: number; signal: number; histogram: number } | null
  bb: { upper: number; middle: number; lower: number } | null
  fundamentalsOk: boolean
  newsCount: number
  /** `[Nh前] 見出し (配信元)` の形のまま最大5件 */
  newsHeadlines: string[]
  /** buildStockContext が例外で落ちた場合のメッセージ（この行は分析対象から外れている） */
  error?: string
}

/** Claude 呼び出しの計測。本文は持たない。 */
export interface TickAI {
  /** API の返事の model。CLI 経路は 'cli' */
  model: string
  inputTokens: number | null
  outputTokens: number | null
  /** API の stop_reason（end_turn / max_tokens …）。失敗時は 'timeout' | 'error'、返事はあったが判断を1件も
   *  救出できなかったときは 'empty'（元の stop_reason は stage 'ai' の note に残す） */
  stopReason: string
  ms: number
  decisionsReturned: number
  decisionsExpected: number
  /** 送ったプロンプトの文字数。プロンプトを組み立てる前に落ちた失敗時は null（0 で埋めない） */
  promptChars: number | null
  /** 返事の文字数。返事が届かなかった失敗時は null */
  responseChars: number | null
}

export interface TickRecord {
  /** `tick_<epoch ms>`（startedAt と同じ時刻） */
  id: string
  startedAt: string
  /** 保存直前の時刻。失敗 tick でも保存時に入る */
  finishedAt: string | null
  stages: TickStage[]
  universe: TickUniverseRow[]
  /** 値動きで選ばれた候補（順位順） */
  selected: string[]
  /** 候補に無く、保有中だから分析対象に足した銘柄 */
  heldAdded: string[]
  contexts: TickContext[]
  /** プロンプトに提示した知識（AISession.knowledgeShown と同じ集合。kind は持たない） */
  knowledge: Array<{ id: string; title: string }>
  ai: TickAI | null
  /** この tick で生まれた判断の参照。書式は `${symbol}@${decidedAt}` */
  decisionIds: string[]
}

/** AISession.ticks に残す件数。超過は古い順に丸ごと落とす。 */
export const TICK_RECORD_LIMIT = 12

export function tickIdFor(startedAtMs: number): string {
  return `tick_${startedAtMs}`
}

export function decisionIdFor(symbol: string, decidedAt: string): string {
  return `${symbol}@${decidedAt}`
}

/** 段の記録を作る（時刻は呼び出し側が Date.now() で渡す。ここでは計算だけ）。 */
export function makeStage(
  name: TickStage['name'],
  startedAtMs: number,
  endedAtMs: number,
  ok: boolean,
  note?: string,
): TickStage {
  const stage: TickStage = {
    name,
    startedAt: new Date(startedAtMs).toISOString(),
    ms: Math.max(0, endedAtMs - startedAtMs),
    ok,
  }
  if (note) stage.note = note
  return stage
}

/** まだ何も積んでいない空の記録。 */
export function emptyTickRecord(startedAtMs: number): TickRecord {
  return {
    id: tickIdFor(startedAtMs),
    startedAt: new Date(startedAtMs).toISOString(),
    finishedAt: null,
    stages: [],
    universe: [],
    selected: [],
    heldAdded: [],
    contexts: [],
    knowledge: [],
    ai: null,
    decisionIds: [],
  }
}

/**
 * 記録を1件足し、直近 TICK_RECORD_LIMIT 件に丸める。
 * 並びは decisions / trades と同じ新しい順（ticks[0] が最新）。旧セッション（ticks 無し）は
 * undefined を渡してよい。入力配列は変更しない。
 */
export function pushTick(ticks: TickRecord[] | undefined | null, t: TickRecord): TickRecord[] {
  const prev = Array.isArray(ticks) ? ticks : []
  return [t, ...prev].slice(0, TICK_RECORD_LIMIT)
}
