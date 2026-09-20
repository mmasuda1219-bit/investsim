'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { RULEBOOK_INVESTOR_IDS, getRulebook, type RuleCheck, type Rulebook, type RulebookResult } from '@/lib/investors/rulebooks'
import { RulebookView } from '@/components/investors/RulebookView'

/**
 * 「名人はいまどう見ているか」— 選んだ銘柄を、投資家のルールブック（公開された考え方をルールにしたもの）に当てた結果。
 *
 * 2026-09-17 S2: 5人の売買の札・頭文字の色付きの四角・格言をやめ、ルールブックがある投資家（当面バフェット）を出す。
 * 2026-09-18: 見た目を「数字は表と数直線（案C）／問いはノートと書き込み罫（案B）」に作り直し（RulebookView）。
 * 判定は /api/signals/[symbol] がルールブックの純関数で行い、ここは応答を読んで並べるだけ（AI 不使用）。
 * 取得の仕組み（useRulebookSignals）は銘柄詳細の InvestorPanel と共用。
 */

const PRESET_SYMBOLS = ['AAPL', 'NVDA', 'MSFT', 'GOOGL', 'AMZN', 'TSLA']

// /api/signals/[symbol] の応答。rulebooks は投資家 id → { version, checks }。
// undecidable は「財務データがまったく取れなかった投資家 id → 理由の文」（無ければキー自体が無い）。
type SignalsResponse = {
  symbol: string
  rulebooks: Record<string, RulebookResult>
  undecidable?: Record<string, string>
  error?: unknown
}

const RULE_STATES = new Set<RuleCheck['state']>(['meets', 'misses', 'read', 'undecidable'])

// 応答が不正（rulebooks が無い・配列・null）なら空。1人分の形が壊れていても、その人だけ外して描画で落ちない。
export function readRulebooks(d: Partial<SignalsResponse> | null): Record<string, RulebookResult> {
  const raw: unknown = d?.rulebooks
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, RulebookResult> = {}
  for (const [id, r] of Object.entries(raw as Record<string, Partial<RulebookResult> | null>)) {
    if (!r || typeof r.version !== 'string' || !Array.isArray(r.checks)) continue
    const checks = r.checks
      .filter((c): c is RuleCheck => c != null && typeof c === 'object' && typeof c.ruleId === 'string' && RULE_STATES.has(c.state))
      // JSON 経由で observed.value が null になっていたら observed ごと落とす（「0.0%」と描かないため。reviewer S2）
      .map(c => (Number.isFinite(c.observed?.value) ? c : { ruleId: c.ruleId, state: c.state, reason: c.reason }))
    out[id] = { version: r.version, checks }
  }
  return out
}

// 理由が文字列の人だけ残す（形が壊れていても落ちない）。無ければ空。
function readUndecidable(d: Partial<SignalsResponse> | null): Record<string, string> {
  const raw: unknown = d?.undecidable
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, string> = {}
  for (const [id, why] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof why === 'string' && why.length > 0) out[id] = why
  }
  return out
}

// 画面に出す取得失敗の文。HTTP の番号や取得元の生の英語（«Real quote unavailable for AAPL — yahoo2: …»）は
// 出さない。原因は API の応答本文（error）とサーバーのログにある（DESIGN.md §6-12: 何が起きたか／データは
// どうなったか／どうすればいいか）。502 ＝ データ源（Yahoo Finance など）が返せなかった。
const MSG_UPSTREAM = 'データ源（Yahoo Finance など）から、この銘柄の値を受け取れませんでした。'
const MSG_SERVER = 'サーバーから判定の結果を受け取れませんでした。'
const MSG_NETWORK = 'サーバーに接続できないか、応答を読めませんでした。'
class HttpError extends Error {
  constructor(status: number) { super(status === 502 ? MSG_UPSTREAM : MSG_SERVER) }
}

export type RulebookSignals = {
  symbol: string
  loading: boolean
  error: string | null
  results: Record<string, RulebookResult> | null
  undecidable: Record<string, string>
  receivedAt: Date | null
}
const idle = (symbol: string): RulebookSignals => ({ symbol, loading: true, error: null, results: null, undecidable: {}, receivedAt: null })

/**
 * /api/signals/[symbol] を読む。銘柄が変わった直後は、前の銘柄の結果を返さず「読み込み中」を返す
 * （state の銘柄と引数の銘柄の比較で決める。effect の中で同期に setState しない: react-hooks/set-state-in-effect）。
 */
export function useRulebookSignals(symbol: string): RulebookSignals {
  const [state, setState] = useState<RulebookSignals>(() => idle(symbol))

  useEffect(() => {
    let alive = true
    fetch(`/api/signals/${encodeURIComponent(symbol)}`)
      .then(async r => {
        const d = (await r.json().catch(() => null)) as Partial<SignalsResponse> | null
        if (!r.ok || !d || d.error) throw new HttpError(r.status)
        return d
      })
      .then(d => {
        if (alive) setState({ symbol, loading: false, error: null, results: readRulebooks(d), undecidable: readUndecidable(d), receivedAt: new Date() })
      })
      .catch((e: unknown) => {
        if (alive) setState({ ...idle(symbol), loading: false, error: e instanceof HttpError ? e.message : MSG_NETWORK })
      })
    return () => { alive = false }
  }, [symbol])

  return state.symbol === symbol ? state : idle(symbol)
}

export const RULEBOOKS: Rulebook[] = RULEBOOK_INVESTOR_IDS.map(id => getRulebook(id)).filter((b): b is Rulebook => b != null)

export function MasterSignals({ initialSymbol = 'AAPL' }: { initialSymbol?: string }) {
  // initialSymbol が後から変わっても useState は追わない。呼び出し側が key で作り直す（app/watch/client.tsx）。
  const [symbol, setSymbol] = useState(initialSymbol)
  const { loading, error, results, undecidable, receivedAt } = useRulebookSignals(symbol)

  return (
    <section id="master-signals" aria-labelledby="master-signals-heading" className="space-y-4">
      {/* 節の見出しは h2（20px/600）。small/--muted では弱すぎて読む気にならない（オーナー指摘 2026-09-18） */}
      <div className="flex items-baseline gap-x-3 gap-y-1 flex-wrap">
        <h2 id="master-signals-heading" className="text-h2 text-ink">名人はいまどう見ているか</h2>
        <span className="text-small text-muted">公開された考え方をルールにして、この銘柄の財務データに当てた結果です</span>
      </div>

      {/* 銘柄の選択は選択チップ（§6-18: 角丸 6px、選択中は --brand-tint の下地＋--brand の枠）。
          紺青の塗りは主ボタンだけ（§5-1）なので、選択中を塗りで示さない。移動は文字ボタン（§6-1）。 */}
      <div className="flex flex-wrap items-center gap-2">
        {PRESET_SYMBOLS.map(s => (
          <button
            key={s}
            type="button"
            onClick={() => setSymbol(s)}
            aria-pressed={symbol === s}
            className={`min-h-11 rounded-field border px-3 text-small font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-2 ${symbol === s ? 'border-brand bg-brand-tint text-brand' : 'border-border-input bg-card text-ink hover:bg-surface'}`}
          >
            {s}
          </button>
        ))}
        <Link
          href={`/stocks/${encodeURIComponent(symbol)}`}
          className="inline-flex min-h-11 items-center rounded-field px-1 text-small text-brand hover:underline focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-2"
        >
          {symbol} の詳細
        </Link>
      </div>

      {RULEBOOKS.map(book => (
        <RulebookView
          key={book.investorId}
          book={book}
          symbol={symbol}
          loading={loading}
          error={error}
          checks={results?.[book.investorId]?.checks ?? (results ? [] : null)}
          why={undecidable[book.investorId]}
          receivedAt={receivedAt}
        />
      ))}
    </section>
  )
}
