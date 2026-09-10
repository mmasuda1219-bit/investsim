'use client'

// /watch S1: 根拠マップ。判断カード第3層を開くと最初に必ず出る縦フロー。
//
//   ● テクニカル（値動きの形）   → 開くと AI の作文（原文）
//   ● ファンダメンタル（会社の中身）→ 開くと FundamentalsFigure
//   ○ ニュース                     → 開くと NewsEvidence（記録が無ければ中空ノード）
//   ◆ この判断                     → 判断バッジ＋確信度＋reasoning
//
// 3つの入力が1つの結論に収束する形を、レール（--border 1px）とノードで見せる。
// アクセント（--accent）は結論ノードの1回だけ。
//
// 原則9: 寄与の重み（%やバー）は絶対に出さない。AIは寄与度を出力していないので捏造になる。
//        無い記録は中空ノード＋「無い」と書く。
// 原則11: 評価語（割安・優良・買い時）はサイト側で書かない。

import { useId, useState } from 'react'
import type { ReactNode } from 'react'
import type { AIDecision } from '@/lib/ai-trader/engine'
import { parseFundamentals, fundamentalsProse, PARSEABLE_FIELDS } from '@/lib/ai-trader/fundamentals-parse'
import FundamentalsFigure from '@/components/watch/FundamentalsFigure'
import NewsEvidence from '@/components/watch/NewsEvidence'

export interface EvidenceMapProps {
  decision: AIDecision
  /** DecisionCard の ACTION[decision.action]。循環 import を避けるため props で受ける。 */
  action: { label: string; cls: string }
  /** DecisionCard の CONFIDENCE[decision.confidence]。 */
  confidenceLabel: string
}

type NodeKind = 'record' | 'empty' | 'conclusion'

/** 先頭の1文、長ければ n 文字で切る。 */
function head(s: string, n = 48): string {
  const t = s.trim()
  const stop = t.indexOf('。')
  const first = stop >= 0 ? t.slice(0, stop + 1) : t
  return first.length <= n ? first : `${first.slice(0, n)}…`
}

const fmtX   = (v: number) => `${v.toLocaleString('ja-JP', { maximumFractionDigits: 2 })}倍`
const fmtPct = (v: number) => `${(v * 100).toLocaleString('ja-JP', { maximumFractionDigits: 1 })}%`

function Node({ kind }: { kind: NodeKind }) {
  // 塗りは CSS 変数を直接使う（globals.css に bg-ink-2 / bg-border のユーティリティは無い）。
  if (kind === 'conclusion') {
    return (
      <span
        aria-hidden
        className="absolute left-[3px] top-[5px] w-3.5 h-3.5 rounded-sm rotate-45"
        style={{ backgroundColor: 'var(--accent)', boxShadow: '0 0 0 2px var(--panel)' }}
      />
    )
  }
  if (kind === 'empty') {
    return (
      <span
        aria-hidden
        className="absolute left-[5px] top-[7px] w-2.5 h-2.5 rounded-full border border-border"
        style={{ backgroundColor: 'var(--panel)' }}
      />
    )
  }
  return (
    <span
      aria-hidden
      className="absolute left-[5px] top-[7px] w-2.5 h-2.5 rounded-full"
      style={{ backgroundColor: 'var(--ink-2)', boxShadow: '0 0 0 2px var(--panel)' }}
    />
  )
}

/** レール。行ごとに「ノード中心→下端」「上端→下端」「上端→ノード中心」を描き分ける。 */
function Rail({ position }: { position: 'first' | 'middle' | 'last' }) {
  const cls =
    position === 'first'  ? 'top-3 bottom-0' :
    position === 'middle' ? 'top-0 bottom-0' :
                            'top-0 h-3'
  return <span aria-hidden className={`absolute left-[9.5px] border-l border-border ${cls}`} />
}

interface RowProps {
  position: 'first' | 'middle' | 'last'
  node: NodeKind
  title: string
  /** 見たもの（事実の要約）。 */
  seen?: string
  /** AIの読み（短い）。 */
  read?: string
  /** 記録が無いときの説明。children が無いときに出す。 */
  emptyNote?: string
  /** 開いたときの中身。無ければ開閉ボタンを出さない。 */
  children?: ReactNode
  openLabel?: string
}

function Row({ position, node, title, seen, read, emptyNote, children, openLabel = '開く' }: RowProps) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const expandable = children != null

  return (
    <li className="relative pl-8 pb-5 last:pb-0">
      <Rail position={position} />
      <Node kind={node} />

      {expandable ? (
        <button
          type="button"
          onClick={() => setOpen(v => !v)}
          aria-expanded={open}
          aria-controls={id}
          className="w-full flex items-start justify-between gap-3 text-left rounded outline-none focus-visible:outline-2 focus-visible:outline-offset-2"
          style={{ outlineColor: 'var(--accent-ink)' }}
        >
          <span className="text-sm font-semibold text-ink">{title}</span>
          <span className="text-sm text-muted shrink-0">{open ? '閉じる ▴' : `${openLabel} ▾`}</span>
        </button>
      ) : (
        <div className="flex items-start justify-between gap-3">
          <span className="text-sm font-semibold text-ink">{title}</span>
          <span className="text-sm text-muted shrink-0">記録なし</span>
        </div>
      )}

      <div className="mt-1 space-y-1 max-w-[42rem]">
        {seen && (
          <p className="text-sm text-ink-2 leading-relaxed">
            <span className="text-muted">見たもの: </span>{seen}
          </p>
        )}
        {read && (
          <p className="text-sm text-ink-2 leading-relaxed">
            <span className="text-muted">AIの読み: </span>{read}
          </p>
        )}
        {!expandable && emptyNote && (
          <p className="text-sm text-muted leading-relaxed">{emptyNote}</p>
        )}
      </div>

      {expandable && open && (
        <div id={id} className="mt-3">
          {children}
        </div>
      )}
    </li>
  )
}

export default function EvidenceMap({ decision, action, confidenceLabel }: EvidenceMapProps) {
  const technicals = (decision.technicals ?? '').trim()
  const fundamentals = decision.fundamentals ?? ''
  const fundData = parseFundamentals(fundamentals)
  const fundProse = fundamentalsProse(fundamentals)
  const fundCount = PARSEABLE_FIELDS.filter(f => fundData[f] != null).length
  const news = decision.news ?? []
  const influence = (decision.newsInfluence ?? '').trim()

  const hasTech = technicals.length > 0
  const hasFund = fundCount > 0 || fundProse.length > 0
  const hasNews = news.length > 0 || influence.length > 0

  // ファンダの「見たもの」: 取得できた項目数と、タイル4項目のうち値があるもの。
  const fundHighlights = [
    fundData.pe            != null ? `PER ${fmtX(fundData.pe)}` : null,
    fundData.roe           != null ? `ROE ${fmtPct(fundData.roe)}` : null,
    fundData.revenueGrowth != null ? `売上成長 ${fmtPct(fundData.revenueGrowth)}` : null,
    fundData.debtToEquity  != null ? `D/E ${fmtX(fundData.debtToEquity)}` : null,
  ].filter((s): s is string => s != null)
  const fundSeen =
    `${PARSEABLE_FIELDS.length}項目のうち ${fundCount} 項目を取得` +
    (fundHighlights.length > 0 ? `（${fundHighlights.join('／')}）` : '')

  return (
    <ol className="list-none m-0 p-0 pt-2">
      <Row
        position="first"
        node={hasTech ? 'record' : 'empty'}
        title="テクニカル（値動きの形）"
        seen={hasTech ? head(technicals) : undefined}
        emptyNote="この判断では、テクニカルの記録がありません。"
      >
        {hasTech ? (
          <div className="max-w-[42rem]">
            <h5 className="text-[13px] font-semibold text-ink mb-1">AIの読み（原文）</h5>
            <p className="text-base text-ink-2 leading-relaxed">{technicals}</p>
          </div>
        ) : undefined}
      </Row>

      <Row
        position="middle"
        node={hasFund ? 'record' : 'empty'}
        title="ファンダメンタル（会社の中身）"
        seen={hasFund ? fundSeen : undefined}
        read={fundProse ? head(fundProse, 80) : undefined}
        emptyNote="この判断では、ファンダメンタルの記録がありません。"
        openLabel="数字を開く"
      >
        {hasFund ? (
          <FundamentalsFigure data={fundData} symbol={decision.symbol} price={decision.price} />
        ) : undefined}
      </Row>

      <Row
        position="middle"
        node={influence.length > 0 ? 'record' : 'empty'}
        title="ニュース"
        seen={news.length > 0 ? `見出し ${news.length} 件を読んだ` : undefined}
        read={influence ? head(influence, 80) : undefined}
        emptyNote="この判断では、ニュースは判断に使われていません。"
      >
        {hasNews ? <NewsEvidence headlines={news} influence={influence} /> : undefined}
      </Row>

      <li className="relative pl-8">
        <Rail position="last" />
        <Node kind="conclusion" />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-sm font-semibold text-ink">この判断</span>
          <span className={`text-sm font-semibold border rounded-lg px-2.5 py-0.5 ${action.cls}`}>
            {action.label}
          </span>
          <span className="text-sm text-muted whitespace-nowrap">
            確信度 <span className="text-ink-2 font-semibold">{confidenceLabel}</span>
          </span>
        </div>
        {decision.reasoning ? (
          <p className="mt-1 text-base text-ink-2 leading-relaxed max-w-[42rem]">{decision.reasoning}</p>
        ) : (
          <p className="mt-1 text-sm text-muted">判断の理由が記録されていません。</p>
        )}
      </li>
    </ol>
  )
}
