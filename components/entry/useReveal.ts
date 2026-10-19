'use client'

import { useEffect, type RefObject } from 'react'

/**
 * 節に入ったときの入場（スキル references/motion.md「Reveal on scroll (once)」）。L2・2026-10-14。
 *
 * root の中の `[data-reveal]` を IntersectionObserver で見て、画面に入ったら `data-in` を付ける（1度だけ・再生しない）。
 * 隠した状態（opacity 0・24px 下）は、この hook が root に `data-motion="on"` を付けたあとにだけ CSS が当てる。
 * だから script が走らなければ何も隠れない（「opacity:0 で待たせない」）。
 * 「動きを減らす」設定・IntersectionObserver が無い環境では、全部にすぐ `data-in` を付けて終える（内容は消えない）。
 * 遅延の刻み（60〜90ms）は要素側の `--i` が持つ（home.module.css）。
 */
export function useReveal(root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = root.current
    if (!el) return
    const targets = Array.from(el.querySelectorAll<HTMLElement>('[data-reveal]'))
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (calm || typeof IntersectionObserver === 'undefined') {
      for (const t of targets) t.setAttribute('data-in', '')
      return
    }
    el.setAttribute('data-motion', 'on')
    const io = new IntersectionObserver(entries => {
      for (const e of entries) {
        if (!e.isIntersecting) continue
        e.target.setAttribute('data-in', '')
        io.unobserve(e.target)
      }
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0 })
    for (const t of targets) io.observe(t)
    return () => {
      io.disconnect()
      el.removeAttribute('data-motion')
    }
  }, [root])
}
