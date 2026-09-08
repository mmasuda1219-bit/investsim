'use client'

import type { ReasonFieldSpec, ReasonParts } from '@/lib/trade/reason'

/**
 * 「なぜそう判断したか」の入力。/trade と TradeModal の両方から使う。
 *
 * 入口が違っても規律を変えない、というのが元からの決まり（TradeModal の
 * コメント参照）。以前は同じ «自由記述1つ» を2か所に別々に書いていたため、
 * 型を入れるにあたって共有の1か所にまとめた。片方だけ問いが変わる状態を作らない。
 *
 * ここは «問いを出すだけ» で、良し悪しの判定はしない。判定するとアプリが
 * 投資判断に点をつけることになり、原則9および助言性の線に触れる。
 */

interface Props {
  /**
   * 出す問い。呼び出し側が `fieldsFor(action)`（今の売買）か
   * `pastFieldsFor(kind)`（過去の取引の記録）を渡す。
   * 問いの定義はここではなく lib/trade/reason.ts が持つ。
   */
  fields: ReasonFieldSpec[]
  parts: ReasonParts
  onChange: (key: string, value: string) => void
  /** key -> メッセージ。validateParts の byKey をそのまま渡す */
  errors: Record<string, string>
  /** 入力済みの項目に対して「あと何文字」を出すかどうか。触る前から赤くしない */
  touched: Record<string, boolean>
  onBlur: (key: string) => void
  /** モーダル用に行数と余白を詰める */
  compact?: boolean
  /** 同一ページに2つ置いても id が衝突しないように */
  idPrefix: string
}

export function ReasonFields({
  fields, parts, onChange, errors, touched, onBlur, compact = false, idPrefix,
}: Props) {
  return (
    <div className={compact ? 'space-y-3' : 'space-y-4'}>
      {fields.map(f => {
        const id = `${idPrefix}-${f.key}`
        const value = parts[f.key] ?? ''
        const err = errors[f.key]
        const showErr = !!err && touched[f.key]

        return (
          <div key={f.key} className="space-y-1">
            <label htmlFor={id} className="block text-xs text-slate-400">
              {f.question}{' '}
              {f.required
                ? <span className="text-emerald-400">（必須）</span>
                : <span className="text-slate-600">（任意）</span>}
            </label>

            {/* «なぜ書くのか» を毎回出す。書き方が分からないことが離脱の原因なので、
                ヘルプを畳まずに常時見せる。 */}
            <p className="text-[11px] text-muted leading-relaxed">{f.help}</p>

            <textarea
              id={id}
              rows={compact ? Math.max(2, f.rows - 1) : f.rows}
              value={value}
              onChange={e => onChange(f.key, e.target.value)}
              onBlur={() => onBlur(f.key)}
              placeholder={f.placeholder}
              aria-invalid={showErr || undefined}
              aria-describedby={showErr ? `${id}-err` : undefined}
              className={`w-full px-3 py-2 rounded-lg bg-panel border text-sm text-white leading-relaxed placeholder:text-slate-600 focus:outline-none ${
                showErr ? 'border-amber-600 focus:border-amber-500' : 'border-border focus:border-emerald-600'
              }`}
            />

            {showErr && (
              <p id={`${id}-err`} className="text-[11px] text-amber-500">{err}</p>
            )}
          </div>
        )
      })}
    </div>
  )
}
