'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { Signal } from '@/types'
import { INVESTOR_META } from '@/lib/investors/registry'

/**
 * 「名人はいまどう見ているか」— 選んだ銘柄に対する5人の現在シグナルと、その理由。
 *
 * 置き場所の経緯: これは旧トップページにあった「投資家別リアルタイム判断」で、
 * トップをLP化した際に行き場を失っていた。オーナー定義の「見る＝AIや名人が、
 * いまの相場をどう見て、なぜそう判断したかを読む」に照らすと、ここが正しい住所。
 *
 * 表示名・色・並び順は `lib/investors/registry` が単一の出所（画面ごとの
 * 独自定義を作らない）。色はTailwindの動的クラス名だとビルド時に消えるため、
 * hexをインラインスタイルで当てる。
 */

const PRESET_SYMBOLS = ['AAPL', 'NVDA', 'MSFT', 'GOOGL', 'AMZN', 'TSLA']

// 方向の札は無彩色＋記号のピル型（DESIGN.md §6-5: --surface の面＋--ink の文字、radius-full）。
// 買い＝緑・売り＝赤で運ばない（DECISIONS 2026-09-10）。枠線は付けない（切り分け3b-2）。
const ACTION_LABEL: Record<Signal['action'], string> = {
  buy: '▲ 買い', sell: '▼ 売り', hold: '◇ 様子見',
}
const ACTION_BADGE = 'rounded-full bg-surface px-2.5 text-small font-semibold text-ink whitespace-nowrap'

// /api/signals/[symbol] の応答。判定は signals の下に名人の id ごとに入っている。
// 旧: 応答全体を state に入れて signals[m.id] をトップレベルで引き、5人とも常に「判定なし」だった（DECISIONS 2026-09-14）。
type SignalsResponse = { symbol: string; signals: Record<string, Signal> }

// 応答が不正（signals が無い・配列・null）なら空＝従来どおり「判定なし」。
// 1人分の形が壊れていても描画（sig.reasons.length など）で落ちないよう、その人だけ外す。
function readSignals(d: Partial<SignalsResponse> | null): Record<string, Signal> {
  const raw: unknown = d?.signals
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, Signal> = {}
  for (const [id, s] of Object.entries(raw as Record<string, Partial<Signal> | null>)) {
    if (!s || !(s.action === 'buy' || s.action === 'sell' || s.action === 'hold') || !Array.isArray(s.reasons)) continue
    out[id] = { ...s, action: s.action, reasons: s.reasons.filter((r): r is string => typeof r === 'string') } as Signal
  }
  return out
}

export function MasterSignals({ initialSymbol = 'AAPL' }: { initialSymbol?: string }) {
  const [symbol, setSymbol] = useState(initialSymbol)
  const [signals, setSignals] = useState<Record<string, Signal> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    setLoading(true); setError(null); setSignals(null)
    fetch(`/api/signals/${encodeURIComponent(symbol)}`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: Partial<SignalsResponse> | null) => { if (alive) setSignals(readSignals(d)) })
      .catch((e: Error) => { if (alive) setError(e.message) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [symbol])

  return (
    <section className="space-y-2">
      {/* 見出しは帯の外（灰の上）に small/--muted（DESIGN.md §6-6） */}
      <div className="flex items-baseline gap-x-3 gap-y-1 flex-wrap">
        <h2 className="text-small text-muted">名人はいまどう見ているか</h2>
        <span className="text-caption text-muted">同じ銘柄を、5人の考え方で判定した結果です</span>
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
          href={`/stocks/${symbol}`}
          className="inline-flex min-h-11 items-center rounded-field px-1 text-small text-brand hover:underline focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-2"
        >
          {symbol} の詳細
        </Link>
        <Link
          href={`/trade?symbol=${encodeURIComponent(symbol)}`}
          className="inline-flex min-h-11 items-center rounded-field px-1 text-small text-brand hover:underline focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-2"
        >
          この銘柄で自分も判断してみる →
        </Link>
      </div>

      {/* 読み込み中・エラーも枠で囲わず白い帯に。文字は左揃え（§2・§6-12） */}
      {loading && (
        <p className="bg-card rounded-card px-4 py-5 text-small text-muted">
          判定中…
        </p>
      )}

      {!loading && error && (
        // 取得できなかったことは --warning-ink で書く（§5-1 色のルール）。
        <div className="bg-card rounded-card px-4 py-5 space-y-1">
          <p className="text-body text-warning-ink">シグナルを取得できませんでした</p>
          <p className="text-body text-ink-2 max-w-[42rem]">{error} — 実データが取れないときは、代わりの数字を作らずここで止めます。</p>
        </div>
      )}

      {!loading && !error && signals && (
        // 旧: 同形カード5枚の格子（DESIGN.md §10 P1.5）。A アプリ型の帯1本に、名人1人＝1行で並べる。
        // 行の区切りは文字の左端から始まる 1px の --border（§6-6）。帯の中に帯を入れない。
        <ul className="bg-card rounded-card">
          {INVESTOR_META.map(m => {
            const sig = signals[m.id]
            return (
              <li key={m.id} className="mx-4 border-t border-border first:border-t-0 py-4 space-y-2">
                <div className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className="w-6 h-6 rounded-field grid place-items-center text-caption font-semibold text-ink"
                    style={{ backgroundColor: m.color }}
                  >
                    {m.initial}
                  </span>
                  <span className="text-body font-semibold text-ink">{m.label}</span>
                  {sig ? (
                    <span className={`ml-auto ${ACTION_BADGE}`}>
                      {ACTION_LABEL[sig.action]}
                    </span>
                  ) : (
                    <span className="ml-auto text-small text-muted">判定なし</span>
                  )}
                </div>

                {sig && sig.reasons.length > 0 ? (
                  <ul className="space-y-1">
                    {sig.reasons.slice(0, 3).map((r, i) => (
                      <li key={i} className="text-small text-ink-2">・{r}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-small text-muted">{m.philosophy}</p>
                )}
              </li>
            )
          })}
        </ul>
      )}

      <p className="text-small text-ink-2 max-w-[42rem]">
        これは各投資家の公開された考え方をルール化して現在の数値に当てた計算結果であり、本人の見解でも、売買の推奨でもありません。
      </p>
    </section>
  )
}
