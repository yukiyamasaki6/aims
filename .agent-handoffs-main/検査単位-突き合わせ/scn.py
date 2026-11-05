# -*- coding: utf-8 -*-
SC=[]
def s(id_,name,trigger,result,layers,abn,segs,notes=None,order=None):
    SC.append(dict(id=id_,name=name,trigger=trigger,result=result,layers=layers,abn=abn,segs=segs,notes=notes or {}))
UI=lambda *x:[f"@UI-01~{a}" for a in x]
U2=lambda *x:[f"@UI-02~{a}" for a in x]
FETCH=["@FET-01","@FET-02"]
SEND_COMMON=["OS_plan","OS_run","OS_hub","OS_life","SQ_plan","SQ_run","@SEND-06","@SEND-07","@SEND-03","@OPS-01","HUB_apply","RR_apply","HUB_inflight","RR_inflight","IDB_ack"]
APPEND=["@LOG-01~contract/op-log-store","HUB_append","RR_append","IDB_append","HUB_life","HUB_notify","RR_base","IDB_conn","@ID-01"]
# ===================== 認証 =====================
s("SC-01","サインアップする","利用者が/signupでメールを入力して進む","アカウントと端末のセッションができ、一覧(または遷移元)へ移る。usersに行ができる","画面、手続き、サーバーアクション(管理者API)、認証サービス、DB(users)、メール","登録済み、登録の確認不能、CAPTCHA未完了、通信不可、コード誤り、再送の待ち、弱いパスワード、設定失敗",
 ["@AUTH-02","@AUTH-04","@AUTH-12","@AUTH-11","@AUTH-10","SA_call","@AUTH-09~client.ts","SRV_admin","AR_rules","U_trigger","@DB-17","@DB-18","@ENT-01","@LIB-01~page-navigation","@LIB-01~clock"]+UI("ui/button.tsx","busy-button","ui/input.tsx")+U2("app-logo","use-hydrated","use-mounted-ref"),
 {"AUTH-04":"コード送付、再送、検証、パスワード設定の段階。メール・コード・パスワードを渡し、段階と欄ごとのエラーを受ける(サインアップとパスワード再設定の2場面から呼ばれる)","@AUTH-10":"入力検証と失敗の文言(メール、パスワード、CAPTCHA、登録済み)","SA_call":"signInWithOtp、verifyOtp、updateUser(コード送付・検証・パスワード設定)","@LIB-01~clock":"再送の待ち時間を1秒ごとに進める(clock.after)"})
s("SC-02","ログインする","利用者が/signinでメールとパスワードを送信する","端末にセッションができ、遷移元または既定の行き先(一覧)へ移る","画面、手続き、認証サービス","入力の検証エラー、CAPTCHA未完了、認証失敗、通信不可、遷移元が不正",
 ["@AUTH-01","@AUTH-11","@AUTH-10","SA_call","@AUTH-09~client.ts","AR_rules","@DB-17","@ENT-01","@LIB-01~page-navigation"]+UI("ui/button.tsx","busy-button","ui/input.tsx")+U2("app-logo","use-hydrated"),
 {"AR_rules":"遷移元の検証(returnTo)と、サインイン後の行き先を決める(destinationOf)","@AUTH-10":"メール・パスワードの検証、失敗の文言"})
s("SC-03","パスワードを再設定する","利用者が/reset-passwordでメールを入力して進む","新しいパスワードが設定され、全端末のサインインが終わり、サインインへ移る","画面、手続き、サーバーアクション(要求のセッション)、認証サービス、メール","コード誤り、再送の待ち、弱いパスワード、設定失敗、全端末サインアウトの失敗",
 ["@AUTH-03","@AUTH-04","@AUTH-12","@AUTH-11","@AUTH-10","SA_call","@AUTH-09~client.ts","SRV_server","AR_rules","@DB-17","@DB-18","@LIB-01~clock","@LIB-01~page-navigation"]+UI("ui/button.tsx","busy-button","ui/input.tsx")+U2("app-logo","use-hydrated"),
 {"AUTH-04":"段階の共通処理(サインアップと同じ入力・期待)","SRV_server":"要求の利用者のセッションの接続(サーバーアクション)"})
s("SC-04","サインアウトする","利用者がレフトパネルのサインアウトを押す","この端末のセッションが終わり、遷移元なしで/signinへ移る","画面(パネル)、手続き、認証サービス","確認の取り消し、実行中の二重押下、終了依頼の失敗、未認証と確かめられない、画面が離れた",
 ["SES_out","SEF_out","SEF_leave","@AUTH-05~sign-out-button","SA_call","SA_read","@AUTH-09~client.ts","AR_rules","@AUTH-06~browser-page-load","@AUTH-10","@LIB-01~connectivity"]+UI("ui/button.tsx","confirm-dialog","ui/dialog.tsx")+U2("use-mounted-ref"),
 {"@UI-01~confirm-dialog":"ブロッキング確認(実行中は閉じない)。説明、確認ラベル、busy、errorを渡す","AR_rules":"signInHref(遷移元なし)でサインインのURLを求める"})
s("SC-05","認証が必要な画面・認証専用画面を要求する","ブラウザが/rounds配下、/signin、/signup、/reset-passwordを要求する","未認証なら遷移元つきで/signinへ、認証済みなら一覧(または遷移元)へリダイレクトされる","要求の入口(proxy)、認証サービス(サーバー)","Server Action呼び出し、遷移元が不正、環境変数なし",
 ["@AUTH-08","@ENT-01"],{"@ENT-01":"保護の範囲の根(ROUNDS_PATH)を値として渡す"})
s("SC-06","認証状態の購読で、セッション喪失を検知して/signinへ移る","認証が必要な画面を開く(購読の開始)。以降、認証状態の通知(SIGNED_OUTなど)が発火する","喪失と判定したら、今の場所を遷移元につけて/signinへ一度だけ移る","画面(レイアウト)、手続き、認証サービス","サインアウト実行中は移らない、遷移済みなら移らない",
 ["@AUTH-06","SA_sub","AR_rules","SEF_leave","@AUTH-10"],{"AR_rules":"signInHref(今の場所つき)"})
s("SC-07","通信復帰の購読で、未認証を確かめて/signinへ移る","認証が必要な画面を開く(購読と初回の確認)。通信が戻ったとき","オンラインで未認証と確かめられたら/signinへ移る","画面(レイアウト)、手続き、通信状態、認証サービス","オフラインでは確かめず保留、状態が不明なら留まる",
 ["SES_watch","ACH_lost","SA_read","@LIB-01~connectivity","@AUTH-06~browser-page-load","SEF_leave","AR_rules"])
s("SC-08","サインイン状態の変化を購読して、端末の利用者識別を記録する","アプリの起動(購読の開始)。以降、サインイン状態が変わる","端末(localStorage)の利用者IDが書き換わる","アプリ、認証サービス、端末の保存","別の利用者へ替わったとき、サインアウト、書き込み失敗",
 ["@AUTH-07","SA_sub","ACH_ident","@AUTH-10"])
s("SC-09","紹介画面を開いて、開始ボタンの行き先を決める","利用者が/を開く","開始ボタンが、判定中・未認証は/signup、認証済み・不明は/roundsへのリンクになる","画面、手続き、認証サービス","判定の失敗(不明)、判定中に押す",
 ["@NAV-01","SA_read","AR_rules","@ENT-01","@AUTH-11~auth-header","@UI-01~ui/button.tsx","@UI-02~app-logo","@UI-02~logo-image"] if False else ["@NAV-01","SA_read","AR_rules","@ENT-01"]+UI("ui/button.tsx")+U2("app-logo","logo-image"))
s("SC-10","レフトパネルを開閉する","利用者が開く・閉じるを操作する、または画面の向き・幅が変わる","パネルの開閉状態が変わり、操作の直後だけtransitionが動く","画面","未操作のまま表示が変わる、回転の直後",
 ["@NAV-02"]+U2("logo-image","globals.css","lib/utils"))
# ===================== 起動・常駐 =====================
s("SC-11","アプリが起動して、常駐処理が始まる","ブラウザがアプリのページを読み込む","入力・記録・窓口・同期・オフラインの部品が作られ、端末識別・同期の契機・SW更新が始まり、各画面へ窓口が渡る","アプリ(起動の入口)、画面のパッケージ、端末の保存、同期","事前描画での生成(実行環境の名前に触れない)",
 ["APP_in","APP_rec","APP_stores","APP_sync","APP_off","APP_order","APP_start","APP_render","@APP-01~rounds-context","@APP-01~layout.tsx","@LIB-01"],{"@LIB-01":"時計、通信状態、遷移を生成して他の部品へ渡す(生成のみ)"})
s("SC-12","アプリのアンマウントで、常駐処理が止まる","アプリがアンマウントされる(購読の解除)","購読と状態が片付く(同期の停止、SW更新の停止、識別の購読の解除)","アプリ、同期、記録、SW更新","停止をまたぐ古い処理が新しい状態を変えない",
 ["APP_start","RS_start","@SYNC-01~sync-triggers","UA_click","@AUTH-07~local-identity"],{})
# ===================== PWA =====================
s("SC-13","アプリをインストールする(Manifest)","ブラウザがManifestを取得する","start_urlとアイコンを持つManifestが返る","ブラウザ、アプリ(サーバー)","",["@PWA-02~manifest.ts","@ENT-01"])
s("SC-14","Service Workerを登録し、枠と静的資産をプリキャッシュする","初回アクセスで、SerwistProviderがSWを登録する","/offlineと枠3件と静的資産がプリキャッシュされ、リダイレクト応答の枠ではインストールが失敗する","画面(layout)、Service Worker、ビルド成果物","本番ビルド以外では無効、枠のHTMLが無いとビルド失敗、リダイレクト応答",
 ["SW_conf","@PWA-01~shell-guard","@PWA-02~serwist.config.mjs","@APP-01~layout.tsx","@PWA-01~offline-routes","@ENT-01"])
s("SC-15","枠のナビゲーションを返す(オフラインを含む)","ブラウザが/rounds、/rounds/new、/rounds/<ID>、その他のパスをナビゲートする","枠はプリキャッシュから返り、枠が無い/未格納の失敗時は/offlineが返る","ブラウザ、Service Worker、Next.js(rewrite)、画面","枠が未格納、枠のないパス、オフライン",
 ["RCH_frame","@PWA-01~precached-frame","SW_fallback","NC_frame","@PWA-01~offline-routes","@PWA-03","@ENT-01","@DET-01~[id]/page.tsx"]+U2("app-logo"))
s("SC-16","静的資産をキャッシュし、それ以外を素通しする","ブラウザがフォント、画像、JS、CSS、その他の同一オリジン、クロスオリジンを要求する","静的資産はキャッシュ、同一オリジンの残りはネットワーク、クロスオリジンはSWを経由しない","ブラウザ、Service Worker","クロスオリジン(Turnstile)",["RCH_assets"])
s("SC-17","新しい版へ切り替えてから遷移する","利用者が内部リンクを押す(購読はアプリ起動時に始まる)","待機中の版があれば、保存の完了を待ち、有効化してから遷移し、新しいビルドの枠が出る","ブラウザ(リンク)、SW更新の手続き、Service Worker、端末の記録(保存待ち)","保存が終わらない、制御の切り替えが進まない、期限(1秒)、リンク以外の経路",
 ["UA_click","UA_hold","@PWA-04~browser-link-clicks","@PWA-04~browser-service-worker","HUB_append","@LIB-01~clock"],{"HUB_append":"whenPersisted(保存中の操作が全て終わるまで待つ)","@LIB-01~clock":"切り替えの期限(1秒)を時計で共有"})
s("SC-18","経路が変わったあとに更新を確認する","画面の経路(usePathname)が変わる","待機が無い遷移では登録の更新を確認し、通した遷移では確認しない","画面、SW更新の手続き、Service Worker","登録の保持前、更新の失敗",["UA_path","UA_hold","@PWA-04~sw-update-activator","@PWA-04~browser-service-worker"])
s("SC-19","開発時にローカルSupabaseを同一オリジンで経由する","ローカルSupabaseで動かす","SupabaseのURLが同一オリジンの/supabase-apiに差し替わり、実アドレスへrewriteされる","Next.jsの設定","本番・Previewでは無効",["NC_local"])
# ===================== 閲覧 =====================
LISTDB=["DBr_decl","DB_auth","@LIB-02"]
s("SC-20","ラウンド一覧を開く","利用者が/roundsを開く","サーバーの一覧と端末の入力中ラウンドが、削除の印を反映して一覧に出る","画面、窓口、取得、端末の記録、同期、DB","オフライン、取得の失敗、時間切れ(10秒)、未認証、空の一覧、削除の印、保存の失敗",
 ["@RND-01","RLS_list","@FET-05","@FET-01","@FET-02","REQ_list","RS_list","BR_all","RF_details","RQ_details","HUB_commit","RR_commit","@REC-03~round-base","IDB_commit","HUB_list","@REF-02~round-base-refreshing","@REF-01~list-requests","@APPLY-01","@ENT-01","@LIB-01~clock","@LIB-01~connectivity"]+LISTDB+U2("skeleton","use-hydrated")+UI("confirm-dialog","dropdown-menu"),
 {"@FET-01":"認証つき取得(切断と競わせ、認証拒否で1回取り直し、10秒の打ち切り)。一覧の取得の1場面","HUB_commit":"取得したベースの反映(別の利用者の取得、古い取得を捨てる)","@APPLY-01":"端末の列から削除の印を導く"})
s("SC-21","端末の入力中ラウンドを一覧の先頭に出す","利用者が一覧を開く(端末の記録を読む)","端末が知る入力中のラウンドが、サーバーの一覧より先に表示される","画面、窓口、端末の記録","保存の読み込み失敗(メモリから作る)、別の利用者の行、削除済み",
 ["@RND-02","HUB_list","RR_derive","@APPLY-01","@APPLY-02","@APPLY-03","@APPLY-04","@DET-02~round-tables","@DET-02~round-view","@REC-03~round-retention","SC_rules","IDB_read","@UI-02~use-hydrated"])
s("SC-22","新規作成画面を開く","利用者が/rounds/newを開く","プリセット(個人と公式)が一覧に出る。取得できないときは保存済みを出す","画面、窓口、取得、端末の保存、DB","オフライン、取得の失敗、時間切れ(1秒で保存済みに切り替え)、保存済みが無い、未認証",
 ["@RND-03","RF_ref","RF_preset","RQ_preset","RQ_common","RF_types","@FET-03~preset.ts","@FET-03~reference-snapshot","@FET-03~reference-snapshots","@FET-03~reference-query-constants","@FET-01","@FET-02","@SETUP-01~round-constants","@SETUP-01~option-label","@SETUP-03~target-face-info","@LIB-02","DB_pr_decl","@ENT-01"]+U2("skeleton","use-hydrated","use-mounted-ref")+UI("dropdown-menu"),
 {"@FET-03~reference-snapshot":"取得できたら利用者ごとのキーで保存、できないときは保存済みを読む"})
s("SC-23","サーバーのベースでラウンド詳細を開く","利用者が/rounds/<ID>を開く","サーバーのベースと端末の操作を重ねたスコアカードが表示される","画面、窓口、依頼の記録、同期、取得、端末の記録、DB","取得の失敗、見つからない、offline、時間切れ、削除済み",
 ["@DET-01","@REF-01~open-requests","REQ_open","RS_open","RC_need","BR_one","RF_detail","RQ_detail","RQ_common","RF_types","@FET-01","@FET-02","HUB_commit","RR_commit","@REC-03~round-base","IDB_commit","HUB_read1","HUB_adopt","RR_adopt","@ENT-01","@LIB-01~clock","@LIB-01~connectivity","DBr_decl","DB_auth","@LIB-02","@FET-03~target-face.ts"]+U2("skeleton"),
 {"@FET-01":"1ラウンドの取得(認証つき取得の1場面)","HUB_commit":"取得したベースの反映"})
s("SC-24","端末のベースでラウンド詳細を開く","利用者が、端末に操作やベースがあるラウンドの詳細を開く(取得が1秒以内に終わらない、またはオフライン)","端末のベースと操作の列からスコアカードが表示される(的の保存分があるとき)","画面、窓口、端末の記録","ベースか的の保存が無い、取得がnot-found、オフライン",
 ["@DET-01~round-detail-store","@DET-01~round-opening","@DET-01~round-detail-client","@DET-01~round-detail-frame","HUB_read1","HUB_adopt","RR_adopt","RF_tf","@FET-03~reference-snapshot","@FET-03~reference-snapshots","@FET-03~target-face.ts","@FET-01","@LIB-01~clock"]+U2("skeleton"))
s("SC-25","作成が未確定のラウンド詳細を開く","ラウンドの開始直後に詳細へ遷移する(作成の操作がまだ送信・確定されていない)","作成操作から作った表と、取得した的でスコアカードが表示される","画面、窓口、端末の記録、取得","的の取得の失敗、作成が失われた(別の画面へ)",
 ["@DET-01~round-detail-store","@DET-01~round-opening","@DET-02~round-tables","HUB_read1","HUB_adopt","RF_tf","RQ_tf","@FET-03~target-face.ts","@FET-01","@LIB-02"]+U2("skeleton"))
s("SC-26","端末のベースで開いたままの詳細を取り直す","端末のベースで開いた詳細が、取得に成功していない間(時計と、通信復帰・可視化)","取得に成功すればサーバーのベースに置き換わり、失敗なら待ち時間を伸ばして繰り返す","同期、取り直しの制御、取得、端末の記録","オフライン、取得の失敗、ラウンドが削除された、詳細を閉じた",
 ["RS_refetch","RS_eval","@SYNC-03~stale-clock","@SYNC-03~stale-retry","@SYNC-02~flight-gate","@REF-03","BR_one","RF_detail","RQ_detail","@FET-01","HUB_commit","RR_commit","IDB_commit","REQ_watch","@LIB-01~clock","@LIB-01~connectivity","ST_dec"])
s("SC-27","記録が変わって、詳細のスコアカードが更新される","端末の記録の変化、または取得結果の変化(購読の発火)","表と画面の状態が導かれ、スコアカード(エンド行、小計、合計)が描き直される","端末の記録、窓口、画面","削除された、作成が失われた、重ねられなかった操作",
 ["RH_main","@DET-02~round-view","@DET-02~round-tables","RR_derive","@APPLY-01","@APPLY-02","@APPLY-03","@APPLY-04","SC_rules","SC_sum","@SCORE-04~ring-color","@SCORE-04~color-tone","@SCORE-04~scorecard-types","@SCORE-05","@SCORE-06","REQ_watch","@ENT-01"]+U2("use-hydrated"),
 {"@APPLY-01":"ベースに操作を重ねて表を導く(詳細、一覧、取り直しの判定から呼ばれる)"})
s("SC-28","詳細の購読を解除する(アンマウント)","詳細画面がアンマウントされる","購読と監視の印が外れ、閉じた詳細の状態が消える","画面、窓口、依頼の記録","複数の購読者が残る間は解除しない",["RH_release","REQ_watch"])
s("SC-29","作成が失われた詳細から離れる","作成が未確定の詳細で、作成が失われたと分かる","一覧へ置き換えて離れる","画面、窓口","",["@DET-01~use-creation-gone","RH_main","@DET-02~round-view","RL_leave","@LIB-01~page-navigation","@ENT-01"])
s("SC-30","詳細から一覧へ戻る","利用者が「一覧へ戻る」を押す","一覧へ置き換えて戻る","画面、手続き","",["@DET-03","RL_leave","@LIB-01~page-navigation","@ENT-01"])
# ===================== 操作 =====================
SENDING=SEND_COMMON+["TR_common"]
s("SC-31","ラウンドを始める","利用者が作成画面でプリセットを選び、開始を押す","作成操作が端末に保存され、詳細へ進み、送信されてラウンドと距離がDBにできる","画面、手続き、端末の記録、送信、DB","未認証、認証の確認が時間切れ、遷移の失敗、送信の失敗(SC-48)",
 ["@RND-05","RPS_start","@RND-03~new-round-store"]+APPEND+SENDING+["TR_round","DB_createround","DB_updist" if False else "DB_auth","DB_distguard","DBr_decl","@FET-01~sign-in-reader","@LIB-01~page-navigation","@LIB-01~clock","@LIB-02"],
 {"@OPS-01":"round.created(作成イベントID、ラウンドID、距離群)","@ID-01":"イベントID、ラウンドID、距離IDを払い出す","HUB_apply":"確定の反映(版、効いた項目)"})
s("SC-32","ラウンドの設定を変更する","利用者が名前・日付・形式・弓種を編集する","更新操作が追記・保存され、画面に反映され、送信されてDBが更新される","画面、手続き、端末の記録、送信、DB","検証エラー、完了済みの編集(入力中へ戻る=SC-40)、項目の拒否、競合",
 ["@SETUP-01","@COMP-02","RP_reopen"]+APPEND+SENDING+["TR_round","DB_upround","DB_auth","DBr_decl","@LIB-02"]+UI("ui/button.tsx","ui/dialog.tsx","ui/input.tsx"),
 {"@OPS-01":"round.updated(変更の組)","HUB_apply":"効かなかった項目の反映(diverged)"})
s("SC-33","距離を追加する","利用者が「距離を追加」して項目を入力し保存する","距離の作成操作が追記・保存され、送信されて距離がDBにできる","画面、手続き、端末の記録、送信、DB","検証エラー(1以上の整数)、位置キー、上限、送信の拒否",
 ["@SETUP-02~use-distance-draft","@SETUP-02~distance-config","@SETUP-02~use-distance-editing","DO_add","@SETUP-02~position-key","@SETUP-04","@SETUP-03","@COMP-02"]+APPEND+SENDING+["TR_dist","DB_createdist","DB_distguard","DB_auth","DBr_decl","@LIB-02","@FET-03~target-face.ts"]+UI("ui/button.tsx","ui/dialog.tsx","ui/input.tsx","confirm-dialog"),
 {"@SETUP-03":"的の選択(絞り込み、選択、図の表示)","DB_distguard":"距離数の上限(トリガー)"})
s("SC-34","距離を変更する","利用者が距離の項目を編集して保存する","距離の更新操作が追記・保存され、送信されて距離が更新される","画面、手続き、端末の記録、送信、DB","矢が記録済みの項目はロック、構成を変える変更、検証エラー、収まらない矢",
 ["@SETUP-02~use-distance-draft","@SETUP-02~distance-config","@SETUP-02~use-distance-editing","DO_upd","@SETUP-04","@SETUP-03","@COMP-02","RP_reopen"]+APPEND+SENDING+["TR_dist","DB_updist","DB_shotfit","DB_auth","DBr_decl","@LIB-02"]+UI("ui/button.tsx","ui/dialog.tsx","ui/input.tsx"),
 {"DB_shotfit":"変更後の構成に既存の矢が収まるかの判定"})
s("SC-35","距離を削除する","利用者が距離を削除して確認する","距離の無効化操作が追記・保存され、その距離の履歴が捨てられ、送信されてDBで論理削除される","画面、手続き、端末の記録、送信、DB","確認の取り消し、送信の拒否",
 ["@SETUP-04","@SETUP-02~use-distance-editing","DO_dis","SH_keep","@COMP-02"]+APPEND+SENDING+["TR_dist","DB_disdist","DB_auth","DBr_decl","@LIB-02"]+UI("confirm-dialog","ui/button.tsx"))
s("SC-36","点数を入力する","利用者がテンキーで点数を押す","矢の記録が追記・保存され、指す矢が進み、スコアカードが更新され、送信されて矢がDBに記録される","画面、手続き、端末の記録、送信、DB","エンドが満杯、射番号の衝突、収まらない矢、送信の拒否、未保存の矢の表示",
 ["USI_score","SO_score","SP_adv","SP_rec","SO_pending","@SCORE-01~use-reconciled-pointer","@SCORE-01~use-pending-shots","SH_keep","@SCORE-03~use-score-history","@SCORE-03~use-round-op-stack","@COMP-02","RP_reopen","SC_rules","SC_keys","@SCORE-04~scorecard-types"]+APPEND+SENDING+["TR_shots","DB_record","DB_shotfit","DB_auth","DBr_decl","@LIB-02","@ID-01"],
 {"SC_rules":"エンドの空きと矢が距離に収まるか(endHasRoom、shotFitsDistance)","DB_shotfit":"矢が的とエンドに収まるかの判定"})
s("SC-37","矢を消去する","利用者が指した矢の点数を消す","消去の操作が追記・保存され、スコアカードが更新され、送信されてDBで取り消される","画面、手続き、端末の記録、送信、DB","消す矢が無い、送信の拒否",
 ["USI_clear","SO_clear","@SCORE-02","SH_keep","@COMP-02"]+APPEND+SENDING+["TR_shots","DB_clear","DB_auth","DBr_decl","@LIB-02"])
s("SC-38","入力を取り消す・やり直す","利用者が取り消し(やり直し)を押す","履歴から1件戻して(進めて)操作が再生され、追記・送信されDBへ反映される","画面、手続き、端末の記録、送信、DB","履歴が無い、距離が削除された、再生した操作が効かない",
 ["USI_replay","SO_replay","SH_nav","SH_keep","@SCORE-03","@COMP-02"]+APPEND+SENDING+["TR_shots","DB_record","DB_clear","DB_auth","DBr_decl","@LIB-02"])
s("SC-39","入力を完了する","利用者が「入力を完了する」を押して確認する","完了操作が追記・保存され、一覧へ進み、送信されてラウンドの状態が完了になる","画面、手続き、端末の記録、送信、DB","確認の取り消し、遷移の失敗(拒否として伝える)",
 ["@COMP-01","RL_complete","RP_status"]+APPEND+SENDING+["TR_round","DB_upround","DB_auth","DBr_decl","@LIB-02","@LIB-01~page-navigation","@ENT-01"]+UI("confirm-dialog","ui/button.tsx"))
s("SC-40","完了済みのラウンドを編集して入力中に戻る","利用者が完了済みのラウンドの点数や設定を編集する","編集の操作と、入力中へ戻す操作が追記・保存され、送信されてDBへ反映される","画面、手続き、端末の記録、送信、DB","戻す操作が不要な編集、判定は追記前の状態で行う",
 ["@COMP-02","RP_reopen","RP_status"]+APPEND+SENDING+["TR_round","DB_upround","DB_auth","DBr_decl","@LIB-02"])
s("SC-41","ラウンドを一覧から削除する","利用者が一覧のメニューから削除を選び確認する","削除操作が追記・保存され、一覧に残ったまま削除の印が付き、送信されてDBで論理削除される","画面、手続き、端末の記録、送信、DB","確認の取り消し、保存の失敗、削除の確定前後の一覧",
 ["@DEL-01","RP_disable","RLS_list","RLi_list","@RND-01~rounds-list-view","@RND-01~rounds-list.tsx"]+APPEND+SENDING+["TR_round","DB_disround","DB_auth","DBr_decl","@LIB-02"]+UI("confirm-dialog","dropdown-menu"))
s("SC-42","ラウンドを詳細から削除して離れる","利用者が詳細のメニューから削除を選び確認する","削除操作が追記・保存され、一覧へ置き換えて移り、送信されてDBで論理削除される","画面、手続き、端末の記録、送信、DB","確認の取り消し、遷移の失敗",
 ["@DEL-02","RL_delete","@DEL-01","RP_disable"]+APPEND+SENDING+["TR_round","DB_disround","DB_auth","DBr_decl","@LIB-02","@LIB-01~page-navigation","@ENT-01"]+UI("confirm-dialog","dropdown-menu"))
s("SC-43","現在の構成をプリセットとして保存する","利用者が詳細のヘッダーから「プリセットに保存」して名前を入力する","個人プリセットがDBにでき、保存済みの一覧が最新になる","画面、手続き、認証の読み取り、DB、取得","未認証、保存の失敗(届かない・拒否)、名前の既定値",
 ["@RND-06","PCm_save","WR_save","DB_pr_save","DB_pr_decl","@FET-01~sign-in-reader","@FET-01~auth-sign-in-reader","RF_preset","RQ_preset","@FET-03~preset.ts","@FET-03~reference-snapshot","@FET-03~reference-snapshots","@LIB-02"]+UI("ui/dialog.tsx","ui/button.tsx","ui/input.tsx"),
 {"@FET-03~preset.ts":"保存後にプリセットを再取得して並べる"})
s("SC-44","個人プリセットを削除する","利用者が作成画面で個人プリセットの削除を選び確認する","個人プリセットがDBから消え、保存済みの一覧からも消える","画面、手続き、認証の読み取り、DB","未認証、削除の失敗、RLSで消せない行",
 ["@RND-04","PCm_del","WR_del","DB_pr_decl","@FET-01~sign-in-reader","@FET-03~reference-snapshot","@FET-03~preset.ts","@LIB-02"]+UI("confirm-dialog"))
s("SC-45","テンキーを開いて、指す矢まで追従する","利用者がテンキーを開く、または画面の向き・矢の位置が変わる","テンキーが出て、指す矢が隠れないようスクロールされる","画面","向き(横・縦)、高さの測り直し、キー入力中",
 ["KP_state","KP_scroll","@SCORE-07","SC_keys","SC_rules"])
s("SC-46","的を選ぶ","利用者が距離の的の欄を開く","形式と弓種で絞り込まれた的の一覧から的が選ばれ、図が表示される","画面","絞り込みで0件、選択済みの的が一覧に無い",
 ["@SETUP-03","@FET-03~target-face.ts","@SETUP-01~round-constants","@SETUP-01~option-label"]+UI("ui/dialog.tsx","ui/button.tsx"))
# ===================== 送信・記録 =====================
s("SC-47","端末に記録された操作が送信され、確定する","記録の変化(または起動・通信復帰)で、未送信の操作がある","要求がRPCで送られ、判定結果が記録に確定として書かれ、端末の保存にも書かれる","送信、DB(RPC)、端末の記録","効かなかった操作(外す)、diverged(取り直しの印)",
 SEND_COMMON+["TR_common","TR_round","TR_dist","TR_shots","HUB_notify","@LIB-02","@FET-01~sign-in-reader","@FET-01~auth-sign-in-reader","@LIB-01~clock","@LIB-01~connectivity","DB_createround","DB_upround","DB_disround","DB_createdist","DB_updist","DB_disdist","DB_record","DB_clear","DB_auth","DB_shotfit","DB_distguard"])
s("SC-48","送信が失敗したとき、再試行・破棄・保留する","送信が失敗する(通信、認証の拒否、契約違反、未認証)","再試行は待ってから再送、破棄は記録と保存先から外し、未認証は保留する","送信、端末の記録","試行番号による待ち時間、上限、PT403・PT422の破棄、保存先の退避の失敗",
 ["OS_run","SQ_run","@SEND-07","HUB_discard","RR_retire","IDB_retire","HUB_inflight","RR_inflight","@LIB-01~clock"])
s("SC-49","通信復帰の購読で、再送する","送信器の起動時に購読を始める。以降、オンラインへ戻る","再試行待ちの要求が、試行番号を消費せずに再送される","送信、通信状態","オフラインの間は送らない",["OS_online","SQ_online","OS_life","@LIB-01~connectivity"])
s("SC-50","記録の変化の購読で、送信を始める","送信器の起動時に購読を始める。以降、記録が変わる","変わった列の送信の計画が呼ばれる","送信、端末の記録","",["OS_hub","HUB_notify"])
s("SC-51","記録が起動して端末から読み込まれ、保存済みの操作が送られる","アプリ起動(記録と送信の起動)","端末から全列が読まれて取り込まれ、読み込み後に保存済みの操作の送信が始まる","アプリ、端末の記録、送信","読み込みの失敗(何もしない)、読み込みの間に利用者が替わる、起動の2回目",
 ["@LOG-01~contract/op-log-store","HUB_life","HUB_reload","HUB_notify","RR_base","IDB_conn","IDB_read","OS_loaded","OS_life","@SYNC-04~round-record-control","@LIB-01~connectivity"])
s("SC-52","利用者が切り替わったとき、記録を捨てて読み直す","サインイン状態が変わる(別の利用者、サインアウト)","送信状態が捨てられ、記録の利用者が替わり、端末から読み直される","同期、認証、端末の記録、送信","同じ利用者なら保留の再開、別の利用者・利用者なし",
 ["@SYNC-04","HUB_life","HUB_reload","OS_life","@SYNC-01~sync-triggers","RS_auth","ST_auth"])
s("SC-53","サインインし直して、保留した送信を再開する","保留があるときに、同じ利用者がサインインし直す","保留が戻り、新しい要求として0から数えて送られる","同期、送信","保留が無い",["OS_resume","SQ_resume","@SYNC-04~round-record-control","@SYNC-04~record-user"])
# ===================== 同期 =====================
s("SC-54","同期が始まり、契機の購読を登録する","アプリ起動(同期の開始)","記録の制御が始まり、取り直しの要否を購読し、認証・通信・可視化の購読が登録される","同期、記録の制御、取り直しの制御","2回目の開始は何もしない",["RS_start","@SYNC-01~sync-triggers","@SYNC-04~round-record-control","RC_sub","@SYNC-01~browser-visibility"])
s("SC-55","認証の購読で、記録を追従させ常駐取得を頼む","サインイン状態の変化(購読の発火)","記録の利用者の切り替え・保留の再開が行われ、必要なら常駐の取得が頼まれる","同期、記録の制御、認証","無視する変化、同じ利用者",["RS_auth","ST_auth","@SYNC-04","@SYNC-01~sync-triggers"])
s("SC-56","通信復帰の購読で、常駐取得とstale再開をする","オンラインへ戻る(購読の発火)","常駐の取得が頼まれ、端末ベースの取り直しが数え直して始まる","同期、取り直しの制御","",["RS_online","RS_resident","@SYNC-02","@SYNC-01~sync-triggers","@LIB-01~connectivity","@SYNC-03~stale-clock"])
s("SC-57","通信切断の購読で、stale時計を止める","オフラインへ変わる(購読の発火)","端末ベースの再試行の時計が止まる","同期","",["RS_offline","@SYNC-03~stale-clock","@SYNC-01~sync-triggers","@LIB-01~connectivity"])
s("SC-58","画面可視化の購読で、常駐取得とstale再開をする","画面が見える状態になる(購読の発火)","常駐の取得が頼まれ、端末ベースの取り直しが数え直して始まる","同期、ブラウザ","",["RS_vis","@SYNC-01~browser-visibility","@SYNC-01~sync-triggers","RS_online"])
s("SC-59","常駐の一括取り直し","同期の契機(認証、通信復帰、可視化)","入力中と保持するラウンドが一括取得され、端末の記録へ反映される。成功回数が増える","同期、取り直しの制御、取得、端末の記録、DB","未認証・別の利用者(取得しない)、実行中の契機(完了後に1回)、取得の失敗",
 ["RS_resident","@SYNC-02","ST_dec","RC_need","BR_all","RF_details","RQ_details","RQ_common","@FET-01","HUB_readall","HUB_commit","RR_commit","@REC-03~round-base","@REC-03~round-retention","IDB_commit","@LIB-02","DBr_decl","DB_auth","RS_notify","@SYNC-01~round-base-refresher","@LIB-01~clock"],
 {"@FET-01":"一括取得(認証つき取得の1場面)"})
s("SC-60","取り直しが要るかを評価して開始する","依頼や記録が変わる(要否の購読の発火)","理由(開く・stale・効かなかった・重ねられなかった)ごとに、取り直しや時計が始まる","同期、依頼の記録、取り直しの制御、端末の記録","オフライン、同じ理由の繰り返し、diverged(通知ごと)",
 ["RS_eval","RS_refetch","RC_need","RC_sub","REQ_watch","@REF-01~open-requests","HUB_diverged","ST_dec","@SYNC-03~stale-clock"])
# ===================== DB =====================
s("SC-61","マイグレーションがDBを構築する","supabase db reset / pushでマイグレーションを適用する","テーブル、制約、RLS、トリガー、関数、公式の的とプリセットが作られる","DB","",["U_decl","U_updated","DB_tf_decl","DB_tf_data","DBr_decl","DB_auth","DB_pr_decl","@DB-17"])
s("SC-62","開発者が確認用ユーザーを投入する","ローカル・Previewの初期化(seed)","確認済みのテスト利用者ができる","DB(開発環境)","既にある場合は何もしない",["@DB-16"])
