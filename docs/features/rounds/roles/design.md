# rounds/roles 設計

## 概要

ラウンドの参加者の役割は、射つ人(`owner`)と代理の人(`editor`)の2つである。
どちらも記録と設定の変更ができ、ラウンドの削除は射つ人が1人のラウンドの本人だけができる。
認可はDB(書き込みはRPC、読み取りはRLS)が持つ。

## 構成とデータの流れ

| ファイル | 責務 |
| :--- | :--- |
| `supabase/migrations/20261128010001_shooters_unified.sql` | 役割の制約、認可の関数、閲覧のポリシー、射つ人の不変条件 |
| `apps/web/src/features/rounds/` | 未同期の`round.created`でも、認証中の利用者を作成者(射つ人、射手1)として端末の状態に持つ(`rounds/shooters`) |

役割は`round_users.role`が持ち、利用者に紐づかない射手の行はNULLである(行の種類は`rounds/shooters`)。
射つ人は番号を必ず持ち、代理の人は番号を持たない。
サーバーは作成者を`auth.uid()`から決め、端末の指定で権限を付与しない。

### 操作と認可

| 操作 | 射つ人 | 代理の人 |
| :--- | :--- | :--- |
| ラウンドの閲覧 | できる | できる |
| 点数の記録・取り消し・射手の付け替え、距離と名前などの設定、完了と入力中への戻し、射手の追加 | できる | できる |
| ラウンドの削除 | 射つ人が自分1人のときだけ | できない |

- `create_round`は、ラウンドと作成者の行(`owner`、`shooter_number = 1`)を1トランザクションで作る。再送は射手を増やさない。
- 書き込みの認可`is_round_editor`は、`owner`と`editor`を編集可能とする。名前は変えない。
- `disable_round`は、ラウンドをロックし、呼び出し元が射つ人で射つ人が1人の場合だけ受ける。それ以外は`PT403`で拒否する。
- 一般の利用者の表の権限はSELECTだけで、書き込みは認可付きの`SECURITY DEFINER`のRPCが行う。内部の関数とトリガー関数の実行権限は与えない。

### 閲覧の判定

参加は、`round_users`に本人の`user_id`と役割がある行があることである。
利用者に紐づかない射手の行は、閲覧の権限を持たない。

| 表 | SELECTのポリシー(`select_if_member`) |
| :--- | :--- |
| `rounds`、`round_users`、`round_events`、`distance_events` | `is_round_member(ラウンドのID)` |
| `distances` | 見える`rounds`があること |
| `shots`、`shot_events` | `round_id IN (SELECT public.member_round_ids())` |

`member_round_ids()`は、本人が参加するラウンドのIDを返す関数である。

```sql
CREATE FUNCTION public.member_round_ids() RETURNS SETOF uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT ru.round_id
  FROM public.round_users ru
  WHERE ru.user_id = auth.uid()
    AND ru.role IN ('owner', 'editor');
$$;
```

所有者は`postgres`で、実行権限は`PUBLIC`・`anon`から剥奪して`authenticated`へ付与する。
索引は`round_users_user_id_idx`を使う。
`is_round_member`は同じ参加の条件を1つのラウンドについて判定する。

### 射つ人の不変条件とロック

- ラウンドには射つ人が常に1人以上いる。`rounds`の作成と`round_users`の追加・更新・削除を対象とする遅延制約トリガーが、コミットの時点で残るラウンドを検査する。同じトランザクションで物理削除したラウンドは検査を通す。
- 書き込みは、操作者の`users`の行を`FOR KEY SHARE`で先に取る(`create_round`、`update_round`、`disable_round`、距離の作成・変更・削除、`record_shots`、`clear_shots`、`add_round_shooter`)。
- 矢と距離の操作は`rounds`を`FOR SHARE`、距離を`FOR UPDATE`で取る。ラウンドの変更と削除、射手の追加、参加の行の変更は`rounds`を`FOR UPDATE`で取る。アカウント削除は対象の`users`と`rounds`を`FOR UPDATE`で取る。
- ロックの順は利用者、ラウンド、距離で、同じ種類の複数の行はID順にする。距離から親を調べる最初の読み取りはロックせず、親を取った後に距離をロックして存在を確かめる。

## 設計判断

| 判断 | 理由 | 見直す条件 |
| :--- | :--- | :--- |
| 役割を射つ人と代理の人の2つにし、読むだけの役割を持たない | 記録に要る操作を代理の人に許し、他の人の記録を消す操作だけを射つ人に限るため | 読むだけの参加者を設けるとき |
| ラウンドの削除を、射つ人が1人のときの本人に限る | 1人の操作で他の射つ人の記録を消さないため | 射つ人がラウンドから外れる操作を作るとき |
| 射つ人が1人以上いることをDBの制約で保ち、参加の行の変更を`rounds`のロックで直列にする | 射つ人が同時にアカウントを削除しても、射つ人のいないラウンドを残さないため | 参加の行を変える経路をDBの外に持つとき |
| `shots`・`shot_events`の閲覧は、行の`round_id`と`member_round_ids()`を照合する | 矢の行ごとの距離の参照と関数の呼び出しをなくすため(計測と却下した形は`rounds/history`)。`round_id`と距離のラウンドは複合外部キーが一致させる | 読み取りの認可の方式を変えるとき |

## 制約と未対応

- 射つ人・代理の人を加える操作と、ラウンドから外れる操作は無い。現在の参加者は作成者だけである。
- 参加の条件を`is_round_member`と`member_round_ids`の2つの関数に書くため、条件を変えるときは両方を変える。
- 画面は削除のメニューを役割と射つ人の数で出し分けない(`rounds/delete`)。
