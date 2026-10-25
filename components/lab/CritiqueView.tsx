'use client'

import { useState } from 'react'
import { LearnPanel } from '@/components/lab/LearnPanel'
import { Pieces } from '@/components/lab/RichText'
import { TermGroup } from '@/components/lab/Term'
import { Disclaimer } from '@/components/ui/Disclaimer'
import type { Critique } from '@/lib/lab/critique/compose'
import { CRITIQUE_TITLE } from '@/lib/lab/critique/sections'
import { splitTerms, termTokens } from '@/lib/lab/rich'

/**
 * 「添削」（/study・2026-10-09 S-A に /lab/9983 として作成）。lib/lab/critique/compose.ts が組んだ Critique を、7節の見出し・順番そのままに描く。
 *
 *  - 見出し7つと順番は lib/lab/critique/sections.ts が正。ここで足さない・並べ替えない
 *  - §3 の範囲を断る文（CHECK_SCOPE_NOTE）とバッジ（BADGE）は**無条件**で描く。§3 の当たりが0件のときも消さない・畳まない
 *    （「見つからなかったこと」を「問題なし」と読まれないため。2026-10-19 公開に合わせて不変条件として明記。検査 (h)）
 *  - §1 は原文の逐語引用（whitespace-pre-wrap・書き換えない）／§2 事実の列挙／§3 固定カタログ／§4 抜けている項目／
 *    §5 固定の併置文／§6 固定テーマ（タップで画面6を開く）／§7 固定文＋Disclaimer part="general"
 *  - 「役に立った／立たなかった」のボタンは出さない（S-A では保存先が無い）
 *  - 評価の語・点数・ランクを作らない。色を使わない
 *  - 見出しは h2＝text-h2 text-ink、節＝h3 text-h3 text-ink（scripts/check-headings.ts の規則）
 *  - 2026-10-12（オーナーの読みやすさの指示 (a)(d)）: §3 の本文と §5 の併置文は compose.ts の「かけら」を描き、数字の直後に出典の番号 [N]。
 *    用語の囲み（Term）は §4 の項目名と §5 の中だけ（同じ節の中で初出だけ）。**§1 の利用者の原文と §3 の固定文は囲まない**。
 *    囲みは <button>（スマホで触っても開く・2026-10-12）。押すと説明の箱が項目の直下に出るので、§4・§5 の各 <li> の中身を TermGroup で包む（§3 は用語が無いので包まない）
 */

const TOKENS = termTokens()

export const CRITIQUE_LEAD = 'あなたが書いた文と、会社が公表した数字を突き合わせました。良し悪しは判定しません。'
export const BADGE = 'このサイトは良し悪しを判定しません'
export const NO_QUOTES = '書かれた文はありません。'
export const OPEN_LEARN = 'この部品を開く'
export const CLOSE_LEARN = '閉じる'
export const KIND_LABEL: Record<'calc' | 'check', string> = { calc: '計算方法', check: '確認漏れ' }

export function CritiqueView({ critique }: { critique: Critique }) {
  const [learnOpen, setLearnOpen] = useState(false)
  const s = critique.sections
  const title = (no: number) => `§${no} ${s[no - 1].title}`
  // §4 の項目名の用語（同じ節の中で初出だけ囲む）
  const missingSeen = new Set<string>()
  const missingPieces = critique.missing.items.map(m => splitTerms(m.label, TOKENS, missingSeen))

  return (
    <section className="space-y-4" data-section="lab-critique" aria-labelledby="lab-critique-heading">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 id="lab-critique-heading" className="text-h2 text-ink">{CRITIQUE_TITLE}</h2>
        <span className="shrink-0 rounded-full border border-border bg-surface px-3 py-1 text-caption text-ink">{BADGE}</span>
      </div>
      <p className="text-small text-muted max-w-[42rem]">{CRITIQUE_LEAD}</p>

      <div className="bg-card rounded-card border border-border">
        {/* §1 あなたの判断の流れ */}
        <section className="mx-4 py-4 space-y-2" data-critique="flow">
          <h3 className="text-h3 text-ink">{title(1)}</h3>
          {critique.flow.decision && <p className="text-body text-ink">結論: {critique.flow.decision}</p>}
          {critique.flow.quotes.length === 0 ? (
            <p className="text-body text-ink-2">{NO_QUOTES}</p>
          ) : (
            <dl className="space-y-3 border-l-2 border-rule-line pl-3">
              {critique.flow.quotes.map((q, i) => (
                <div key={`${q.label}-${i}`}>
                  <dt className="text-small font-semibold text-ink">{q.label}</dt>
                  <dd className="text-body text-ink-2 whitespace-pre-wrap break-words">{q.text}</dd>
                </div>
              ))}
            </dl>
          )}
        </section>

        {/* §2 書けていたこと */}
        <section className="mx-4 border-t border-border py-4 space-y-2" data-critique="written">
          <h3 className="text-h3 text-ink">{title(2)}</h3>
          <p className="text-body text-ink-2 tabular-nums">{critique.written.filledLine}</p>
          <p className="text-small font-semibold text-ink pt-1">{critique.written.namesHeading}</p>
          {critique.written.nameLines.map((l, i) => (
            <p key={i} className="text-body text-ink-2">{l}</p>
          ))}
          <p className="text-body text-ink-2 pt-1">{critique.written.decisionLine}</p>
        </section>

        {/* §3 計算の確かめと、確認したいこと（見出し文は sections.ts。ここに書かない） */}
        <section className="mx-4 border-t border-border py-4 space-y-3" data-critique="check">
          <h3 className="text-h3 text-ink">{title(3)}</h3>
          {critique.check.hits.length === 0 ? (
            <p className="text-body text-ink-2">{critique.check.nothingFound}</p>
          ) : (
            <ul className="space-y-3">
              {critique.check.hits.map(h => (
                <li key={h.id} className="space-y-1" data-catalogue-id={h.id}>
                  <p className="text-small font-semibold text-ink">
                    {h.title} <span className="font-normal text-caption text-muted">（{KIND_LABEL[h.kind]}）</span>
                  </p>
                  <p className="text-body text-ink-2 max-w-[42rem] tabular-nums"><Pieces pieces={h.bodyPieces} /></p>
                  {h.details.length > 0 && (
                    <ul className="list-disc pl-5 space-y-0.5" data-catalogue-details={h.id}>
                      {h.details.map((d, i) => (
                        <li key={i} className="text-body text-ink-2 max-w-[42rem] tabular-nums"><Pieces pieces={d.pieces} /></li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
          {/* 範囲を断る文。当たりが0件でも描く＝上の三項の**外**に置く（検査 (h)）。畳まない・条件で包まない */}
          <p className="text-caption text-muted max-w-[42rem]">{critique.check.scopeNote}</p>
        </section>

        {/* §4 確認が抜けている項目 */}
        <section className="mx-4 border-t border-border py-4 space-y-2" data-critique="missing">
          <h3 className="text-h3 text-ink">{title(4)}</h3>
          {critique.missing.noneText ? (
            <p className="text-body text-ink-2">{critique.missing.noneText}</p>
          ) : (
            <ul className="list-disc pl-5 space-y-0.5">
              {critique.missing.items.map((m, i) => (
                <li key={m.key} className="text-body text-ink-2"><TermGroup id={`lab-critique-missing-${m.key}`}><Pieces pieces={missingPieces[i]} /></TermGroup></li>
              ))}
            </ul>
          )}
        </section>

        {/* §5 情報のつなげ方の例 */}
        <section className="mx-4 border-t border-border py-4 space-y-2" data-critique="connect">
          <h3 className="text-h3 text-ink">{title(5)}</h3>
          <ol className="list-decimal pl-5 space-y-2">
            {critique.connect.pieces.map((p, i) => (
              <li key={i} className="text-body text-ink-2 max-w-[42rem] tabular-nums"><TermGroup id={`lab-critique-connect-${i}`}><Pieces pieces={p} /></TermGroup></li>
            ))}
          </ol>
        </section>

        {/* §6 次に学ぶとよいテーマ */}
        <section className="mx-4 border-t border-border py-4 space-y-2" data-critique="learn">
          <h3 className="text-h3 text-ink">{title(6)}</h3>
          <p className="text-body text-ink">{critique.learn.theme.title}</p>
          <p className="text-body text-ink-2 max-w-[42rem]">{critique.learn.theme.lead}</p>
          <button
            type="button"
            aria-expanded={learnOpen}
            aria-controls="lab-learn-panel"
            onClick={() => setLearnOpen(v => !v)}
            className="h-11 px-4 rounded-field bg-card text-ink border border-border-input hover:bg-surface text-small focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-2"
          >
            {learnOpen ? CLOSE_LEARN : OPEN_LEARN}
          </button>
          {learnOpen && (
            <div id="lab-learn-panel" className="pt-2">
              <LearnPanel theme={critique.learn.theme} />
            </div>
          )}
        </section>

        {/* §7 注意事項 */}
        <section className="mx-4 border-t border-border py-4 space-y-2" data-critique="notes">
          <h3 className="text-h3 text-ink">{title(7)}</h3>
          {critique.notes.map((t, i) => (
            <p key={i} className="text-small text-ink-2 max-w-[42rem]">{t}</p>
          ))}
          <Disclaimer part="general" />
        </section>
      </div>
    </section>
  )
}
