'use client'

import type { PlannedHold } from '@/lib/review/planned-hold'

/**
 * 「ロジックの検証」の縦チェーン（/review/[recordId] §3・S3a・2026-09-30）。
 * 書いたことを **前提 → だから → 結論 → 期間 → 注目 → 降りる条件** の順に並べ直し、前提の側にだけ状態を付ける。
 *
 * 守っていること（DECISIONS 2026-09-30 (6)・legal-compliance）:
 *  - 状態は4つだけ: 確認できた／事実と違いました／確かめようがありません／書かれていません。
 *    S3a（AI なし・資料なし）で出るのは後ろの2つだけ。塗りの丸／斜線の丸は S3b（出典付きの突き合わせ）用に部品だけ用意する
 *  - **結論（買う判断）のノードには状態を付けない**（判断の良し悪しに読めるため）
 *  - 「書かれていません」の観点は AI に発明させず、コード側の固定3つ（期間／降りる条件／注目）
 *  - 状態は **色ではなくアイコンの形＋語＋固定の並び順** で区別する。`--danger`（赤）は使わない。
 *    形: 塗りの丸＝確認できた／斜線の丸＝事実と違いました／中空の丸＝確かめようがありません／中空の三角＝書かれていません
 *  - 本人の原文は書き換えない（そのまま出す）。「崩れた」「穴」「不足」「甘い」「改善」は使わない
 * 検査: scripts/check-review-record.ts。
 */

export type PremiseStatus = 'confirmed' | 'broken' | 'unverifiable' | 'missing'

/** 画面語（この4つ以外を作らない） */
export const STATUS_LABEL: Record<PremiseStatus, string> = {
  confirmed: '確認できた',
  broken: '事実と違いました',
  unverifiable: '確かめようがありません',
  missing: '書かれていません',
}

/** 固定の並び順（凡例・一覧はこの順。順序そのものが区別の手がかり） */
export const STATUS_ORDER: readonly PremiseStatus[] = ['confirmed', 'broken', 'unverifiable', 'missing']

/** 文字色。状態を色だけで表さないので、形と語が必ず一緒に出る。赤は使わない */
const STATUS_CLASS: Record<PremiseStatus, string> = {
  confirmed: 'text-brand',
  broken: 'text-ink',
  unverifiable: 'text-muted',
  missing: 'text-warning-ink',
}

/** 状態のアイコン（14px・currentColor）。形で区別する */
export function StatusMark({ status }: { status: PremiseStatus }) {
  const common = { width: 14, height: 14, viewBox: '0 0 14 14', 'aria-hidden': true, focusable: 'false' as const, className: 'inline-block shrink-0 align-[-2px]' }
  switch (status) {
    case 'confirmed':
      return <svg {...common}><circle cx={7} cy={7} r={5} fill="currentColor" /></svg>
    case 'broken':
      return (
        <svg {...common}>
          <circle cx={7} cy={7} r={5} fill="none" stroke="currentColor" strokeWidth={1.5} />
          <line x1={3.5} y1={10.5} x2={10.5} y2={3.5} stroke="currentColor" strokeWidth={1.5} />
        </svg>
      )
    case 'unverifiable':
      return <svg {...common}><circle cx={7} cy={7} r={5} fill="none" stroke="currentColor" strokeWidth={1.5} /></svg>
    case 'missing':
      return <svg {...common}><polygon points="7,1.5 12.5,12 1.5,12" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" /></svg>
  }
}

/** アイコン＋語。常に一緒に出す */
export function StatusTag({ status }: { status: PremiseStatus }) {
  return (
    <span className={`inline-flex items-center gap-1 text-small ${STATUS_CLASS[status]}`} data-status={status}>
      <StatusMark status={status} />
      <span>{STATUS_LABEL[status]}</span>
    </span>
  )
}

export interface PremiseChainProps {
  symbol: string
  shares: number
  /** 【見立て】の原文。見出しの無い古い記録は全文。無ければ null */
  thesis: string | null
  /** 【注目】の原文。無ければ null */
  catalyst: string | null
  /** 【降りる条件】の原文のうち、条件として読めるもの。空・「決めていなかった」は null */
  exitRule: string | null
  /** 【降りる条件】欄に書かれた原文（「決めていなかった」など）。表示にだけ使う */
  exitRuleRaw?: string | null
  /** 書かれた文から読み取った予定の期間。読めなければ null */
  plannedHold: PlannedHold | null
}

const NOT_WRITTEN = '書かれていません'

interface Node {
  key: string
  heading: string
  /** 見出しの補足 */
  hint?: string
  text: string
  /** 前提の側にだけ付ける。結論には付けない */
  status: PremiseStatus | null
  /** 状態の下に添える1行（判定ではなく、この画面が何をしていないかの説明） */
  note?: string
}

export function PremiseChain(props: PremiseChainProps) {
  const { symbol, shares, thesis, catalyst, exitRule, exitRuleRaw, plannedHold } = props

  const nodes: Node[] = [
    {
      key: 'premise',
      heading: '前提',
      hint: '見立て（なぜ買うのか）',
      text: thesis ?? NOT_WRITTEN,
      // S3a では書かれた見立てに状態を付けない（S3a レビュー W1）。「確かめようがありません」は
      // 法務の定義で「意見・感想＝原理的に確かめられない」の意味。ここは資料と突き合わせていないだけで、
      // S3b で同じ文に「確認できた」が付きうる。付けるのは「書かれていません」だけ（DECISIONS 2026-09-30 (3)）。
      status: thesis ? null : 'missing',
      note: thesis ? 'この画面では、書かれたことを資料と突き合わせていません。' : undefined,
    },
    {
      key: 'conclusion',
      heading: '結論',
      hint: '買う判断（ここには状態を付けません）',
      text: `${symbol} を ${shares.toLocaleString()}株、買う`,
      status: null,
    },
    {
      key: 'period',
      heading: '期間',
      hint: 'どれくらい持つつもりか',
      text: plannedHold ? `${plannedHold.label}（書かれた文から読み取った期間）` : NOT_WRITTEN,
      status: plannedHold ? null : 'missing',
      note: plannedHold ? '下の図で、実際に持っていた期間と並べています。' : undefined,
    },
    {
      key: 'catalyst',
      heading: '注目',
      hint: 'これから何を見るか',
      text: catalyst ?? NOT_WRITTEN,
      status: catalyst ? null : 'missing',
      note: catalyst ? 'この画面では、その出来事が起きたかどうかを追っていません。' : undefined,
    },
    {
      key: 'exit',
      heading: '降りる条件',
      hint: '＝間違いだと分かったら降りる条件',
      text: exitRule ?? (exitRuleRaw?.trim() || NOT_WRITTEN),
      status: exitRule ? null : 'missing',
      note: exitRule ? '下の図で、そのあとの株価と並べています。' : undefined,
    },
  ]

  return (
    <div className="space-y-3">
      <ol className="bg-card rounded-card border border-border px-4 py-4">
        {nodes.map((n, i) => {
          const last = i === nodes.length - 1
          return (
            <li key={n.key} className="grid grid-cols-[20px_1fr]">
              {/* 左: 縦の線と丸印。状態の印ではなく、並びの印（結論だけ塗りを変えない＝どのノードも同じ形） */}
              <div className="relative">
                <span aria-hidden className="absolute left-1.5 top-2 h-2.5 w-2.5 rounded-full border-2 border-brand bg-card" />
                {!last && <span aria-hidden className="absolute left-[11px] top-5 bottom-0 w-px bg-border" />}
              </div>
              <div className={`min-w-0 ${last ? '' : 'pb-4'}`}>
                {/* 前提 → だから → 結論: つなぎの語は結論の見出しの上に出す */}
                {n.key === 'conclusion' && <p className="text-caption text-muted mb-1">↓ だから</p>}
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="text-small font-semibold text-ink">{n.heading}</span>
                  {n.hint && <span className="text-caption text-muted">{n.hint}</span>}
                </div>
                <p className={`text-body whitespace-pre-line max-w-[42rem] ${n.text === NOT_WRITTEN ? 'text-muted' : 'text-ink'}`}>{n.text}</p>
                {n.status && (
                  <div className="mt-1 space-y-0.5">
                    <StatusTag status={n.status} />
                    {n.note && <p className="text-caption text-muted">{n.note}</p>}
                  </div>
                )}
                {!n.status && n.note && <p className="mt-1 text-caption text-muted">{n.note}</p>}
              </div>
            </li>
          )
        })}
      </ol>

      {/* 凡例: 4つの状態を固定の順で。形＋語で区別し、この画面で出るものと出ないものを書く */}
      <div className="space-y-1">
        <ul className="flex flex-wrap gap-x-4 gap-y-1">
          {STATUS_ORDER.map(s => (
            <li key={s}><StatusTag status={s} /></li>
          ))}
        </ul>
        <p className="text-caption text-muted max-w-[42rem]">
          「確認できた」「事実と違いました」「確かめようがありません」は、出典の付いた資料と突き合わせられたときだけ出します。この画面は資料との突き合わせを行っていないので、出るのは「書かれていません」だけです。
        </p>
      </div>
    </div>
  )
}
