import json, os, sys
ROOT = "/root/worktrees/aims-batch1-simplify/apps/web/src/"
OUT = "/root/worktrees/aims-batch1-simplify/.agent-handoffs/diagrams/設計-バッチ1/"
A = "app/(auth)/"
F = "features/auth/"

def f(path, fns=None, consts=None):
    d = {"path": path}
    if fns: d["functions"] = fns
    if consts: d["constants"] = consts
    return d

def g(name, feature, layer, label, files):
    return {"name": name, "feature": feature, "layer": layer, "label": label, "files": files}

layers = [
  {"name": "組み立て層", "label": "入口。具体実装と手続きの生成・注入"},
  {"name": "UI層", "label": "画面の部品"},
  {"name": "アプリケーション層", "label": "操作の手続きと手続きの約束"},
  {"name": "ドメイン層", "label": "業務の規則と状態"},
  {"name": "インフラ層", "label": "外部へのアクセスと形の変換"},
]
features = [
  {"name": "認証", "label": "サインイン・サインアップ・パスワード再設定"},
  {"name": "共有の技術", "label": "複数の機能が使う接続・遷移・時計"},
  {"name": "ラウンド", "label": "ラウンドの経路の定数だけを使う"},
]
externals = ["認証サービス"]

# ---------- 図A: 入口・サーバー側 ----------
def diagA(after):
    groups = []
    groups.append(g("サインインの入口", "認証", "組み立て層", "サインイン画面の手続きを生成して画面へ渡す", [f(A+"signin/page.tsx", ["SignInPage"])]))
    files = [f(A+"signup/page.tsx", ["SignUpPage"])]
    if not after: files.append(f(A+"signup/actions.ts", ["isEmailRegistered"]))
    groups.append(g("サインアップの入口", "認証", "組み立て層", "サインアップ画面の手続きを生成して画面へ渡す", files))
    files = [f(A+"reset-password/page.tsx", ["ResetPasswordPage"])]
    if not after: files.append(f(A+"reset-password/actions.ts", ["changePassword"]))
    groups.append(g("再設定の入口", "認証", "組み立て層", "再設定画面の手続きを生成して画面へ渡す", files))
    groups.append(g("本体画面の入口", "認証", "組み立て層", "サインアウトとセッション見張りの入口(範囲外。依存の位置づけ用)", [f("app/(main)/layout.tsx", ["MainLayout"])]))
    groups.append(g("サインイン画面", "認証", "UI層", "メールとパスワードの入力と送信", [f(F+"ui/signin-form.tsx", ["SignInForm"])]))
    groups.append(g("段階式画面", "認証", "UI層", "メール・コード・パスワードの3段階(サインアップと再設定で共有)",
        [f(F+"ui/signup-form.tsx", ["SignUpForm"]), f(F+"ui/reset-password-form.tsx", ["ResetPasswordForm"]), f(F+"ui/password-setup-form.tsx", ["PasswordSetupForm"])]))
    groups.append(g("サインインの手続き", "認証", "アプリケーション層", "照合の順序と遷移", [f(F+"application/sign-in.ts", ["createSignIn"])]))
    groups.append(g("サインアップ・再設定の手続き", "認証", "アプリケーション層", "コード送付後のパスワード設定と遷移",
        [f(F+"application/sign-up.ts", ["createSignUp"]), f(F+"application/reset-password.ts", ["createResetPassword"])]))
    if not after:
        groups.append(g("サーバーの手続き", "認証", "アプリケーション層", "パスワード変更と全端末のサインイン終了をサーバーで行う", [f(F+"application/password-change.ts", ["createPasswordChange"])]))
    groups.append(g("共通の順序", "認証", "アプリケーション層", "送付・確認・パスワード設定の共通の順序", [f(F+"application/password-setup.ts", ["applyPassword","verifyCode"])]))
    groups.append(g("経路の規則", "認証", "ドメイン層", "遷移先の規則", [f(F+"domain/auth-routes.ts", ["destinationOf"], ["SIGN_IN_PATH"])]))
    groups.append(g("認証サービスの実装", "認証", "インフラ層", "利用者のセッションで認証サービスに頼む唯一の実装", [f(F+"infrastructure/supabase-auth.ts", ["createSupabaseAuth"])]))
    if not after:
        groups.append(g("登録確認", "認証", "インフラ層", "管理者の接続でメールの登録有無を調べる", [f(F+"infrastructure/supabase-registration-check.ts", ["createSupabaseRegistrationCheck"])]))
        groups.append(g("遷移元の読み出し", "認証", "インフラ層", "URLのクエリから遷移元の値を読む", [f(F+"infrastructure/browser-return-to.ts", ["createBrowserReturnTo"])]))
    groups.append(g("ページ全体の読み込み", "認証", "インフラ層", "ハード遷移(本体画面のセッション喪失の遷移が使う)", [f(F+"infrastructure/browser-page-load.ts", ["createBrowserPageLoad"])]))
    groups.append(g("ブラウザの接続", "共有の技術", "インフラ層", "ブラウザの認証サービス接続", [f("lib/supabase/infrastructure/client.ts", ["createClient"])]))
    if not after:
        groups.append(g("サーバーの接続", "共有の技術", "インフラ層", "管理者の接続と要求のcookieの接続", [f("lib/supabase/infrastructure/server.ts", ["createAdminClient","createServerClient"])]))
    groups.append(g("遷移と時計", "共有の技術", "インフラ層", "routerによる遷移と時間の経過",
        [f("lib/page-navigation/infrastructure/router-page-navigation.ts", ["createRouterPageNavigation"]), f("lib/clock/infrastructure/browser-clock.ts", ["createBrowserClock"])]))
    groups.append(g("ラウンドの経路", "ラウンド", "ドメイン層", "保護対象の根の経路", [f("features/rounds/domain/round-routes.ts", None, ["ROUNDS_PATH"])]))

    S = A+"signin/page.tsx"; U = A+"signup/page.tsx"; R = A+"reset-password/page.tsx"
    SA = A+"signup/actions.ts"; RA = A+"reset-password/actions.ts"; ML = "app/(main)/layout.tsx"
    SIF = F+"ui/signin-form.tsx"; SUF = F+"ui/signup-form.tsx"; RF = F+"ui/reset-password-form.tsx"; PSF = F+"ui/password-setup-form.tsx"
    SI = F+"application/sign-in.ts"; SU = F+"application/sign-up.ts"; RP = F+"application/reset-password.ts"; PC = F+"application/password-change.ts"; PS = F+"application/password-setup.ts"
    AR = F+"domain/auth-routes.ts"; SB = F+"infrastructure/supabase-auth.ts"; RC = F+"infrastructure/supabase-registration-check.ts"
    BR = F+"infrastructure/browser-return-to.ts"; BP = F+"infrastructure/browser-page-load.ts"
    CL = "lib/supabase/infrastructure/client.ts"; SV = "lib/supabase/infrastructure/server.ts"; RN = "lib/page-navigation/infrastructure/router-page-navigation.ts"; BC = "lib/clock/infrastructure/browser-clock.ts"; RR = "features/rounds/domain/round-routes.ts"

    refs = [
      (S,SI),(S,SB),(S,SIF),(S,RN),(S,CL),(S,RR),
      (U,SU),(U,SB),(U,SUF),(U,RN),(U,CL),(U,RR),(U,BC),
      (R,RP),(R,SB),(R,RF),(R,CL),(R,BC),
      (SUF,PSF),(RF,PSF),
      (SU,PS),(SU,AR),(RP,PS),(RP,AR),(SI,AR),
      (ML,BP),
    ]
    calls = [
      (S,SIF,False),(U,SUF,False),(R,RF,False),
      (SIF,SI,True),(PSF,SU,True),(PSF,RP,True),
      (SI,SB,True),(SI,RN,True),
      (SU,SB,True),(SU,RN,True),(SU,PS,False),
      (RP,PS,False),(RP,SB,True),
      (SB,CL,True),(SB,"認証サービス",False),
      (ML,BP,False),
    ]
    if after:
        refs += [(R,RN)]
        calls += [(RP,RN,True)]
    else:
        refs += [(S,BR),(U,SA),(R,BP),(R,RA),(SA,RC),(SA,SV),(RA,PC),(RA,SB),(RA,SV),(PC,RP),(SB,PC),(BP,RP),(SI,BR)]
        calls += [(SI,BR,True),(SU,SA,True),(RP,RA,True),(RP,BP,True),(SA,RC,False),(SA,SV,False),(RC,SV,True),(RC,"認証サービス",False),(RA,PC,False),(RA,SV,False),(RA,SB,False),(PC,SB,True)]
    return {
      "title": "認証画面の入口・サーバー側・遷移元の構造",
      "layers": layers, "features": features, "groups": groups, "externals": externals,
      "references": [{"from":a,"to":b} for a,b in refs],
      "calls": [({"from":a,"to":b,"via_injection":True} if v else {"from":a,"to":b}) for a,b,v in calls],
    }

# ---------- 図B: 手続き・集約 ----------
def diagB(after):
    P = F+"application/password-setup.ts"; PF = F+"domain/password-setup-flow.ts"
    groups = []
    groups.append(g("サインイン画面", "認証", "UI層", "メールとパスワードの入力と送信", [f(F+"ui/signin-form.tsx", ["SignInForm"])]))
    groups.append(g("段階式画面", "認証", "UI層", "メール・コード・パスワードの3段階", [
        f(F+"ui/password-setup-form.tsx", ["PasswordSetupForm"]),
        f(F+"ui/otp-email-step.tsx", ["OtpEmailStep"]),
        f(F+"ui/otp-code-step.tsx", ["OtpCodeStep"])]))
    groups.append(g("画面の状態", "認証", "UI層", "集約の状態を持ち、手続きへ渡す画面の約束を作る", [f(F+"ui/use-screen-view.ts", ["useScreenView"])]))
    groups.append(g("サインインの手続き", "認証", "アプリケーション層", "照合の順序", [f(F+"application/sign-in.ts", ["createSignIn"])]))
    groups.append(g("サインアップ・再設定の手続き", "認証", "アプリケーション層", "コード送付後のパスワード設定と遷移", [
        f(F+"application/sign-up.ts", ["createSignUp"]), f(F+"application/reset-password.ts", ["createResetPassword"])]))
    groups.append(g("共通の順序", "認証", "アプリケーション層", "送付・確認・パスワード設定の共通の順序",
        [f(P, ["tickCooldown","sendCode","verifyCode","applyPassword"] if after else ["tickCooldown","deliver","resend","verifyCode","applyPassword"])]))
    groups.append(g("認証サービスへの結果", "認証", "アプリケーション層", "頼みごとの結果の型(after: 受付と失敗の2種)", [f(F+"application/call-result.ts", ["failureOf"])]))
    groups.append(g("サインインの集約", "認証", "ドメイン層", "サインインの開始の可否と状態", [f(F+"domain/sign-in-flow.ts", ["beginSignIn","signInReducer"])]))
    groups.append(g("パスワード設定の集約", "認証", "ドメイン層", "段階・実行中の操作・再送の待ち・トークン", [
        f(PF, ["beginSendCode","beginVerifyCode","beginSetPassword","passwordSetupReducer"] if after else ["beginSendCode","beginVerifyCode","beginResend","beginSetPassword","passwordSetupReducer"], ["initialPasswordSetupFlow"])]))
    groups.append(g("入力の規則", "認証", "ドメイン層", "認証コードの待ちとパスワードの規則", [
        f(F+"domain/auth-code.ts", ["validateResendWait"] if after else ["validateAuthCode","validateResendWait"], ["AUTH_CODE_LENGTH","RESEND_COOLDOWN_SECONDS"]),
        f(F+"domain/password.ts", ["validatePasswordPresent","validateNewPassword"], ["PASSWORD_MIN_LENGTH","PASSWORD_MAX_LENGTH"])]))
    groups.append(g("認証サービスの実装", "認証", "インフラ層", "認証サービスに頼み、応答を結果の値に変える", [f(F+"infrastructure/supabase-auth.ts", ["createSupabaseAuth"])]))
    SIF=F+"ui/signin-form.tsx"; PSF=F+"ui/password-setup-form.tsx"; OE=F+"ui/otp-email-step.tsx"; OC=F+"ui/otp-code-step.tsx"; US=F+"ui/use-screen-view.ts"
    SI=F+"application/sign-in.ts"; SU=F+"application/sign-up.ts"; RP=F+"application/reset-password.ts"; CR=F+"application/call-result.ts"
    SF=F+"domain/sign-in-flow.ts"; AC=F+"domain/auth-code.ts"; PW=F+"domain/password.ts"; SB=F+"infrastructure/supabase-auth.ts"
    refs=[(SIF,SF),(SIF,US),(PSF,PF),(PSF,US),(PSF,PW),(OC,AC),(SI,SF),(SU,P),(SU,PF),(RP,P),(RP,PF),(P,PF),(P,CR),(PF,AC),(PF,PW),(SF,PW),(SB,CR)]
    calls=[(PSF,OE,False),(PSF,OC,False),(SIF,SI,True),(PSF,SU,True),(PSF,RP,True),(SU,P,False),(RP,P,False),(P,PF,False),(P,CR,False),(SI,SF,False),(SB,"認証サービス",False),(SI,SB,True),(SU,SB,True),(RP,SB,True),(PF,AC,False),(PF,PW,False),(SF,PW,False)]
    if not after:
        refs.append((SI,CR)); calls.append((SI,CR,False))
    return {
      "title": "コード送付・確認・パスワード設定と結果の型の構造",
      "layers": [l for l in layers if l["name"]!="組み立て層"],
      "features": [features[0]],
      "groups": groups, "externals": externals,
      "references":[{"from":a,"to":b} for a,b in refs],
      "calls":[({"from":a,"to":b,"via_injection":True} if v else {"from":a,"to":b}) for a,b,v in calls],
    }

def validate(d, check_exist):
    paths = {fl["path"] for gr in d["groups"] for fl in gr["files"]}
    names = paths | set(d["externals"])
    for r in d["references"]+d["calls"]:
        assert r["from"] in paths, ("from?", r)
        assert r["to"] in names, ("to?", r)
    seen=set()
    for gr in d["groups"]:
        for fl in gr["files"]:
            assert fl["path"] not in seen, fl["path"]; seen.add(fl["path"])
            if check_exist:
                assert os.path.exists(ROOT+fl["path"]), fl["path"]

for name, fn in (("構造A", diagA), ("構造B", diagB)):
    b, a = fn(False), fn(True)
    validate(b, True); validate(a, False)
    json.dump(b, open(OUT+name+"-変更前.json","w"), ensure_ascii=False, indent=1)
    json.dump(a, open(OUT+name+"-変更後.json","w"), ensure_ascii=False, indent=1)
print("ok")
