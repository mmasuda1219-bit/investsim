'use client'

import { CausalMap } from '@/components/lab/CausalMap'
import { MetricRows } from '@/components/lab/MetricRows'
import { LAB_9983, type LabData } from '@/lib/lab/9983'
import type { LearnTheme } from '@/lib/lab/critique/learn-themes'

/**
 * 画面6「学ぶ」（/study・2026-10-09・S-A）。添削の §6 をタップで開く。
 * 文章で教えるのではなく、画面2・3の部品（MetricRows・CausalMap）を実データのまま再掲する（DECISIONS 2026-10-09 却下案: 画面6を独立ページに／架空の数字でシナリオを作る）。
 * 再掲の MetricRows は解説を最初から開く（defaultOpen）。見出し（h2）は付けない（親の節の中に入るため）。
 */

export const LEARN_PANEL_NOTE = '下は画面2・3と同じ部品の再掲です（数字・出所も同じ）。'

export function LearnPanel({ theme, data = LAB_9983 }: { theme: LearnTheme; data?: LabData }) {
  const keys = theme.parts.metricKeys ?? []
  return (
    <div className="space-y-4" data-section="lab-learn" data-learn-theme={theme.key}>
      <p className="text-caption text-muted">{LEARN_PANEL_NOTE}</p>
      {keys.length > 0 && <MetricRows data={data} keys={keys} defaultOpen heading={false} />}
      {theme.parts.chain && <CausalMap data={data} heading={false} />}
    </div>
  )
}
