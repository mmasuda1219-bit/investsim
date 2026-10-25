import { LAB_9983 } from './9983'

/**
 * 1社固定の断り（/study の h1 の直下とホームの「学ぶ」の節で、見出しの直下に無条件で出す）。
 * 2026-10-25 に app/study/client.tsx から一字も変えずに移した。ホームが client.tsx（/study の画面本体）を import すると
 * /study の部品がまるごとホームの JS に入る（+32KB）ため、定数だけをここに置く。
 */
/** 1社固定の断り。h1 の直下に無条件で出す（文言はオーナー決定 2026-10-19。社名と証券コードは data から） */
export const FIXED_COMPANY_NOTE = `練習用に1社（${LAB_9983.company.name}・${LAB_9983.company.code}）を固定しています。この会社を勧めるものではありません。他の銘柄を選ぶ機能はまだありません。`
