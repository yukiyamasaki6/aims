import json, os
ROOT="/root/worktrees/aims-batch1-simplify/apps/web/src/"
OUT="/root/worktrees/aims-batch1-simplify/.agent-handoffs/diagrams/設計-バッチ1/"
A="app/(auth)/"; F="features/auth/"
L=[("組み立て層","入口。生成と注入"),("UI層","画面の部品"),("アプリケーション層","操作の手続きと約束"),("ドメイン層","業務の規則と状態"),("インフラ層","外部へのアクセスと形の変換")]
FE=[("認証","サインイン・サインアップ・再設定"),("共有の技術","接続・遷移・時計"),("ラウンド","経路の定数だけ使う")]
# path -> (feature, layer, group)
N={
 A+"signin/page.tsx":("認証","組み立て層","サインインの入口"),
 A+"signup/page.tsx":("認証","組み立て層","サインアップの入口"),
 A+"signup/actions.ts":("認証","組み立て層","サインアップの入口"),
 A+"reset-password/page.tsx":("認証","組み立て層","再設定の入口"),
 A+"reset-password/actions.ts":("認証","組み立て層","再設定の入口"),
 F+"ui/signin-form.tsx":("認証","UI層","サインイン画面"),
 F+"ui/password-setup-form.tsx":("認証","UI層","段階式画面"),
 F+"ui/otp-email-step.tsx":("認証","UI層","段階式画面"),
 F+"ui/otp-code-step.tsx":("認証","UI層","段階式画面"),
 F+"application/sign-in.ts":("認証","アプリケーション層","サインインの手続き"),
 F+"application/sign-up.ts":("認証","アプリケーション層","サインアップ・再設定の手続き"),
 F+"application/reset-password.ts":("認証","アプリケーション層","サインアップ・再設定の手続き"),
 F+"application/password-change.ts":("認証","アプリケーション層","サーバーの手続き"),
 F+"application/password-setup.ts":("認証","アプリケーション層","共通の順序"),
 F+"application/call-result.ts":("認証","アプリケーション層","結果の型"),
 F+"application/session.ts":("認証","アプリケーション層","サインアウトの手続き"),
 F+"domain/password-setup-flow.ts":("認証","ドメイン層","パスワード設定の集約"),
 F+"domain/sign-in-flow.ts":("認証","ドメイン層","サインインの集約"),
 F+"domain/auth-routes.ts":("認証","ドメイン層","経路の規則"),
 F+"infrastructure/supabase-auth.ts":("認証","インフラ層","認証サービスの実装"),
 F+"infrastructure/supabase-registration-check.ts":("認証","インフラ層","登録確認"),
 F+"infrastructure/browser-return-to.ts":("認証","インフラ層","遷移元の読み出し"),
 F+"infrastructure/browser-page-load.ts":("認証","インフラ層","ページ全体の読み込み"),
 "app/(main)/layout.tsx":("認証","組み立て層","本体画面の入口"),
 "lib/supabase/infrastructure/client.ts":("共有の技術","インフラ層","ブラウザの接続"),
 "lib/supabase/infrastructure/server.ts":("共有の技術","インフラ層","サーバーの接続"),
 "lib/page-navigation/infrastructure/router-page-navigation.ts":("共有の技術","インフラ層","遷移と時計"),
 "lib/clock/infrastructure/browser-clock.ts":("共有の技術","インフラ層","遷移と時計"),
 "features/rounds/domain/round-routes.ts":("ラウンド","ドメイン層","ラウンドの経路"),
 "proxy.ts":("共有の技術","組み立て層","要求の入口"),
 "lib/supabase/infrastructure/session.ts":("共有の技術","インフラ層","要求ごとのセッション更新"),
}
def build(title, files, refs, calls):
    # files: {path:[fns]}
    groups={}
    for p,fns in files.items():
        fe,ly,gn=N[p]
        g=groups.setdefault((fe,ly,gn),{"name":gn,"feature":fe,"layer":ly,"label":gn+"のまとまり","files":[]})
        g["files"].append({"path":p,"functions":fns,"constants":[]})
    paths=set(files)
    names=paths|{"認証サービス"}
    for a,b,*_ in refs+calls:
        assert a in paths and b in names,(a,b)
    for p in files: assert os.path.exists(ROOT+p),p
    return {"title":title,"layers":[{"name":n,"label":l} for n,l in L],"features":[{"name":n,"label":l} for n,l in FE],
      "groups":list(groups.values()),"externals":["認証サービス"],
      "references":[{"from":a,"to":b} for a,b in refs],
      "calls":[({"from":a,"to":b,"via_injection":True} if (c and c[0]) else {"from":a,"to":b}) for a,b,*c in calls]}
def emit(name,title,b,a):
    for k,v in (("変更前",b),("変更後",a)):
        json.dump(build(title,*v),open(f"{OUT}{name}-{k}.json","w"),ensure_ascii=False,indent=1)
p=lambda s:A+s; f=lambda s:F+s
SB=f("infrastructure/supabase-auth.ts"); SI=f("application/sign-in.ts"); SU=f("application/sign-up.ts"); RP=f("application/reset-password.ts")
PS=f("application/password-setup.ts"); PF=f("domain/password-setup-flow.ts"); CR=f("application/call-result.ts"); SES=f("application/session.ts")
RN="lib/page-navigation/infrastructure/router-page-navigation.ts"; CL="lib/supabase/infrastructure/client.ts"; SV="lib/supabase/infrastructure/server.ts"
BP=f("infrastructure/browser-page-load.ts"); ML="app/(main)/layout.tsx"; AR=f("domain/auth-routes.ts")

# 段階14 再設定サーバーアクション撤去
RPg=p("reset-password/page.tsx"); RAc=p("reset-password/actions.ts"); PC=f("application/password-change.ts")
b=({RPg:["ResetPasswordPage"],RAc:["changePassword"],RP:["createResetPassword"],PC:["createPasswordChange"],PS:["applyPassword"],SB:["createSupabaseAuth"],SV:["createAdminClient","createServerClient"],BP:["createBrowserPageLoad"],CL:["createClient"],ML:["MainLayout"],RN:["createRouterPageNavigation"]},
 [(RPg,RP),(RPg,BP),(RPg,RAc),(RPg,SB),(RPg,CL),(RAc,PC),(RAc,SB),(RAc,SV),(PC,RP),(SB,PC),(BP,RP),(RP,PS),(ML,BP)],
 [(RPg,RP,),(RP,RAc,(True,)),(RP,BP,(True,)),(RP,PS),(RAc,PC),(RAc,SV),(RAc,SB),(PC,SB,(True,)),(SB,CL,(True,)),(SB,"認証サービス"),(ML,BP)])
a=({RPg:["ResetPasswordPage"],RP:["createResetPassword"],PS:["applyPassword"],SB:["createSupabaseAuth"],SV:["createAdminClient"],BP:["createBrowserPageLoad"],CL:["createClient"],ML:["MainLayout"],RN:["createRouterPageNavigation"]},
 [(RPg,RP),(RPg,RN),(RPg,SB),(RPg,CL),(RP,PS),(ML,BP)],
 [(RP,PS),(RP,SB,(True,)),(RP,RN,(True,)),(SB,CL,(True,)),(SB,"認証サービス"),(ML,BP)])
emit("段階14-再設定","再設定のパスワード変更の構造",b,a)

# 段階15 登録確認撤去
SUp=p("signup/page.tsx"); SAc=p("signup/actions.ts"); RC=f("infrastructure/supabase-registration-check.ts")
b=({SUp:["SignUpPage"],SAc:["isEmailRegistered"],SU:["createSignUp"],PS:["deliver","resend"],RC:["createSupabaseRegistrationCheck"],SV:["createAdminClient"],SB:["createSupabaseAuth"],CL:["createClient"],RN:["createRouterPageNavigation"]},
 [(SUp,SU),(SUp,SAc),(SUp,SB),(SAc,RC),(SAc,SV),(SU,PS),(SUp,RN),(SUp,CL)],
 [(SU,SAc,(True,)),(SAc,RC),(SAc,SV),(RC,SV,(True,)),(RC,"認証サービス"),(SU,PS),(SU,SB,(True,)),(SB,CL,(True,)),(SB,"認証サービス"),(SU,RN,(True,))])
a=({SUp:["SignUpPage"],SU:["createSignUp"],PS:["deliver","resend"],SB:["createSupabaseAuth"],CL:["createClient"],RN:["createRouterPageNavigation"]},
 [(SUp,SU),(SUp,SB),(SU,PS),(SUp,RN),(SUp,CL)],
 [(SU,PS),(SU,SB,(True,)),(SB,CL,(True,)),(SB,"認証サービス"),(SU,RN,(True,))])
emit("段階15-登録確認","サインアップのコード送付と登録確認の構造",b,a)

# 段階13 returnTo
SIp=p("signin/page.tsx"); SIF=f("ui/signin-form.tsx"); BR=f("infrastructure/browser-return-to.ts")
b=({SIp:["SignInPage"],SIF:["SignInForm"],SI:["createSignIn"],BR:["createBrowserReturnTo"],AR:["destinationOf"],SB:["createSupabaseAuth"],RN:["createRouterPageNavigation"]},
 [(SIp,SI),(SIp,BR),(SIp,SIF),(SIp,SB),(SIp,RN),(SI,AR),(BR,AR)],
 [(SIp,SIF),(SIF,SI,(True,)),(SI,BR,(True,)),(SI,SB,(True,)),(SI,RN,(True,)),(SI,AR),(SB,"認証サービス")])
a=({SIp:["SignInPage"],SIF:["SignInForm"],SI:["createSignIn"],AR:["destinationOf"],SB:["createSupabaseAuth"],RN:["createRouterPageNavigation"]},
 [(SIp,SI),(SIp,SIF),(SIp,SB),(SIp,RN),(SI,AR)],
 [(SIp,SIF),(SIF,SI,(True,)),(SI,SB,(True,)),(SI,RN,(True,)),(SI,AR),(SB,"認証サービス")])
emit("段階13-遷移元","サインインの遷移元の受け渡しの構造",b,a)

# 段階16 送付統合
PSF=f("ui/password-setup-form.tsx"); OC=f("ui/otp-code-step.tsx"); OE=f("ui/otp-email-step.tsx")
b=({PSF:["PasswordSetupForm"],OE:["OtpEmailStep"],OC:["OtpCodeStep"],SU:["createSignUp"],RP:["createResetPassword"],PS:["deliver","resend","verifyCode","applyPassword","tickCooldown"],PF:["beginSendCode","beginResend","beginVerifyCode","beginSetPassword","passwordSetupReducer"]},
 [(PSF,PF),(SU,PS),(RP,PS),(PS,PF),(SU,PF),(RP,PF)],
 [(PSF,OE),(PSF,OC),(PSF,SU,(True,)),(PSF,RP,(True,)),(SU,PS),(RP,PS),(PS,PF)])
a=({PSF:["PasswordSetupForm"],OE:["OtpEmailStep"],OC:["OtpCodeStep"],SU:["createSignUp"],RP:["createResetPassword"],PS:["sendCode","verifyCode","applyPassword","tickCooldown"],PF:["beginSendCode","beginVerifyCode","beginSetPassword","passwordSetupReducer"]},
 [(PSF,PF),(SU,PS),(RP,PS),(PS,PF)],
 [(PSF,OE),(PSF,OC),(PSF,SU,(True,)),(PSF,RP,(True,)),(SU,PS),(RP,PS),(PS,PF)])
emit("段階16-送付統合","コード送付と再送の手続きの構造",b,a)

# 段階9 CallResult
b=({CR:["failureOf"],SB:["createSupabaseAuth"],SI:["createSignIn"],PS:["deliver","verifyCode","applyPassword"],SES:["createSession"]},
 [(SB,CR),(SI,CR),(PS,CR),(SES,CR)],[(SI,CR),(PS,CR),(SES,CR),(SB,"認証サービス")])
a=({CR:["failureOf"],SB:["createSupabaseAuth"],SI:["createSignIn"],PS:["deliver","verifyCode","applyPassword"],SES:["createSession"]},
 [(SB,CR),(PS,CR),(SES,CR)],[(PS,CR),(SES,CR),(SB,"認証サービス")])
emit("段階09-結果の型","認証サービスへの結果の型の構造",b,a)

# 段階23 proxy・セッション更新
PX="proxy.ts"; US="lib/supabase/infrastructure/session.ts"; RR="features/rounds/domain/round-routes.ts"
b=({PX:["proxy"],US:["updateSession"],AR:["redirectFor"],RR:[]},
 [(PX,US),(PX,AR),(PX,RR)],
 [(PX,US),(US,AR,(True,)),(US,"認証サービス")])
a=({PX:["proxy"],US:["updateSession"],AR:["redirectFor"],RR:[]},
 [(PX,US),(PX,AR),(PX,RR)],
 [(PX,US),(PX,AR),(US,"認証サービス")])
emit("段階23-proxy","要求ごとのセッション更新と転送の規則の構造",b,a)
print("ok")
