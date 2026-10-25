import type { ReactNode } from 'react'
import Link from 'next/link'
import { MIN_RECORDS } from '@/lib/review/patterns'
import { summarizeHabits } from '@/lib/review/habits/catalogue'
import {
  CATALYST_DENOM,
  CATALYST_LABEL,
  CATALYST_TITLE,
  CHANGE_DENOM,
  CHANGE_LABEL,
  CHANGE_TITLE,
  DISCLAIMER_A,
  DISCLAIMER_B,
  DISCLAIMER_D,
  EXIT_RULE_DENOM,
  EXIT_RULE_LABEL,
  EXIT_RULE_TITLE,
  HOLD_DENOM,
  HOLD_LABEL,
  HOLD_LEAD,
  HOLD_TITLE,
  MATERIAL_DENOM,
  MATERIAL_LABEL,
  MATERIAL_LEAD,
  MATERIAL_NONE_LABEL,
  MATERIAL_TITLE,
  PAST_NO_CATALYST_NOTE,
  PHRASE_DENOM,
  PHRASE_LEAD,
  PHRASE_NONE,
  SECTION_DOING,
  SECTION_PHRASE,
  SECTION_WRITING,
  SELL_LINK_BREAKDOWN,
  SELL_LINK_DENOM,
  SELL_LINK_HIT_LABEL,
  SELL_LINK_LABEL,
  SELL_LINK_LEAD,
  SELL_LINK_MISS_LABEL,
  SELL_LINK_NOTE,
  SELL_LINK_TITLE,
  SEPARATE_NOTE,
  countText,
  countedText,
  denominatorText,
  groupHeading,
  headingText,
  ofText,
  recordLinkText,
} from '@/lib/review/habits/text'
import type { HabitGroup, HabitRecordInput } from '@/lib/review/habits/types'

/**
 * 「書いたことと、したことのまとめ（売り終えた◯件から）」（/review の一覧・S-H1・2026-10-25）。DESIGN.md §6-20。
 *
 * 文はすべて lib/review/habits/text.ts から引く（この部品で文を作らない）。数は lib/review/habits/catalogue.ts の純関数が数える。
 * 見た目は既存のトークンだけ: 節は h2（text-h2 text-ink）、帳簿ごとに h3、事実ごとに --card の帯の中を border-t の行で区切る
 * （カードを格子に並べない）。件数に色・棒・ゲージを付けない。断り (a)(b) は常に、(c) は傾向の段落ごとに、(d) は5件未満のとき。
 * 断りは 12px 以上・--muted 以上の濃さ。<details> で畳まない・opacity を重ねない・aria-hidden を付けない。
 *
 * 損益・株価・買値・売値を受け取らない（props は HabitRecordInput だけ＝その欄が型に無い）。
 * 検査: scripts/check-review-habits.ts。
 */

type Row = { label: string; value: string }

/** 区分の行（label 左・件数 右）。行の区切りは border-t。390px で折り返す */
function Rows({ rows }: { rows: Row[] }) {
  return (
    <dl className="bg-card rounded-card px-4">
      {rows.map((r, i) => (
        <div key={`${r.label}-${i}`} className="border-t border-border first:border-t-0 flex items-baseline justify-between gap-3 py-3">
          <dt className="min-w-0 text-small text-ink">{r.label}</dt>
          <dd className="shrink-0 text-small text-ink tabular-nums whitespace-nowrap">{r.value}</dd>
        </div>
      ))}
    </dl>
  )
}

/** 1つの事実の段落。trend＝5件以上の傾向の段落（分母の文 (c) を同じ段落に置く） */
function Fact({ title, lead, rows, note, denom, trend, children }: { title: string; lead?: string; rows: Row[]; note?: string; denom?: string; trend: boolean; children?: ReactNode }) {
  return (
    <div className="space-y-2" data-habit-trend={trend ? '' : undefined}>
      <p className="text-small font-semibold text-ink">{title}</p>
      {lead && <p className="text-small text-ink-2 max-w-[42rem]">{lead}</p>}
      <Rows rows={rows} />
      {children}
      {note && <p className="text-small text-muted max-w-[42rem]">{note}</p>}
      {denom && <p className="text-small text-muted max-w-[42rem]" data-habit-denominator="">{denom}</p>}
    </div>
  )
}

function Group({ g }: { g: HabitGroup }) {
  const trend = g.total >= MIN_RECORDS
  const v = (total: number, count: number) => (trend ? ofText(total, count) : countText(count))
  const den = (d: readonly [string, string], n: number) => (trend ? denominatorText(g.closedCount, d[0], n, d[1]) : undefined)
  const catalystNote = g.source === 'past' ? PAST_NO_CATALYST_NOTE : undefined

  return (
    <div className="space-y-6">
      <h3 className="text-h3 text-ink">{groupHeading(g.source, g.total)}</h3>

      {!trend && <p className="text-small text-ink-2 max-w-[42rem]">{DISCLAIMER_D}</p>}

      {/* §1 書き方の内訳 */}
      <div className="space-y-4">
        <p className="text-small font-semibold text-ink-2">{SECTION_WRITING}</p>
        <Fact
          title={EXIT_RULE_TITLE}
          rows={g.exitRule.counts.map(c => ({ label: EXIT_RULE_LABEL[c.key], value: v(g.exitRule.total, c.count) }))}
          denom={den(EXIT_RULE_DENOM, g.exitRule.total)}
          trend={trend}
        />
        <Fact
          title={MATERIAL_TITLE}
          lead={MATERIAL_LEAD}
          rows={[
            ...g.material.counts.map(c => ({ label: MATERIAL_LABEL[c.key], value: v(g.material.total, c.count) })),
            { label: MATERIAL_NONE_LABEL, value: v(g.material.total, g.material.noneCount) },
          ]}
          denom={den(MATERIAL_DENOM, g.material.total)}
          trend={trend}
        />
        <Fact
          title={CATALYST_TITLE}
          rows={g.catalyst.counts.map(c => ({ label: CATALYST_LABEL[c.key], value: v(g.catalyst.total, c.count) }))}
          note={catalystNote}
          denom={den(CATALYST_DENOM, g.catalyst.total)}
          trend={trend}
        />
      </div>

      {/* §2・§3 は5件以上のときだけ（5件未満は件数だけ＝傾向の文を出さない） */}
      {trend && (
        <div className="space-y-4">
          <p className="text-small font-semibold text-ink-2">{SECTION_DOING}</p>
          <Fact
            title={SELL_LINK_TITLE}
            lead={SELL_LINK_LEAD}
            rows={[
              { label: SELL_LINK_HIT_LABEL, value: ofText(g.sellLink.total, g.sellLink.hits) },
              { label: SELL_LINK_MISS_LABEL, value: ofText(g.sellLink.total, g.sellLink.total - g.sellLink.hits) },
            ]}
            note={SELL_LINK_NOTE}
            denom={denominatorText(g.closedCount, SELL_LINK_DENOM[0], g.sellLink.total, SELL_LINK_DENOM[1])}
            trend
          >
            <p className="text-small text-ink-2 max-w-[42rem] pt-1">{SELL_LINK_BREAKDOWN}</p>
            <Rows rows={g.sellLink.counts.map(c => ({ label: SELL_LINK_LABEL[c.key], value: ofText(g.sellLink.hits, c.count) }))} />
          </Fact>
          <Fact
            title={CHANGE_TITLE}
            rows={g.change.counts.map(c => ({ label: CHANGE_LABEL[c.key], value: ofText(g.change.total, c.count) }))}
            denom={denominatorText(g.closedCount, CHANGE_DENOM[0], g.change.total, CHANGE_DENOM[1])}
            trend
          />
          <Fact
            title={HOLD_TITLE}
            lead={HOLD_LEAD}
            rows={g.hold.counts.map(c => ({ label: HOLD_LABEL[c.key], value: ofText(g.hold.total, c.count) }))}
            denom={denominatorText(g.closedCount, HOLD_DENOM[0], g.hold.total, HOLD_DENOM[1])}
            trend
          />
        </div>
      )}

      {trend && (
        <div className="space-y-2" data-habit-trend="">
          <p className="text-small font-semibold text-ink-2">{SECTION_PHRASE}</p>
          <p className="text-small text-ink-2 max-w-[42rem]">{PHRASE_LEAD}</p>
          {g.phrase.phrases.length === 0 ? (
            <p className="text-small text-ink">{PHRASE_NONE}</p>
          ) : (
            <ul className="bg-card rounded-card px-4">
              {g.phrase.phrases.map((p, i) => (
                <li key={`${p.text}-${i}`} className="border-t border-border first:border-t-0 py-3 space-y-1">
                  <p className="text-body text-ink whitespace-pre-line break-words max-w-[42rem]" data-habit-quote="">「{p.text}」</p>
                  <p className="flex flex-wrap gap-x-3 gap-y-1 text-small">
                    {p.records.map(r => (
                      <Link key={r.id} href={`/review/${r.id}`} className="text-brand hover:underline tabular-nums">
                        {recordLinkText(r.seq)}
                      </Link>
                    ))}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <p className="text-small text-muted max-w-[42rem]" data-habit-denominator="">
            {denominatorText(g.closedCount, PHRASE_DENOM[0], g.phrase.total, PHRASE_DENOM[1])}
          </p>
        </div>
      )}
    </div>
  )
}

export function HabitSummary({ records }: { records: readonly HabitRecordInput[] }) {
  const s = summarizeHabits(records)
  const practice = s.groups.find(g => g.source === 'practice')?.total ?? 0
  const past = s.groups.find(g => g.source === 'past')?.total ?? 0

  return (
    <section className="space-y-3" aria-labelledby="habit-summary-heading">
      <h2 id="habit-summary-heading" className="text-h2 text-ink text-balance">{headingText(s.total)}</h2>

      {/* (a)(b) はどの状態でも出す（legal §8・畳まない・薄くしない） */}
      <p className="text-small text-ink-2 max-w-[42rem]" data-habit-disclaimer="a">{DISCLAIMER_A}</p>
      <p className="text-small text-ink-2 max-w-[42rem]" data-habit-disclaimer="b">{DISCLAIMER_B}</p>

      {/* §0 数えたもの */}
      <p className="text-body text-ink max-w-[42rem]">
        {countedText({
          total: s.total,
          practice,
          past,
          closedCount: s.closedCount,
          openCount: s.openCount,
          unstructuredCount: s.unstructuredCount,
          firstAt: s.firstAt,
          lastAt: s.lastAt,
        })}
      </p>

      {s.total === 0 && <p className="text-small text-ink-2 max-w-[42rem]">{DISCLAIMER_D}</p>}
      {s.groups.length === 2 && <p className="text-small text-muted max-w-[42rem]">{SEPARATE_NOTE}</p>}

      {s.groups.length > 0 && (
        <div className="space-y-8 pt-2">
          {s.groups.map(g => (
            <Group key={g.source} g={g} />
          ))}
        </div>
      )}
    </section>
  )
}
