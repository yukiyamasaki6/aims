begin;

set lock_timeout = '1s';
set statement_timeout = '5s';

-- ============================================================
-- target_face_rings.unique(spot_id, z_index) を削除する。
-- z_indexは描画上の重なり順に過ぎず、得点判定はradiusのみで行われるため、
-- 重複しても採点ロジックには影響しない。他ユーザーへの影響もない、
-- 作成者本人の見た目の問題に留まるため、DBレベルで強制すべき不変条件では
-- ない。将来カスタム的作成UIを作る際は、フォーム側での自動採番や
-- バリデーションで対応する。
-- ============================================================

alter table target_face_rings
  drop constraint target_face_rings_spot_id_z_index_key;

commit;
