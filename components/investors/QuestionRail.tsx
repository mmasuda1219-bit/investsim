// 「ここから先は、あなたが答えます」のレール（2026-09-18 オーナー選択・案B）。言葉のルールの問いを並べる。
//
//  - 左に 1px の縦線（--rule-line）。各問いの1行目の高さに直径 9px の中空の丸（線 1.5px --brand）
//  - 問いの文だけを h3（18px/600）・行間 1.7 で出す。title と plain は出さない
//  - 各問いの下に書き込みの罫（1px --rule-line）と「/trade で書く →」。行全体が /trade へのリンク。銘柄だけ引き継ぐ
//    （app/trade/page.tsx:63-66 が ?symbol= を受ける）。ホバーで罫が --brand に（150ms）
//  - C ノート型（DESIGN.md §6-6）の名人欄への適用。読み終わったら自分が書く番だと形で分かるようにする
//
// 丸の位置: ol の左の線（1px）＋ 内側の余白（PC 32px / 390px 24px）の分だけ左へ戻し、線の上に中心を置く
//   left = −(余白 + 線 1px + 半径 4.5 − 線幅 0.5) → PC −37px / 390px −29px

import Link from 'next/link'
import type { JudgmentRule } from '@/lib/investors/rulebooks'

const DOT =
  "before:content-[''] before:absolute before:top-[9px] before:h-[9px] before:w-[9px] before:rounded-full before:bg-card before:border-[1.5px] before:border-brand before:-left-[29px] sm:before:-left-[37px]"

export function QuestionRail({ rules, symbol }: { rules: readonly JudgmentRule[]; symbol: string }) {
  const href = `/trade?symbol=${encodeURIComponent(symbol)}`
  return (
    <ol className="ml-1 border-l border-rule-line pl-6 sm:pl-8 space-y-7">
      {rules.map(rule => (
        <li key={rule.id} data-rule={rule.id} className={`relative ${DOT}`}>
          <Link
            href={href}
            className="group block rounded-field focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-4"
          >
            <p className="text-h3 leading-[1.7] text-ink">{rule.question}</p>
            <span className="mt-3 flex items-end justify-between gap-3 border-b border-rule-line pb-2 transition-colors duration-150 group-hover:border-brand">
              <span aria-hidden />
              <span className="text-caption text-muted">/trade で書く →</span>
            </span>
          </Link>
        </li>
      ))}
    </ol>
  )
}
