// ウォーレン・バフェットのルールブック（2026-09-17 S1）。データだけ。判定は evaluate.ts。
//
// 出典はすべてバークシャー・ハサウェイ公式サイトの株主への手紙と Owner's Manual で、
// researcher が一次資料で照合した（NEXT-STEPS.md「researcher 照合結果」2026-09-17）。
//  - 手紙は «対象年度» で呼ぶ。「2014年の手紙」は 2015年2月付の文書
//  - 英語原文の抜粋は入れない（著作権の確認が未了）。locator は印刷ページ・見出し・検索語だけ
//  - 本文（title・plain・belief・question・portrait・avoids.text）は三人称の言い換え。本人の言葉のような引用を作らない
//  - 数値の目安（15%・50%・FCF>0）は当サイトの近似で、原文に数値は無い（thresholdOrigin: 'approximation'）
//  - 一次資料で見つからなかった言葉は unverifiedSayings に記録だけして、画面に出さない
//
// ルールIDは記録に残るので変えない・消さない。中身を変えたら version の日付を進める。
// 2026-09-18: データルールの title を名詞に（元手で稼ぐ力／借金の重さ／手元に残る金）、指標名 metricLabel と数直線の scale を追加、
// 言葉のルールの question を短い口語に（オーナーが見本の文言を選んだ。DECISIONS.md 2026-09-18）。ID・plain・出典は不変。

import type { Rulebook, SourceRef } from './types'

const BERKSHIRE = 'https://www.berkshirehathaway.com'

const letter = (year: number, file: string, rest: Omit<SourceRef, 'title' | 'year' | 'url'>): SourceRef => ({
  title: `${year}年の株主への手紙`,
  year,
  url: `${BERKSHIRE}/letters/${file}`,
  ...rest,
})

const buffett: Rulebook = {
  investorId: 'buffett',
  version: 'buffett@2026-09-18',

  portrait: {
    weighs: '事業を理解できるか、強みが長く続くか、価格と価値の差',
    ignores: '短い期間の値動きと、相場の予想',
    horizon: '事業を長く持つ前提で、年単位で考える',
  },

  corePhilosophy: [
    '理解できる事業を、価値に見合う価格で持ち、長く保有する（公開された手紙の考え方の言い換え）',
  ],

  rules: [
    {
      id: 'buffett.B1',
      kind: 'judgment',
      phase: 'entry',
      title: '事業を理解できるか',
      plain: '何で稼ぐ会社かを自分で説明できる範囲だけを対象にする',
      belief: '評価できる範囲の大きさより、その境界を知ることが大事だと考えている',
      question: 'なにで稼ぐ会社か、2文で言えますか？',
      lookFor: ['事業内容の説明', '収益源の説明', '稼ぎ方の説明'],
      tension: ['事業の説明が無く、話題性やテーマだけ'],
      sources: [
        letter(1996, '1996.html', {
          locator: '見出し Common Stock Investments・検索語 circle of competence',
          status: '照合済み',
          note: '重心は輪の大きさより境界を知ること',
        }),
      ],
    },
    {
      id: 'buffett.B2',
      kind: 'judgment',
      phase: 'entry',
      title: '強みが長く続くか',
      plain: '競合が簡単にまねできない強みが、何年も続くかを見る',
      belief: '長く続く競争上の強みが、事業の価値を支えると考えている',
      question: 'その強み、10年後も残りますか？',
      lookFor: ['競争優位', '参入障壁', 'ブランド', '乗り換えにくさ'],
      tension: ['強みの説明が無い'],
      sources: [
        letter(2007, '2007ltr.pdf', {
          locator: '印刷p.6・見出し Businesses – The Great, the Good and the Gruesome',
          status: '照合済み',
        }),
      ],
    },
    {
      id: 'buffett.B3',
      kind: 'data',
      phase: 'entry',
      title: '元手で稼ぐ力',
      metricLabel: 'ROE',
      plain: '借金に頼らずに、自己資本に対して高い利益を出しているか',
      belief: '借金に頼らず自己資本で高く稼ぐ経営が、良い経営の物差しだと考えている',
      question: '元手に対して、しっかり稼げていますか？',
      checks: [{ metric: 'roe', op: 'gte', value: 0.15, unit: 'ratio' }],
      // 数直線の軸: 0〜40%（目安 15% が左寄り 3/8 に来る）。AAPL の 148.8% のような値は軸の外と書く
      scale: { min: 0, max: 0.4 },
      combine: 'all',
      thresholdOrigin: 'approximation',
      gapNote: '15%は当サイトの目安で、原文に具体的な数値は無い',
      sources: [
        letter(1979, '1979.html', {
          locator: '検索語 undue leverage',
          status: '照合済み',
          note: '経営成績の物差しの話',
        }),
        letter(2014, '2014ltr.pdf', {
          locator: '印刷p.23・Acquisition Criteria (3)',
          status: '照合済み',
        }),
      ],
    },
    {
      id: 'buffett.B4',
      kind: 'data',
      phase: 'entry',
      title: '借金の重さ',
      metricLabel: 'D/E',
      plain: '自己資本に比べて借金が多すぎないかを見る',
      belief: '借金を控えめにしておけば、悪い時期にも事業を続けられると考えている',
      question: '不景気でも、この借金は重荷になりませんか？',
      // 0 以上 かつ 50 以下。下限があるのは、自己資本がマイナスの会社（例: 自社株買いで資本が減った MCD）は
      // Yahoo の D/E が負の値になり、上限だけだと「目安を満たす」に見えてしまうため（reviewer W1・2026-09-17）
      checks: [
        { metric: 'debtToEquity', op: 'gte', value: 0, unit: 'yahooPct' },
        { metric: 'debtToEquity', op: 'lte', value: 50, unit: 'yahooPct' },
      ],
      // 数直線の軸: 0〜150（yahooPct ＝ 0〜1.5倍。目安 0.5倍 が左寄り 1/3 に来る）
      scale: { min: 0, max: 150 },
      combine: 'all',
      thresholdOrigin: 'approximation',
      // 綴りが3系統ある: lib/market/us-universe.ts は 'Financials'、data/universe.json（Nasdaq 由来）は 'Finance'、
      // Yahoo の assetProfile は 'Financial Services'
      excludeSectors: ['Financials', 'Finance', 'Financial Services'],
      gapNote: '原文はバークシャー自身の財務方針。50%は当サイトの目安。金融業は借入が事業の一部なので判定しない。自己資本がマイナスの会社は目安を満たさないとする。不動産（REIT）は構造的に借入が多く、目安を満たさないと出る',
      sources: [
        {
          title: 'Owner\'s Manual',
          year: 1996,
          locator: '原則7・印刷p.19',
          url: `${BERKSHIRE}/ownman.pdf`,
          status: '照合済み',
          note: '主語はバークシャー自身。初版は1996年で、のちに改訂あり',
        },
      ],
    },
    {
      id: 'buffett.B5',
      kind: 'judgment',
      phase: 'entry',
      title: '価格と価値を分ける',
      plain: 'いま払う価格と、事業の価値を別々に考える',
      belief: '価格は払うもの、価値は受け取るもので、別のものだと考えている',
      question: 'いくらの価値だと考え、いまの値段と比べましたか？',
      lookFor: ['価値の見積もり', '価格との比較'],
      tension: ['価格だけ', '価値だけ'],
      sources: [
        letter(2008, '2008ltr.pdf', {
          locator: '印刷p.5',
          status: '照合済み',
          note: 'グレアムの言葉の引用として書かれている',
        }),
        letter(1989, '1989.html', {
          locator: '見出し Mistakes of the First Twenty-five Years',
          status: '照合済み',
        }),
      ],
    },
    {
      id: 'buffett.B6',
      kind: 'judgment',
      phase: 'entry',
      title: '値動きを理由にしない',
      plain: '相場の気分や値動きの予想を、買う理由の中心にしない',
      belief: '相場の気分は利用するものであって、従うものではないと考えている',
      question: '値動きの予想が外れても、その理由は残りますか？',
      lookFor: ['事業に基づく理由'],
      tension: ['上がりそう', 'みんなが買っている', '話題になっている'],
      // 1996年の手紙には Mr. Market が無い（researcher 照合）ので出典にしない
      sources: [
        letter(1987, '1987.html', {
          locator: '見出し Marketable Securities - Permanent Holdings・検索語 Mr. Market',
          status: '照合済み',
        }),
        letter(2008, '2008ltr.pdf', {
          locator: '印刷p.4',
          status: '照合済み',
        }),
        letter(2014, '2014ltr.pdf', {
          locator: '印刷p.19',
          status: '照合済み',
        }),
      ],
    },
    {
      id: 'buffett.B7',
      kind: 'data',
      phase: 'entry',
      title: '手元に残る金',
      metricLabel: 'FCF',
      plain: '事業を保つ設備投資を引いても、株主に利益が残るか',
      belief: '事業を保つための設備投資を引いた後に残る利益が、株主の本当の取り分だと考えている',
      question: '設備投資を払った後、株主に残るお金はありますか？',
      checks: [{ metric: 'freeCashflow', op: 'gt', value: 0, unit: 'amount' }],
      combine: 'all',
      thresholdOrigin: 'approximation',
      gapNote: '本来のオーナー利益は維持に必要な設備投資だけを引く。当サイトは全ての設備投資を引いたフリーキャッシュフローで近似する',
      sources: [
        letter(1986, '1986.html', {
          locator: '付録 Purchase-Price Accounting Adjustments and the Cash Flow Fallacy・検索語 owner earnings',
          status: '照合済み',
        }),
      ],
    },
    {
      id: 'buffett.B8',
      kind: 'judgment',
      phase: 'exit',
      title: '先送りしない',
      plain: '見立てを崩す事実が出たら、考え直すのを遅らせない',
      belief: '見立てが崩れたと分かった時に手を打つのを遅らせたことを、自らの誤りとして振り返っている',
      question: '降りるのは株価が動いた時ですか、事業が変わった時ですか？',
      lookFor: ['事業の変化に基づく降りる条件'],
      tension: ['株価の下落率だけ'],
      sources: [
        letter(2014, '2014ltr.pdf', {
          locator: '印刷p.17-18・見出し Investments',
          status: '照合済み',
        }),
        letter(2008, '2008ltr.pdf', {
          locator: '印刷p.5',
          status: '照合済み',
        }),
      ],
    },
  ],

  avoids: [
    {
      text: '借金で株を買うこと',
      sources: [
        letter(2017, '2017ltr.pdf', {
          locator: '印刷p.10',
          status: '照合済み',
        }),
      ],
    },
    {
      text: '短期の相場予想',
      sources: [
        letter(1992, '1992.html', {
          locator: '検索語 fortune tellers',
          status: '照合済み',
          note: '直前の見出しは未確認',
        }),
      ],
    },
  ],

  // 一次資料（バークシャーの手紙・Owner's Manual）で見つからず載せない言葉。記録用で画面に出さない
  unverifiedSayings: [
    'ルール1: 損をするな。ルール2: ルール1を忘れるな',
    '分散は無知に対する防御だ',
  ],
}

export default buffett
