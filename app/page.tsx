'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { NAV } from '@/components/SiteNav'

/**
 * トップページ＝ランディング。
 *
 * 従来ここは銘柄セレクタ＋チャート＋投資家シグナルの「道具ページ」で、
 * 「このサイトは何ができるのか」を説明する面がサイト内に1つも無かった。
 * 投資家シグナルのグリッドは /stocks/[symbol] の InvestorPanel と同じ
 * /api/signals/[symbol] を叩く重複だったため、ここでは持たない。
 *
 * 主役は「AIの直近の判断」だが、**保存済みデータの読み出しだけ**を行い
 * AI推論は一切走らせない。最も人が来る面を最も安い面にするため
 * （AI費用は自己負担であり、匿名訪問で課金が発生する設計にしない）。
 */

interface Decision {
  symbol: string
  name: string
  action: 'buy' | 'sell' | 'hold' | 'watch'
  reasoning: string
  confidence: 'high' | 'medium' | 'low'
}
interface SessionSummary {
  id: string
  lastTickAt: string
  tickCount: number
  pnlPct: number
  decisions: Decision[]
}

const ACTION_LABEL: Record<Decision['action'], string> = {
  buy: '買い', sell: '売り', hold: '保有継続', watch: '様子見',
}
const ACTION_STYLE: Record<Decision['action'], string> = {
  buy:   'bg-emerald-50 text-emerald-700 border-emerald-200',
  sell:  'bg-rose-50 text-rose-700 border-rose-200',
  hold:  'bg-[var(--muted)] text-ink-2 border-border',
  watch: 'bg-amber-50 text-amber-700 border-amber-200',
}

function formatWhen(iso: string): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  const min = Math.floor((Date.now() - t) / 60_000)
  if (min < 1) return 'たった今'
  if (min < 60) return `${min}分前`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}時間前`
  return `${Math.floor(h / 24)}日前`
}

export default function Home() {
  const [session, setSession] = useState<SessionSummary | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'empty'>('loading')

  useEffect(() => {
    let alive = true
    fetch('/api/ai-session')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((list: SessionSummary[]) => {
        if (!alive) return
        // 最後に動いたセッションを1件だけ。無ければ正直に「まだ無い」と出す。
        const latest = Array.isArray(list) && list.length
          ? [...list].sort((a, b) => Date.parse(b.lastTickAt) - Date.parse(a.lastTickAt))[0]
          : null
        if (latest && Array.isArray(latest.decisions) && latest.decisions.length) {
          setSession(latest); setState('ready')
        } else {
          setState('empty')
        }
      })
      .catch(() => { if (alive) setState('empty') })
    return () => { alive = false }
  }, [])

  return (
    <div className="max-w-5xl mx-auto space-y-12">

      {/* ── 何のサイトか ─────────────────────────────────────────── */}
      <section className="pt-6 space-y-5">
        <p className="text-sm font-semibold tracking-[0.18em] text-emerald-700 uppercase">
          投資判断の練習場
        </p>
        <h1 className="text-3xl sm:text-[2.6rem] font-bold leading-[1.4] text-balance">
          AIと名人と自分。<br className="hidden sm:block" />
          どの判断が正しかったかを、<span className="text-emerald-700">リスクゼロ</span>で確かめる。
        </h1>
        <p className="text-base text-ink-2 leading-relaxed max-w-[42rem]">
          実際の株価データを使い、仮想の資金で投資の判断だけを練習します。
          うまくなるのはAIではなく、あなたです。実際のお金は1円も動きません。
        </p>
        <div className="flex flex-wrap gap-3 pt-1">
          <Link
            href="/watch"
            className="px-5 py-2.5 rounded-lg bg-accent text-on-accent text-sm font-bold transition-colors"
          >
            まずAIの判断を見てみる
          </Link>
          <Link
            href="/learn"
            className="px-5 py-2.5 rounded-lg border border-border hover:border-accent text-ink-2 hover:text-ink text-sm font-semibold transition-colors"
          >
            名人の条件を過去に当ててみる
          </Link>
        </div>
      </section>

      {/* ── 4段階の学習 ──────────────────────────────────────────── */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-ink">上から順に降りてくるだけです</h2>
        <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {NAV.map(({ href, label, hint }, i) => (
            <li key={href}>
              <Link
                href={href}
                className="h-full flex flex-col gap-2 p-4 rounded-xl bg-surface border border-border hover:border-accent transition-colors"
              >
                <span className="text-xs font-mono tabular-nums text-muted">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span className="text-base font-bold text-ink">{label}</span>
                <span className="text-sm text-ink-2 leading-relaxed">{hint}</span>
              </Link>
            </li>
          ))}
        </ol>
      </section>

      {/* ── AIの直近の判断（保存済みデータの読み出しのみ） ───────────── */}
      <section className="space-y-4">
        <div className="flex items-baseline justify-between gap-4 flex-wrap">
          <h2 className="text-xl font-semibold text-ink">AIは、いまこう考えています</h2>
          {state === 'ready' && session && (
            <span className="text-sm text-muted tabular-nums">
              {formatWhen(session.lastTickAt)}・{session.tickCount}回目の判断
            </span>
          )}
        </div>

        {state === 'loading' && (
          <div className="p-6 rounded-xl bg-surface border border-border text-base text-muted">
            読み込み中…
          </div>
        )}

        {state === 'empty' && (
          <div className="p-6 rounded-xl bg-surface border border-border space-y-2">
            <p className="text-base text-ink font-medium">まだAIの判断記録がありません</p>
            <p className="text-base text-ink-2 leading-relaxed max-w-[42rem]">
              AIの運用を始めると、ここに直近の判断とその理由が並びます。
            </p>
            <Link href="/watch" className="inline-block text-sm text-emerald-700 hover:text-emerald-800 pt-1">
              「見る」を開く →
            </Link>
          </div>
        )}

        {state === 'ready' && session && (
          <>
            <ul className="space-y-2.5">
              {session.decisions.slice(0, 3).map((d, i) => (
                <li key={`${d.symbol}-${i}`} className="p-4 rounded-xl bg-surface border border-border space-y-2">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <span className="font-bold text-ink text-sm">{d.symbol}</span>
                    <span className="text-sm text-muted truncate">{d.name}</span>
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded border ${ACTION_STYLE[d.action]}`}>
                      {ACTION_LABEL[d.action]}
                    </span>
                  </div>
                  <p className="text-base text-ink-2 leading-relaxed line-clamp-3 max-w-[42rem]">{d.reasoning}</p>
                </li>
              ))}
            </ul>
            <p className="text-sm text-muted leading-relaxed max-w-[42rem]">
              これはAIの仮想運用の記録であり、売買の推奨ではありません。
              <Link href="/watch" className="text-emerald-700 hover:text-emerald-800 ml-1">
                全部の判断と根拠を見る →
              </Link>
            </p>
          </>
        )}
      </section>

      {/* ── 恒久免責 ─────────────────────────────────────────────── */}
      <section className="pt-2 border-t border-border">
        {/* 信頼を作る文章が、ページ内で最も読めない書式（11px・低コントラスト）
            になっていた。本文サイズ＋--ink-2 相当まで上げる。 */}
        <p className="text-sm text-ink-2 leading-relaxed pt-4 max-w-[42rem]">
          InvestSim は投資判断を練習するためのシミュレーターです。表示される売買はすべて仮想資金による
          ものであり、実際の証券口座・決済とは一切連携しません。特定の銘柄の売買を推奨するものではなく、
          投資助言・代理業には該当しません。掲載する情報の正確性・完全性を保証するものではなく、
          投資の最終判断はご自身の責任で行ってください。
        </p>
      </section>
    </div>
  )
}
