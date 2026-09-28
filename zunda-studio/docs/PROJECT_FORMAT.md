# プロジェクトファイル仕様

## 1. 方針

プロジェクトは1つのJSONファイル(`*.zsproj`)である。素材は**絶対パスと、プロジェクトファイルからの相対パスの両方**を記録し、読み込み時に相対パスを優先する(プロジェクトごと別マシンに移しても開けるようにするため)。

元素材は一切書き換えない。動画の切り出しもエフェクトも、この構造の中の指示として表現される。

派生データ(合成済みwav、プロキシ動画、波形、PSDから切り出したパーツPNG)はプロジェクトファイルに含めず、キャッシュディレクトリに置く。キャッシュを消してもプロジェクトは開ける。

時間の単位はすべて**ミリ秒(整数)**とする。浮動小数の秒を使うと丸め誤差でアイテムの隙間や重なりが生じるため。

## 2. 全体構造

```jsonc
{
  "formatVersion": 1,
  "meta": {
    "title": "ゲーム実況 #1",
    "createdAt": "2026-09-27T10:00:00Z",
    "updatedAt": "2026-09-27T12:30:00Z",
    "renderSeed": 123456789      // まばたき等の乱数を決定論的にするための種
  },
  "canvas": {
    "width": 1920,
    "height": 1080,
    "fps": 30,
    "backgroundColor": "#000000"
  },
  "characters": { /* 3章 */ },
  "assets":     { /* 4章 */ },
  "layers":     [ /* 5章 */ ],
  "items":      [ /* 6章 */ ],
  "credits":    { /* 8章 */ },
  "liveSessions": { /* 9章 */ },
  "chat":       { /* 10章 */ },
  "ai":         { /* 11章 */ },
  "editing": {
    "rippleOnVoiceChange": true,   // セリフの尺が変わったら後ろのアイテムもずらす
    "defaultGapMs": 200,           // セリフを続けて追加するときの間
    "duckVolume": 0.35,            // セリフの間、duckable な音声をこの倍率まで下げる
    "duckFadeMs": 200              // 下げる・戻すのにかける時間
  }
}
```

`characters` / `assets` はIDをキーにしたオブジェクト、`items` は配列とする。アイテムは数千個になりうるので、配列にして描画時に時間でインデックスを張る。

## 3. キャラクター

キャラクターは「話者・立ち絵・字幕スタイル」を束ねたプリセットである。ボイスアイテムはキャラクターIDを参照するだけで、これらの既定値を得る。

`authorRole` はそのキャラクターのセリフを誰が書くかを表す。`ai` の場合は `persona` が必須で、AIはこれに従ってセリフを書く。掛け合いの構成(誰が自分の役で誰が相方か)をアプリの仕様として固定せず、キャラクターの属性として表現するのは、3人以上の構成や全員を手書きする運用にも同じ仕組みで対応できるようにするためである。

```jsonc
"characters": {
  "chr_zundamon": {
    "name": "ずんだもん",
    "authorRole": "user",          // user: 人間が書く / ai: AIが演じる相方
    "persona": null,               // authorRole が "ai" のときのみ設定する
    "voice": {
      "engineId": "voicevox",
      "speakerId": 3,              // VOICEVOX のスタイルID
      "speakerName": "ずんだもん(ノーマル)",
      "speedScale": 1.1,
      "pitchScale": 0.0,
      "intonationScale": 1.0,
      "volumeScale": 1.0,
      "prePhonemeLength": 0.1,
      "postPhonemeLength": 0.1
    },
    "subtitle": { "styleId": "sty_zundamon" },
    "portrait": {
      "assetId": "ast_zunda_psd",
      "transform": { "x": 1350, "y": 1080, "scale": 1.0, "flipX": false, "anchor": "bottom-center" },
      "parts": { /* 3.1 */ },
      "expressions": { /* 3.2 */ },
      "defaultExpressionId": "exp_normal",
      "lipSync": { "mode": "vowel", "partGroupId": "grp_mouth" },
      "blink": { "partGroupId": "grp_eye", "intervalMs": 4000, "jitterMs": 1500, "closeDurationMs": 120 }
    },
    "creditRequired": true,
    "creditText": "VOICEVOX:ずんだもん"
  }
}
```

相方(`authorRole: "ai"`)のキャラクターは `persona` を持つ。

```jsonc
"chr_metan": {
  "name": "四国めたん",
  "authorRole": "ai",
  "persona": {
    "personality": "冷静で少し毒舌だが、面倒見はいい",
    "speechStyle": "一人称は「わたくし」。丁寧語まじりで、語尾に「かしら」を使う",
    "banterRole": "tsukkomi",      // tsukkomi / boke / navigator / free
    "forbidden": ["下品な表現"],
    "targetLengthChars": 40        // 1返答の目安。テンポの基準になる
  },
  // voice / subtitle / portrait は他のキャラクターと同じ
}
```

`targetLengthChars` を持つのは、掛け合いのテンポが1返答の長さでほぼ決まるためである。これを設定として持たせておくと、AIに毎回「短めに」と指示しなくてよい。

### 3.1 立ち絵のパーツ対応

PSDのレイヤーツリーに対する「役割の割り当て」を保存する。`layerPath` はPSD内のレイヤーを一意に指すパス。

```jsonc
"parts": {
  "grp_eye": {
    "role": "eye",
    "layerPath": ["キャラ", "!目"],
    "selection": "exclusive",       // exclusive: 1つだけ表示 / multiple: 複数可
    "items": [                       // まばたき・口パクでは配列の順序が開→閉の段階を表す
      { "id": "prt_eye_open",  "name": "目1_開き",   "layerPath": ["キャラ","!目","目1_開き"] },
      { "id": "prt_eye_half",  "name": "目1_半目",   "layerPath": ["キャラ","!目","目1_半目"] },
      { "id": "prt_eye_close", "name": "目1_閉じ",   "layerPath": ["キャラ","!目","目1_閉じ"] }
    ],
    "blinkSequence": ["prt_eye_open", "prt_eye_half", "prt_eye_close"]
  },
  "grp_mouth": {
    "role": "mouth",
    "layerPath": ["キャラ", "!口"],
    "selection": "exclusive",
    "items": [ /* ... */ ],
    // mode:"vowel" のとき、母音から口パーツへの対応
    "vowelMap": {
      "a": "prt_mouth_a", "i": "prt_mouth_i", "u": "prt_mouth_u",
      "e": "prt_mouth_e", "o": "prt_mouth_o",
      "N": "prt_mouth_n", "cl": "prt_mouth_close", "pau": "prt_mouth_close"
    },
    // mode:"amplitude" のとき、閉→開の段階列
    "openSequence": ["prt_mouth_close", "prt_mouth_half", "prt_mouth_open"]
  }
}
```

### 3.2 表情プリセット

表情は「どのパーツを選ぶか」の組み合わせに名前を付けたもの。AIが表情を指定するときはこのIDを使う(A-3)。`mouth` は口パクに使われるため表情には含めない。

```jsonc
"expressions": {
  "exp_normal": { "name": "通常",   "selections": { "grp_eyebrow": "prt_brow_normal", "grp_eye": "prt_eye_open" } },
  "exp_happy":  { "name": "笑顔",   "selections": { "grp_eyebrow": "prt_brow_up",     "grp_eye": "prt_eye_smile" } },
  "exp_angry":  { "name": "怒り",   "selections": { "grp_eyebrow": "prt_brow_angry",  "grp_eye": "prt_eye_sharp" } },
  "exp_shock":  { "name": "驚き",   "selections": { "grp_eyebrow": "prt_brow_up",     "grp_eye": "prt_eye_wide" } }
}
```

## 4. 素材

```jsonc
"assets": {
  "ast_gameplay": {
    "type": "video",
    "path": { "absolute": "D:/rec/play01.mp4", "relative": "../rec/play01.mp4" },
    "durationMs": 7325400,
    "width": 1920, "height": 1080, "fps": 60,
    "hasAudio": true,
    "proxyPath": null,             // キャッシュ側で管理。参照は実行時に解決する
    "license": { "source": "自分で録画", "creditRequired": false, "note": "" }
  },
  "ast_bgm_01": {
    "type": "audio",
    "path": { "absolute": "D:/bgm/track.mp3", "relative": "../bgm/track.mp3" },
    "durationMs": 184000,
    "license": { "source": "https://example.com/", "creditRequired": true, "creditText": "BGM: ...", "note": "商用利用可" }
  },
  "ast_zunda_psd": {
    "type": "psd",
    "path": { "absolute": "D:/tachie/zundamon.psd", "relative": "../tachie/zundamon.psd" },
    "license": { "source": "配布元URL", "creditRequired": true, "creditText": "立ち絵: ..." }
  }
}
```

`license` を素材の必須フィールドとするのは、書き出し時にクレジットを機械的に集約するためである(L-4)。

## 5. レイヤー

```jsonc
"layers": [
  { "id": "lyr_bg",       "name": "背景",   "index": 0, "visible": true, "locked": false, "muted": false },
  { "id": "lyr_zoom",     "name": "ズーム", "index": 1, "visible": true, "locked": false, "muted": false },
  { "id": "lyr_portrait", "name": "立ち絵", "index": 2, "visible": true, "locked": false, "muted": false },
  { "id": "lyr_voice",    "name": "ボイス", "index": 3, "visible": true, "locked": false, "muted": false },
  { "id": "lyr_bgm",      "name": "BGM",   "index": 4, "visible": true, "locked": false, "muted": false }
]
```

`index` が大きいレイヤーが前面に描画される。音声のみのアイテムには描画順は影響しない。

ズームのアイテムは、置かれたレイヤーより下(`index` が小さいレイヤー)だけを拡大する。既定の構成ではゲーム映像だけが拡大され、立ち絵と字幕は動かない。

## 6. アイテム

全アイテムが共通して持つフィールド。

```jsonc
{
  "id": "itm_0001",
  "type": "voice",
  "layerId": "lyr_voice",
  "startMs": 0,
  "durationMs": 2480,
  "effects": [ /* 7章 */ ],
  "locked": false
}
```

### 6.1 ボイスアイテム

本アプリの中心となるアイテム。テキスト・音声・字幕・口パクが一体となる。

```jsonc
{
  "id": "itm_0001",
  "type": "voice",
  "layerId": "lyr_voice",
  "startMs": 0,
  "durationMs": 2480,          // 合成結果から自動算出される。手動では変更しない
  "characterId": "chr_zundamon",
  "text": "今日はこのゲームをやっていくのだ！",
  "voiceOverride": { "speedScale": 1.2 },   // キャラクター既定値の部分上書き
  "subtitleOverride": { "color": "#ff4444", "sizeScale": 1.2 },
  "expressionId": "exp_happy",              // この発話中の表情
  "generatedBy": {                          // AIが書いたセリフのみ。人間が書いたら null
    "providerId": "claude-code",
    "model": "claude-opus-5",
    "at": "2026-09-27T12:00:00Z"
  },
  "synthesis": {
    "cacheKey": "sha256:...",               // 合成結果wavのキャッシュキー
    "audioDurationMs": 2480,
    "lipSync": [                            // モーラから導出した口パクタイムライン
      { "atMs": 100, "vowel": "o" },
      { "atMs": 190, "vowel": "i" }
    ],
    "accentPhrases": [ /* VOICEVOX の AudioQuery をそのまま保持(読み修正の保存先) */ ]
  },
  "subtitleLines": ["今日はこのゲームを", "やっていくのだ！"]   // 自動改行の結果。手動編集可
}
```

`durationMs` を合成結果から導出するのは、音声と字幕と口パクの尺が原理的にズレないようにするためである。この値をユーザーが直接編集できるようにすると、3者の同期が壊れる。

`accentPhrases` をプロジェクトに保存するのは、読み方の修正(V-6)を永続化するためである。保存されていればそれを `POST /synthesis` に渡し、`/audio_query` をやり直さない。

### 6.2 その他のアイテム

```jsonc
// 動画: 素材の一部を切り出して配置する
{ "type": "video", "assetId": "ast_gameplay", "inMs": 750000, "outMs": 765000,
  "transform": { "x": 960, "y": 540, "scale": 1.0, "rotation": 0, "opacity": 1.0 },
  "volume": 0.4, "playbackRate": 1.0 }

// 静止画(フリーズフレーム): 動画の inMs のコマを尺いっぱい止めて表示する。音は鳴らさない。
// freeze が無い(古い)プロジェクトは通常の動画として扱う。
{ "type": "video", "assetId": "ast_gameplay", "inMs": 762333, "outMs": 762333,
  "transform": { /* 同上 */ }, "volume": 0.4, "playbackRate": 1.0, "freeze": true }

// 画像
{ "type": "image", "assetId": "ast_cutin", "transform": { /* 同上 */ } }

// 独立した字幕・テロップ(ボイスに紐づかないもの)
{ "type": "text", "text": "衝撃の結末", "styleId": "sty_telop",
  "transform": { /* 同上 */ } }

// BGM・効果音
{ "type": "audio", "assetId": "ast_bgm_01", "inMs": 0, "outMs": 184000,
  "volume": 0.25, "loop": true, "fadeInMs": 1000, "fadeOutMs": 2000, "duckable": true }

// 図形・単色背景
{ "type": "shape", "shape": "rect", "fill": "#101820", "transform": { /* 同上 */ } }

// 立ち絵の明示的な配置(常時表示ではなく区間を制御したい場合)
{ "type": "portrait", "characterId": "chr_zundamon", "transformOverride": null }
```

`transform` の `x`, `y` はアイテムの中心の位置。等倍の大きさは、動画は画面に収まる最大の大きさ、画像は素材の画素数、図形は画面全体とする。ゲーム録画は置いただけで画面いっぱいになり、画像は素材の大きさのまま置かれる。

音量の時間変化(音量 × フェード × ダッキング)は折れ線として求め、プレビューと書き出しで同じ折れ線を使う(`src/shared/audio/envelope.ts`)。

立ち絵は既定ではキャラクター設定に基づいて発話中に自動表示されるが、登場・退場を明示的に制御したい場合に `portrait` アイテムを置ける。

`duckable: true` の音声アイテムは、ボイスアイテムの再生区間で自動的に音量が下がる(M-4)。

### 6.3 ズームアイテム

画面の一部に寄って、終了時に戻る演出。**このアイテムより下のレイヤーだけ**を拡大する(REQUIREMENTS.md Z-5)。

```jsonc
{
  "type": "zoom",
  "layerId": "lyr_zoom",           // 既定ではゲーム映像(背景)のすぐ上のレイヤー
  "startMs": 750000,
  "durationMs": 4000,
  "region": { "x": 120, "y": 80, "width": 960 },   // キャンバス座標。高さは縦横比から決まる
  "method": "smooth",              // cut / smooth / linear / punch / slowPush
  "inMs": 400,                     // 寄るのにかける時間
  "outMs": 400                     // 戻るのにかける時間
}
```

範囲に高さを持たせず幅だけで表すのは、縦横比が動画と常に一致することをデータ構造で保証するためである。高さは `width × canvas.height ÷ canvas.width` で求める。

| method | 動き |
| --- | --- |
| `cut` | 開始時刻に一瞬で寄り、終了時刻に一瞬で戻る |
| `smooth` | `inMs` かけてなめらかに寄り、終了前の `outMs` でなめらかに戻る |
| `linear` | 同じく等速で寄って戻る |
| `punch` | 素早く寄って少し行き過ぎてから収まる(強調向き) |
| `slowPush` | 期間全体をかけてゆっくり寄り続け、`outMs` で戻る |

拡大率は範囲の幅の対数で補間する。幅を線形に補間すると、寄り始めは速く終わり際は遅く見えるためである。

## 7. エフェクト

アイテムに対する時間変化する変形。`Compositor` は各エフェクトを「アイテム内の相対時刻 → 変形パラメータ」として評価する。

```jsonc
"effects": [
  { "type": "fade",  "inMs": 200, "outMs": 200 },
  { "type": "scale", "from": 1.0, "to": 1.08, "easing": "easeOutCubic", "durationMs": 400 },
  { "type": "move",  "fromX": 0, "fromY": 40, "toX": 0, "toY": 0, "easing": "easeOutCubic", "durationMs": 300 },
  { "type": "shake", "amplitudePx": 8, "frequencyHz": 18, "durationMs": 300 }
]
```

`shake` は乱数を使うが、`meta.renderSeed` とアイテムIDと相対時刻から決定論的に生成する。

## 8. 字幕スタイルとクレジット

```jsonc
"subtitleStyles": {
  "sty_zundamon": {
    "name": "ずんだもん",
    "fontFamily": "Noto Sans JP",
    "fontWeight": 700,
    "fontSizePx": 64,
    "color": "#ffffff",
    "outline": { "color": "#2b7a0b", "widthPx": 8 },
    "shadow": { "color": "#00000080", "offsetX": 4, "offsetY": 4, "blurPx": 4 },
    "position": { "anchor": "bottom-center", "x": 960, "y": 980 },
    "maxCharsPerLine": 22,
    "lineHeight": 1.2
  }
},
"credits": {
  "generated": "VOICEVOX:ずんだもん\nVOICEVOX:四国めたん\n立ち絵: ...\nBGM: ...",
  "confirmedByUser": false
}
```

`confirmedByUser` を持つのは、クレジットの最終確認を投稿者の明示的な操作にするためである(L-5)。

## 9. ライブセッション

録画中にAIと交わした会話の記録。編集時に振り返り、台本の素材として採用する。

```jsonc
"liveSessions": {
  "ses_01": {
    "startedAt": "2026-09-27T20:00:00Z",
    "endedAt": "2026-09-27T22:14:30Z",
    "recordingAssetId": "ast_gameplay",
    "offsetMs": 12000,           // 録画の12秒目がセッション開始に対応する
    "offsetSource": "obs",       // obs: 自動取得 / manual: 手動調整 / unknown: 未対応
    "entries": [
      { "id": "ent_001", "atMs": 0,      "role": "user", "kind": "chat",
        "text": "このボス初見なんだけど、パターンある？", "bookmarked": false, "adoptedItemId": null },
      { "id": "ent_002", "atMs": 1800,   "role": "ai",   "kind": "question",
        "text": "3段階に分かれているかしら。まずは足元を見ることね",
        "bookmarked": false, "adoptedItemId": null,
        "generatedBy": { "providerId": "opencode", "model": "opencode-go/kimi-k3", "at": "..." } },
      { "id": "ent_003", "atMs": 421000, "role": "user", "kind": "marker",
        "text": "いまのは奇跡", "bookmarked": true, "adoptedItemId": "itm_0042" }
    ]
  }
}
```

`atMs` はセッション開始からの相対時刻である。録画上の時刻は `offsetMs + atMs` で求める。相対時刻で保存するのは、録画との対応付けのずれを後から直すときに、`offsetMs` 1つを変えるだけで済むようにするためである。

`adoptedItemId` は、その発言を台本に採用したときに生成されたボイスアイテムを指す。同じ発言を二重に採用するのを防ぎ、編集画面で「採用済み」を示せる。

プレイ中の記録は、まずキャッシュディレクトリのJSONLファイルへ発言ごとに追記する(クラッシュで失わないため)。プロジェクトへ取り込むのは編集時であり、そのときにこの構造へ変換する。

## 10. チャット履歴

```jsonc
"chat": {
  "messages": [
    { "role": "user", "content": "テンポを上げたいので各セリフを短くして", "atMs": 1727430000000 },
    { "role": "assistant", "content": "7件のセリフを短縮する提案です",
      "proposedCommands": [ /* コマンド列 */ ], "applied": true, "transactionId": "txn_012" }
  ]
}
```

チャット履歴をプロジェクトに含めるのは、次のセッションでAIが過去の指示(口調の方針など)を踏まえられるようにするためである。

## 11. AI設定

プロジェクトごとの会話AI(相方を演じるAI)の指定。`null` ならアプリ全体の既定値を使う。

```jsonc
"ai": {
  "conversation": { "providerId": "opencode", "model": "opencode-go/kimi-k3" }
}
```

編集AIはプロジェクトに持たせない。動画ごとに変える理由が薄く、アプリ設定で固定するのが自然なためである。

どのAIが実際にどのセリフを書いたかは、ここではなく各アイテムの `generatedBy` に記録する。プロジェクトの設定は「これから書くセリフ」の既定値にすぎず、途中で変えれば過去のセリフとは異なるためである。

## 12. バージョニング

`formatVersion` を単調増加させ、読み込み時に現在のバージョンへの移行関数を順に適用する。移行関数は一度書いたら変更しない。プロジェクトを開いて保存したら古いバージョンでは開けなくなるため、移行前のファイルを `*.zsproj.bak` として残す。
