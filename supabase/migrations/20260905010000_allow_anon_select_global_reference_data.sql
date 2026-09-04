begin;

set lock_timeout = '1s';
set statement_timeout = '5s';

-- target_faces/round_presetsはグローバル分（owner_id is null）に限り、
-- どのユーザーから見ても常に同じ内容を返す参照データのため、サーバー側で
-- 未認証（anon）のリクエストからも閲覧できるようにし、Cookie（セッション）
-- に依存しないキャッシュを可能にする。既存のauthenticated向けポリシー
-- （個人データも含め全て閲覧可）はそのまま維持し、個人データがanonに
-- 見えるようになるわけではない。

create policy "select_global_anon" on target_faces
  for select
  to anon
  using (owner_id is null);

create policy "select_global_anon" on target_face_spots
  for select
  to anon
  using (
    exists (
      select 1 from target_faces tf
      where tf.id = target_face_spots.target_face_id and tf.owner_id is null
    )
  );

create policy "select_global_anon" on target_face_rings
  for select
  to anon
  using (
    exists (
      select 1 from target_face_spots s
      join target_faces tf on tf.id = s.target_face_id
      where s.id = target_face_rings.spot_id and tf.owner_id is null
    )
  );

create policy "select_global_anon" on round_presets
  for select
  to anon
  using (owner_id is null);

create policy "select_global_anon" on round_preset_distances
  for select
  to anon
  using (
    exists (
      select 1 from round_presets rp
      where rp.id = round_preset_distances.preset_id and rp.owner_id is null
    )
  );

commit;
