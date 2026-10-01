'use client'

import { isRenderableSourceUrl } from '@/lib/review/primary-sources/allowlist'
import type { PrimarySourceResult } from '@/lib/review/primary-sources/types'

/**
 * 「あなたが書いていないことの、出どころ」（/review/[recordId]・S3c・2026-10-01・DECISIONS 2026-09-30 3本目の追記）。
 * 買った日の前後 30 日に発行会社が公式に出した書類（米: SEC EDGAR／日: 金融庁 EDINET）を、見出し・日付・URL で並べる。
 *
 * 守っていること:
 *  - 要約しない・選ばない・評価しない。見出しは取得元の表記のまま（切らない）
 *  - 並びと中身は取得側（lib/review/primary-sources/index.ts の finalizeSources）で確定。ここでは並べ替え・絞り込み・切り詰めをしない
 *  - href に入れるのは isRenderableSourceUrl を通った URL（表示用ホスト完全一致）だけ。通らない件は描かない
 *  - リンクは rel="nofollow noopener" target="_blank"。末尾に取得日と「リンク先は当社と関係がありません。」
 *  - status が ok でなければ **節ごと描かない**（見出しも出さない）。日本株は該当 0 件の期間が多い
 *  - `--danger` を使わない。格子にしない（border-t の一列）
 * 検査: scripts/check-primary-sources.ts。
 */

export const SECTION_TITLE = 'あなたが書いていないことの、出どころ'
export const SECTION_LEAD = '買った日の前後30日に、発行会社が公式に出した書類の一覧です。中身の要約はしていません。'
export const NOT_AFFILIATED = 'リンク先は当社と関係がありません。'

/** ISO 8601 → YYYY-MM-DD（読めなければそのまま） */
function isoDate(iso: string): string {
  const day = iso.split('T')[0]
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : iso
}

export function PrimarySources({ result }: { result: PrimarySourceResult | null }) {
  if (!result || result.status !== 'ok') return null
  const browseAll = result.browseAllUrl && isRenderableSourceUrl(result.browseAllUrl) ? result.browseAllUrl : null
  return (
    <section className="space-y-2" data-section="primary-sources">
      <h2 className="text-small text-muted">{SECTION_TITLE}</h2>
      <div className="bg-card rounded-card border border-border px-4 py-3 space-y-3">
        <p className="text-small text-ink-2 max-w-[42rem]">{SECTION_LEAD}</p>
        <ul>
          {result.items.map(it =>
            isRenderableSourceUrl(it.url) ? (
              <li key={`${it.source}:${it.uid}`} className="border-t border-border first:border-t-0 py-3 space-y-0.5 min-w-0">
                <p className="text-caption text-muted tabular-nums">
                  {it.publishedAt}
                  <span aria-hidden>・</span>{it.publisher}
                  <span aria-hidden>・</span>{it.docType}
                </p>
                <p className="text-body text-ink break-words">
                  <a href={it.url} rel="nofollow noopener" target="_blank" className="text-brand hover:underline">{it.title}</a>
                </p>
                {it.filerName !== '' && <p className="text-caption text-muted break-words">{it.filerName}</p>}
              </li>
            ) : null,
          )}
        </ul>
        <p className="text-caption text-muted tabular-nums">
          取得 {isoDate(result.fetchedAt)}<span aria-hidden>・</span>{NOT_AFFILIATED}
        </p>
        {result.truncated > 0 && (
          <p className="text-caption text-muted">
            {`この期間には他に${result.truncated}件あります。`}
            {browseAll && (
              <>
                {' '}
                <a href={browseAll} rel="nofollow noopener" target="_blank" className="text-brand hover:underline">発行元のページで全件を見る</a>
              </>
            )}
          </p>
        )}
      </div>
    </section>
  )
}
