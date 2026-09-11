'use client'

// /watch の「1回の分析（tick）」を1つの出来事として説明するカード。
//
// これが答えるのは「なぜAIはこの銘柄を見たのか」だけ。判断の中身は DecisionCard が持つ。
// 選定ルール（母集団40銘柄 → 当日変化率の絶対値で上位4 → 保有銘柄を追加）は
// lib/ai-trader/engine.ts の selectCandidates / runTick に実在するロジックで、
// 銘柄数は lib/ai-trader/universe.ts の実データから引いている（画面で数字を作らない）。
//
// 表示方針: 装飾で「AIっぽさ」を出さない。処理の段階・実測値・時刻を精密に出すことだけで
// 技術的な信頼を作る（発光・グラデーション・偽のリアルタイム風演出は使わない）。

import { UNIVERSE_META, TICK_CANDIDATE_COUNT } from '@/lib/ai-trader/universe'

export interface TickSummaryProps {
  /** 最新tickの実行時刻（ISO文字列）。 */
  lastTickAt: string
  tickCount: number
  /** この回で分析した銘柄（engine の session.watchlist ＝ 候補＋保有の重複除去済み）。 */
  analyzedSymbols: string[]
  /** 保有中の銘柄。値動きで選ばれたものと区別して印を付けるために使う。 */
  holdingSymbols: string[]
  /** 銘柄→当日変化率(%)。最新tickの判断から拾える分だけ。無い銘柄は数値を出さない。 */
  changeBySymbol: Record<string, number | undefined>
  /**
   * この回のtickでAIの判断が記録されたか。engine は「分析対象を選ぶ→AIに問う」の順で動き、
   * 対象(watchlist)は問う前に保存される。そのためAIの応答が取れなかった回は
   * 「対象はあるが判断は無い」状態が実際に残る。これを隠さずに書く。
   */
  decisionsRecorded?: boolean
}

const changeCls = (v: number) => (v > 0 ? 'text-success' : v < 0 ? 'text-danger' : 'text-ink-2')
const fmtPct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`

function relTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms)) return ''
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}秒前`
  if (s < 3600) return `${Math.floor(s / 60)}分前`
  if (s < 86400) return `${Math.floor(s / 3600)}時間前`
  return `${Math.floor(s / 86400)}日前`
}

function absTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  }).format(d)
}

/** 処理過程の1段。左に段番号、右に実測値を等幅で置く。 */
function Step({ n, label, value, note, last }: { n: number; label: string; value: string; note?: string; last?: boolean }) {
  return (
    <li className="relative pl-9 pb-4 last:pb-0">
      {/* 段をつなぐ縦線。最後の段には引かない */}
      {!last && (
        <span aria-hidden className="absolute left-[11px] top-6 bottom-0 w-px bg-[var(--border)]" />
      )}
      <span
        aria-hidden
        className="absolute left-0 top-0 w-6 h-6 rounded-full border border-border bg-surface
                   flex items-center justify-center text-[11px] font-mono tabular-nums text-muted"
      >
        {n}
      </span>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <span className="text-ink-2">{label}</span>
        <span className="ml-auto font-mono tabular-nums text-ink font-semibold whitespace-nowrap">{value}</span>
      </div>
      {note && <div className="text-sm text-muted leading-relaxed">{note}</div>}
    </li>
  )
}

export default function TickSummary({
  lastTickAt,
  tickCount,
  analyzedSymbols,
  holdingSymbols,
  changeBySymbol,
  decisionsRecorded = true,
}: TickSummaryProps) {
  const holdingSet = new Set(holdingSymbols)
  // 値動きで選ばれた分 ＝ 分析対象のうち保有でないもの。engine 側で取得に失敗した銘柄は
  // 母集団から落ちるため、ルール上の上位4件より少ないことがある。実際の数を出す。
  const hasChanges = analyzedSymbols.some(s => typeof changeBySymbol[s] === 'number')
  const byMove = analyzedSymbols.filter(s => !holdingSet.has(s))
  const heldAnalyzed = analyzedSymbols.filter(s => holdingSet.has(s))

  return (
    <section className="bg-panel border border-border rounded-2xl overflow-hidden">
      <header className="px-5 py-4 border-b border-border flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-ink font-semibold">最新の分析</h2>
        <span className="font-mono tabular-nums text-sm text-muted">Tick #{tickCount}</span>
        <span className="ml-auto text-sm text-ink-2 tabular-nums whitespace-nowrap">
          {relTime(lastTickAt)}
          <span className="text-muted"> · {absTime(lastTickAt)}</span>
        </span>
      </header>

      {!decisionsRecorded && (
        <div className="px-5 py-3 border-b border-border bg-surface">
          <p className="text-sm text-ink-2 leading-relaxed max-w-[42rem]">
            この回は分析する銘柄を選ぶところまでは進みましたが、AIの判断は記録されていません。
            下に出ているのは、それより前に記録された判断です。
          </p>
        </div>
      )}

      <div className="px-5 py-4 space-y-5">
        <div>
          <h3 className="text-sm font-semibold text-ink-2 mb-3">AIがこの銘柄を選ぶまで</h3>
          <ol className="text-base max-w-[40rem]">
            <Step
              n={1}
              label="監視している銘柄"
              value={`${UNIVERSE_META.total}銘柄`}
              note={`米国 ${UNIVERSE_META.us}銘柄・日本 ${UNIVERSE_META.jp}銘柄。毎回この全部の株価を取得する`}
            />
            <Step
              n={2}
              label="当日の値動きが大きい順に選定"
              value={`${byMove.length}銘柄`}
              note={`上昇・下落を問わず、当日変化率の絶対値が大きい上位${TICK_CANDIDATE_COUNT}銘柄`}
            />
            <Step
              n={3}
              label="保有中の銘柄を追加"
              value={`${heldAnalyzed.length}銘柄`}
              note="売る判断をするために、持っている銘柄は値動きに関わらず必ず見る"
            />
            <Step
              n={4}
              last
              label="この回で分析した銘柄"
              value={`${analyzedSymbols.length}銘柄`}
              note="同じ銘柄の重なりを除いた数です。1銘柄ずつ、株価・値動きの形・会社の数字・ニュースを集めてAIに渡しています"
            />
          </ol>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-ink-2 mb-2">
            {hasChanges ? '分析した銘柄と、選ばれた理由になった当日変化率' : 'この回で分析した銘柄'}
          </h3>
          {analyzedSymbols.length === 0 ? (
            <p className="text-sm text-muted">この回の分析対象は記録されていません。</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {analyzedSymbols.map(sym => {
                const held = holdingSet.has(sym)
                const chg = changeBySymbol[sym]
                return (
                  <li
                    key={sym}
                    className="flex items-baseline gap-2 border border-border rounded-lg bg-surface px-2.5 py-1.5"
                  >
                    <span className="font-mono font-semibold text-sm text-ink">{sym}</span>
                    {typeof chg === 'number' ? (
                      <span className={`font-mono tabular-nums text-sm ${changeCls(chg)}`}>{fmtPct(chg)}</span>
                    ) : hasChanges ? (
                      <span className="text-sm text-muted" title="この銘柄の変化率は記録に残っていません">—</span>
                    ) : null}
                    {held && (
                      <span className="text-[11px] text-muted border border-border rounded px-1 py-px whitespace-nowrap">
                        保有中
                      </span>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
          <p className="text-sm text-muted leading-relaxed mt-2 max-w-[42rem]">
            「保有中」の印が無い銘柄は、その日に大きく動いたから選ばれただけです。
            良い銘柄だから選んだ、という意味ではありません。
          </p>
        </div>
      </div>
    </section>
  )
}
