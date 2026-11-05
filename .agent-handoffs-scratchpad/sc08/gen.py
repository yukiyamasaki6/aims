import json
actors=[
 ("ent","入口(root-client-entry.tsx)"),
 ("rec","識別の記録(local-identity.ts)"),
 ("conv","窓口の変換(supabase-auth.tsの購読と変換)"),
 ("auth","認証サービスの窓口(auth-jsと端末のセッション)"),
 ("rule","規則(auth-change.tsのidentityChange)"),
 ("store","識別の保存(browser-identity-store.ts、localStorage)"),
]
S=[]
def s(id,actor,type,label): S.append(dict(id=id,actor=actor,type=type,label=label))
s("start","ent","start","アプリが起動する(ルート入口がマウントされる。(main)と(auth)を含む全ページ)")
s("e_start","ent","action","識別の記録を始める(useEffectでlocalIdentity.start()。解除する関数を保つ)")
s("r_sub","rec","action","認証状態の変化の購読を頼む(changes.subscribe)")
s("c_conn","conv","action","認証サービスの接続を取得する(createClient)")
s("c_env","conv","decision","接続を作れるか(環境変数はあるか)")
s("c_throw","conv","end","起動の不備として同期に投げる(購読は始まらない)")
s("c_reg","conv","action","通知の受け手として登録する(onAuthStateChange。受け取った通知を変換して渡す。解除はsubscription.unsubscribe)")
s("a_init","auth","action","初期化を待ち、保存先のセッションを読んで、この受け手へだけINITIAL_SESSIONを1回通知する(読み取りが失敗したときはセッション無しで通知。受け手ごとに1回)")
s("a_notify","auth","action","認証状態が変わり、全ての受け手へ通知する(サインイン成功やタブが見えた時の復元=SIGNED_IN、更新=TOKEN_REFRESHED、セッション削除=SIGNED_OUT、再設定の確認など。発生元の手続きはSC-01〜04、07)")
s("a_kind","auth","decision","通知のイベント名は")
s("c_in","conv","action","signed-inに写す(利用者=セッションの利用者ID)")
s("c_ini","conv","action","initialに写す(利用者=セッションの利用者ID。セッションが無ければnull)")
s("c_tok","conv","action","token-refreshedに写す(利用者=セッションの利用者ID)")
s("c_out","conv","action","signed-outに写す(利用者はnull)")
s("c_oth","conv","action","otherに写す(利用者はnull。例: PASSWORD_RECOVERY)")
s("c_call","conv","action","変化(種類と利用者)を、記録の手続きの受け手へ渡す(同じ通知を見張り=SC-06、記録の利用者=SC-55も並列に受ける)")
s("r_recv","rec","action","受け取った変化を規則に渡し、記録・消去・何もしないを決めさせる(identityChange)")
s("d_kind","rule","decision","変化の種類は")
s("d_user","rule","decision","利用者がいるか")
s("r_keep","rec","action","何も書かない(識別情報は変わらない。利用者のいないinitialは、通信失敗でも起きるため消さない)")
s("r_rec","rec","action","利用者IDを書くよう頼む(writer.write(利用者ID)。別の利用者へ替わったときも同じ上書き)")
s("r_clr","rec","action","消すよう頼む(writer.write(null))")
s("s_win","store","decision","サーバーでの描画中(windowが無い)か")
s("s_none","store","action","何もしない")
s("s_val","store","decision","渡された値は")
s("s_set","store","action","localStorageのaims:local-user-idに利用者IDを書く(setItem)")
s("s_rm","store","action","localStorageのaims:local-user-idを消す(removeItem)")
s("s_res","store","decision","保存先は使えたか(例外を捕まえる)")
s("s_done","store","action","端末の利用者IDが書き換わる(同じ端末の全タブで共有される)")
s("s_swallow","store","action","黙って無視する(識別情報は変わらない。通知の受け手は投げない)")
s("w_wait","ent","decision","次に起きるのは")
s("end","ent","end","アンマウントで購読を解除する(SC-12)")
F=[]
def f(a,b,l=None):
    d={"from":a,"to":b}
    if l: d["label"]=l
    F.append(d)
f("start","e_start"); f("e_start","r_sub"); f("r_sub","c_conn"); f("c_conn","c_env")
f("c_env","c_reg","作れる"); f("c_env","c_throw","作れない")
f("c_reg","a_init")
f("a_init","a_kind"); f("a_notify","a_kind")
f("a_kind","c_in","SIGNED_IN"); f("a_kind","c_ini","INITIAL_SESSION"); f("a_kind","c_tok","TOKEN_REFRESHED"); f("a_kind","c_out","SIGNED_OUT"); f("a_kind","c_oth","それ以外")
for x in ("c_in","c_ini","c_tok","c_out","c_oth"): f(x,"c_call")
f("c_call","r_recv"); f("r_recv","d_kind")
f("d_kind","r_clr","signed-out"); f("d_kind","d_user","signed-in、またはinitial"); f("d_kind","r_keep","token-refreshed、またはother")
f("d_user","r_rec","いる"); f("d_user","r_keep","いない")
f("r_rec","s_win"); f("r_clr","s_win")
f("s_win","s_none","無い(サーバーでの描画中)"); f("s_win","s_val","ある")
f("s_val","s_set","利用者ID"); f("s_val","s_rm","null")
f("s_set","s_res"); f("s_rm","s_res")
f("s_res","s_done","使えた"); f("s_res","s_swallow","投げた(使えない、容量超過)")
for x in ("r_keep","s_none","s_done","s_swallow"): f(x,"w_wait")
f("w_wait","a_notify","認証状態が変わる(通知が届く)"); f("w_wait","end","画面が離れる(アンマウント)")
d={"title":"SC-08 サインイン状態の変化を購読して、端末の利用者識別を記録する(購読の始め方と、通知ごとの記録・消去)","actors":[{"id":a,"label":l} for a,l in actors],"steps":S,"flows":F}
json.dump(d,open("/home/user/aims/.agent-handoffs/diagrams/検査-SC-08/SC-08.json","w"),ensure_ascii=False,indent=1)
