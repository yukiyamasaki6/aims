const { createRequire } = require('module');
const req = createRequire('/home/user/aims/apps/web/package.json');
const { createClient } = req('@supabase/supabase-js');
const URL_='http://127.0.0.1:54321', ANON='sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH', SECRET='<LOCAL_SECRET_KEY: supabase status で得る>';
const mk=()=>createClient(URL_,ANON,{auth:{persistSession:false,autoRefreshToken:false}});
const admin=createClient(URL_,SECRET,{auth:{persistSession:false,autoRefreshToken:false}});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const bl=s=>Buffer.byteLength(s,'utf8');
const show=s=>JSON.stringify(s.length>40?s.slice(0,18)+'…'+s.slice(-6):s);
async function retry(fn){ for(let i=0;i<20;i++){ const r=await fn(); const st=r.error&&(r.error.status||0); if(st===429||(r.error&&/rate limit/i.test(r.error.message))){await sleep(12000);continue;} return r;} return {error:{message:'rate-limit persisted'}}; }
const signin=async(email,pw)=>{ const r=await retry(()=>mk().auth.signInWithPassword({email,password:pw,options:{captchaToken:'x'}})); return r.error?`NG ${r.error.status} ${r.error.code}: ${r.error.message}`:'OK'; };
const cut=(s,n)=>{ const b=Buffer.from(s,'utf8').subarray(0,n); return b.toString('utf8'); };
const A=(n,pre='Ab1')=>pre+'x'.repeat(n-pre.length);

(async()=>{
 const mkuser=async(pw)=>{ const email=`pw2-${Date.now()}-${Math.random().toString(36).slice(2,6)}@aims.test`; const c=await admin.auth.admin.createUser({email,password:'Base-pass-1',email_confirm:true}); const cl=mk(); await retry(()=>cl.auth.signInWithPassword({email,password:'Base-pass-1',options:{captchaToken:'x'}})); const u=await cl.auth.updateUser({password:pw}); return {email,u}; };
 const out=async(k,v)=>console.log(k,'=>',v);
 // 境界: 日本語で72Bちょうど/73B
 for(const [n,pw] of [['jp 23字+ab1=72B('+bl('あ'.repeat(23)+'ab1')+')','あ'.repeat(23)+'ab1'],['jp 23字+ab12=73B','あ'.repeat(23)+'ab12'],['絵文字 15個(60B)+Ab1+x*9=72B?','😀'.repeat(15)+'Ab1'+'x'.repeat(9)],['絵文字 18個(72B)+Ab1','😀'.repeat(18)+'Ab1']]){
  const {email,u}=await mkuser(pw);
  console.log(n,'chars',[...pw].length,'bytes',bl(pw),'set',u.error?`拒否 ${u.error.status} ${u.error.code}: ${u.error.message}`:'成功');
  if(!u.error){ console.log('   full',await signin(email,pw)); }
 }
 // 72B 日本語(24字=72B)に英数が無いと weak か: 72B ちょうど = あ*23 + abc ok済。
 // 72Bのパスワードに対し、長い入力でサインイン
 const a=A(72); const {email,u}=await mkuser(a); console.log('72B set',u.error?u.error.message:'ok');
 for(const [n,p] of [['72B+Z(73B)',a+'Z'],['72B+200B suffix',a+'y'.repeat(128)],['72B + 1000B suffix',a+'y'.repeat(928)],['先頭71B+別文字(72B)',a.slice(0,71)+'Q'],['先頭72B中の1字変更(200B)',a.slice(0,5)+'Q'+a.slice(6)+'y'.repeat(128)]]) console.log('  signin',n,'bytes',bl(p),await signin(email,p));
 // NUL・空白の対照
 const f5='Pass\u0000word123'; const r5=await mkuser(f5); console.log('NUL set',r5.u.error?r5.u.error.message:'ok');
 for(const [n,p] of [['full',f5],['NUL手前まで "Pass"+ "1a"?','Pass'],['NUL以降を除く "Password123"','Password123'],['NUL手前+別: "Pass\u0000"','Pass\u0000']]) console.log('  signin',n,await signin(r5.email,p));
 const r2=await mkuser(' Passw0rd12 '); for(const [n,p] of [['trim前の全文',' Passw0rd12 '],['trim後','Passw0rd12']]) console.log('  signin(空白)',n,await signin(r2.email,p));
 // ログイン側に長さ上限があるか(存在しない/誤ったパスワード 1000B)
 console.log('  signin 誤り1000B',await signin(r2.email,'Zz1'+'q'.repeat(997)));
 // password.ts の現行規則を通る72字ASCII記号を含む
 const sym='Ab1!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~'; const rs=await mkuser(sym+'x'.repeat(72-sym.length)); console.log('記号全種+72字',bl(sym+'x'.repeat(72-sym.length)),rs.u.error?rs.u.error.message:'ok', rs.u.error?'':await signin(rs.email,sym+'x'.repeat(72-sym.length)));
})();
