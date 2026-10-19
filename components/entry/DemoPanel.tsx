'use client'

import { useEffect, useState } from 'react'
import { BUY_FIELDS, EXAMPLE_MEMO, RecordView, WriteForm, isTyped, type Memo } from './fragments'
import s from './home.module.css'

/**
 * ヒーローの実演パネル（設計図 §6 の「下端から覗く最初の実演」＋ §8「Slow crossfade」の翻訳）。L2・2026-10-14。
 *
 * 1件のメモの3つの状態を、1.6秒かけて入れ替わり、5.5秒ずつ留まる。**最初に出すのは 2（記録された1件）**で、順は 2 → 0 → 1 → 2 …
 * （MC 2026-10-14: 下端から覗く上 90px に「実際に書かれた文を持つ行」が入るほうが、設計図の「実物大の2行が見える」に近く、
 *   最初の画面で「何が残るのか」が伝わる）。
 *   0: 問いが3つ並んだだけ（空欄。薄い文字は記入例）。最初の欄が選択中の見え方
 *   1: 記入例が入った状態（reason.ts の placeholder が値として入る）
 *   2: 記録された1件（保存されるときと同じ形に組み立てたもの）。覗きに入るよう hint は下の行にまとめる（dense）
 *
 * 訪問者ができる1つのこと（スキル step 4「live thing」）: 欄に触れた／書いた瞬間に移り変わりを止め、その文を保持する。
 * 文は onDraft で親（app/(night)/page.tsx）へ渡り、下の節にそのまま現れる。**保存も送信もしない**（fetch・localStorage を使わない）。
 *
 * 守っていること:
 *  - タブが隠れたら止める（visibilitychange）。「動きを減らす」設定では最初の1つだけを出し、動かさない
 *  - 隠れている層は inert（焦点が隠れた欄に入らない）。visibility: hidden は CSS 側（home.module.css の .layer）
 *  - 3つ目の状態（記録）を押すと「書く前」に戻って書けるようにする（指1本・いつでも書ける）
 *  - 時刻・乱数・ユーザー・ログイン状態で中身を変えない（全員に同じものを同じ順で）
 */

const HOLD_MS = 5500
const LAYERS = 3

export function DemoPanel({ onDraft }: { onDraft: (draft: Memo | null) => void }) {
  const [active, setActive] = useState(2)
  const [locked, setLocked] = useState(false)
  const [draft, setDraft] = useState<Memo | null>(null)

  // 移り変わり。触られたら（locked）止める。タブが隠れている間は進めない
  useEffect(() => {
    if (locked) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let timer: number | undefined
    const arm = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        if (!document.hidden) setActive(a => (a + 1) % LAYERS)
        arm()
      }, HOLD_MS)
    }
    const onVisibility = () => {
      if (document.hidden) window.clearTimeout(timer)
      else arm()
    }
    arm()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [locked])

  /** 欄に触れた: その層で止める。初期値は層 0 なら空欄、層 1 なら記入例 */
  const hold = (layer: number) => {
    if (locked) return
    setLocked(true)
    setActive(layer)
    setDraft(prev => prev ?? (layer === 1 ? { ...EXAMPLE_MEMO } : Object.fromEntries(BUY_FIELDS.map(f => [f.key, '']))))
  }
  const change = (layer: number) => (key: string, value: string) => {
    hold(layer)
    setDraft(prev => {
      const base = prev ?? (layer === 1 ? { ...EXAMPLE_MEMO } : Object.fromEntries(BUY_FIELDS.map(f => [f.key, ''])))
      const next = { ...base, [key]: value }
      onDraft(next)
      return next
    })
  }

  const typed = isTyped(draft)
  const memo = typed ? (draft as Memo) : EXAMPLE_MEMO
  const emptyValues = Object.fromEntries(BUY_FIELDS.map(f => [f.key, '']))

  return (
    <div
      data-ui
      role="group"
      aria-label="書くときの画面の例。欄に書くと、その文が下の節にそのまま現れます。保存も送信もしません。"
      className={`${s.ui} ${s.stack}`}
    >
      <div className={s.layer} data-on={active === 0 ? '' : undefined} inert={active !== 0}>
        <WriteForm
          idPrefix="demo-a"
          values={locked && active === 0 ? (draft ?? emptyValues) : emptyValues}
          onChange={change(0)}
          onFocus={() => hold(0)}
          pointer={!locked}
          inert={active !== 0}
        />
      </div>
      <div className={s.layer} data-on={active === 1 ? '' : undefined} inert={active !== 1}>
        <WriteForm
          idPrefix="demo-b"
          values={locked && active === 1 ? (draft ?? EXAMPLE_MEMO) : EXAMPLE_MEMO}
          onChange={change(1)}
          onFocus={() => hold(1)}
          inert={active !== 1}
        />
      </div>
      {/* 記録された1件。押すと「書く前」に戻る（隠れた層は inert なので、この層への押下はここで受ける） */}
      <div
        className={s.layer}
        data-on={active === 2 ? '' : undefined}
        inert={active !== 2}
        onClick={() => { if (active === 2) hold(0) }}
      >
        <RecordView
          memo={memo}
          typed={typed}
          dense
          stateWord={(typed ? 'あなたが上の欄に書いた文です（保存も送信もしていません）。' : '記入例が入った状態です。') + '記録されると、こう残ります。押すと書く前に戻ります。'}
        />
      </div>
    </div>
  )
}
