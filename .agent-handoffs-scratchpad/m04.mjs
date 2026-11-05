const API='http://127.0.0.1:54321';
const SECRET='<LOCAL_SECRET_KEY: supabase status で得る>';
const PUB='sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH';
const email=`pw-${Date.now()}@example.com`;
let r=await fetch(`${API}/auth/v1/admin/users`,{method:'POST',headers:{apikey:SECRET,Authorization:`Bearer ${SECRET}`,'content-type':'application/json'},body:JSON.stringify({email,password:'Passw0rd!x',email_confirm:true})});
r=await fetch(`${API}/auth/v1/token?grant_type=password`,{method:'POST',headers:{apikey:PUB,'content-type':'application/json'},body:JSON.stringify({email,password:'Passw0rd!x',gotrue_meta_security:{captcha_token:'XXXX.DUMMY.TOKEN.XXXX'}})});
const tok=(await r.json()).access_token;
const cases={ '7文字':'abc123X','数字だけ8':'12345678','英字だけ8':'onlyletters','73バイト':'a1'.repeat(36)+'b','72バイト':'a1'.repeat(36),'全角のみ':'ｐａｓｓｗｏｒｄ１２３','空':''};
for(const [n,p] of Object.entries(cases)){
  const r=await fetch(`${API}/auth/v1/user`,{method:'PUT',headers:{apikey:PUB,Authorization:`Bearer ${tok}`,'content-type':'application/json'},body:JSON.stringify({password:p})});
  const b=await r.json();
  console.log(n,Buffer.byteLength(p),r.status,b.error_code??'ok',(b.msg??'').slice(0,80));
}
