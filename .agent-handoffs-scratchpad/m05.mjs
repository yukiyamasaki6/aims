const API='http://127.0.0.1:54321';
const PUB='sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH';
const SECRET='<LOCAL_SECRET_KEY: supabase status で得る>';
const email=`code-${Date.now()}@example.com`;
await fetch(`${API}/auth/v1/admin/users`,{method:'POST',headers:{apikey:SECRET,Authorization:`Bearer ${SECRET}`,'content-type':'application/json'},body:JSON.stringify({email,password:'Passw0rd!x',email_confirm:true})});
for (const type of ['email','recovery']) for (const token of ['', '12345', '1234567', 'abcdef', '123456']) {
  const r=await fetch(`${API}/auth/v1/verify`,{method:'POST',headers:{apikey:PUB,'content-type':'application/json'},body:JSON.stringify({type,email,token})});
  const b=await r.json();
  console.log(type,JSON.stringify(token),r.status,b.error_code??'ok',(b.msg??'').slice(0,80));
}
