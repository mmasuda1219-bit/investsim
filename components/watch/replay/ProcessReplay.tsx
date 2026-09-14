'use client'

// /watch の中心部品「分析の過程の再生」（DESIGN.md §6-19）の外枠。
//
//  - 回の一覧（listReplayRounds）と選択。既定は「判断のある最新の回」（findStateRound）
//  - この回で詳しく見る銘柄（pickFocusSymbol）の足を既存 chart API から銘柄ごとに1回だけ取り、
//    buildReplayModel に渡して株価・平均線を再計算する
//  - 操作: 「過程を再生する」↔「結果まで飛ばす」（同じスロット・終了後は「もう一度再生する」）、速さ（ふつう／3倍）、
//    再生中の Esc で飛ばす。初回表示は静止した完成状態。端末の「動きを減らす」設定では操作を出さず再生しない
//  - role="status" aria-live="polite" は1つ。読むのは再生開始・各段の開始（3倍では開始と終了だけ）・終了要約のみ
//  - 免責は再生の直下に small・--ink-2（marketing/RULES.md §2(a) の短い版）
//
// 原則9: 値は replay-model が出どころの印付きで返すものだけ。ここで数字を作らない。
// 原則11: 勝率・成績を出さない。おすすめ・買い時・注目銘柄の語を使わない。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AISession, AIDecision } from '@/lib/ai-trader/engine'
import {
  listReplayRounds, findStateRound, pickFocusSymbol, buildReplayModel,
  type ReplayHistoryBar, type ReplayRound,
} from '@/lib/ai-trader/replay-model'
import ReplayStages, { planFor, STAGE_NAMES, ProvDot, type HistoryStatus } from './ReplayStages'
import type { ReplayMarker } from './ReplayChart'
import { useReplayClock, type ReplaySpeed } from './useReplayClock'

export interface ProcessReplayProps {
  session: AISession
}

interface ChartEntry {
  status: HistoryStatus
  history: ReplayHistoryBar[]
  markers: ReplayMarker[]
  error?: string
}

// RULES.md §2(a) 短い版。部品の中で文言を作り直さない（§6-11）
const DISCLAIMER =
  'InvestSimは仮想資金で投資判断を練習するシミュレーターです。実際の売買・決済は行いません。' +
  '特定銘柄の推奨や投資助言・勧誘を目的とするものではなく、投資の最終判断はご自身の責任でお願いします。個別の投資相談にはお答えできません。'

const PRIMARY =
  'inline-flex h-12 items-center justify-center rounded-card bg-brand px-5 text-body font-semibold text-on-brand transition-colors hover:bg-brand-strong focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-2'
const SECONDARY =
  'inline-flex h-12 items-center justify-center rounded-card border border-border-input bg-card px-5 text-body font-semibold text-ink transition-colors hover:bg-surface focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-2'
const chip = (selected: boolean) =>
  `inline-flex min-h-11 items-center rounded-field border px-3 text-small font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-2 ${
    selected ? 'border-brand bg-brand-tint text-brand' : 'border-border-input bg-card text-ink hover:bg-surface'
  }`

const JST = 'Asia/Tokyo'
function jstShort(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const parts = new Intl.DateTimeFormat('ja-JP', { timeZone: JST, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d)
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? ''
  return `${get('month')}/${get('day')} ${get('hour')}:${get('minute')}`
}
function jstFull(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return new Intl.DateTimeFormat('ja-JP', { timeZone: JST, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(d)
}

// session.decisions は複数回ぶんが新しい順に積まれた1本の配列。「先頭から銘柄が重複しない並び」が直近1回ぶん
// （app/watch/client.tsx の leadingUniqueRun と同じ近似）。当日変化率（AIDecision.change）は allDecisions に無いので、ここから拾う
function leadingUniqueRun(decisions: AIDecision[]): AIDecision[] {
  const seen = new Set<string>()
  const out: AIDecision[] = []
  for (const d of decisions) {
    if (seen.has(d.symbol)) break
    seen.add(d.symbol)
    out.push(d)
  }
  return out
}

export default function ProcessReplay({ session }: ProcessReplayProps) {
  const sessionId = session.id
  const rounds = useMemo(() => listReplayRounds(session), [session])
  const stateRound = useMemo(() => findStateRound(session, rounds), [session, rounds])
  const defaultId = stateRound?.id ?? rounds[0]?.id ?? null

  const [pickedId, setPickedId] = useState<string | null>(null)
  const roundId = pickedId && rounds.some(r => r.id === pickedId) ? pickedId : defaultId
  const round: ReplayRound | null = rounds.find(r => r.id === roundId) ?? null
  const focusSymbol = round ? pickFocusSymbol(session, round, rounds) : null

  // ── 足の取得（銘柄ごとに1回。セッションが変わったら捨てる） ──
  const chartsRef = useRef(new Map<string, ChartEntry>())
  const chartsSessionRef = useRef(sessionId)
  const [charts, setCharts] = useState<Map<string, ChartEntry>>(() => new Map())
  const mountedRef = useRef(true)
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false } }, [])
  // 足の取得の中断（アンマウント時・セッションが変わったとき）。中断は失敗として扱わず、表示に何も出さない
  const abortRef = useRef<AbortController | null>(null)
  useEffect(() => () => {
    abortRef.current?.abort()
    // 取得途中の銘柄は未取得に戻す（付け直されたとき＝開発時の StrictMode など、に取り直せるように）
    for (const [sym, e] of chartsRef.current) if (e.status === 'loading') chartsRef.current.delete(sym)
  }, [])
  useEffect(() => {
    if (chartsSessionRef.current !== sessionId) {
      abortRef.current?.abort()
      chartsSessionRef.current = sessionId
      chartsRef.current = new Map()
      setCharts(new Map())
    }
    if (!focusSymbol || chartsRef.current.has(focusSymbol)) return
    const symbol = focusSymbol
    if (!abortRef.current || abortRef.current.signal.aborted) abortRef.current = new AbortController()
    const { signal } = abortRef.current
    const publish = (entry: ChartEntry) => {
      // 中断した取得の結果は捨てる（catch に来ても status:'error' にしない）
      if (signal.aborted || !mountedRef.current || chartsSessionRef.current !== sessionId) return
      chartsRef.current.set(symbol, entry)
      setCharts(new Map(chartsRef.current))
    }
    publish({ status: 'loading', history: [], markers: [] })
    fetch(`/api/ai-session/${sessionId}/chart/${encodeURIComponent(symbol)}`, { cache: 'no-store' })
      .then(async r => {
        const d = await r.json()
        if (!r.ok || d.error) throw new Error(d.error ?? `HTTP ${r.status}`)
        return d as { history?: ReplayHistoryBar[]; trades?: Array<{ time: number; action: string; price: number }> }
      })
      .then(d => publish({
        status: 'ready',
        history: d.history ?? [],
        markers: (d.trades ?? [])
          .filter(t => t.action === 'buy' || t.action === 'sell')
          .map(t => ({ time: t.time < 1e11 ? t.time * 1000 : t.time, action: t.action as 'buy' | 'sell', price: t.price })),
      }))
      .catch(e => publish({ status: 'error', history: [], markers: [], error: e instanceof Error ? e.message : '取得に失敗しました' }))
  }, [sessionId, focusSymbol])

  const entry = focusSymbol ? charts.get(focusSymbol) : undefined
  const historyStatus: HistoryStatus = entry?.status ?? (focusSymbol ? 'loading' : 'ready')
  const history = entry?.status === 'ready' ? entry.history : undefined

  const model = useMemo(
    () => (round ? buildReplayModel(session, round, { history, rounds }) : null),
    [session, round, history, rounds],
  )
  // 回の一覧の札に出す「第N回」は、最後に成功した回だけ tickCount から分かる
  const stateTickNumber = useMemo(
    () => (stateRound ? buildReplayModel(session, stateRound, { rounds }).round.tickNumber : null),
    [session, stateRound, rounds],
  )
  const plan = useMemo(() => (model ? planFor(model) : []), [model])
  const planMs = useMemo(() => plan.reduce((n, s) => n + s.steps.reduce((m, st) => m + st.ms, 0), 0), [plan])

  // ── 直近の判断に残る当日変化率（TickSummary が持っていた情報。40銘柄の走査が記録に無い回の補い） ──
  const watchlist = session.watchlist ?? []
  const latestRun = useMemo(() => leadingUniqueRun(session.decisions ?? []), [session.decisions])
  const watchSet = useMemo(() => new Set(watchlist), [watchlist])
  const decisionsFromLatestTick = watchlist.length > 0 && latestRun.length > 0 && latestRun.every(d => watchSet.has(d.symbol))
  const isStateRoundShown = !!round && !!stateRound && round.id === stateRound.id
  const recordedChange = useMemo(() => {
    if (!isStateRoundShown || !(decisionsFromLatestTick || watchlist.length === 0)) return undefined
    const out: Record<string, number> = {}
    for (const d of latestRun) if (typeof d.change === 'number' && Number.isFinite(d.change)) out[d.symbol] = d.change
    return Object.keys(out).length > 0 ? out : undefined
  }, [isStateRoundShown, decisionsFromLatestTick, watchlist.length, latestRun])

  // ── 時計・読み上げ・自動スクロール ──
  const [live, setLive] = useState('')
  const stageRefs = useRef<(HTMLLIElement | null)[]>([])
  const userScrolledRef = useRef(false)
  const modelRef = useRef(model)
  modelRef.current = model

  const onStage = useCallback((i: number, event: 'start' | 'end', speed: ReplaySpeed) => {
    const m = modelRef.current
    if (!m) return
    const st = m.stages[i]
    if (!st) return
    if (event === 'start') {
      if (i === 0) {
        const sec = Math.round(planMs / speed / 1000)
        setLive(`過程の再生を始めます。${m.stages.length} 段、約 ${sec} 秒。段1 ${STAGE_NAMES[st.key]}`)
      } else if (speed < 3) {
        setLive(`段${st.no} ${STAGE_NAMES[st.key]}`)
      }
      if (!userScrolledRef.current) {
        const el = stageRefs.current[i]
        if (el && typeof el.scrollIntoView === 'function') {
          el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
        }
      }
    }
  }, [planMs])

  const clock = useReplayClock(plan, onStage)
  const { phase, playing, done, play, skip, reset, speed, setSpeed, reduced } = clock

  // 回を切り替えたら静止した完成状態に戻す
  useEffect(() => { reset() }, [roundId, reset])

  // 終了要約（自然に終わっても、飛ばしても）
  const prevPlayingRef = useRef(false)
  useEffect(() => {
    if (prevPlayingRef.current && !playing && model) {
      const a = model.summary.analysed
      setLive(`再生を終えました。監視 ${model.summary.universe} 銘柄、分析 ${a == null ? '記録なし' : `${a} 銘柄`}、判断 ${model.summary.decided} 件`)
    }
    prevPlayingRef.current = playing
  }, [playing, model])

  // 再生中の Esc で飛ばす。利用者が自分でスクロールしたら自動スクロールを止める
  useEffect(() => {
    if (!playing) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); skip(); return }
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(e.key)) userScrolledRef.current = true
    }
    const onUser = () => { userScrolledRef.current = true }
    window.addEventListener('keydown', onKey)
    window.addEventListener('wheel', onUser, { passive: true })
    window.addEventListener('touchmove', onUser, { passive: true })
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('wheel', onUser)
      window.removeEventListener('touchmove', onUser)
    }
  }, [playing, skip])

  const startPlay = useCallback(() => {
    userScrolledRef.current = false
    play()
  }, [play])

  // ── 表示 ──
  const defaultNotNewest = !!stateRound && rounds.length > 0 && stateRound.id !== rounds[0].id
  const pastPicked = !!round && !!stateRound && round.id !== stateRound.id
  const watchlistNewer = isStateRoundShown && watchlist.length > 0 && !decisionsFromLatestTick

  const optionLabel = (r: ReplayRound) => {
    const t = jstShort(r.at)
    if (stateRound && r.id === stateRound.id && stateTickNumber != null) return `${t}（第${stateTickNumber}回）`
    if (r.decisions.length === 0) return `${t}（判断なし）`
    return t
  }

  return (
    <section className="space-y-2" aria-labelledby="replay-heading">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 id="replay-heading" className="text-small text-muted">AI の判断の過程</h2>
        {rounds.length > 0 && (
          <label className="flex items-center gap-2 text-small text-muted">
            <span>回</span>
            <select
              value={roundId ?? ''}
              onChange={e => setPickedId(e.target.value)}
              className="min-h-11 rounded-field border border-border-input bg-card px-3 text-body text-ink tabular-nums focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-2"
              aria-label="再生する回"
            >
              {rounds.map(r => <option key={r.id} value={r.id}>{optionLabel(r)}</option>)}
            </select>
          </label>
        )}
      </div>

      {!model || !round ? (
        <div className="rounded-card bg-card px-4 py-5">
          <p className="text-body text-ink-2 max-w-[42rem]">まだ再生できる分析の記録がありません。最初の分析が行われると、AI が何を集め、何を計算し、どう判断したかをここで追えます。</p>
        </div>
      ) : (
        <>
          <div className="space-y-3 rounded-card bg-card px-4 py-5">
            <p className="text-body text-ink-2 max-w-[42rem]">
              AI が実際に行った順に、何を集め、何を計算し、どう判断したかを追います。時間は縮めて再生します。数字は本番の記録か、同じ取得元から計算し直したものです。
            </p>
            <p className="text-small text-muted tabular-nums">
              {model.round.tickNumber != null && <>第{model.round.tickNumber}回　</>}
              {jstFull(round.at)}（日本時間）　監視 {model.summary.universe} 銘柄 → 分析 {model.summary.analysed == null ? '記録なし' : `${model.summary.analysed} 銘柄`} → 判断 {model.summary.decided} 件
              {model.totalMs.provenance === 'record' && model.totalMs.value != null && <>　実測 {(model.totalMs.value / 1000).toFixed(1)} 秒</>}
            </p>
            {defaultNotNewest && !pastPicked && (
              <p className="text-small text-ink-2 max-w-[42rem]">これより新しい回は判断が記録されていないため、判断のある最新の回を出しています。</p>
            )}
            {pastPicked && (
              <p className="text-small text-ink-2 max-w-[42rem]">過去の回は残る記録が少なく「記録なし」の段が増えます。</p>
            )}
            {watchlistNewer && (
              <p className="text-small text-ink-2 max-w-[42rem]">
                最新の分析（{jstShort(session.lastTickAt)}）は分析する銘柄を選ぶところまで進みましたが、AI の判断は記録されていません。段1の分析対象はその回のもので、判断はこの回のものです。
              </p>
            )}

            {reduced ? (
              <p className="text-small text-ink-2">端末の「動きを減らす」設定に合わせ、再生せず結果を表示しています。</p>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                {playing ? (
                  <button type="button" onClick={skip} className={SECONDARY}>結果まで飛ばす</button>
                ) : (
                  <button type="button" onClick={startPlay} className={PRIMARY}>{done ? 'もう一度再生する' : '過程を再生する'}</button>
                )}
                <div role="group" aria-label="再生の速さ" className="flex items-center gap-1.5">
                  <button type="button" aria-pressed={speed === 1} onClick={() => setSpeed(1)} className={chip(speed === 1)}>ふつう</button>
                  <button type="button" aria-pressed={speed === 3} onClick={() => setSpeed(3)} className={chip(speed === 3)}>3倍</button>
                </div>
                <span className="text-caption text-muted tabular-nums">約 {Math.round(planMs / speed / 1000)} 秒</span>
              </div>
            )}

            <p className="flex flex-wrap gap-x-4 gap-y-1 text-caption text-muted" aria-label="印の意味">
              <span className="inline-flex items-center gap-1.5"><ProvDot provenance="record" />記録から</span>
              <span className="inline-flex items-center gap-1.5"><ProvDot provenance="recomputed" />同じ取得元から計算し直した</span>
              <span className="inline-flex items-center gap-1.5"><ProvDot provenance="none" />記録なし</span>
            </p>
          </div>

          <div role="status" aria-live="polite" className="sr-only" data-replay-live="">{live}</div>

          <div className="pt-2">
            <ReplayStages
              model={model}
              phase={phase}
              history={historyStatus}
              historyError={entry?.error ?? null}
              markers={entry?.markers ?? []}
              instant={speed >= 3}
              recordedChange={recordedChange}
              stageRefs={stageRefs}
            />
          </div>
        </>
      )}

      <p className="text-small text-ink-2 max-w-[42rem]">{DISCLAIMER}</p>
    </section>
  )
}
