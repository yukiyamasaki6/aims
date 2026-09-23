# Agent Guidelines

## 共通ルール

- **使用言語：** 常にユーザーがプロンプトで使用している言語で回答する。
- **機密情報：** `service_role` を含む本番の秘密情報を扱わない。
- **アジャイル：** 完璧さよりも段階的な前進を優先する。前提がずれたまま完璧なコードを書いても意味はない。
- **リエンジニアリング：** 開発を通して得られた知見に基づき、必要に応じてガイドラインを更新する。

## 開発ワークフロー

- 開発は原則として、設計 → Issue起票（必要な場合）→ テスト/実装 ↔ 統合 ↔ レビュー → PR作成の流れで進める。
- 各責務の詳細は、担当時に参照すること。
    - 設計: `agents/design.md`
    - Issue起票: `agents/issue.md`
    - テスト: `agents/testing.md`
    - 実装: `agents/implementation.md`
    - 統合: `agents/integration.md`
    - レビュー: `agents/review.md`
    - PR作成: `agents/pull-request.md`
- テストと実装は、合意済みの設計を共通の基準とする独立した責務として扱う。
