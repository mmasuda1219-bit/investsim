'use client'

import { useState, useEffect } from 'react'
import investors from '@/lib/investors'
import type { Signal } from '@/types'

interface Props {
  symbol: string
}

// 方向の札は無彩色＋記号（DESIGN.md §6-5）。買い＝緑・売り＝赤で運ばない（DECISIONS 2026-09-10）。
// 以前の text-bull / text-bear は定義の無いクラス名で、色が付いていなかった。
const ACTION_LABEL: Record<Signal['action'], string> = {
  buy: '▲ 買い',
  sell: '▼ 売り',
  hold: '＝ 保有',
}

const ACTION_COLOR: Record<Signal['action'], string> = {
  buy: 'text-ink bg-surface border-border',
  sell: 'text-ink bg-surface border-border',
  hold: 'text-ink bg-surface border-border',
}

const STRENGTH_DOTS = (n: Signal['strength']) => Array.from({ length: 3 }, (_, i) => i < n)

// 画面に出す取得失敗の文。取得元の生の英語（«Real quote unavailable for AAPL — yahoo2: … / yahoodirect: …»、
// スライス1以降は3経路の失敗理由を連結した長い文）は出さない。原因は API の応答本文（error）にあり、
// 開発者はブラウザの Network で読める。文言は DESIGN.md §6-12 の三点形式（何が起きたか／データはどうなったか／
// どうすればいいか）。502 ＝ データ源が返せなかった（app/api/signals/[symbol]/route.ts の catch）。
const MSG_UPSTREAM = 'データ源（Yahoo Finance など）から、この銘柄の値を受け取れませんでした。実データが取れないときは、代わりの数字を作らずここで止めます。時間をおいて再読み込みしてください。'
const MSG_SERVER = 'サーバーから判定の結果を受け取れませんでした。時間をおいて再読み込みしてください。'
const MSG_NETWORK = 'サーバーに接続できないか、応答を読めませんでした。通信の状態を確かめて、再読み込みしてください。'
class HttpError extends Error {
  constructor(status: number) { super(status === 502 ? MSG_UPSTREAM : MSG_SERVER) }
}

// /api/signals の undecidable（判定できなかった名人の id → 理由の文。2026-09-17 スライス2）。
// 理由が文字列の人だけ残す。キーが無ければ空。
function readUndecidable(d: { undecidable?: unknown } | null): Record<string, string> {
  const raw = d?.undecidable
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, string> = {}
  for (const [id, why] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof why === 'string' && why.length > 0) out[id] = why
  }
  return out
}

export function InvestorPanel({ symbol }: Props) {
  const [selectedId, setSelectedId] = useState(investors[0].id)
  const [signals, setSignals] = useState<Record<string, Signal>>({})
  const [undecidable, setUndecidable] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    setUndecidable({})
    fetch(`/api/signals/${symbol}`)
      .then(async (r) => {
        const d = await r.json().catch(() => null)
        if (!r.ok || !d || d.error) throw new HttpError(r.status)
        setSignals(d.signals ?? {})
        setUndecidable(readUndecidable(d))
      })
      .catch((e: unknown) => setError(e instanceof HttpError ? e.message : MSG_NETWORK))
      .finally(() => setLoading(false))
  }, [symbol])

  const selected = investors.find((i) => i.id === selectedId)!
  const signal = signals[selectedId]
  const whyUndecidable = signal ? undefined : undecidable[selectedId]

  return (
    <div className="bg-panel border border-border rounded-xl p-5">
      <h2 className="text-ink font-semibold mb-4">著名投資家シミュレーション</h2>

      {/* Investor tabs */}
      <div className="flex gap-2 mb-5 flex-wrap">
        {investors.map((inv) => (
          <button
            key={inv.id}
            onClick={() => setSelectedId(inv.id)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all border ${
              selectedId === inv.id
                ? 'text-ink border-transparent'
                : 'text-muted border-border hover:text-ink'
            }`}
            style={selectedId === inv.id ? { backgroundColor: inv.avatarColor + '33', borderColor: inv.avatarColor } : {}}
          >
            {inv.nameJa}
          </button>
        ))}
      </div>

      {/* Investor info */}
      <div className="flex items-start gap-3 mb-5">
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center text-ink font-bold text-sm shrink-0"
          style={{ backgroundColor: selected.avatarColor }}
        >
          {selected.name.charAt(0)}
        </div>
        <div>
          <div className="text-ink font-medium">{selected.name}</div>
          <div className="text-ink-2 text-base mt-1 leading-relaxed max-w-[42rem]">{selected.description}</div>
          <div className="text-muted text-sm mt-1 italic leading-relaxed max-w-[42rem]">「{selected.philosophy}」</div>
        </div>
      </div>

      {/* Signal */}
      {loading && (
        <div className="flex items-center gap-2 text-muted text-sm">
          <div className="w-4 h-4 border-2 border-muted border-t-white rounded-full animate-spin" />
          シグナルを分析中...
        </div>
      )}

      {error && (
        // 取得できなかったことは --warning-ink で書く（DESIGN.md §5-1 色のルール）。
        // 旧: 赤い箱に「データ取得エラー: {取得元の生の英語}」。枠の中に枠を作らない。
        <div className="text-sm py-2 max-w-[42rem] leading-relaxed">
          <p className="text-warning-ink">シグナルを取得できませんでした</p>
          <p className="text-ink-2 mt-1">{error}</p>
        </div>
      )}

      {!loading && !error && whyUndecidable && (
        // 材料が無くて判定できない（財務データが取れない等）。理由の文は API から来る。
        <div className="text-sm py-2 max-w-[42rem] leading-relaxed">
          <p className="text-warning-ink">判定できません</p>
          <p className="text-ink-2 mt-1">{whyUndecidable}</p>
        </div>
      )}

      {!loading && !error && !signal && !whyUndecidable && (
        <div className="text-muted text-sm py-2">
          このシンボルのシグナルデータが取得できませんでした
        </div>
      )}

      {!loading && !error && signal && (
        <div>
          <div className={`inline-flex items-center gap-3 px-4 py-2.5 rounded-lg border mb-4 ${ACTION_COLOR[signal.action]}`}>
            <span className="text-lg font-bold">{ACTION_LABEL[signal.action]}</span>
            <div className="flex gap-1">
              {STRENGTH_DOTS(signal.strength).map((filled, i) => (
                <div
                  key={i}
                  className={`w-2 h-2 rounded-full ${filled ? 'bg-current' : 'bg-current opacity-30'}`}
                />
              ))}
            </div>
            <span className="text-xs opacity-70">
              強度 {signal.strength}/3
            </span>
          </div>

          <ul className="space-y-2">
            {signal.reasons.map((r, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-ink-2">
                <span className="text-muted mt-0.5 shrink-0">▸</span>
                {r}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
