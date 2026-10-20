'use client'

import { createContext, useContext, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react'
import type { LabTerm } from '@/lib/lab/glossary-extra'

/**
 * 用語の囲み（/study・2026-10-12・オーナーの読みやすさの指示 (d)・DECISIONS 2026-10-09 の追記）。
 * components/ui に同じ部品が無いので、この画面用にここへ置く。
 *
 * 2026-10-12（同日のオーナー指示）: <abbr title>＋tabIndex=0 をやめ、**スマホで指で触っても説明が出る** <button> にした。
 *  - 見た目は前のまま: --card の面＋--border 1px＋rounded-field の小さな囲み。text-small font-semibold text-ink。ピル（rounded-full）にしない
 *  - 押す／Enter／Space で開閉。開いたら **その用語を含む段落の直下** に説明の箱（TermBox）を差し込む
 *    （浮かせる吹き出しにしない＝位置ずれ・画面外のはみ出しを避ける）。
 *    箱は --surface の面＋--border＋rounded-card。先頭に用語名（font-semibold text-ink）、その下に lib/lab/glossary-extra.ts の body（算式を含む）
 *  - **同じ段落で開けるのは1つ**（別の用語を押すと前のが閉じる）。もう一度押すか Esc で閉じる。開いている囲みは aria-expanded="true"＋枠を --brand に
 *  - 段落単位の状態は TermGroup が持つ（React の文脈）。呼び手は段落（<p>）や項目（<li> の中身）を TermGroup で包む。
 *    MetricRows・CausalMap・CritiqueView の3か所で同じ作法。箱は TermGroup の children の直後に描くので、<p> の外（兄弟）か <li> の中に出る
 *  - TermGroup の外で使われたときは囲み自身が開閉を持ち、箱を直後に <span class="block"> で出す（<p> の中でも壊れない保険。通常は使わない）
 *  - ホバーの title は残す（マウスの人の近道）。開閉にアニメーションは付けない（付けないので prefers-reduced-motion で分ける動きも無い）
 *  - **囲むのは用語だけ**。評価や状態の札（好調・注意 など）は作らない（DESIGN.md §2「札と記号の散らばり」。検査 (p)）
 *  - 日本語は単語の間に空白が無いので、行の高さを崩さないよう leading-tight・py-0.5 に留める
 * 検査: scripts/check-lab-9983.ts (p)。開閉の規則は純関数（nextOpenName・isCloseKey・termBoxId）に切り出し、検査はそれを直接呼ぶ
 */

const TERM_BASE =
  'inline-block rounded-field border bg-card px-1.5 py-0.5 text-small font-semibold leading-tight text-ink cursor-pointer touch-manipulation focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-2'
/** 閉じているとき（既定の見た目） */
export const TERM_CLASS = `${TERM_BASE} border-border`
/** 開いているとき（枠を --brand に） */
export const TERM_OPEN_CLASS = `${TERM_BASE} border-brand`
/** 説明の箱 */
export const TERM_BOX_CLASS = 'bg-surface rounded-card border border-border px-3 py-2 mt-2 text-small text-ink-2'

/** 押した用語が開いていれば閉じる（null）、別の用語なら切り替える。同じ段落で開けるのは1つ */
export const nextOpenName = (current: string | null, clicked: string): string | null => (current === clicked ? null : clicked)
/** Esc で閉じる（古いブラウザの 'Esc' も） */
export const isCloseKey = (key: string): boolean => key === 'Escape' || key === 'Esc'
/** 説明の箱の id（囲みの aria-controls と一致させる）。用語名に空白は無いが、id に空白は使えないので念のため _ に */
export const termBoxId = (groupId: string, name: string): string => `${groupId}-term-${name.replace(/\s+/g, '_')}`

interface TermContextValue {
  groupId: string
  openName: string | null
  toggle: (term: LabTerm) => void
  close: () => void
}
const TermContext = createContext<TermContextValue | null>(null)

/**
 * 1段落ぶんの開閉の状態。children（段落）の直後に、開いている用語の説明の箱を描く。
 * id はページの中で一意にする（箱の id・aria-controls の元）。defaultOpen は最初から開いておく用語（検査・静的描画用）。
 */
export function TermGroup({ id, defaultOpen = null, children }: { id: string; defaultOpen?: LabTerm | null; children: ReactNode }) {
  const [open, setOpen] = useState<LabTerm | null>(defaultOpen)
  const value = useMemo<TermContextValue>(
    () => ({
      groupId: id,
      openName: open?.name ?? null,
      toggle: term => setOpen(cur => (nextOpenName(cur?.name ?? null, term.name) === null ? null : term)),
      close: () => setOpen(null),
    }),
    [id, open],
  )
  return (
    <TermContext.Provider value={value}>
      {children}
      {open && <TermBox id={termBoxId(id, open.name)} term={open} />}
    </TermContext.Provider>
  )
}

/** 説明の箱。先頭に用語名、その下に body（算式を含む）。as="span" は <p> の中に置くときの保険（block で段落の下に出る） */
export function TermBox({ id, term, as = 'div' }: { id: string; term: LabTerm; as?: 'div' | 'span' }) {
  const Tag = as
  return (
    <Tag id={id} className={as === 'span' ? `block ${TERM_BOX_CLASS}` : TERM_BOX_CLASS} data-term-box={term.name}>
      <span className="block font-semibold text-ink">{term.name}</span>
      <span className="block">{term.body}</span>
    </Tag>
  )
}

export function Term({ term, children }: { term: LabTerm; children?: ReactNode }) {
  const ctx = useContext(TermContext)
  // TermGroup の外で使われたときの保険（通常は TermGroup が状態を持つ）
  const [localOpen, setLocalOpen] = useState(false)
  const open = ctx ? ctx.openName === term.name : localOpen
  const boxId = termBoxId(ctx?.groupId ?? 'lab-term', term.name)
  const toggle = () => (ctx ? ctx.toggle(term) : setLocalOpen(v => !v))
  const close = () => (ctx ? ctx.close() : setLocalOpen(false))
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (open && isCloseKey(e.key)) {
      e.preventDefault()
      close()
    }
  }
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={boxId}
        title={`${term.name}：${term.body}`}
        className={open ? TERM_OPEN_CLASS : TERM_CLASS}
        data-term={term.name}
        onClick={toggle}
        onKeyDown={onKeyDown}
      >
        {children ?? term.name}
      </button>
      {!ctx && open && <TermBox id={boxId} term={term} as="span" />}
    </>
  )
}
