'use client'

// /watch S1: 根拠マップ。判断カード第3層を開くと最初に必ず出る縦フロー。
//
//   ● テクニカル（値動きの形）   → AIの読み（原文に札）を最初から表示
//   ● ファンダメンタル（会社の中身）→ 取得件数の横棒＋タイル4枚＋52週メーターを最初から表示、
//                                     AIの読み（原文に札）。開くと全項目表（FundamentalsTable）
//   ○ ニュース                     → 見出し件数＋AIの読み（原文に札）。開くと NewsEvidence
//   ◆ この判断                     → 判断バッジ＋確信度＋reasoning
//
// 3つの入力が1つの結論に収束する形を、レール（--border 1px）とノードで見せる。
// アクセント（--accent）は結論ノードの1回だけ。
//
// 2026-09-11: 「見たもの: …（PER 17.4倍／ROE …）」「AIの読み: PER17.4x割安…」という文字列の羅列を
//   やめ、数字はタイル・メーター・横棒で、AIの文は ReadingText（原文のまま・数値に札）で見せる。
//   テクニカルの「見たもの」は出さない。機械生成の信号は保存されておらず、AIの文から抜き出すと
//   文脈が失われる（S2 で信号を保存してから作る）。
//
// 原則9: 寄与の重み（%やバー）は絶対に出さない。AIは寄与度を出力していないので捏造になる。
//        取得件数の横棒は「何項目のデータが手元にあったか」であって、寄与ではない。
//        無い記録は中空ノード＋「無い」と、なぜ無いかを書く。
// 原則11: 評価語（割安・優良・買い時）はサイト側で書かない。AIの文は1文字も変えない。

import { useId, useState } from 'react'
import type { ReactNode } from 'react'
import type { AIDecision } from '@/lib/ai-trader/engine'
import { parseFundamentals, fundamentalsProse, PARSEABLE_FIELDS } from '@/lib/ai-trader/fundamentals-parse'
import FundamentalsFigure, { FundamentalsTable } from '@/components/watch/FundamentalsFigure'
import NewsEvidence from '@/components/watch/NewsEvidence'
import ReadingText from '@/components/watch/ReadingText'

export interface EvidenceMapProps {
  decision: AIDecision
  /** DecisionCard の ACTION[decision.action]。循環 import を避けるため props で受ける。 */
  action: { label: string; cls: string }
  /** DecisionCard の CONFIDENCE[decision.confidence]。 */
  confidenceLabel: string
}

type NodeKind = 'record' | 'empty' | 'conclusion'

const READ_LABEL = 'AIの読み（AIの言葉をそのまま）'
const SUB_HEAD = 'text-[13px] font-semibold text-ink mb-1'

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

/**
 * 取得件数の小さな横棒。台 --border・塗り --ink-2・幅＝取得/総数。数字は右に併記。
 * 色相なし（多い/少ないを良し悪しとして色で運ばない）。
 */
function CountBar({ got, total }: { got: number; total: number }) {
  const pct = total > 0 ? Math.round((Math.min(got, total) / total) * 100) : 0
  return (
    <div className="flex items-center gap-2 max-w-[42rem]" data-count-bar="">
      {/* 棒は残り幅に合わせて縮む（狭い画面で右の数字を切らない）。最大 10rem。 */}
      <span
        aria-hidden
        className="block h-1.5 flex-1 min-w-[3rem] max-w-[10rem] rounded-full overflow-hidden"
        style={{ backgroundColor: 'var(--border)' }}
      >
        <span
          className="block h-full rounded-full"
          style={{ width: `${pct}%`, backgroundColor: 'var(--ink-2)' }}
        />
      </span>
      <span className="text-sm text-ink-2 font-mono tabular-nums whitespace-nowrap shrink-0">
        {got}
        <span className="text-muted"> / {total} 項目を取得</span>
      </span>
    </div>
  )
}

interface RowProps {
  position: 'first' | 'middle' | 'last'
  node: NodeKind
  title: string
  /** 常に見せる中身（図・札付きの文）。無いときは emptyNote を出す。 */
  body?: ReactNode
  /** 記録が無いときの説明（なぜ無いかまで）。body が無いときに出す。 */
  emptyNote?: string
  /** 開いたときの中身。無ければ開閉ボタンを出さない。 */
  children?: ReactNode
  openLabel?: string
}

function Row({ position, node, title, body, emptyNote, children, openLabel = '開く' }: RowProps) {
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
          {node === 'empty' && <span className="text-sm text-muted shrink-0">記録なし</span>}
        </div>
      )}

      <div className="mt-2">
        {body != null ? (
          body
        ) : emptyNote ? (
          <p className="text-sm text-muted leading-relaxed max-w-[42rem]">{emptyNote}</p>
        ) : null}
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
  // AIの文は raw のまま ReadingText に渡す（trim も含めて1文字も変えない）。有無の判定だけ trim。
  const technicalsRaw = decision.technicals ?? ''
  const fundamentals = decision.fundamentals ?? ''
  const fundData = parseFundamentals(fundamentals)
  const fundProse = fundamentalsProse(fundamentals)
  const fundTotal = PARSEABLE_FIELDS.length
  const fundCount = PARSEABLE_FIELDS.filter(f => fundData[f] != null).length
  const fundMissing = fundTotal - fundCount
  const news = decision.news ?? []
  const influenceRaw = decision.newsInfluence ?? ''

  const hasTech = technicalsRaw.trim().length > 0
  const hasFund = fundCount > 0 || fundProse.trim().length > 0
  const hasInfluence = influenceRaw.trim().length > 0
  const hasNews = news.length > 0 || hasInfluence

  return (
    <ol className="list-none m-0 p-0 pt-2">
      {/* テクニカル: 「見たもの」は出さない（信号が保存されていない。冒頭コメント参照）。 */}
      <Row
        position="first"
        node={hasTech ? 'record' : 'empty'}
        title="テクニカル（値動きの形）"
        body={hasTech ? <ReadingText text={technicalsRaw} label={READ_LABEL} /> : undefined}
        emptyNote="この判断では、テクニカルの記録がありません。"
      />

      {/* ファンダメンタル: 横棒＋タイル＋メーターを最初から。開くと全項目表。 */}
      <Row
        position="middle"
        node={hasFund ? 'record' : 'empty'}
        title="ファンダメンタル（会社の中身）"
        body={hasFund ? (
          <div className="space-y-3">
            <div>
              <h5 className={SUB_HEAD}>見たもの（判断時点の数字）</h5>
              <CountBar got={fundCount} total={fundTotal} />
              {fundMissing > 0 && (
                <p className="mt-1 text-sm text-muted leading-relaxed max-w-[42rem]">
                  残り {fundMissing} 項目は、判断時点でデータ元（Yahoo Finance）から値が返らなかったもの（表では「未取得」）。
                </p>
              )}
            </div>
            {fundCount > 0 ? (
              <FundamentalsFigure
                variant="inline"
                data={fundData}
                symbol={decision.symbol}
                price={decision.price}
              />
            ) : (
              <p className="text-sm text-muted leading-relaxed max-w-[42rem]">
                この判断には数値が記録されておらず、AIの文だけが残っています。
              </p>
            )}
            <ReadingText
              text={fundProse}
              label={READ_LABEL}
              emptyNote="この判断には、ファンダメンタルについてのAIの読み（文）が記録されていません（数値だけの記録）。"
            />
          </div>
        ) : undefined}
        emptyNote="この判断では、ファンダメンタルの記録がありません。"
        openLabel="全項目を開く"
      >
        {fundCount > 0 ? (
          <FundamentalsTable data={fundData} symbol={decision.symbol} />
        ) : undefined}
      </Row>

      {/* ニュース: 見出し件数の短い表示＋AIの読み。開くと見出し一覧（NewsEvidence）。 */}
      <Row
        position="middle"
        node={hasInfluence ? 'record' : 'empty'}
        title="ニュース"
        body={hasNews ? (
          <div className="space-y-3">
            <p className="text-sm text-ink-2 leading-relaxed max-w-[42rem]">
              <span className="text-muted">見たもの: </span>
              {news.length > 0 ? `見出し ${news.length} 件` : '見出しの記録なし'}
            </p>
            <ReadingText
              text={influenceRaw}
              label={READ_LABEL}
              emptyNote="この判断には、ニュースについてのAIの読みが記録されていません。"
            />
          </div>
        ) : undefined}
        emptyNote="この判断では、ニュースは判断に使われていません。"
        openLabel="見出しを開く"
      >
        {hasNews ? <NewsEvidence headlines={news} influence={influenceRaw.trim()} /> : undefined}
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
