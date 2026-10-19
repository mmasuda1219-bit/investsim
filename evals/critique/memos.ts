/**
 * フェーズA（2026-10-18）: 添削の AI を測るための判断メモ。**純データ。**
 *
 *  - `collected-undecided`・`decided-uncollected` は**オーナーの実物**（2026-10-18 受領・scratchpad/phaseA-memos-real.md が正）。
 *    **原文を一字一句そのまま**置く。要約・整形・誤字の修正をしない（「ESP」の綴り違いもそのまま。それ自体が測定の対象）
 *  - `clean` は誤りを仕込まない1件（builder が lib/lab/9983.ts の実数値で書いた）。「何も無いときに何も出さないか」を測る。実物とは別に要る
 *  - `expect` ＝ AI が見つけるべきもの（判定 AI が「同じことを指しているか」で○×）。`plantedText` は本文に逐語で含まれる文（検査が確かめる）
 *  - `expectNot` ＝ 出したら減点するもの（採点基準 G。判定 AI に読ませる）
 *  - `catalogueId` は記録だけ（採点に使わない）。「新 fact-mismatch」などは lib/lab/critique/catalogue.ts に**まだ無い** id（このスライスでは catalogue.ts を触らない）
 *  - 銘柄はどちらもファーストリテイリング（9983）。与える数字は evals/critique/figures.ts が lib/lab/9983.ts から組む
 */

export interface ExpectedFinding {
  id: string
  kind: 'calc' | 'missing'
  /** 判定 AI に渡す「何を指すか」（公表値との対比を含む） */
  description: string
  /** 本文に逐語で含まれる文（AI の quote がここに当たるかの目安。採点は description で行う） */
  plantedText: string
  /** 当たるはずのカタログ id（記録だけ。無ければ null、まだ無い id は '新 …'） */
  catalogueId: string | null
  /** 公表値との食い違い（MC が最重要と置いた3件に印） */
  factMismatch?: true
}

export interface ExpectNot {
  id: string
  /** 判定 AI に渡す「こう書いたら減点」の説明 */
  description: string
}

export interface EvalMemo {
  id: string
  /** 人が読むための1行 */
  title: string
  /** 出どころ */
  source: 'owner-real' | 'builder-clean'
  /** 原文（一字一句そのまま） */
  text: string
  expect: ExpectedFinding[]
  expectNot: ExpectNot[]
}

const MEMO_1 = `【銘柄】ファーストリテイリング
【判断の流れ】
- まず日経平均を見て、相場全体の調子を確認した。
- 次に業種別の値上がりランキングを見た。資源、ゴム、海運などが上がっていた。
- その後、ファーストリテイリングを見た。
- 決算がいつなのか分からず、どのタイミングで見るべきか判断できなかった。
- PERの意味が分からなかった。
- 株価は何とも言えない状況。
- 営業利益と純利益のどちらを見るべきか、またそれを株価とどう結びつけるかが分からなかった。
- ESPが下がっている。これを他の指標とどう関連づけて解釈するかが分からない。
- セグメントを見ると海外の人気が高そう。
- キャッシュフローが増えていて、手元資金も確保されているので安心材料だと思う。
- 今日の発表で配当予想が上方修正された。
- ROAは11.92%、ROEは21%。差が約10%あるので負債が大きいと判断した。ただ、10%が大きいのか小さいのかは分からない。
【結論】（未記入）`

const MEMO_2 = `【銘柄】ファーストリテイリング
【判断の流れ】
- 最近ずっと株価が上がっているので、勢いがあると思った。
- PERは40倍くらい。数字が大きいので人気がある証拠だと思う。
- 売上高は前期比で10%増えていた。
- 営業利益も増えていたので、業績は問題ない。
- 有名な会社なので潰れることはないと思う。
【結論】買う。株価がまだ上がり続けそうだから。`

/** 誤りを仕込まないメモ（builder 作・lib/lab/9983.ts の実数値だけ・実物と同じ書き方） */
const MEMO_CLEAN = `【銘柄】ファーストリテイリング
【判断の流れ】
- 2026年8月期の決算は 2026-10-08 に発表された。次回は未定（例年1月上旬）なので、次の発表の前にこのメモを読み返す。
- 売上収益は 3兆9,634億円で前期比 +16.6%。営業利益は 7,431億円（+31.7%）、純利益は 5,425億円（+25.3%）。営業利益と純利益は別の数字なので分けて書いた。
- EPS は 1,768.08円で、純利益と同じ +25.3%。株数はほぼ変わっていないと読める。
- ROE は 2026年8月期で 21.2%（前の期 20.2% から +1.0ポイント）。ROA は 2025年8月期の 11.6% までしか会社が開示していないので、同じ期では比べていない。
- 自己資本比率は 58.9% から 62.6% で +3.7ポイント。
- 営業CF は 7,886億円で、純利益 5,425億円より大きい。手元資金は 1兆76億円で、前の期の 8,932億円から増えた。
- 年間配当は 850円（前の期 500円）。10月8日に予想が 640円 から 850円 に修正された。来期予想は 900円。配当性向は 35.4% から 48.1%、配当利回り（予想）は 1.25%。
- 予想PER は 39.3倍で、プライム市場・小売業の加重平均 27.7倍（単純平均は 22.5倍）より大きい。市場全体の加重平均は 20.6倍。実績PER は 40.6倍、PBR は 7.73倍。来期の会社予想は売上収益 +12.3%、純利益 +3.2% なので、PER は利益の伸びと合わせて見る。
- セグメントは海外ユニクロが +26.2%（構成比 約61%）、国内ユニクロ +5.7%、ジーユー +1.8%、グローバルブランド −2.3%。
- 決算発表の翌日 2026-10-09 の終値は 71,780円で、前日比 −4.04%。
【結論】保留。利益は増えているが、来期予想の純利益の伸びが +3.2% と今期の +25.3% より小さい理由を決算短信でまだ確かめていないので、次の四半期決算を見てから決める。`

export const EVAL_MEMOS: readonly EvalMemo[] = [
  {
    id: 'collected-undecided',
    title: '集めたが、決められない（オーナーの実物）',
    source: 'owner-real',
    text: MEMO_1,
    expect: [
      {
        id: 'roe-roa-diff',
        kind: 'calc',
        description: '「差が約10%あるので負債が大きい」— ROE と ROA は分母が違う（期中平均の自己資本／期中平均の総資産）。差の数字そのもので負債の大きさを読むのではなく、何を分母にしたかで読む。かつ比率どうしの差は「%」でなく「ポイント」で書く',
        plantedText: '差が約10%あるので負債が大きいと判断した',
        catalogueId: 'roe-roa-mix',
      },
      {
        id: 'roa-mismatch',
        kind: 'calc',
        description: '「ROAは11.92%」— 会社の開示値と違う。2025年8月期の ROA は 11.6%、2026年8月期は会社が開示していない（メモの数字の出どころが会社の開示値ではない）',
        plantedText: 'ROAは11.92%',
        catalogueId: 'roa-unpublished（＋新 fact-mismatch）',
        factMismatch: true,
      },
      {
        id: 'eps-mismatch',
        kind: 'calc',
        description: '「ESPが下がっている」— （綴りは EPS）事実と逆。2026年8月期の EPS は 1,411.44円 → 1,768.08円（+25.3%）で増えている',
        plantedText: 'ESPが下がっている',
        catalogueId: '新 fact-mismatch',
        factMismatch: true,
      },
      {
        id: 'no-conclusion',
        kind: 'missing',
        description: '結論が未記入である、という事実の指摘（「結論を出すべきだ」とは書かない）',
        plantedText: '【結論】（未記入）',
        catalogueId: 'conclusion-empty',
      },
      {
        id: 'cf-profit-unchecked',
        kind: 'missing',
        description: '「キャッシュフローが増えていて…安心材料だと思う」— 営業CF と純利益の整合（営業CF 7,886億円・純利益 5,425億円）を見ていない',
        plantedText: 'キャッシュフローが増えていて、手元資金も確保されているので安心材料だと思う',
        catalogueId: '新 cf-profit-unchecked',
      },
      {
        id: 'segment-impression',
        kind: 'missing',
        description: '「セグメントを見ると海外の人気が高そう」— 数字で書いていない（海外ユニクロ 売上 +26.2%・構成比 約61%）',
        plantedText: 'セグメントを見ると海外の人気が高そう',
        catalogueId: '新 segment-impression',
      },
    ],
    expectNot: [
      {
        id: 'self-aware-gaps',
        description: '「決算がいつなのか分からず」「PERの意味が分からなかった」「10%が大きいのか小さいのかは分からない」を誤り・確認漏れとして指摘すること。これは本人が自覚している穴で、サイトの画面が埋めるもの。「調べるべきだった」「確かめるべきだった」と書いたら減点（数字や定義を事実として添えるだけなら減点しない）',
      },
      {
        id: 'procedure-denied',
        description: '「日経平均を見て」「業種別の値上がりランキングを見た」という手順そのものを否定すること',
      },
    ],
  },
  {
    id: 'decided-uncollected',
    title: '決めたが、集めていない（オーナーの実物）',
    source: 'owner-real',
    text: MEMO_2,
    expect: [
      {
        id: 'sales-mismatch',
        kind: 'calc',
        description: '「売上高は前期比で10%増えていた」— 公表値は +16.6%（3兆4,005億円 → 3兆9,634億円）',
        plantedText: '売上高は前期比で10%増えていた',
        catalogueId: '新 fact-mismatch',
        factMismatch: true,
      },
      {
        id: 'per-one-reading',
        kind: 'calc',
        description: '「PERは40倍くらい。数字が大きいので人気がある証拠だと思う」— PER が大きいことは「市場の期待が大きい」とも「利益に対して株価が先行している」とも読めるのに1通りだけで決めている。かつ、何（加重平均か単純平均か）と比べて大きいのかが書かれていない',
        plantedText: 'PERは40倍くらい。数字が大きいので人気がある証拠だと思う',
        catalogueId: 'per-only（＋per-average-kind）',
      },
      {
        id: 'forecast-as-reason',
        kind: 'calc',
        description: '「結論：買う。株価がまだ上がり続けそうだから」— 結論の理由が将来の株価の予想になっている。予想は後から確かめられないので根拠にならない（予想の当否には触れない）',
        plantedText: '買う。株価がまだ上がり続けそうだから',
        catalogueId: '新 forecast-as-reason',
      },
      {
        id: 'momentum-as-reason',
        kind: 'calc',
        description: '「最近ずっと株価が上がっているので、勢いがあると思った」— 値動きそのものを根拠にしている（上がっている理由が「上がっているから」になる）',
        plantedText: '最近ずっと株価が上がっているので、勢いがあると思った',
        catalogueId: '新 momentum-as-reason',
      },
      {
        id: 'fame-as-safety',
        kind: 'calc',
        description: '「有名な会社なので潰れることはないと思う」— 知名度と、返済能力を示す数字（自己資本比率 62.6%・手元資金 1兆76億円）は別のもの',
        plantedText: '有名な会社なので潰れることはないと思う',
        catalogueId: '新 fame-as-safety',
      },
      {
        id: 'net-eps-untouched',
        kind: 'missing',
        description: '「営業利益も増えていたので、業績は問題ない」— 純利益・EPS に触れていない（営業利益 +31.7%／純利益 +25.3%／EPS +25.3% で伸び率が違う）',
        plantedText: '営業利益も増えていたので、業績は問題ない',
        catalogueId: 'op-net-mix（＋missing）',
      },
    ],
    expectNot: [
      { id: 'judge-the-decision', description: '「買うべきでない」「この判断は間違っている」と書くこと' },
      { id: 'judge-the-stock', description: '「株価は上がらない」「割高だ」など、銘柄の良し悪し・将来の株価を書くこと' },
    ],
  },
  {
    id: 'clean',
    title: '誤りを仕込まない1件（builder 作）',
    source: 'builder-clean',
    text: MEMO_CLEAN,
    expect: [],
    expectNot: [
      { id: 'invented-issue', description: '原文に無い誤りを作って指摘すること（原文と公表値は一致している）' },
    ],
  },
]

export function memoById(id: string): EvalMemo {
  const m = EVAL_MEMOS.find(x => x.id === id)
  if (!m) throw new Error(`evals/memos: 未定義の id ${id}`)
  return m
}
