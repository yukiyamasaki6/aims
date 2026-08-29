begin;

set lock_timeout = '1s';
set statement_timeout = '5s';

-- ============================================================
-- distances.is_marked / round_preset_distances.is_marked:
-- WAフィールドアーチェリーのアンマークドクラス（距離が公表されない）に対応する。
--
-- distanceのnullable化だけでは「正式にアンマークドで距離不明」と「入力漏れ」
-- を区別できず、またアーチャー自身が非公式に目測した距離をアンマークドの
-- ままでも記録したいケースを表せない。そのため、distanceとは独立に
-- is_markedを持たせる。is_marked=trueの場合のみ従来通りdistanceを必須とする。
-- ============================================================

alter table distances add column if not exists is_marked boolean not null default true;
-- アンマークド対応が本migrationの目的そのものであり、下記のis_marked連動
-- CHECK制約でmarked=trueの行のNOT NULL相当を引き続き強制する。
-- squawk-ignore ban-drop-not-null
alter table distances alter column distance drop not null;
alter table distances
  add constraint distances_marked_requires_distance
    check (is_marked = false or distance is not null) not valid;

alter table round_preset_distances add column if not exists is_marked boolean not null default true;
-- 上記distancesと同じ理由（アンマークド対応が目的、CHECK制約で代替保証）。
-- squawk-ignore ban-drop-not-null
alter table round_preset_distances alter column distance drop not null;
alter table round_preset_distances
  add constraint round_preset_distances_marked_requires_distance
    check (is_marked = false or distance is not null) not valid;

commit;
