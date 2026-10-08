'use client'

import { useEffect, useState } from 'react'
import { YearBars } from '@/components/stocks/YearBars'
import { fiscalYearOf, formatValue, signWord, yearLabel, yoyLine } from '@/lib/statements/display'
import type { AnnualStatements as AnnualStatementsData } from '@/lib/statements/sec-xbrl'

/**
 * 「1年ごとの決算」の節（/stocks/[symbol]・2026-10-07・designer の設計）。
 * SEC EDGAR の XBRL（companyfacts）から取った年次 5 期の 売上高・営業利益・純利益・1株あたり利益 を、色を使わずに棒グラフと数字で出す。
 *
 *  - データは /api/stocks/[symbol]/statements（SEC EDGAR だけ。Yahoo 由来の getStatements() は使わない）
 *  - 日本株（.T）は対応していないので節ごと出さない（この部品が null を返す）
 *  - 4 状態: 読込中（動かない骨組み・aria-busy）／成功／空（10-K の年次データが無い）／失敗（取得できなかった・--warning-ink）
 *  - 同じ見た目のカードを並べない。bg-card の帯 1 本の中に mx-4 border-t の区切りで 4 項目（components/watch/DecisionCard.tsx と同じ流儀）
 *  - 赤字／黒字は 位置（ゼロ線の上下）・形（中空／塗り）・符号（U+2212）・語（赤字／黒字）の 4 重で伝える。--success／--danger を使わない
 *  - 前年比は％バッジにせず 1 文（lib/statements/display.ts の yoyLine）
 *  - 出所（figcaption）は無条件に描く。畳まない・薄くしない（text-caption text-muted が底）
 *  - 優劣の語・推奨・採点・順位を出さない
 * 検査: scripts/check-annual-statements.ts。
 */

export const SECTION_TITLE = '1年ごとの決算'
export const SECTION_LEAD = '塗りつぶした年は赤字（マイナス）、枠だけの年は黒字（プラス）です。横の線が 0 です。'
export const SOURCE_NOTE = 'この図は、会社が SEC に提出した書類の数値をそのまま並べたものです。当社の分析や評価は含まれていません。将来を予測するものではありません。'
/** 「使用した項目」（英語の識別子）の直後に必ず置く説明。同じ「売上高」の札でも会社ごとに中身（総収益・契約収益・純収益）が違うため */
export const TAG_NOTE = '会社によって、決算書で使う項目の名前が違います。上は、その会社が実際に使っていた名前です。'
export const EMPTY_TEXT = 'この銘柄の1年ごとの決算は、SEC EDGAR の年次報告書（10-K）のデータに見つかりませんでした。米国以外の会社や ETF は、この形式では提出していないことがあります。'
export const FAILED_TITLE = '1年ごとの決算を取得できませんでした'
export const FAILED_BODY = 'SEC EDGAR（米国の会社が決算書類を提出する公的なデータベース）から、この銘柄の数値を受け取れませんでした。代わりの数字は作らず、ここで止めます。'
export const FAILED_NEXT = '時間をおいて再読み込みしてください。'
export const LOADING_TEXT = 'SEC EDGAR から決算の数値を取得しています'

export type AnnualStatementsState =
  | { status: 'loading'; slow: boolean }
  | { status: 'ok'; data: AnnualStatementsData }
  | { status: 'empty' }
  | { status: 'failed' }

/** ISO 8601 → YYYY-MM-DD（読めなければそのまま） */
function isoDate(iso: string): string {
  const day = iso.split('T')[0]
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : iso
}

const BAND = 'bg-card rounded-card border border-border'
const ROW = 'mx-4 border-t border-border first:border-t-0 py-4 space-y-2'

/** 見た目だけの部品（状態を受け取って描く）。検査はこれを静的に描く */
export function AnnualStatementsView({ state }: { state: AnnualStatementsState }) {
  return (
    <section className="space-y-3" data-section="annual-statements">
      <h2 className="text-h2 text-ink">{SECTION_TITLE}</h2>
      <p className="text-small text-muted max-w-[42rem]">{SECTION_LEAD}</p>

      {state.status === 'loading' && (
        <div className={BAND} aria-busy="true">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className={ROW}>
              <div className="h-4 w-20 rounded-field bg-surface" />
              <div className="h-7 w-32 rounded-field bg-surface" />
              <div className="h-[88px] rounded-field bg-surface" />
            </div>
          ))}
          {state.slow && <p className="mx-4 border-t border-border py-3 text-small text-muted">{LOADING_TEXT}</p>}
        </div>
      )}

      {state.status === 'empty' && (
        <div className={`${BAND} px-4 py-5`}>
          <p className="text-body text-ink-2 max-w-[42rem]">{EMPTY_TEXT}</p>
        </div>
      )}

      {state.status === 'failed' && (
        <div className={`${BAND} px-4 py-5 space-y-1`}>
          <p className="text-body text-warning-ink">{FAILED_TITLE}</p>
          <p className="text-body text-ink-2 max-w-[42rem]">{FAILED_BODY}</p>
          <p className="text-body text-ink-2 max-w-[42rem]">{FAILED_NEXT}</p>
        </div>
      )}

      {state.status === 'ok' && <Statements data={state.data} />}
    </section>
  )
}

function Statements({ data }: { data: AnnualStatementsData }) {
  const ends = data.periodEnds
  const last = ends.length - 1
  const lastEnd = last >= 0 ? ends[last] : null
  return (
    <figure className={BAND}>
      {data.items.map(item => {
        const curr = last >= 0 ? item.values[last] : null
        const prev = last >= 1 ? item.values[last - 1] : null
        const word = curr == null ? null : signWord(curr)
        return (
          <div key={item.key} className={ROW}>
            <p className="text-small font-semibold text-ink">{item.label}</p>
            <p className="flex flex-wrap items-baseline gap-x-2">
              {curr == null ? (
                <span className="text-h1 text-muted">—</span>
              ) : (
                <span className={`text-h1 tabular-nums ${curr === 0 ? 'text-muted' : 'text-ink'}`}>{formatValue(curr, item.kind)}</span>
              )}
              {word && <span className="text-small text-muted">{word}</span>}
            </p>
            {lastEnd && (
              <p className="text-caption text-muted tabular-nums">{yearLabel(lastEnd)}（期末 {lastEnd}）</p>
            )}
            <YearBars label={item.label} ends={ends} values={item.values} kind={item.kind} />
            {lastEnd && (
              <p className="text-small text-ink-2 max-w-[42rem]">{yoyLine(prev, curr, item.kind, fiscalYearOf(lastEnd))}</p>
            )}
          </div>
        )
      })}
      {/* 出所（法務が要求する注記＝弱めない・畳まない。text-caption text-muted が底） */}
      <figcaption className="mx-4 border-t border-border py-3 space-y-1 text-caption text-muted">
        <p className="tabular-nums">
          出所: {data.entityName}（SEC EDGAR・10-K・米国会計基準・連結・米ドル）／{isoDate(data.fetchedAt)} 取得／各決算期の終了日: {ends.join(', ')}
        </p>
        {/* 同じ「売上高」でも会社・時期によって元のタグが違う（アップルは契約収益・JPモルガンは総収益・ゴールドマンは純収益）ので、採ったタグ名を隠さない */}
        <p className="break-words">
          使用した項目: {data.items.map(it => `${it.label}=${it.tags.join(' + ')}`).join('／')}
        </p>
        <p className="text-caption text-muted">{TAG_NOTE}</p>
        <p>{SOURCE_NOTE}</p>
      </figcaption>
    </figure>
  )
}

type LoadedState = Exclude<AnnualStatementsState, { status: 'loading' }>

/**
 * 取得して描く（製品コードの入口）。.T は対応していないので節ごと出さない。
 * 結果は「どの銘柄の結果か」と組で持ち、銘柄が変わったら自動的に読込中に戻る（effect の中で同期的に setState しない）。
 */
export function AnnualStatements({ symbol }: { symbol: string }) {
  const jp = /\.T$/i.test(symbol)
  const [loaded, setLoaded] = useState<{ symbol: string; state: LoadedState } | null>(null)
  /** 3 秒を超えても読込中だった銘柄（§6-12「3 秒を超えたら取得していますと書く」） */
  const [slowFor, setSlowFor] = useState<string | null>(null)

  useEffect(() => {
    if (jp) return
    let alive = true
    const slowTimer = setTimeout(() => { if (alive) setSlowFor(symbol) }, 3000)
    fetch(`/api/stocks/${encodeURIComponent(symbol)}/statements`)
      .then(async r => {
        clearTimeout(slowTimer)
        const body = (await r.json().catch(() => null)) as { statements?: AnnualStatementsData | null } | null
        if (!alive) return
        if (!r.ok || body === null) { setLoaded({ symbol, state: { status: 'failed' } }); return }
        if (body.statements) setLoaded({ symbol, state: { status: 'ok', data: body.statements } })
        else setLoaded({ symbol, state: { status: 'empty' } })
      })
      .catch(() => { clearTimeout(slowTimer); if (alive) setLoaded({ symbol, state: { status: 'failed' } }) })
    return () => { alive = false; clearTimeout(slowTimer) }
  }, [symbol, jp])

  if (jp) return null
  const state: AnnualStatementsState = loaded && loaded.symbol === symbol ? loaded.state : { status: 'loading', slow: slowFor === symbol }
  return <AnnualStatementsView state={state} />
}
