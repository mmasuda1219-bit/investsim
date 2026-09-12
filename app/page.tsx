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
 *
 * 見た目は DESIGN.md §6-6「A アプリ型」の見本（2026-09-11 切り分け3a）:
 *   地は --surface（灰）、内容は枠線なしの白い帯（--card）、見出しは帯の外に
 *   small/--muted、行の区切りは文字の左端から始まる1本の線。角丸の枠で囲わない。
 *   同じ組み方を app/review/page.tsx でも手書きしている。3回目が出たら
 *   components/ui/ へ抽出する（原則8・切り分け3d）。
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

// 方向の札は無彩色＋記号（DESIGN.md §6-5）。買い＝緑・売り＝赤で運ばない（DECISIONS 2026-09-10）。
// 4種とも同じ形（--surface の面・--ink の文字・ピル型）なので class は1つで足りる。
const ACTION_LABEL: Record<Decision['action'], string> = {
  buy: '▲ 買い', sell: '▼ 売り', hold: '＝ 保有継続', watch: '◇ 様子見',
}
const ACTION_BADGE = 'shrink-0 rounded-full bg-surface px-2 text-caption font-semibold text-ink'

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
    // 地（--surface）。layout.tsx の <main> は max-w-6xl（1152px）で中央に絞られているので、
    // この要素の背景色だけでは PC 幅で左右に --bg が残る（1280px で片側 64px の柱に見えた）。
    // そこで、ぼかし 0・広がり 100vmax の box-shadow を同じ色で付け、画面の外まで塗る。
    // box-shadow は「インクのはみ出し」でレイアウトにもスクロール範囲にも入らないため、
    // 100vw（Windows ではスクロールバー幅を含む）と違って横スクロールが出ない。
    // 上方向はヘッダー（sticky・z-40・不透明）が上に描かれて隠れ、下方向は内容が短くても
    // 画面の下端まで塗り続ける。負のマージンも「ヘッダー 59px」の決め打ちも要らなくなった。
    // 余白は <main> の pt-5 / pb-20 md:pb-5 と合わせて 24 / 96 / 40 px（3a と同じ）。
    // layout 側に地を持たせるのが本筋だが、それは切り分け3d（共通化）で行う。
    <div className="bg-surface shadow-[0_0_0_100vmax_var(--surface)] pt-1 pb-4 md:pb-5">
      <div className="max-w-[760px] mx-auto space-y-6">

        {/* ── 何のサイトか ─────────────────────────────────────────── */}
        <section className="space-y-4 pb-2">
          <p className="text-small text-muted">投資判断の練習場</p>
          <h1 className="text-h1 text-ink text-balance">
            AIと名人と自分。<br className="hidden sm:block" />
            どの判断が正しかったかを、リスクゼロで確かめる。
          </h1>
          <p className="text-body text-ink-2 max-w-[42rem]">
            実際の株価データを使い、仮想の資金で投資の判断だけを練習します。
            うまくなるのはAIではなく、あなたです。実際のお金は1円も動きません。
          </p>
          {/* 主ボタンは1画面に1つ（§6-1）。もう1つは副ボタン（白い面＋輪郭）。 */}
          <div className="flex flex-wrap gap-3 pt-1">
            <Link
              href="/watch"
              className="inline-flex h-12 items-center justify-center rounded-card bg-brand px-5 text-body font-semibold text-on-brand transition-colors hover:bg-brand-strong focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-2"
            >
              まずAIの判断を見てみる
            </Link>
            <Link
              href="/learn"
              className="inline-flex h-12 items-center justify-center rounded-card border border-border-input bg-card px-5 text-body font-semibold text-ink transition-colors hover:bg-surface focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-2"
            >
              名人の条件を過去に当ててみる
            </Link>
          </div>
        </section>

        {/* ── 4段階の学習 ──────────────────────────────────────────── */}
        {/* 同形カード4枚の格子ではなく、番号付きの一列（§2・§3）。03 やる が心臓なので
            一回り大きく（text-h2 対 text-h3、行も高く）描く。--brand-tint の下地は
            §5-1 で「現在地・選択中だけ」なのでここでは使わない。 */}
        <section className="space-y-2">
          <h2 className="text-small text-muted">上から順に降りてくるだけです</h2>
          <ol className="bg-card rounded-card overflow-hidden">
            {NAV.map(({ href, label, hint }, i) => {
              const heart = href === '/trade'
              return (
                // 区切り線は文字の左端から（li に mx-4）。押せる範囲は帯の端まで（Link に -mx-4）。
                <li key={href} className="mx-4 border-t border-border first:border-t-0">
                  <Link
                    href={href}
                    className={`-mx-4 flex items-center gap-4 px-4 transition-colors hover:bg-surface focus-visible:outline-2 focus-visible:outline-focus focus-visible:-outline-offset-2 ${
                      heart ? 'min-h-20 py-4' : 'min-h-14 py-3'
                    }`}
                  >
                    <span className="w-6 shrink-0 text-small text-muted tabular-nums">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <span className="min-w-0">
                      <span className={`block text-ink ${heart ? 'text-h2' : 'text-h3'}`}>{label}</span>
                      <span className={`block text-ink-2 ${heart ? 'text-body' : 'text-small'}`}>{hint}</span>
                    </span>
                  </Link>
                </li>
              )
            })}
          </ol>
        </section>

        {/* ── AIの直近の判断（保存済みデータの読み出しのみ） ───────────── */}
        <section className="space-y-2">
          <div className="flex items-baseline justify-between gap-4 flex-wrap">
            <h2 className="text-small text-muted">AIは、いまこう考えています</h2>
            {state === 'ready' && session && (
              <span className="text-caption text-muted tabular-nums">
                {formatWhen(session.lastTickAt)}・{session.tickCount}回目の判断
              </span>
            )}
          </div>

          {/* 読み込み中: 完成時と同じ形の薄い枠（§6-12）。画面全体を覆わない。 */}
          {state === 'loading' && (
            <ul className="bg-card rounded-card motion-safe:animate-pulse" aria-busy="true" aria-label="AIの判断を読み込んでいます">
              {[0, 1, 2].map(i => (
                <li key={i} className="mx-4 border-t border-border first:border-t-0 py-4 space-y-2">
                  <div className="h-4 w-40 rounded-field bg-surface" />
                  <div className="h-4 w-full rounded-field bg-surface" />
                </li>
              ))}
            </ul>
          )}

          {/* 空: 何が無いか＋次の一手を1つ（§6-12）。主ボタンは上の段で使い切っているので文字ボタン。 */}
          {state === 'empty' && (
            <div className="bg-card rounded-card px-4 py-5 space-y-2">
              <p className="text-body font-semibold text-ink">まだAIの判断記録がありません</p>
              <p className="text-small text-ink-2 max-w-[42rem]">
                AIの運用を始めると、ここに直近の判断とその理由が並びます。
              </p>
              <Link href="/watch" className="inline-block text-small text-brand hover:underline">
                「見る」を開く →
              </Link>
            </div>
          )}

          {state === 'ready' && session && (
            <>
              <ul className="bg-card rounded-card">
                {session.decisions.slice(0, 3).map((d, i) => (
                  <li key={`${d.symbol}-${i}`} className="mx-4 border-t border-border first:border-t-0 py-4 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-body font-semibold text-ink">{d.symbol}</span>
                      <span className="text-small text-muted truncate">{d.name}</span>
                      <span className={ACTION_BADGE}>{ACTION_LABEL[d.action]}</span>
                    </div>
                    <p className="text-body text-ink-2 line-clamp-3 max-w-[42rem]">{d.reasoning}</p>
                  </li>
                ))}
              </ul>
              <p className="text-small text-ink-2 max-w-[42rem]">
                これはAIの仮想運用の記録であり、売買の推奨ではありません。
                <Link href="/watch" className="text-brand hover:underline ml-1">
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
    </div>
  )
}
