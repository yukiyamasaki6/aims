begin;

set lock_timeout = '1s';
set statement_timeout = '5s';

-- score_strとscore_intはtarget_face_ringsから入力ツールが生成する結果であり、
-- X=10やM=0のような対応をDBの固定ルールとしては保証しない。
-- score_str/score_intはNOT NULLと整数型だけを維持し、的ごとの採点定義から分離する。
alter table shots
  drop constraint if exists shots_check;

commit;
