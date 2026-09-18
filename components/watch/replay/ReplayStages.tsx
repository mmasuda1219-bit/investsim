'use client'

// 分析の過程の再生（DESIGN.md §6-19）の段の並べ方（C ノート型）と、段ごとの中身。
//
//  - 段は replay-model の ReplayModel.stages（engine.ts の実処理順と1対1）。順番を入れ替えない
//  - 動きは受け取った進行状態（PhaseState）に従って描くだけ。時計は useReplayClock、制御は ProcessReplay
//  - 静止した完成状態（phase.stage = stages.length）では全段が描画済み・丸印は --brand の塗り・明滅なし
//  - 出どころの印（原則9）: 記録から＝--brand の塗り／同じ取得元から計算し直した＝橙 #C26A2A／記録なし＝輪郭だけ。
//    'none' は値を出さず理由を書く。値が null なら「—」＋「記録から分からない」
//  - 勝率・成績・点数は出さない。判断の一覧は行動の種類を同じ重さで並べる。緑赤で方向を示さない

import type { CSSProperties, MutableRefObject, ReactNode } from 'react'
import type {
  ReplayModel, ReplayStage, Provenance, Sourced, Trend,
  CandidatesStage, MaterialsStage, IndicatorsStage, KnowledgeStage, AiStage, DecisionsStage, TradesStage,
} from '@/lib/ai-trader/replay-model'
import type { ChangeBasisMark } from '@/lib/ai-trader/replay-model'
import { PROVENANCE_LABEL, LEGACY_CHANGE_NOTE, showsLegacyChangeNote } from '@/lib/ai-trader/replay-model'
import { UNIVERSE_META, TICK_CANDIDATE_COUNT } from '@/lib/ai-trader/universe'
import { CLAUDE_TIMEOUT_MS, DECISION_MAX_TOKENS } from '@/lib/ai-trader/ai-config'
import { AI_SKIPPED_STOP_REASON } from '@/lib/ai-trader/tick-record'
import type { FundamentalsData } from '@/types'
import ReplayChart, { fmtPrice, type ReplayMarker } from './ReplayChart'
import { type PhaseState, type StagePlan, stageState, stepProgress, revealCount } from './useReplayClock'

export type HistoryStatus = 'loading' | 'ready' | 'error'

/**
 * 判断の記録から補う当日変化率と、その基準の印。値と印は必ず一緒に運ぶ
 * （印なし＝2026-09-16 より前の計算の可能性があるので、画面に1行の注記を足す）。
 */
export interface RecordedChange {
  values: Record<string, number>
  changeBasis: ChangeBasisMark
}

export interface ReplayStagesProps {
  model: ReplayModel
  phase: PhaseState
  history: HistoryStatus
  historyError?: string | null
  markers: ReplayMarker[]
  /** 3倍のとき true。件数は数え上げず即時に出す */
  instant?: boolean
  /** 判断の記録にある当日変化率（40銘柄の走査結果が記録に無い回に、判断のある銘柄ぶんだけ補う）と基準の印 */
  recordedChange?: RecordedChange
  /** 段の要素（自動スクロール用） */
  stageRefs?: MutableRefObject<(HTMLLIElement | null)[]>
}

export const STAGE_NAMES: Record<ReplayStage['key'], string> = {
  candidates: '候補を選ぶ',
  materials: '材料を集める',
  indicators: '指標を計算',
  knowledge: '知識を読む',
  ai: 'AI に聞く',
  decisions: '判断',
  trades: '売買',
}

// ── 再生の計画（段ごとの手順と所要 ms・ふつうの速さ）。合計 15.0 秒（売買の段がある回も 15.0 秒） ──

/** 段5で「寄って消える」札。実際に渡した銘柄（record）か、分析対象（渡した数は記録なし）。 */
export function aiChips(st: AiStage, model: ReplayModel): { symbols: string[]; provenance: Provenance } {
  if (st.symbolsSent.provenance === 'record') return { symbols: st.symbolsSent.value, provenance: 'record' }
  const c = model.stages.find((s): s is CandidatesStage => s.key === 'candidates')
  if (c && c.analysed.complete) return { symbols: c.analysed.symbols, provenance: 'none' }
  return { symbols: [], provenance: 'none' }
}

export function planFor(model: ReplayModel): StagePlan[] {
  const seven = model.stages.some(s => s.key === 'trades')
  const hasChart = !!model.chart && model.chart.bars.length >= 2
  return model.stages.map((st): StagePlan => {
    switch (st.key) {
      case 'candidates':
        return { key: st.key, steps: [
          { key: 'scan', ms: 1600 },
          { key: 'held', ms: seven ? 500 : 600 },
          { key: 'analysed', ms: seven ? 700 : 1000 },
        ] }
      case 'materials': {
        const fund = Object.keys(st.fundamentals.data).length
        const news = st.news.headlines.value.length
        return { key: st.key, steps: [
          { key: 'fund', ms: fund > 0 ? (seven ? 800 : 900) : 0 },
          { key: 'news', ms: news > 0 ? (seven ? 600 : 700) : 0 },
          { key: 'line', ms: hasChart ? 1800 : 0 },
        ] }
      }
      case 'indicators': {
        const t = st.fromText
        const hasTrend = st.trend.value != null || !!(t.trendWord || t.rsi || t.macd || t.bb) || st.rsi14.value != null
        return { key: st.key, steps: [
          { key: 'ma20', ms: st.ma20.value != null ? 900 : 0 },
          { key: 'ma50', ms: st.ma50.value != null ? 900 : 0 },
          { key: 'trend', ms: hasTrend ? 1000 : 0 },
        ] }
      }
      case 'knowledge':
        return { key: st.key, steps: [{ key: 'items', ms: st.items.value.length > 0 ? 800 : 0 }] }
      case 'ai': {
        const chips = aiChips(st, model).symbols.length
        // AI を呼ばなかった回は「考えている」時間を置かず、文を読む短い間だけ（0.6 秒）
        return { key: st.key, steps: [
          { key: 'gather', ms: chips > 0 ? (seven ? 600 : 800) : 0 },
          { key: 'think', ms: st.skipped ? 600 : seven ? 1400 : 1800 },
        ] }
      }
      case 'decisions':
        return { key: st.key, steps: [
          { key: 'rows', ms: st.rows.length > 0 ? 1400 : 0 },
          { key: 'focus', ms: st.focus ? 800 : 0 },
        ] }
      case 'trades':
        return { key: st.key, steps: [{ key: 'rows', ms: 1200 }] }
    }
  })
}

// ── 書式 ──────────────────────────────────────────────────────────────────

const MINUS = '−'
/** 割合は符号付き・小数1桁（DESIGN.md §5-2）。マイナスは U+2212 */
const fmtPct1 = (n: number) => `${n > 0 ? '+' : n < 0 ? MINUS : '±'}${Math.abs(n).toFixed(1)}%`
const fmtSec = (ms: number) => `${(ms / 1000).toFixed(1)}秒`
const fmtInt = (n: number) => n.toLocaleString('en-US')
const isJP = (symbol: string) => /\.T$/i.test(symbol)

const ACTION_LABEL: Record<'buy' | 'sell' | 'hold' | 'watch', string> = {
  buy: '▲ 買い', sell: '▼ 売り', hold: '＝ 保有継続', watch: '◇ 様子見',
}
const CONFIDENCE_LABEL: Record<'high' | 'medium' | 'low', string> = { high: '高い', medium: '中くらい', low: '低い' }
const TREND_WORD: Record<Trend, string> = { up: '上昇トレンド', down: '下落トレンド', flat: '横ばい' }

function stopReasonLabel(r: string): string {
  switch (r) {
    case 'end_turn': return '正常に終了（end_turn）'
    case 'max_tokens': return '返事の上限で打ち切り（max_tokens）'
    // 秒数は書かない: 過去の記録は当時の設定（例 35秒）で打ち切られており、今の CLAUDE_TIMEOUT_MS を
    // 過去の回に当てて表示すると事実と違う数字になる。今の設定値は下の「今の設定:」の行だけが名乗る。
    case 'timeout': return '時間切れで打ち切り（timeout）'
    case 'error': return '呼び出しに失敗（error）'
    // 'empty' は段6の失敗の行が記録の手掛かりで出し分ける（EMPTY_REPLY_TEXT）ので、ここは英語を出さず事実だけ
    case 'empty': return '返事はあったが判断を1件も読めなかった'
    case 'cli': return 'ローカルの CLI 経路（cli）'
    // 呼ばなかった回は段5・段6が別の文を出すのでここには来ないが、英語のまま出さないよう和文にしておく
    case AI_SKIPPED_STOP_REASON: return 'AI を呼ばなかった'
    default: return r
  }
}

function jstTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hour12: false }).format(d)
}
function jstDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric' }).format(d)
}

// 会社の数字13項目（fundamentals-parse の SPEC と同じ順）。書式は FundamentalsFigure と揃える
type FundKind = 'x' | 'pct' | 'de' | 'big' | 'amount'
const FUND_FIELDS: ReadonlyArray<{ field: keyof FundamentalsData; label: string; kind: FundKind }> = [
  { field: 'pe', label: 'PER', kind: 'x' },
  { field: 'pb', label: 'PBR', kind: 'x' },
  { field: 'roe', label: 'ROE', kind: 'pct' },
  { field: 'roa', label: 'ROA', kind: 'pct' },
  { field: 'operatingMargin', label: '営業利益率', kind: 'pct' },
  { field: 'grossMargin', label: '粗利益率', kind: 'pct' },
  { field: 'revenueGrowth', label: '売上成長', kind: 'pct' },
  { field: 'debtToEquity', label: 'D/E', kind: 'de' },
  { field: 'freeCashflow', label: 'FCF', kind: 'big' },
  { field: 'marketCap', label: '時価総額', kind: 'big' },
  { field: 'dividendYield', label: '配当利回り', kind: 'pct' },
  { field: 'week52High', label: '52週高値', kind: 'amount' },
  { field: 'week52Low', label: '52週安値', kind: 'amount' },
]
function fmtFund(kind: FundKind, symbol: string, n: number, legacy: boolean): string {
  switch (kind) {
    case 'x': return `${n.toLocaleString('ja-JP', { maximumFractionDigits: 2 })}倍`
    case 'pct': return `${(n * 100).toLocaleString('ja-JP', { maximumFractionDigits: 1 })}%`
    // v1 の記録は単位が判別できないので保存値のまま（推測で換算しない＝原則9）
    case 'de': return legacy ? `${n.toLocaleString('ja-JP', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}（単位は記録から判別できない）`
      : `${n.toLocaleString('ja-JP', { maximumFractionDigits: 1 })}%`
    case 'big': return isJP(symbol)
      ? `¥${(n / 1e8).toLocaleString('ja-JP', { maximumFractionDigits: 0 })}億`
      : `$${(n / 1e9).toLocaleString('en-US', { maximumFractionDigits: 1 })}B`
    case 'amount': return fmtPrice(symbol, n)
  }
}

// ── 小さな部品 ────────────────────────────────────────────────────────────

const NONE_DOT: CSSProperties = { boxShadow: 'inset 0 0 0 1.5px var(--border-input)' }

/** 出どころの丸印。色に加えて形（塗り／橙／輪郭だけ）でも区別する */
export function ProvDot({ provenance }: { provenance: Provenance }) {
  const cls = provenance === 'record' ? 'bg-brand' : provenance === 'recomputed' ? 'bg-[#C26A2A]' : 'bg-transparent'
  return <span aria-hidden className={`inline-block h-2 w-2 shrink-0 rounded-full ${cls}`} style={provenance === 'none' ? NONE_DOT : undefined} />
}

function Mark({ provenance, label }: { provenance: Provenance; label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-caption text-muted">
      <ProvDot provenance={provenance} />
      <span>{label ?? PROVENANCE_LABEL[provenance]}</span>
    </span>
  )
}

function Note({ children }: { children: ReactNode }) {
  return <span className="text-caption text-muted">{children}</span>
}

/**
 * 出どころ付きの値。'none' は値を出さず理由だけ、null は「—」＋「記録から分からない」、
 * 'recomputed' は値のあとに注記。
 */
function Val<T>({ s, fmt, noneText, shown = true }: {
  s: Sourced<T>
  fmt: (v: NonNullable<T>) => ReactNode
  noneText?: string
  /** 再生中でまだこの値の手順に届いていないとき false（何も出さない） */
  shown?: boolean
}) {
  if (!shown) return <span className="text-muted">　</span>
  if (s.provenance === 'none') return <Note>{s.note ?? noneText ?? '記録なし'}</Note>
  if (s.value == null) return <><span className="text-muted">—</span> <Note>{s.note ?? '記録から分からない'}</Note></>
  return (
    <>
      <b className="font-semibold text-ink tabular-nums">{fmt(s.value as NonNullable<T>)}</b>
      {s.provenance === 'recomputed' && <> <Note>{s.note ?? PROVENANCE_LABEL.recomputed}</Note></>}
    </>
  )
}

/** 方向の札（§6-5）: --surface の面＋--ink の文字・ピル型。色は付けない */
function ActionPill({ action }: { action: keyof typeof ACTION_LABEL }) {
  return <span className="rounded-full bg-surface px-2.5 text-small font-semibold text-ink whitespace-nowrap">{ACTION_LABEL[action]}</span>
}

const REVEAL = 'transition-opacity duration-200 ease-out'
const on = (visible: boolean) => (visible ? 'opacity-100' : 'opacity-0')

// ── 段1 候補を選ぶ ────────────────────────────────────────────────────────

function Candidates({ st, s, phase, instant, recordedChange }: {
  st: CandidatesStage; s: number; phase: PhaseState; instant: boolean; recordedChange?: RecordedChange
}) {
  const pScan = stepProgress(phase, s, 0)
  const pHeld = stepProgress(phase, s, 1)
  const pPick = stepProgress(phase, s, 2)
  const total = st.universe.length
  const scanning = pScan > 0 && pScan < 1 ? Math.min(total - 1, Math.floor(pScan * total)) : -1
  const heldSet = new Set([...st.held.value, ...st.heldAdded.value])
  const analysedSet = new Set(st.analysed.symbols)
  const showHeld = pHeld > 0
  const showPick = pPick > 0

  const count = (n: number, p: number) => (instant || p >= 1 ? n : Math.round(n * p))
  const fetchedShown = st.fetched.value != null ? count(st.fetched.value, pScan) : null
  const heldKnown = st.held.provenance !== 'none'
  const heldShown = count(heldSet.size, pHeld)
  const analysedShown = count(st.analysed.symbols.length, pPick)

  const rankedRows = st.rows.provenance === 'record'
    ? [...st.rows.value].sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9))
    : []
  const rowsShown = revealCount(pScan, rankedRows.length)

  const changeEntries = st.rows.provenance !== 'record' && recordedChange
    ? st.analysed.symbols.filter(sym => typeof recordedChange.values[sym] === 'number')
    : []

  // 取得数・値動きで選ばれた候補・各銘柄の変化率と順位が3つとも記録なしなら、「記録なし」を1行にまとめる
  const scanNone = st.fetched.provenance === 'none' && st.selected.provenance === 'none' && st.rows.provenance === 'none'
  const pickHead = st.selected.provenance === 'record' || !scanNone
  const heldAddedShown = st.heldAdded.provenance === 'record' && st.heldAdded.value.length > 0

  return (
    <>
      <ul className="mt-3 grid grid-cols-5 gap-1 sm:grid-cols-8 sm:gap-1.5" aria-label="監視している銘柄">
        {st.universe.map((sym, i) => {
          const isScan = i === scanning
          const held = showHeld && heldSet.has(sym)
          const pick = showPick && analysedSet.has(sym)
          const out = showPick && !analysedSet.has(sym) && !held
          let cls = 'rounded-field px-0.5 py-1 text-center text-caption tabular-nums whitespace-nowrap overflow-hidden transition-colors duration-150 '
          let style: CSSProperties | undefined
          if (isScan) cls += 'bg-brand-tint text-brand font-semibold'
          else if (pick) { cls += 'bg-card text-ink font-semibold'; style = { boxShadow: 'inset 0 0 0 2px var(--brand)' } }
          else if (held) { cls += 'bg-card text-ink font-semibold'; style = { boxShadow: 'inset 0 0 0 1px var(--border-input)' } }
          else cls += `bg-surface text-muted ${out ? 'opacity-40' : ''}`
          return <li key={sym} className={cls} style={style}>{sym}</li>
        })}
      </ul>

      {rankedRows.length > 0 && (
        <p className="mt-2 text-caption text-ink-2 tabular-nums leading-relaxed">
          <span className="text-muted">変化率と順位（記録から）: </span>
          {/* 区切りの「・」は nowrap の外に置く（中に入れると1行全体が折り返せず横にはみ出す） */}
          {rankedRows.slice(0, rowsShown).map((r, i) => (
            <span key={r.symbol}>
              {i > 0 && <span className="text-muted">・</span>}
              <span className="whitespace-nowrap">
                {r.rank != null && <span className="text-muted">{r.rank} </span>}
                {r.symbol} {r.ok === false || r.changePercent == null ? <span className="text-muted">取得できず</span> : fmtPct1(r.changePercent)}
              </span>
            </span>
          ))}
        </p>
      )}
      {/* 印の無い回（2026-09-16 より前の記録）だけ、変化率の行の直後に1行（枠なし・§6-19）。
          保存値は書き換えない＝表示に注記を添えるだけ（DECISIONS.md 2026-09-16 スライスB）。
          変化率の数字が1つも出ていない回（全行「取得できず」）では出さない（showsLegacyChangeNote） */}
      {rankedRows.length > 0 && showsLegacyChangeNote(st) && (
        <p className="mt-1 text-caption text-muted leading-relaxed">{LEGACY_CHANGE_NOTE}</p>
      )}

      <p className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-small text-ink-2 tabular-nums">
        <span>
          <b className="text-h3 font-semibold text-ink">{fetchedShown ?? '—'}</b> / {total} 取得
          {st.fetched.provenance === 'none' && !scanNone && <> <Note>取得数は記録なし</Note></>}
        </span>
        <span>
          {heldKnown ? <><b className="text-h3 font-semibold text-ink">{heldShown}</b> 保有中</>
            : st.heldAdded.provenance === 'record' ? <><b className="text-h3 font-semibold text-ink">{heldShown}</b> 保有から足した <Note>候補にも入った保有銘柄は分からない</Note></>
            : <Note>この回の保有は記録なし</Note>}
        </span>
        <span>
          <b className="text-h3 font-semibold text-ink">{analysedShown}</b> 分析対象
          {!st.analysed.complete && <> <Note>判断のある銘柄だけ分かる</Note></>}
        </span>
      </p>

      {scanNone && (
        <p className="mt-2 text-caption text-muted">この回は、{total}銘柄それぞれの変化率・順位と、値動きで選ばれた候補が記録なし</p>
      )}
      {(pickHead || heldAddedShown || st.analysed.complete) && (
        <p className={`mt-2 text-small text-ink-2 ${REVEAL} ${on(showPick)}`}>
          {st.selected.provenance === 'record'
            ? <><span className="text-muted">値動きで選ばれた候補: </span><span className="tabular-nums">{st.selected.value.join('、') || 'なし'}</span></>
            : pickHead && <Note>{st.selected.note ?? '値動きで選ばれた候補は記録なし'}</Note>}
          {heldAddedShown && (
            <><span className="text-muted">{pickHead ? '　' : ''}保有から足した: </span><span className="tabular-nums">{st.heldAdded.value.join('、')}</span></>
          )}
          {st.analysed.complete && (
            <>{(pickHead || heldAddedShown) && <br />}<span className="text-muted">分析対象: </span><span className="tabular-nums">{st.analysed.symbols.join('、')}</span></>
          )}
        </p>
      )}

      {changeEntries.length > 0 && (
        <p className={`mt-2 text-caption text-ink-2 tabular-nums leading-relaxed ${REVEAL} ${on(showPick)}`}>
          <Mark provenance="record" label="判断の記録にある当日変化率（順位は記録なし）: " />
          {changeEntries.map((sym, i) => (
            <span key={sym}>{i > 0 && <span className="text-muted">・</span>}<span className="whitespace-nowrap">{sym} {fmtPct1(recordedChange!.values[sym])}</span></span>
          ))}
        </p>
      )}
      {changeEntries.length > 0 && recordedChange!.changeBasis == null && (
        <p className={`mt-1 text-caption text-muted leading-relaxed ${REVEAL} ${on(showPick)}`}>{LEGACY_CHANGE_NOTE}</p>
      )}
      {st.rows.provenance === 'none' && !scanNone && (
        <p className="mt-1 text-caption text-muted">{st.rows.note ?? '各銘柄の変化率と順位は記録なし'}</p>
      )}

      <p className="mt-3 text-caption text-muted leading-relaxed">
        米国 {UNIVERSE_META.us}・日本 {UNIVERSE_META.jp} 銘柄。当日の変化率（上昇・下落を問わず絶対値）が大きい上位 {TICK_CANDIDATE_COUNT} 銘柄に、
        保有中の銘柄を足して分析対象にします。「保有中」でない銘柄は、その日に大きく動いたから選ばれただけで、良い銘柄だから選んだという意味ではありません。
      </p>
    </>
  )
}

// ── 段2 材料を集める ──────────────────────────────────────────────────────

function Materials({ st, s, model, phase, history, historyError, markers, instant, maIdx }: {
  st: MaterialsStage; s: number; model: ReplayModel; phase: PhaseState; history: HistoryStatus; historyError?: string | null
  markers: ReplayMarker[]; instant: boolean
  /** 段3の位置（平均線の表示は段3の進み具合で決まる） */
  maIdx: number
}) {
  const pFund = stepProgress(phase, s, 0)
  const pNews = stepProgress(phase, s, 1)
  const pLine = stepProgress(phase, s, 2)
  const symbol = st.symbol ?? ''
  const entries = FUND_FIELDS.filter(f => st.fundamentals.data[f.field] != null)
  const fundShown = revealCount(pFund, entries.length)
  const heads = st.news.headlines.value
  const newsShown = revealCount(pNews, heads.length)
  const chart = model.chart
  const hasChart = !!chart && chart.bars.length >= 2
  const barsCount = chart ? chart.bars.length : null
  const barsShown = st.bars.value != null
    ? (instant || pLine >= 1 || !hasChart ? st.bars.value : Math.round(st.bars.value * pLine))
    : null

  const ma20On = stepProgress(phase, maIdx, 0) > 0 || stageState(phase, maIdx) === 'done'
  const ma50On = stepProgress(phase, maIdx, 1) > 0 || stageState(phase, maIdx) === 'done'

  if (!st.symbol) {
    return <p className="mt-2 text-small text-muted">この回は、材料も判断も記録に残っていません。</p>
  }

  return (
    <>
      <p className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-small text-ink-2 tabular-nums">
        <span>
          {st.bars.provenance === 'none'
            ? <Note>足の本数は記録なし{history === 'loading' ? '（足を取得しています）' : ''}</Note>
            : <><b className="text-h3 font-semibold text-ink">{barsShown ?? '—'}</b> 日分の終値</>}
        </span>
        <span>
          {st.fundamentals.count.provenance === 'none'
            ? <Note>会社の数字の件数は記録なし</Note>
            : <><b className="text-h3 font-semibold text-ink">{instant || pFund >= 1 ? st.fundamentals.count.value : fundShown}</b> / {st.fundamentals.total} 会社の数字</>}
        </span>
        <span>
          {st.news.fetched.provenance === 'record' && st.news.fetched.value != null
            ? <><b className="text-h3 font-semibold text-ink">{instant || pNews >= 1 ? st.news.fetched.value : newsShown}</b> 件のニュース</>
            : <Note>取得件数は記録なし（判断に残るのは先頭2件）</Note>}
        </span>
      </p>

      {entries.length > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="会社の数字">
          {entries.map((f, i) => (
            <li key={f.field} className={`rounded-field bg-surface px-2 py-0.5 text-caption text-ink tabular-nums ${REVEAL} ${on(i < fundShown)}`}>
              {f.label} {fmtFund(f.kind, symbol, st.fundamentals.data[f.field] as number, st.fundamentals.legacy)}
            </li>
          ))}
        </ul>
      ) : st.fundamentals.ok.value === false ? (
        <p className="mt-2 text-caption text-warning-ink">会社の数字は取得できませんでした（記録から）</p>
      ) : null}

      {heads.length > 0 && (
        <ul className="mt-2 space-y-1 text-small text-ink-2" aria-label="ニュースの見出し">
          {heads.map((h, i) => (
            <li key={i} className={`${REVEAL} ${on(i < newsShown)}`}>{h}</li>
          ))}
        </ul>
      )}

      <div className="mt-3">
        {hasChart ? (
          <>
            <ReplayChart view={chart} symbol={symbol} markers={markers} draw={{ price: pLine, ma20: ma20On, ma50: ma50On }} />
            <p className="mt-1 text-caption text-muted">
              <Mark provenance="recomputed" label={`線は同じ取得元から取り直した足（${barsCount} 本）。判断日の足は判断時の価格に置き換え`} />
              {chart!.headMissing && <><br /><Mark provenance="none" label="窓の先頭が欠けている（平均線は途中から）" /></>}
            </p>
          </>
        ) : history === 'loading' ? (
          <p className="text-small text-muted">株価の足を取得しています</p>
        ) : history === 'error' ? (
          <p className="text-small text-warning-ink">株価の足を取得できませんでした{historyError ? `（${historyError}）` : ''}。線と平均線は再計算できません。</p>
        ) : chart ? (
          <p className="text-small text-muted">判断日までの足が、取得できた範囲にありません。</p>
        ) : null}
      </div>

      {st.bars.provenance === 'recomputed' && st.bars.note && (
        <p className="mt-1 text-caption text-muted">{st.bars.note}</p>
      )}
      <p className="mt-2 text-caption text-muted leading-relaxed">
        AI に渡すのは判断日までのおよそ3か月の終値、会社の数字 {st.fundamentals.total} 項目、ニュースの先頭3件です。
      </p>
    </>
  )
}

// ── 段3 指標を計算 ────────────────────────────────────────────────────────

function Indicators({ st, s, phase }: { st: IndicatorsStage; s: number; phase: PhaseState }) {
  const active = stageState(phase, s) !== 'pending'
  const p20 = stepProgress(phase, s, 0)
  const p50 = stepProgress(phase, s, 1)
  const pT = stepProgress(phase, s, 2)
  const symbol = st.symbol ?? ''
  const price = (n: number) => fmtPrice(symbol, n)
  const t = st.fromText
  const trend = st.trend.value
  // 数値が無く、記録の文の語だけを出す行（並び・RSI・MACD・BB）があるか。その注記は dl の直下に1回だけ出す
  const hasNum = (v: Sourced<unknown>) => v.provenance !== 'none' && v.value != null
  const wordOnly = (!trend && !!t.trendWord)
    || (!hasNum(st.rsi14) && !!t.rsi) || (!hasNum(st.macd) && !!t.macd) || (!hasNum(st.bb) && !!t.bb)

  const trendText = (() => {
    if (trend) {
      const cmp = trend === 'up' ? '>' : trend === 'down' ? '<' : null
      const chain = cmp ? `判断時の価格 ${cmp} 20日平均 ${cmp} 50日平均` : '価格と平均線の並びが揃っていない'
      const match = st.trendMatchesText === true ? '（記録の文と一致）'
        : st.trendMatchesText === false && t.trendWord ? `（記録の文は「${t.trendWord}」で一致しない）` : ''
      return <><span className="tabular-nums">{chain}</span> → <b className="font-semibold text-ink">{TREND_WORD[trend]}</b>{match} <Mark provenance={st.trend.provenance} /></>
    }
    if (t.trendWord) return <b className="font-semibold text-ink">{t.trendWord}</b>
    return <Note>平均線の値が無いので並びは計算できない</Note>
  })()

  const wordOrNone = (s: Sourced<unknown>, word: string | null, fmt: () => ReactNode, shown: boolean) => {
    if (!shown) return <span>　</span>
    if (hasNum(s)) return <>{fmt()} <Mark provenance={s.provenance} /></>
    if (word) return <b className="font-semibold text-ink">{word}</b>
    return <Note>記録なし</Note>
  }

  if (!st.symbol) {
    return <p className="mt-2 text-small text-muted">材料が無いので、この回の指標は計算されていません。</p>
  }

  return (
    <>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-small text-ink-2">
        <dt className="text-muted">判断時の価格</dt>
        <dd><Val s={st.price} fmt={price} shown={active} /></dd>
        <dt className="text-muted">20日平均</dt>
        <dd><Val s={st.ma20} fmt={price} shown={p20 > 0} /></dd>
        <dt className="text-muted">50日平均</dt>
        <dd><Val s={st.ma50} fmt={price} shown={p50 > 0} /></dd>
        <dt className="text-muted">並び</dt>
        <dd className={`${REVEAL} ${on(pT > 0)}`}>{trendText}</dd>
        <dt className="text-muted">RSI<span className="hidden sm:inline">（過熱の目安）</span></dt>
        <dd>{wordOrNone(st.rsi14, t.rsi, () => <b className="font-semibold text-ink tabular-nums">{st.rsi14.value!.toFixed(1)}</b>, pT > 0)}</dd>
        <dt className="text-muted">MACD<span className="hidden sm:inline">（勢いの目安）</span></dt>
        <dd>{wordOrNone(st.macd, t.macd, () => {
          const m = st.macd.value!
          return <span className="tabular-nums"><b className="font-semibold text-ink">{m.macd.toFixed(2)}</b> / シグナル {m.signal.toFixed(2)} / 差 {m.histogram.toFixed(2)}</span>
        }, pT > 0)}</dd>
        <dt className="text-muted">BB<span className="hidden sm:inline">（値幅の目安）</span></dt>
        <dd>{wordOrNone(st.bb, t.bb, () => {
          const b = st.bb.value!
          return <span className="tabular-nums">上 {price(b.upper)} / 中 {price(b.middle)} / 下 {price(b.lower)}</span>
        }, pT > 0)}</dd>
      </dl>
      {wordOnly && (
        <p className={`mt-1 text-caption text-muted ${REVEAL} ${on(pT > 0)}`}>記録の文から。数値そのものは記録なし</p>
      )}
    </>
  )
}

// ── 段4 知識を読む ────────────────────────────────────────────────────────

function Knowledge({ st, s, phase }: { st: KnowledgeStage; s: number; phase: PhaseState }) {
  const p = stepProgress(phase, s, 0)
  const items = st.items.value
  const shown = revealCount(p, items.length)
  if (st.items.provenance === 'none') {
    return <p className="mt-2 text-small text-ink-2"><Note>{st.items.note ?? 'この回に提示した知識は記録なし'}</Note></p>
  }
  // AI を呼ばなかった回は読みにも行っていない（「0件を選んだ」と書くと事実と違う）
  if (st.skipped) {
    return (
      <p className="mt-2 text-small text-ink-2">
        AI を呼ばないため、知識は読んでいません。
        <span className="text-muted"> 呼ぶ回は、蓄えた知識を最大 60 件読み、そこから最大 6 件を選ぶ仕組みです。</span>
      </p>
    )
  }
  return (
    <>
      <p className="mt-2 text-small text-ink-2">
        今回は <b className="text-h3 font-semibold text-ink tabular-nums">{items.length}</b> 件。
        <span className="text-muted"> 蓄えた知識を最大 60 件読み、そこから最大 6 件を選ぶ仕組みです。</span>
      </p>
      {items.length > 0 && (
        <ol className="mt-1 list-decimal pl-5 text-small text-ink-2 space-y-0.5">
          {items.map((k, i) => <li key={k.id} className={`${REVEAL} ${on(i < shown)}`}>{k.title}</li>)}
        </ol>
      )}
    </>
  )
}

// ── 段5 AI に聞く ─────────────────────────────────────────────────────────

function Ai({ st, s, model, phase }: { st: AiStage; s: number; model: ReplayModel; phase: PhaseState }) {
  const pGather = stepProgress(phase, s, 0)
  const pThink = stepProgress(phase, s, 1)
  const state = stageState(phase, s)
  const chips = aiChips(st, model)
  // 札が「渡し終えて」消えるのは再生中だけ。静止した完成状態（初回・飛ばした後・動きを減らす設定・再生の終了後）は見せたまま残す
  const playing = phase.stage < model.stages.length
  const gone = playing ? revealCount(pGather, chips.symbols.length) : 0
  const thinking = state === 'active' && pThink > 0 && pThink < 1
  const answered = pThink >= 1
  // モデル・所要時間・トークン・終わり方が4つとも記録なしなら、行ごとに書かない。見出しの印（sourceLabel）が
  // 既に「記録なし」と言っている項目は繰り返さず、足りない分だけ短く書く（全部言っていれば何も出さない）
  const processNone = st.model.provenance === 'none' && st.stopReason.provenance === 'none'
    && st.inputTokens.provenance === 'none' && st.ms.provenance === 'none'
  const headSays = (w: string) => st.sourceLabel.includes('記録なし') && st.sourceLabel.includes(w)
  const processNote = !processNone ? null
    : !(headSays('モデル') && headSays('所要時間')) ? 'この回には過程の記録がないため、モデル・所要時間・トークン・終わり方は記録なし'
    : headSays('トークン') && headSays('終わり方') ? null
    : 'トークンと終わり方も記録なし'
  // 返事の行に出すものが無い（4つとも記録なしで、見出しの印が全部言っている）ときは、行ごと出さない
  const replyLine = !(answered && processNone && processNote == null)

  // AI を呼ばなかった回（材料を取得できた銘柄が0件・2026-09-17）: 渡した札も返事の行もモデル・終わり方の表も出さない
  // （呼んでいないものを「打ち切り」「記録なし」と書かない）。stopReason の英語は画面に出さない
  if (st.skipped) {
    return (
      <p className="mt-2 text-small text-ink-2">
        <b className="font-semibold text-ink">AI は呼ばなかった。</b>
        <span className="text-muted"> 材料を取得できた銘柄が0件だったため、知識も読まず、AI に何も渡していません。費用も待ち時間も使っていません。</span>
      </p>
    )
  }

  return (
    <>
      {chips.symbols.length > 0 ? (
        <>
          <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="AI に渡した銘柄">
            {chips.symbols.map((sym, i) => (
              <li key={sym} className={`rounded-full bg-surface px-2.5 py-0.5 text-caption text-ink tabular-nums transition-all duration-200 ease-out motion-reduce:transition-none ${i < gone ? 'translate-x-4 opacity-0' : 'opacity-100'}`}>{sym}</li>
            ))}
          </ul>
          <p className="mt-1 text-caption text-muted">
            {chips.provenance === 'record'
              ? <Mark provenance="record" label={`実際に渡した ${chips.symbols.length} 銘柄。1回でまとめて渡す`} />
              : <Mark provenance="none" label={st.symbolsSent.note ?? '渡した銘柄は記録なし'} />}
          </p>
        </>
      ) : (
        <p className="mt-2 text-caption"><Mark provenance="none" label={st.symbolsSent.note ?? '渡した銘柄は記録なし'} /></p>
      )}

      {replyLine && (
        <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-small text-ink-2" aria-hidden={!thinking && !answered}>
          {thinking && (
            <span className="inline-flex items-center gap-1" aria-hidden>
              <span className="h-1.5 w-1.5 rounded-full bg-brand motion-safe:animate-pulse" />
              <span className="h-1.5 w-1.5 rounded-full bg-brand motion-safe:animate-pulse [animation-delay:200ms]" />
              <span className="h-1.5 w-1.5 rounded-full bg-brand motion-safe:animate-pulse [animation-delay:400ms]" />
            </span>
          )}
          {thinking ? <span>AI が判断を書いています</span> : answered ? (
            processNone ? <Note>{processNote}</Note> : (
              <span>
                返事: {st.ms.provenance === 'record' && st.ms.value != null
                  ? <><b className="font-semibold text-ink tabular-nums">実際は {fmtSec(st.ms.value)}</b> <Mark provenance="record" /></>
                  : <Note>所要時間は記録なし</Note>}
              </span>
            )
          ) : <span>　</span>}
        </p>
      )}

      <dl className={`${replyLine ? 'mt-2' : 'mt-3'} grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-small text-ink-2 ${REVEAL} ${on(answered)}`}>
        {!processNone && (
          <>
            <dt className="text-muted">モデル</dt>
            <dd><Val s={st.model} fmt={m => m} noneText="モデルは記録なし" /></dd>
            <dt className="text-muted">終わり方</dt>
            <dd><Val s={st.stopReason} fmt={stopReasonLabel} noneText="記録なし" /></dd>
            <dt className="text-muted">トークン</dt>
            <dd>
              {st.inputTokens.provenance === 'record' && st.inputTokens.value != null
                ? <span className="tabular-nums">入力 {fmtInt(st.inputTokens.value)}・出力 {st.outputTokens.value != null ? fmtInt(st.outputTokens.value) : '—'}</span>
                : <Note>記録なし</Note>}
            </dd>
          </>
        )}
        <dt className="text-muted">判断の数</dt>
        <dd>
          {st.expected.provenance === 'record' && st.expected.value != null
            ? <span className="tabular-nums"><b className="font-semibold text-ink">{st.returned.value}</b> / {st.expected.value} 銘柄</span>
            : <span className="tabular-nums"><b className="font-semibold text-ink">{st.returned.value}</b> 銘柄 <Note>（分母は記録なし）</Note></span>}
        </dd>
      </dl>

      <p className="mt-3 text-caption text-muted leading-relaxed">
        今の設定: 返事の上限 {fmtInt(DECISION_MAX_TOKENS)} トークン・{CLAUDE_TIMEOUT_MS / 1000} 秒で打ち切り（engine.ts と同じ値）。
        渡すもの: 資産状況、各銘柄の価格と前日比、指標の要約、会社の数字、ニュース先頭3件、これまでの学習の要約、判断基準。返事は JSON（機械が読める形）で受け取ります。
      </p>
    </>
  )
}

// ── 段6 判断 ──────────────────────────────────────────────────────────────

/**
 * 'empty'（返事はあったが判断を1件も読めなかった）の回の失敗の行。記録の中の手掛かり（replay-model の
 * classifyEmptyReply）で出し分ける（2026-09-18 決定）。「打ち切られ」と書くのは本当に上限で打ち切られた回だけ。
 * 事実だけを言い、断定しない。英語（empty / max_tokens / end_turn）は出さない。保存値は変えない
 */
export const EMPTY_REPLY_TEXT = {
  /** AI に渡した銘柄が0件だった回（2026-09-17 より前は材料0件でも呼んでいた） */
  noSymbols: 'AI に渡した銘柄が0件だったため、判断は返ってきませんでした',
  /** 返事の上限（max_tokens）で打ち切られた回。変更前と同じ「打ち切られ」の文（事実に合う） */
  maxTokens: 'AI の返事が打ち切られ、この回の判断は記録なし（返事の上限に達して打ち切られ、判断を1件も読めなかった）',
  /** 終わり方が max_tokens 以外と分かっている回、または手掛かりが無い回。打ち切りと断定しない中立の文 */
  other: 'AI の返事に、使える判断が1件もありませんでした',
} as const

/** 段6 の失敗の行の文。'empty' 以外（timeout / error）は変更前の文のまま */
function failureText(f: NonNullable<DecisionsStage['failure']>): string {
  switch (f.emptyKind) {
    case 'no-symbols': return EMPTY_REPLY_TEXT.noSymbols
    case 'max-tokens': return EMPTY_REPLY_TEXT.maxTokens
    case 'other':
    case 'unknown': return EMPTY_REPLY_TEXT.other
    default:
      return `AI の返事が打ち切られ、この回の判断は記録なし（${stopReasonLabel(f.stopReason)}${f.note ? `・${f.note}` : ''}）`
  }
}

function Decisions({ st, s, phase }: { st: DecisionsStage; s: number; phase: PhaseState }) {
  const pRows = stepProgress(phase, s, 0)
  const pFocus = stepProgress(phase, s, 1)
  const shown = revealCount(pRows, st.rows.length)
  const f = st.focus

  return (
    <>
      {st.failure && (
        <p className="mt-2 text-small text-warning-ink">
          {failureText(st.failure)}
        </p>
      )}
      {st.skipped && (
        <p className="mt-2 text-small text-ink-2">
          材料が0件のため AI には聞いていません。<Note>判断が無いのは、返事が無かったからではなく、聞いていないからです</Note>
        </p>
      )}

      {st.rows.length > 0 && (
        <ul className="mt-2" aria-label="銘柄ごとの判断">
          {st.rows.map((r, i) => (
            <li key={r.symbol} className={`flex flex-wrap items-center gap-x-3 gap-y-0.5 border-t border-border py-2 text-small first:border-t-0 ${REVEAL} ${on(i < shown)}`}>
              <span className="w-16 font-semibold text-ink tabular-nums">{r.symbol}</span>
              {r.action ? <ActionPill action={r.action} /> : <span className="text-muted">{st.skipped ? '材料を取得できず' : '判断の記録なし'}</span>}
              {r.confidence && <span className="text-caption text-muted">確信度 {CONFIDENCE_LABEL[r.confidence]}</span>}
              {r.price != null && <span className="ml-auto tabular-nums text-ink-2">{fmtPrice(r.symbol, r.price)}</span>}
              {r.held === true && <span className="text-caption text-muted">保有中</span>}
            </li>
          ))}
        </ul>
      )}

      {f && (
        <div className={`mt-4 border-t border-border pt-3 ${REVEAL} ${on(pFocus > 0)}`}>
          <h4 className="text-small font-semibold text-ink">この回で詳しく見る銘柄</h4>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-small">
            <span className="text-h3 font-semibold text-ink tabular-nums">{f.symbol}</span>
            <ActionPill action={f.action} />
            <span className="tabular-nums text-ink-2">{fmtPrice(f.symbol, f.price)}</span>
            <span className="text-caption text-muted">確信度 {CONFIDENCE_LABEL[f.confidence]}</span>
          </p>
          <p className="mt-2 text-body text-ink-2 max-w-[42rem]">{f.reasoning || <span className="text-muted">判断の理由は記録されていません。</span>}</p>
          {f.technicals && <p className="mt-1 text-small text-ink-2 max-w-[42rem]"><span className="text-muted">値動きの読み: </span>{f.technicals}</p>}
          {f.fundamentalsProse && <p className="mt-1 text-small text-ink-2 max-w-[42rem]"><span className="text-muted">会社の数字の読み: </span>{f.fundamentalsProse}</p>}
          <p className="mt-2 text-small text-ink-2 tabular-nums">
            <span className="text-muted">保有: </span>
            {f.holding.provenance === 'none'
              ? <Note>{f.holding.note ?? 'この回の時点の保有は記録なし'}</Note>
              : f.holding.value == null
                ? <Note>{f.holding.note ?? '判断時点では保有していない'}</Note>
                : <>
                    {jstDate(f.holding.value.entryAt)} に {fmtPrice(f.symbol, f.holding.value.avgCost)} で {f.holding.value.shares.toFixed(2)} 株
                    {f.holdingPnlPct.provenance === 'recomputed' && f.holdingPnlPct.value != null && (
                      <>。判断時の価格は取得単価から <b className="font-semibold text-ink">{fmtPct1(f.holdingPnlPct.value)}</b> <Note>{f.holdingPnlPct.note ?? '取得単価と判断時の価格から計算'}</Note></>
                    )}
                  </>}
          </p>
        </div>
      )}
    </>
  )
}

// ── 段7 売買 ──────────────────────────────────────────────────────────────

function Trades({ st, s, phase }: { st: TradesStage; s: number; phase: PhaseState }) {
  const p = stepProgress(phase, s, 0)
  const rows = st.trades.value
  const shown = revealCount(p, rows.length)
  return (
    <ul className="mt-2" aria-label="この回の売買">
      {rows.map((t, i) => (
        <li key={`${t.symbol}-${t.timestamp}-${i}`} className={`border-t border-border py-2 text-small first:border-t-0 ${REVEAL} ${on(i < shown)}`}>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 tabular-nums">
            <span className="text-muted">{jstTime(t.timestamp)}</span>
            <span className="font-semibold text-ink">{t.symbol}</span>
            <span className="text-ink">{t.action === 'buy' ? '▲ 買い' : '▼ 売り'}</span>
            <span className="text-ink-2">{t.shares.toFixed(2)} 株</span>
            <span className="text-ink-2">{fmtPrice(t.symbol, t.price)}</span>
            <span className="ml-auto text-ink-2">合計 {fmtPrice(t.symbol, t.total)}</span>
          </p>
          {t.reason && <p className="mt-0.5 text-small text-ink-2 max-w-[42rem]">{t.reason}</p>}
        </li>
      ))}
    </ul>
  )
}

// ── 段の並べ方 ────────────────────────────────────────────────────────────

export default function ReplayStages({ model, phase, history, historyError, markers, instant = false, recordedChange, stageRefs }: ReplayStagesProps) {
  const total = model.stages.length
  const playing = phase.stage < total
  const maIdx = model.stages.findIndex(s => s.key === 'indicators')

  return (
    <ol className="m-0 list-none p-0">
      {model.stages.map((st, i) => {
        const state = stageState(phase, i)
        const dim = playing && state === 'pending'
        const last = i === total - 1
        const dot = state === 'done' ? 'border-brand bg-brand' : state === 'active' ? 'border-brand bg-brand-tint' : 'border-border bg-card'
        // AI を呼ばなかった回の段4・段5は記録の所要 0ms を「実測 0.0秒」と見せない（測っていない・やっていない）
        const msHidden = (st.key === 'knowledge' || st.key === 'ai') && st.skipped
        return (
          <li
            key={st.key}
            ref={el => { if (stageRefs) stageRefs.current[i] = el }}
            data-stage={st.key}
            data-state={state}
            className={`grid grid-cols-[28px_minmax(0,1fr)] sm:grid-cols-[72px_minmax(0,1fr)] transition-opacity duration-200 ease-out ${dim ? 'opacity-40' : 'opacity-100'}`}
          >
            <div className="pr-1 pt-4 sm:pr-3">
              <span className="block text-small font-semibold text-ink tabular-nums leading-tight">{st.no}</span>
              <span className="mt-0.5 hidden text-caption text-muted leading-tight sm:block">{STAGE_NAMES[st.key]}</span>
            </div>
            <div className={`relative min-w-0 border-l pl-3 sm:pl-5 ${last ? 'border-transparent pb-0' : 'border-border pb-6'}`}>
              <span aria-hidden className={`absolute -left-[7px] top-[18px] h-[13px] w-[13px] rounded-full border-2 transition-colors duration-200 ${dot}`} />
              <section className="rounded-card bg-card px-3 py-4 sm:px-4" aria-labelledby={`replay-stage-${st.key}`}>
                <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <h3 id={`replay-stage-${st.key}`} className="text-body font-semibold text-ink text-balance">
                    <span className="sm:hidden">{STAGE_NAMES[st.key]}　</span>{st.title}
                  </h3>
                  <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-0.5">
                    <Mark provenance={st.provenance} label={st.sourceLabel} />
                    {!msHidden && st.ms.provenance === 'record' && st.ms.value != null && (
                      <span className="text-caption text-muted tabular-nums">実測 {fmtSec(st.ms.value)}</span>
                    )}
                  </span>
                </header>
                {st.key === 'candidates' && <Candidates st={st} s={i} phase={phase} instant={instant} recordedChange={recordedChange} />}
                {st.key === 'materials' && <Materials st={st} s={i} model={model} phase={phase} history={history} historyError={historyError} markers={markers} instant={instant} maIdx={maIdx} />}
                {st.key === 'indicators' && <Indicators st={st} s={i} phase={phase} />}
                {st.key === 'knowledge' && <Knowledge st={st} s={i} phase={phase} />}
                {st.key === 'ai' && <Ai st={st} s={i} model={model} phase={phase} />}
                {st.key === 'decisions' && <Decisions st={st} s={i} phase={phase} />}
                {st.key === 'trades' && <Trades st={st} s={i} phase={phase} />}
              </section>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
