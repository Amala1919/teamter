# AI編集プロトコル

AIがプロジェクトを編集するための仕組みを定義する。ここで定義するコマンドは**UIの手動編集が使うものと同一**であり、AI専用の経路は作らない。

AIには2つの役割がある。

1. **共演者**: 相方(`authorRole: "ai"` のキャラクター)としてセリフを書く(2章)
2. **編集アシスタント**: チャット指示に従ってタイムラインを編集する(3章以降)

どちらも最終的には同じコマンド列に帰着する。相方のセリフ生成は `voice.insert` の発行であり、専用の保存形式を持たない。生成されたセリフが人間の書いたセリフと同じ構造になることで、以降の編集で両者を区別する必要がなくなる。

## 1. なぜコマンドを介するのか

LLMにプロジェクトJSON全体を書き換えさせる方式は、次の理由で採らない。

- 数千アイテムのプロジェクトは出力トークンに収まらない
- 全体を書き換えると、AIが触るつもりのなかった箇所が壊れても検知できない
- 差分を提示できないため、ユーザーが適用前に確認できない
- undoの単位が「プロジェクト全体の置き換え」になり、粒度が粗すぎる

そこで**AIには「小さな操作の列」を出力させる**。各操作はスキーマで検証でき、適用前に人間が読める差分として提示でき、失敗すれば個別に拒否できる。

## 2. 相方としての返答生成

投稿者が自分の役(ずんだもん)のセリフを書き、AIが相方の返答を書く。これを往復して台本を作る。

### 2.1 流れ

```
投稿者が自分のセリフを書く(voice.insert / voice.setText)
   ↓ 「返答を生成」
相方のペルソナ + 直前までの会話 + 動画の題材 → LLM
   ↓
相方のセリフ(1件または複数候補)
   ↓ 投稿者が採用・再生成・修正
voice.insert として台本に追加
```

生成された返答をそのまま確定させず、採用の一手を挟むのは、掛け合いの面白さが投稿者の判断に依存するからである。AIの返答をそのまま並べるだけでは、投稿者の作品ではなくなる。

### 2.2 返答生成に渡すもの

| 内容 | 理由 |
| --- | --- |
| 相方のペルソナ(性格・口調・立ち位置・NG表現・目安の長さ) | キャラクターを保つため |
| 直前までの会話(発話順の話者とセリフ) | 話題の流れを追うため |
| 動画全体の題材・企画メモ | 脱線しすぎないため |
| 直近の映像アイテムの情報(あれば) | 画面で何が起きているかに触れられるようにするため |

会話が長くなった場合は、古い部分を要約して渡す。ただし**直近の数往復は必ず原文で渡す**。掛け合いのテンポと口調は直前の流れに強く依存するため、そこを要約すると返答が急に不自然になる。

### 2.3 守らせること

- 生成するのは相方のセリフのみとする。投稿者の役のセリフは、明示的な指示がない限り書き換えない
- 依頼の `targetLengthChars`(返答を作るたびに決める。無ければペルソナの `targetLengthChars`)を目安の長さとして守る
- ペルソナの `forbidden` に挙げられた表現を使わない
- 相方が自分のペルソナを書き換えること(`character.setPersona`)は許さない。ペルソナの変更はUIからのみ行う

### 2.4 表情の同時割り当て

返答を生成するとき、そのセリフに合う表情プリセットも同時に選ばせる。セリフと表情は本来一体で決まるものであり、あとから別の処理で割り当てると噛み合わなくなる。生成結果は `voice.insert` の `expressionId` として反映する。

## 3. 処理の流れ

```
ユーザーのチャット入力
   ↓
コンテキスト構築(プロジェクトの要約 + 台本 + 選択範囲 + 利用可能なID一覧)
   ↓
LLM(tool use) → コマンド列
   ↓
スキーマ検証 + 事前実行(ドライラン)
   ↓
差分をUIに提示 ── ユーザーが却下 → 破棄
   ↓ 承認
1トランザクションとして適用(undoは1回で全部戻る)
```

## 4. AIに渡すコンテキスト

プロジェクト全体は渡さない。トークンを浪費するうえ、AIが不要な情報に引きずられる。渡すのは以下に限る。

| 内容 | 形式 |
| --- | --- |
| キャンバス設定 | 解像度・fps・総尺 |
| キャラクター一覧 | ID、名前、利用可能な表情プリセットのIDと名前 |
| 台本 | ボイスアイテムのID・話者・開始時刻・尺・テキストの表(発話順) |
| 素材一覧 | ID、種類、尺、ファイル名 |
| 非ボイスアイテムの概要 | ID、種類、レイヤー、区間 |
| 選択範囲 | 現在選択中のアイテムIDと時間範囲 |
| 直近のチャット履歴 | 直近N往復 |

台本が長すぎてトークン上限を超える場合は、選択範囲の周辺を優先して渡し、範囲外は要約する。AIが範囲外を編集する必要を認識したときは、必要な範囲を取得するための読み取りコマンド(`query.script`)を呼べるようにする。

素材ファイルの中身(映像・音声・画像そのもの)は送信しない。

## 5. コマンド定義

すべてのコマンドは `{ "op": "<名前>", ...引数 }` の形をとる。IDを新規に作るコマンドは、AIが指定した一時IDを結果IDに解決して後続のコマンドから参照できるようにする。

### 5.1 台本・ボイス

| op | 引数 | 意味 |
| --- | --- | --- |
| `voice.insert` | `characterId`, `text`, `afterItemId` または `atMs`, `expressionId?`, `tempId?` | セリフを挿入する。以降のアイテムは自動で後ろにずれる |
| `voice.setText` | `itemId`, `text` | セリフを書き換える。音声は再合成され尺が変わる |
| `voice.delete` | `itemId` | セリフを削除し、以降を前に詰める |
| `voice.move` | `itemId`, `afterItemId` または `atMs` | 発話順を変える |
| `voice.setCharacter` | `itemId`, `characterId` | 話者を変える |
| `voice.setExpression` | `itemId`, `expressionId` | 表情を変える |
| `voice.setVoiceParams` | `itemId`, `speedScale?`, `pitchScale?`, `intonationScale?`, `volumeScale?` | 発話パラメータを上書きする |
| `voice.setSubtitleOverride` | `itemId`, `color?`, `sizeScale?`, `styleId?` | 字幕の見た目を個別に上書きする |
| `voice.setSubtitleHidden` | `itemIds`, `hidden` | セリフの字幕を出す・出さない(声はそのまま。SRT にも入れない) |
| `voice.setDisplayText` | `itemId`, `text`(`null` で戻す) | 字幕に出す文字だけを、読み上げるセリフと別にする(声は変わらない) |
| `voice.setGapAfter` | `itemId`, `gapMs` | 次のセリフまでの間を指定する |
| `script.adoptLiveEntry` | `sessionId`, `entryId`, `atMs?` | ライブセッションの発言を台本に採用する。発言者に応じた役のボイスアイテムになる |

### 5.2 素材の配置

| op | 引数 | 意味 |
| --- | --- | --- |
| `media.placeVideo` | `assetId`, `atMs`, `layerId?`, `inMs?`, `outMs?`, `transform?`, `volume?`, `tempId?` | 動画の区間を配置する。区間を省略すると素材の全体。既定のレイヤーは背景 |
| `media.placeImage` | `assetId`, `atMs`, `durationMs`, `layerId?`, `transform?`, `tempId?` | 画像を配置する |
| `media.placeAudio` | `assetId`, `atMs`, `layerId?`, `inMs?`, `outMs?`, `durationMs?`, `volume?`, `loop?`, `duckable?`, `tempId?` | BGM・SEを配置する。ループするなら素材より長くできる。既定のレイヤーは BGM |
| `media.placeText` | `text`, `atMs`, `durationMs`, `layerId?`, `styleId?`, `transform?`, `tempId?` | 独立したテロップを置く |
| `media.placeShape` | `shape`, `fill`, `atMs`, `durationMs`, `layerId?`, `transform?`, `props?`, `effects?`, `tempId?` | 図形・装飾を置く(手書きの丸・矢印・吹き出し・集中線・スポットライト・紙吹雪など)。`props` の `width`・`height` を省くと画面全体の大きさ |

変形(`transform`)の `x`, `y` はアイテムの中心の位置(キャンバス座標)。等倍(`scale: 1`)の大きさは、動画は画面に収まる最大の大きさ、画像は素材の画素数、図形は画面全体。

### 5.3 共通のアイテム操作

| op | 引数 | 意味 |
| --- | --- | --- |
| `item.setTimeRange` | `itemId`, `startMs?`, `durationMs?` | 区間を変える(ボイスアイテムの尺には使えない) |
| `item.trim` | `itemId`, `startMs?`, `endMs?` | 端を動かす。動画・音声は素材の切り出し位置も一緒に動く |
| `item.setLayer` | `itemId`, `layerId` | レイヤーを移す |
| `item.setTransform` | `itemId`, `x?`, `y?`, `scale?`, `rotation?`, `opacity?` | 変形を設定する |
| `item.setAudio` | `itemId`, `volume?`, `loop?`, `fadeInMs?`, `fadeOutMs?`, `duckable?` | 音量などを設定する(動画は音量のみ) |
| `item.setContent` | `itemId`, `text?`, `styleId?`, `fill?`, `shape?` | テロップの文字・図形の色や形を変える |
| `item.setTextLook` | `itemIds`, `look`, `replace?` | テロップだけの見た目(色・フォント・太さ・大きさ・揃え・行間・縁取り・影・背景の帯・文字送り)。項目を `null` にするとスタイルに戻す。`replace` なら今の見た目を捨てて `look` だけにする |
| `item.addEffect` | `itemId`, `effect` | エフェクトを追加する |
| `item.updateEffect` | `itemId`, `effectIndex`, `effect` | エフェクトを置き換える |
| `item.removeEffect` | `itemId`, `effectIndex` | エフェクトを外す |
| `item.delete` | `itemId` | 削除する |
| `item.split` | `itemId`, `atMs`, `tempId?` | その時刻で2つに分ける(セリフ・ズームは不可)。後半が新しいアイテムになる |
| `item.setSpeed` | `itemId`, `rate` | 動画の再生速度(0.25〜16倍)。画面上の長さが変わる |
| `item.setShape` | `itemIds`, `shape?`, `fill?`, `props?`, `replace?` | 図形の形・色・見た目(縁取り・影・描いていく時間など)をまとめて変える。項目を `null` にすると形ごとの既定に戻す |
| `item.setMediaLook` | `itemIds`, `crop?`, `frame?`, `adjust?` | 動画・画像の切り抜き・枠(小窓の見た目)・色の調整。`null` で外す |
| `item.setVolumeKeys` | `itemId`, `keys`(`null` で一定) | 音量の時間変化(アイテム内の時刻と倍率の点) |
| `timeline.crossTransition` | `itemId`, `kind`, `durationMs` | 前の素材から重ねて切り替える(クロスフェード・ワイプなど)。重ねる続きが無ければ、前をフェードで消してから出す |
| `video.condense` | `itemId`, `ranges`, `mode`(`cut`/`speed`), `rate?`, `ripple?`, `label?` | 動画の中の区間(待ち時間など)をまとめて切り取る・早送りにする。後ろは詰める |
| `marker.add` / `marker.update` / `marker.remove` | `atMs`, `text?`, `color?` / `markerId`, … | 編集中の目印(メモ) |
| `item.freezeFrame` | `itemId`, `atMs`, `durationMs`, `mode`(`insert`/`overwrite`), `tempId?` | その時刻のコマで動画を止め、静止画として表示する。`insert` は後ろをずらし(かかっているズームは寄ったまま伸ばす)、`overwrite` は動画のその先を静止画で置き換える |
| `project.setMix` | `master?`, `voice?`, `music?`, `video?`(倍率 0〜2。`null` で 100%) | 全体の音量と、セリフ・BGM/効果音・動画の音の大きさ |
| `timeline.rippleDelete` | `itemIds`, `ignoreOthers?` | 削除して、空いた時間を詰める(`ignoreOthers` なら、ほかの素材は考慮せず消した長さだけ詰める) |
| `timeline.packLeft` | `itemIds`, `keepGaps?` | 選んだものを左(前)へ詰める。ほかのものは動かさない。`keepGaps` なら選んだもの同士の間を保つ |
| `timeline.closeGap` | `atMs` | その位置の何も無い時間を詰める |
| `timeline.insertGap` | `atMs`, `durationMs` | その位置から後ろをずらして空白を作る |
| `portrait.insert` | `characterId`, `atMs`, `durationMs`, `kind?`(`show`/`hide`/`adjust`), `transform?`, `expressionId?`, `transition?`(`none`/`fade`/`pop`), `tempId?` | 場面ごとの立ち絵を置く(出す・隠す・位置や表情を変える) |
| `portrait.update` | `itemId`, `kind?`, `transform?`, `expressionId?` | 場面ごとの立ち絵を直す(`null` は全体の設定・セリフの表情に従う) |
| `zoom.insert` | `atMs`, `durationMs`, `region`(`x`,`y`,`width`), `method?`, `inMs?`, `outMs?`, `wholeScreen?`, `layerId?`, `tempId?` | ズーム枠を置く。`wholeScreen` が真なら立ち絵・字幕も含めて拡大する |
| `zoom.update` | `itemId`, `region?`, `method?`, `inMs?`, `outMs?` | ズーム枠の範囲・寄り方を変える |

### 5.4 設定

| op | 引数 | 意味 |
| --- | --- | --- |
| `character.setDefaults` | `characterId`, `voice?`, `transform?`, `defaultExpressionId?` | キャラクターの既定値を変える |
| `style.upsertSubtitle` | `styleId`, `props` | 字幕スタイルを作る・更新する |
| `layer.insert` | `name`, `index`, `tempId?` | レイヤーを追加する |
| `project.setMeta` | `title?` | メタ情報を変える |

### 5.5 読み取り(適用ではなく取得)

| op | 引数 | 戻り |
| --- | --- | --- |
| `query.script` | `fromItemId?`, `count?` | 指定範囲の台本を返す |
| `query.items` | `layerId?`, `fromMs?`, `toMs?`, `type?` | 条件に合うアイテムの一覧を返す |
| `query.assets` | `type?` | 素材一覧を返す |
| `query.liveSession` | `sessionId`, `fromMs?`, `toMs?` | 録画中の会話の記録を返す。台本を書くときの素材になる |

読み取りコマンドはプロジェクトを変更しないため、ユーザーの承認なしに実行してよい。

## 6. 制約

AIに許さないことを明示する。実装上もこれらのコマンドを公開しない。

- 素材ファイルの削除・移動・書き換え
- プロジェクトの保存・書き出しの実行(提案はできるが、実行はユーザーが行う)
- 外部への送信を伴う操作
- `formatVersion` の変更
- クレジットの `confirmedByUser` を true にすること(L-5)

また、1回の提案で生成できるコマンド数に上限を設ける(既定200)。上限を超える大規模な変更は、AIに分割して提案させる。

## 7. 差分の提示

コマンド列はそのままではユーザーに読めないため、適用前に人間向けの差分へ変換して提示する。

```
台本を7件変更します

  #12 ずんだもん
    - 今日はこのゲームをやっていこうと思うのだ。よろしくお願いするのだ。
    + 今日はこのゲームをやるのだ！

  #13 四国めたん
    - そうね、それでは始めましょうか。
    + 始めましょうか。

  ... 他5件

  尺: 4分52秒 → 4分18秒 (-34秒)
```

尺の変化を必ず表示する。台本の変更はほぼ常に全体の尺を変えるため、これがユーザーにとって最も重要な影響である。

## 8. 自動下書き

企画メモとゲーム録画から一括生成する機能(A-5)も、最終的には同じコマンド列に帰着させる。生成の流れは次のとおり。

```
1. 録画の解析(音声の無音区間、シーン切替、ゲーム音の盛り上がり)
   → 素材の中で使えそうな区間の候補リスト
2. ライブセッションの記録(録画中にAIと話した内容と、打った目印)
   → どこで何が起きたか、何を話したかが時刻付きで既に分かっている
3. 企画メモ + 候補リスト + セッションの記録 → LLM
   → 台本(誰が何を話すか) + どの候補区間をどこに当てるか
4. コマンド列に変換(voice.insert × N、media.placeVideo × N、voice.setExpression × N)
5. ドライラン → 差分提示 → 適用
```

ライブセッションの記録があると、この下書きの質が大きく変わる。音量やシーン切替からの推測に頼らず、**プレイ中に実際に交わした会話と打った目印**を素材にできるためである。録画中の「いまのは奇跡」という一言が、そのまま使う場面の指示になる。

ここで生成されるのは完成品ではなく下書きである。ユーザーが必ずプレビューして修正する前提とし、そのための差分提示とundoを先に用意しておく(だからこの機能はPhase 5であり、Phase 4のチャット編集より後になる)。

## 9. モデルの選択

AIは役割ごとに選ぶ(REQUIREMENTS.md 3.9)。

| 役割 | 使う場面 | 選び方 |
| --- | --- | --- |
| 会話AI | 相方の返答生成(2章)、ライブモードの会話 | プロジェクトごとに設定できる。未設定ならアプリの既定値 |
| 編集AI | 編集チャット(3章以降)、推敲、自動下書き、投稿文の生成 | アプリ設定で固定 |

会話AIとライブモードで同じAIを使うのは、録画中に話した相手と動画内の相方が同一人物であるべきだからである。ペルソナが同じでもモデルが違えば話し方は変わる。

生成結果には必ず生成元(プロバイダとモデル)を添え、ボイスアイテムとライブの発言に `generatedBy` として記録する。相方の中の人を回ごとに変える企画では、これが「誰が喋ったか」の唯一の記録になる。

AIの呼び出しはローカルのCLI(Claude Code / OpenCode)を経由し、アプリはAPIキーを持たない。CLIが使えない状態でもアプリは完全に動作し、AIを使う機能だけが無効になる(A-9)。接続方式の詳細は ARCHITECTURE.md の 2.8 を参照。

## 立ち絵のまとめ調整

チャットの「立ち絵をAIで調整」は、台本(話者・時刻・セリフ・今の表情)・場面(録画とズームの区間)・各キャラクターの表情の一覧と今の配置・今ある場面ごとの立ち絵を編集AIに渡し、立ち絵に関わるコマンドだけを出させる(`src/shared/ai/portraits.ts`)。出してよいのは `voice.setExpression`・`portrait.insert`・`portrait.update`・`project.setEditing`(`portraitDim`・`portraitHop` のみ)と、場面ごとの立ち絵に対する `item.setTimeRange`・`item.delete`。立ち絵以外のアイテムを対象にしたものは取り除き、除いた数を返事に書き添える。提案は編集チャットと同じく差分を確かめてから1回で適用する。

## 画面を見せる(相方の返答)

相方の返答を作るとき、`vision` を付けるとゲーム画面を画像として添える(`src/shared/ai/cohost.ts`、`src/main/services/media/frame-grabber.ts`)。
- `frame`: その時刻の1コマ。`clip`: 区間を両端を含めて等間隔に分けたコマ(2秒ごとに1枚増え、最大8枚・最長60秒)。
- コマは、その時刻に映っている一番前面の録画から ffmpeg で取り出した JPEG(横768px まで)。立ち絵・字幕は重ねない。映像の無い時刻は飛ばす。
- 各画像の前に「動画の 0:12.000 の画面」という説明を置き、依頼文の最後に画像の説明を足す。
- 送り方: Claude(Claude Code)は `--input-format stream-json` で画像ブロックとして、OpenCode の API は形式ごとの画像の書き方(`image_url`・`image`・`input_image`・`inline_data`)で送る。opencode コマンド経由では画像を送らない。
- 画像を受け付けないモデルでエラーになったら、画像を外して文字だけでやり直し、そのことを画面に出す(`imagesDropped`)。
