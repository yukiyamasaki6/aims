import json
actors = [
 {"id":"screen","label":"画面(サインアウトのボタンと確認ダイアログ)"},
 {"id":"proc","label":"サインアウトの手続き(規則を含む)"},
 {"id":"auth","label":"認証サービスの窓口(auth-jsと端末のセッション)"},
 {"id":"svc","label":"認証サービス(サーバー)"},
 {"id":"nav","label":"遷移(ページ全体の読み込み)"},
]
S=[]; F=[]
def st(i,a,t,l): S.append({"id":i,"actor":a,"type":t,"label":l})
def fl(a,b,l=None):
    d={"from":a,"to":b}
    if l: d["label"]=l
    F.append(d)

st("start","screen","start","利用者がレフトパネル下端の「サインアウト」を押す")
st("s_open","screen","action","確認ダイアログを開く(まだ実行しない)")
st("d_choice","screen","decision","利用者の操作は")
st("d_closing","screen","decision","実行中か(閉じる操作の可否)")
st("e_noclose","screen","end","閉じない。ダイアログは開いたまま")
st("s_close","screen","action","ダイアログを閉じ、表示中の失敗を消す")
st("e_cancel","screen","end","何も変わらない(取り消し)")
st("s_confirm","screen","action","実行中の表示にし、失敗を消して、手続きにサインアウトを頼む(画面が表示中かを答える関数を渡す)")
st("p_begin","proc","decision","手続きの状態は実行中か(開始の命令)")
st("p_busy","proc","action","実行中の結果(busy)を返す。状態は変えない")
st("e_busy","screen","end","画面は何も変えない(最初の呼び出しの結果が実行中の表示を解く)")
st("p_start","proc","action","実行中の状態にして、この端末のサインアウトを頼む")
st("a_call","auth","action","接続を取得し、signOut(scope: local)を呼ぶ")
st("d_thrown","auth","decision","呼び出しは投げたか(接続を得られないなど)")
st("a_thrown","auth","action","「届かなかった」の結果にする")
st("d_load","auth","decision","保存先のセッションを読めたか(期限切れなら更新を試みる)")
st("a_keep","auth","action","保存先を消さずにエラーを返す(更新が通信失敗のとき)")
st("d_tok","auth","decision","アクセストークンはあるか")
st("v_logout","svc","action","この端末のセッションを無効にする(/logout?scope=local)")
st("d_resp","svc","decision","応答は")
st("a_mem","auth","action","サービスのエラーを覚える(401・403・404以外のエラーでも、保存先は消す)")
st("a_rm","auth","action","保存先のセッションを消し、SIGNED_OUTを購読者へ通知する(通知の完了まで待つ)。通知先の更新(識別=SC-08、記録=SC-55、見張り=SC-06)はこの図の外")
st("p_watch","proc","action","見張りがSIGNED_OUTを受けるが、実行中のため遷移しない(SC-06)")
st("d_after","auth","decision","消す前にサービスのエラーを受けていたか")
st("a_ok","auth","action","「受け付けられた」の結果にする")
st("a_map","auth","action","エラーを失敗の種類に写し「拒否」の結果にする(通信断はunreachable、リクエスト過多はrate_limited、それ以外はother)")
st("p_fold","proc","action","結果を失敗の有無にまとめる(受け付け=なし、拒否=その失敗、届かなかった=通信エラー)")
st("d_mount1","proc","decision","画面はまだ表示中か(読み取りの前)")
st("a_read","auth","action","サインインの状態を読む(保存先のセッション無し=未認証、有効=認証済み、更新が通信失敗=不明。投げない)")
st("d_mount2","proc","decision","画面はまだ表示中か(読み取りの後)")
st("p_discard","proc","action","実行中を解き、結果を破棄する(discarded)。サインアウトの依頼は取り消さない")
st("s_discard","screen","action","画面は状態を更新しない")
st("e_discard","screen","end","遷移しない。端末のセッションは既に消えている")
st("d_status","proc","decision","呼び出しの後に、この端末は未認証と確かめられたか")
st("p_done","proc","action","実行中を解き、完了を返す(呼び出しが失敗を返していても、失敗は示さない)")
st("d_left","proc","decision","サインインへの遷移をすでに始めているか")
st("p_go","proc","action","遷移済みにして、遷移先を求める(遷移元なしの/signin)")
st("n_replace","nav","action","/signinへページ全体を読み込んで置き換える(履歴に残さない)")
st("d_navthrow","proc","decision","遷移の呼び出しは投げたか")
st("p_swallow","proc","action","扱わない。完了を返す")
st("s_ok","screen","action","完了を受けて、実行中を解き、ダイアログを閉じる")
st("e_ok","screen","end","/signinが開く(遷移元なし。前の画面の状態は捨てられる)")
st("p_fail","proc","action","実行中を解き、失敗を返す(理由は呼び出しの失敗、無ければ通信エラー)")
st("s_err","screen","action","実行中を解き、失敗の種類を文言にして、ダイアログ内に表示する。ダイアログは開いたまま")

fl("start","s_open"); fl("s_open","d_choice")
fl("d_choice","d_closing","キャンセル・Esc・背景")
fl("d_closing","e_noclose","はい"); fl("d_closing","s_close","いいえ"); fl("s_close","e_cancel")
fl("d_choice","s_confirm","「サインアウトする」")
fl("s_confirm","p_begin")
fl("p_begin","p_busy","はい"); fl("p_busy","e_busy")
fl("p_begin","p_start","いいえ")
fl("p_start","a_call"); fl("a_call","d_thrown")
fl("d_thrown","a_thrown","はい"); fl("d_thrown","d_load","いいえ")
fl("d_load","a_keep","読めない"); fl("d_load","d_tok","読めた(セッション無しを含む)")
fl("d_tok","v_logout","ある"); fl("d_tok","a_rm","無い")
fl("v_logout","d_resp")
fl("d_resp","a_rm","成功・401・403・404")
fl("d_resp","a_mem","通信失敗・その他のエラー"); fl("a_mem","a_rm")
fl("a_rm","p_watch"); fl("p_watch","d_after")
fl("d_after","a_ok","いいえ"); fl("d_after","a_map","はい")
fl("a_keep","a_map"); fl("a_thrown","p_fold"); fl("a_ok","p_fold"); fl("a_map","p_fold")
fl("p_fold","d_mount1")
fl("d_mount1","a_read","はい"); fl("d_mount1","p_discard","いいえ(読まない)")
fl("a_read","d_mount2")
fl("d_mount2","d_status","はい"); fl("d_mount2","p_discard","いいえ")
fl("p_discard","s_discard"); fl("s_discard","e_discard")
fl("d_status","p_done","はい(未認証)"); fl("d_status","p_fail","いいえ(認証済み・不明)")
fl("p_done","d_left")
fl("d_left","p_go","いいえ"); fl("d_left","s_ok","はい(移らない)")
fl("p_go","n_replace"); fl("n_replace","d_navthrow")
fl("d_navthrow","p_swallow","はい"); fl("d_navthrow","s_ok","いいえ"); fl("p_swallow","s_ok")
fl("s_ok","e_ok")
fl("p_fail","s_err"); fl("s_err","d_choice","利用者が再操作")
json.dump({"title":"SC-04 サインアウトする","actors":actors,"steps":S,"flows":F},open("/home/user/aims/.agent-handoffs/diagrams/検査-SC-04/SC-04.json","w"),ensure_ascii=False,indent=1)
ids={s["id"] for s in S}
for f in F: assert f["from"] in ids and f["to"] in ids,f
out={f["from"] for f in F}; inn={f["to"] for f in F}
for s in S:
    if s["type"]!="end": assert s["id"] in out, s["id"]
    if s["type"]!="start": assert s["id"] in inn, s["id"]
print(len(S),len(F))
