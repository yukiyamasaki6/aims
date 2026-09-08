import { useEffect, useState } from "react";

// ハイドレーション完了前にクリック・入力すると、ハンドラ未接続で空振り
// したり、直後の再描画で入力値が消えたりすることがある（e2eで確認済み）。
// ハードナビゲーション（page.goto）直後に操作する画面ルートのコンポーネントが
// data-hydrated属性として公開し、テスト側が操作前にこれを待てるようにする。
export function useHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  return hydrated;
}
