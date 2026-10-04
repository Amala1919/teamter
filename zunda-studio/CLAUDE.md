# zunda-studio で作業するときの決まり

VOICEVOX のキャラクターで、ゲーム実況(掛け合い)動画を作る Electron アプリ。
これまでの経緯と残っている作業は [docs/HANDOFF.md](docs/HANDOFF.md) を最初に読む。

## 利用者とのやりとり

- **日本語で答える。** 画面の文言・コメント・コミットメッセージも日本語(既存のコードに合わせる)。
- 機能を足したら、最後に「PR を作成しますか？」と聞く。PR は頼まれたときだけ作る(「うん」「はい」で作る。「できたら PR まで」と先に言われたら、作り終えたら作る)。
- 利用者は「操作が煩雑にならなければ、便利な機能はどんどん足してほしい」という考え。

## 作りの方針(利用者の希望)

- **素材は独立が基本。** セリフの長さが変わっても、ほかのセリフや素材を自動で動かさない。一緒に動かしたいものはグループにする。
- **自動でやる動きは、設定で選べるようにする。** 既存の動きを変えたときも、機能を丸ごと消すのでなければ設定で元の動きに戻せるようにする(設定の「編集」タブ・`EditingSettings` か `ui` の設定)。
- 変更は取り消せる(undo)ようにする。プロジェクトの変更はコマンド(`src/shared/commands`)で行う。

## 仕組みの要点

- Electron + electron-vite + React 19 + TypeScript + zustand。main とレンダラは `src/shared/ipc/contract.ts` の契約で話す(チャネルを足すときは契約・`src/main/core/handlers.ts` の引数の検証と実装を足す)。
- プロジェクトの変更は immer のコマンド(`src/shared/commands/handlers/*`)。`applyCommands` の後処理で、重なりの振り分け・立ち絵の区間の伸び縮み・独りのグループの解消を行う。
- 描画は `src/shared/render/compositor.ts` が唯一の実装(プレビューと書き出しで同じ)。書き出しは `@napi-rs/canvas`。
  - `@napi-rs/canvas` は描いた内容を記録として積み、`save()` の外で全体を消したときにだけ捨てる。1コマごとに `save()` の外で全体を消すこと(消さないとメモリが溜まり続ける)。
- テスト用ホスト(devhost)は、IPC を HTTP で運んでブラウザで動かす(E2E はこれを使う)。

## 確かめ方(push の前に通す)

```
npm run typecheck
npx vitest run
npm run build:app && npm run build:devhost && npx playwright test
```

- 実物の Electron の確認: `npm run dist -- --dir` のあと `npx playwright test -c playwright.electron.config.ts`(Linux なら `xvfb-run -a` を付ける)。
- E2E は型の DOM ライブラリを読まないので、`globalThis as unknown as {...}` の形で書く。
- Playwright のブラウザが無ければ `npx playwright install chromium`。
- 「止めている間は止めたコマが映り続ける」などの動画プレビューの E2E は、まれに1回だけ失敗することがある(単体で繰り返すと通る)。

## ブランチ・コミット

- 作業ブランチから、`claude/shadowverse-digital-cardgame-pkuaad` へ PR を出す。
- PR がマージされたら、作業ブランチをそのブランチの最新から作り直してから次の作業をする。
