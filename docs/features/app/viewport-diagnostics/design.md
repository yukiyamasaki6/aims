# viewport-diagnostics 設計

## 概要

設定画面(`/settings`)の「表示領域の診断」のスイッチで、表示領域の測定値のバッジを全画面の右下に出す。有効・無効は端末の`localStorage`に保存し、サーバーへは送らない。
無効のとき、バッジのDOM・リスナー・タイマーは存在しない。
診断を1つの機能にまとめ、設定機能とは入口を介してだけつなぐ。除去は、機能ディレクトリの削除と入口などの該当行の削除で足りる。

## 画面と状態

| 画面・状態 | 内容 |
| :--- | :--- |
| 無効(初期) | バッジを描かない。サーバーと初回の描画も無効。 |
| 有効 | マウント後にバッジが`document.body`へ追加され、0.5・2・5秒後、リサイズ、表示状態の変化で測り直す。 |
| 切り替え | 同一タブは実装内の通知で即時に反映する。別タブの変更は`storage`イベントで反映する。 |

## 構成とデータの流れ

- `src/features/viewport-diagnostics/application/diagnostics-setting.ts`: 約束`DiagnosticsSetting`(`read`、`write`、`subscribe`)。
- `infrastructure/browser-diagnostics-setting.ts`: `localStorage`のキー`aims:viewport-diagnostics`に`"1"`で有効、無し・それ以外は無効。値は変数に持ち、保存先の例外は捕捉してそのセッションだけ変数の値で動く。
- `ui/viewport-diagnostics-provider.tsx`: 設定を`useSyncExternalStore`で購読し、有効のときだけ`ViewportBadge`を子と並べて描く。`useDiagnosticsSetting`で切り替えへ渡す。
- `ui/viewport-badge.tsx`: 測定、文字列の組み立て、DOMとリスナーの管理。`ui/viewport-judgement.ts`が`ok`/`BAD`を判定する。
- `ui/diagnostics-toggle.tsx`: スイッチ(`role="switch"`)。
- `ui/viewport-diagnostics-messages.ts`: 文言(名前空間`viewportDiagnostics`)。バッジ内の値の識別子は、スクリーンショットの照合用の技術表記で、翻訳しない。
- 入口: `app/root-client-entry.tsx`が設定を1つ作り、`ViewportDiagnosticsProvider`で`children`を包む。`app/(main)/settings/page.tsx`が`DiagnosticsToggle`を`SettingsScreen`の`diagnostics`へ渡す。
- 設定は端末単位で、利用者・サインアウトとは独立する。

## 設計判断

| 判断 | 理由 | 見直す条件 |
| :--- | :--- | :--- |
| 設定機能ではなく独立した機能にする | 診断の除去が設定機能の改変にならないようにするため。設定機能は`diagnostics`の枠を受けるだけにする。 | 診断が不要になったとき(機能ごと除去)。 |
| 設定を`localStorage`に端末単位で保存する | ホーム画面のアプリにはURL欄がなく、URL引数で切り替えられないため。 | 診断を端末の外で制御する必要が出たとき。 |
| 初回の描画は無効にする | 水和の不一致を避けるため。 | なし。 |

## 制約と未対応

- 有効でも、アプリの起動直後の数百ミリ秒はマウント後の測定になる。
- `localStorage`が使えない環境では、そのセッションだけ有効にでき、保持されない。
