'use client'

// 分析の過程の再生（DESIGN.md §6-19）の「時計」。段（stage）と、その中の手順（step）の所要時間を受け取り、
// requestAnimationFrame で進行状態 {stage, step, progress} を刻む。見た目は一切持たない。
//
//  - 静止した完成状態 … stage = plan.length（全段が終わった位置）。ページを開いた直後・飛ばした後・
//    「動きを減らす」設定のときはこの状態のまま
//  - play()  … 先頭から刻み始める。所要 0ms の手順は待たずに次へ（0件の段は待たない）
//  - skip()  … 直ちに完成状態へ
//  - speed   … 1（ふつう）か 3（3倍）。再生の途中で変えても、いまの手順の進み具合を保ったまま速さだけ変わる
//  - reduced … 端末の prefers-reduced-motion。true のとき play() は何もしない（動かさない）。
//    再生の途中で true になったら skip() と同じく、その場で完成状態へ
//
// 時刻は performance.now() だけを使う（Date.now は使わない）。

import { useCallback, useEffect, useRef, useState } from 'react'

export interface StepPlan {
  key: string
  /** ふつうの速さでの所要（ms）。0 なら待たずに次へ */
  ms: number
}

export interface StagePlan {
  key: string
  steps: StepPlan[]
}

export interface PhaseState {
  /** いまの段（0 始まり）。plan.length なら全段が終わった静止状態 */
  stage: number
  step: number
  /** いまの手順の進み具合 0〜1 */
  progress: number
}

export type ReplaySpeed = 1 | 3

export type StageEvent = 'start' | 'end'

export interface ReplayClock {
  phase: PhaseState
  playing: boolean
  /** 一度でも最後まで再生した（または飛ばした）か。ボタンの文言（もう一度再生する）に使う */
  done: boolean
  play: () => void
  skip: () => void
  /** 静止した完成状態に戻す（回を切り替えたとき） */
  reset: () => void
  speed: ReplaySpeed
  setSpeed: (s: ReplaySpeed) => void
  reduced: boolean
}

export function completePhase(plan: StagePlan[]): PhaseState {
  return { stage: plan.length, step: 0, progress: 1 }
}

/** 段 s の状態。静止状態（stage = plan.length）ではすべて 'done'。 */
export function stageState(phase: PhaseState, s: number): 'pending' | 'active' | 'done' {
  if (phase.stage > s) return 'done'
  if (phase.stage < s) return 'pending'
  return 'active'
}

/** 段 s の手順 k の進み具合（0〜1）。過ぎた手順は 1、まだの手順は 0。 */
export function stepProgress(phase: PhaseState, s: number, k: number): number {
  if (phase.stage > s) return 1
  if (phase.stage < s) return 0
  if (phase.step > k) return 1
  if (phase.step < k) return 0
  return phase.progress
}

/** 「順に出す」ための件数。p=1 で n、途中は floor。 */
export function revealCount(p: number, n: number): number {
  if (p >= 1) return n
  if (p <= 0) return 0
  return Math.min(n, Math.floor(p * n + 1e-9))
}

export function useReplayClock(
  plan: StagePlan[],
  onStage?: (stageIndex: number, event: StageEvent, speed: ReplaySpeed) => void,
): ReplayClock {
  const [phase, setPhase] = useState<PhaseState>(() => completePhase(plan))
  const [playing, setPlaying] = useState(false)
  const [done, setDone] = useState(false)
  const [speed, setSpeedState] = useState<ReplaySpeed>(1)
  // SSR では false（サーバーは端末の設定を知らない）。マウント後に実際の設定を読む
  const [reduced, setReduced] = useState(false)

  const planRef = useRef(plan)
  planRef.current = plan
  const onStageRef = useRef(onStage)
  onStageRef.current = onStage
  const speedRef = useRef<ReplaySpeed>(1)
  const rafRef = useRef<number | null>(null)
  const posRef = useRef({ stage: 0, step: 0, progress: 0 })
  const stepStartRef = useRef(0)
  const playingRef = useRef(false)

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const apply = () => setReduced(mq.matches)
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])

  const stopLoop = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [])

  const finish = useCallback(() => {
    stopLoop()
    playingRef.current = false
    setPlaying(false)
    setDone(true)
    setPhase(completePhase(planRef.current))
  }, [stopLoop])

  const frame = useCallback((now: number) => {
    if (!playingRef.current) return
    const p = planRef.current
    let { stage: s, step: k } = posRef.current
    // 所要 0 の手順や、経過した手順を飛ばして「いまの手順」に合わせる
    for (;;) {
      if (s >= p.length) { finish(); return }
      const steps = p[s].steps
      if (k >= steps.length) {
        onStageRef.current?.(s, 'end', speedRef.current)
        s++; k = 0
        if (s >= p.length) { finish(); return }
        onStageRef.current?.(s, 'start', speedRef.current)
        stepStartRef.current = now
        continue
      }
      const duration = steps[k].ms / speedRef.current
      const elapsed = now - stepStartRef.current
      if (duration <= 0 || elapsed >= duration) {
        // 余った時間は次の手順に持ち越す（合計時間が速さに正確に比例するように）
        stepStartRef.current = duration <= 0 ? now : now - (elapsed - duration)
        k++
        continue
      }
      const progress = elapsed / duration
      posRef.current = { stage: s, step: k, progress }
      setPhase({ stage: s, step: k, progress })
      rafRef.current = requestAnimationFrame(frame)
      return
    }
  }, [finish])

  const play = useCallback(() => {
    if (reduced) return
    const p = planRef.current
    if (p.length === 0) return
    stopLoop()
    playingRef.current = true
    setPlaying(true)
    setDone(false)
    posRef.current = { stage: 0, step: 0, progress: 0 }
    setPhase({ stage: 0, step: 0, progress: 0 })
    onStageRef.current?.(0, 'start', speedRef.current)
    stepStartRef.current = performance.now()
    rafRef.current = requestAnimationFrame(frame)
  }, [reduced, stopLoop, frame])

  const skip = useCallback(() => {
    finish()
  }, [finish])

  const reset = useCallback(() => {
    stopLoop()
    playingRef.current = false
    setPlaying(false)
    setDone(false)
    posRef.current = { stage: 0, step: 0, progress: 0 }
    setPhase(completePhase(planRef.current))
  }, [stopLoop])

  const setSpeed = useCallback((s: ReplaySpeed) => {
    if (s === speedRef.current) return
    // 再生中は、いまの手順の進み具合を保ったまま速さだけ変える
    if (playingRef.current) {
      const p = planRef.current
      const { stage, step, progress } = posRef.current
      const ms = p[stage]?.steps[step]?.ms ?? 0
      stepStartRef.current = performance.now() - progress * (ms / s)
    }
    speedRef.current = s
    setSpeedState(s)
  }, [])

  // 再生の途中で「動きを減らす」設定がオンになったら、その場で止めて静止した完成状態へ（結果まで飛ばすのと同じ）
  useEffect(() => {
    if (reduced && playing) finish()
  }, [reduced, playing, finish])

  useEffect(() => () => stopLoop(), [stopLoop])

  // 再生していないときに段の数が変わったら（回の切り替え・売買の段の有無）、静止した完成状態に合わせ直す
  const stageCount = plan.length
  useEffect(() => {
    if (!playingRef.current) setPhase({ stage: stageCount, step: 0, progress: 1 })
  }, [stageCount])

  return { phase, playing, done, play, skip, reset, speed, setSpeed, reduced }
}
