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
const cases=[
 ['a 72B ASCII', A(72)],
 ['b 73B ASCII', A(73)],
 ['c1 100B ASCII', A(100)],
 ['c2 200B ASCII', A(200)],
 ['d1 日本語+英数(14字)', 'パスワードの設定12ab'],
 ['d2 絵文字+英数', 'Pass😀word123'],
 ['d3 全角英数のみ(10字)', 'Ｐａｓｓｗｏｒｄ１２'],
 ['d4 全角+半角英数', 'Ｐａｓｓ１２３４a1'],
 ['e1 日本語23字+a1(25字/71B)', 'あ'.repeat(23)+'a1'],
 ['e2 日本語24字+a1(26字/74B)', 'あ'.repeat(24)+'a1'],
 ['e3 日本語28字+a1(30字/86B)', 'あ'.repeat(28)+'a1'],
 ['e4 日本語30字+a1(32字/92B)', 'あ'.repeat(30)+'a1'],
 ['f1 空白を含む', 'Pass word123'],
 ['f2 前後に空白', ' Passw0rd12 '],
 ['f3 タブ', 'Pass\tword123'],
 ['f4 改行', 'Pass\nword123'],
 ['f5 NUL', 'Pass\u0000word123'],
 ['f6 DEL(0x7f)', 'Passw0rd12\u007f'],
 ['f7 制御文字 0x01', 'Passw0rd12\u0001'],
];
(async()=>{
 const lines=[];
 for(const [name,pw] of cases){
  const email=`pw-${Date.now()}-${Math.random().toString(36).slice(2,6)}@aims.test`;
  const base='Base-pass-1';
  const cu=await admin.auth.admin.createUser({email,password:base,email_confirm:true});
  if(cu.error){lines.push(`${name}: createUser失敗 ${cu.error.message}`);continue;}
  const c=mk(); const si=await retry(()=>c.auth.signInWithPassword({email,password:base,options:{captchaToken:'x'}}));
  if(si.error){lines.push(`${name}: base signin失敗 ${si.error.message}`);continue;}
  const u=await c.auth.updateUser({password:pw});
  const row={name,chars:[...pw].length,len16:pw.length,bytes:bl(pw),set:u.error?`拒否 ${u.error.status} ${u.error.code}: ${u.error.message}`:'成功'};
  if(!u.error){
    row.full=await signin(email,pw);
    const nonA = bl(pw)>72 || bl(pw)===72 ;
    if(bl(pw)>=72){
      const p72=cut(pw,72);
      row.first72=`${bl(p72)}B ${await signin(email,p72)}`;
      row.first72plusZ=await signin(email,p72+'Z');
      // 先頭72Bの途中を変えたもの(対照)
      const alt=p72.slice(0,5)+(p72[5]==='q'?'r':'q')+p72.slice(6);
      row.altwithin72=await signin(email,alt);
      row.base_old=await signin(email,base);
    }
    if(bl(pw)<72){ row.old=await signin(email,base); row.wrong=await signin(email,pw+'Z'); }
  }
  // admin作成+signUpでの設定可否
  const e2=`pwa-${Date.now()}-${Math.random().toString(36).slice(2,6)}@aims.test`;
  const ca=await admin.auth.admin.createUser({email:e2,password:pw,email_confirm:true});
  row.adminCreate=ca.error?`拒否 ${ca.error.status} ${ca.error.code}: ${ca.error.message}`:'成功';
  if(!ca.error && bl(pw)>72){ row.adminCreate_full=await signin(e2,pw); }
  const su=await retry(()=>mk().auth.signUp({email:`pws-${Date.now()}-${Math.random().toString(36).slice(2,6)}@aims.test`,password:pw,options:{captchaToken:'x'}}));
  row.signUp=su.error?`拒否 ${su.error.status} ${su.error.code}: ${su.error.message}`:'成功';
  console.log(JSON.stringify(row));
 }
})();
