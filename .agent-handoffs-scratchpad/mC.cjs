const { createRequire } = require('module');
const req = createRequire('/home/user/aims/apps/web/package.json');
const { createClient } = req('@supabase/supabase-js');
const URL_='http://127.0.0.1:54321', ANON='sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH', SECRET='<LOCAL_SECRET_KEY: supabase status で得る>';
const mk=()=>createClient(URL_,ANON,{auth:{persistSession:false,autoRefreshToken:false}});
const admin=createClient(URL_,SECRET,{auth:{persistSession:false,autoRefreshToken:false}});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function latestCode(email, notEq){ for(let i=0;i<30;i++){ const l=await (await fetch('http://127.0.0.1:54324/api/v1/search?query='+encodeURIComponent('to:'+email))).json(); const msgs=(l.messages||[]); for(const m of msgs){const d=await (await fetch('http://127.0.0.1:54324/api/v1/message/'+m.ID)).json(); const x=/(\d{6})/.exec(d.HTML); if(x && x[1]!==notEq) return {code:x[1], subject:d.Subject, n:msgs.length};} await sleep(500);} throw new Error('no mail'); }
(async()=>{
  const email=`mc-${Date.now()}@aims.test`;
  await admin.auth.admin.createUser({email,password:'password-original',email_confirm:true});
  const c=mk();
  const r=await c.auth.resetPasswordForEmail(email,{captchaToken:'x'}); console.log('resetPasswordForEmail ->', r.error?r.error.message:'ok');
  const m1=await latestCode(email); console.log('mail1:', m1.subject, 'mails:',m1.n, 'code:', m1.code);
  await sleep(1500);
  const g=await admin.auth.admin.generateLink({type:'recovery',email});
  console.log('generateLink ->', g.error?g.error.message:'ok', 'confirmed_at:', g.data?.user?.email_confirmed_at?'set':'null', 'otp:', g.data?.properties?.email_otp);
  const v=await mk().auth.verifyOtp({email,token:m1.code,type:'recovery'});
  console.log('verifyOtp(mail1 code) after generateLink ->', v.error?`${v.error.status} ${v.error.code}: ${v.error.message}`:'SUCCESS (session issued)');
  // control: without generateLink
  const email2=`mc2-${Date.now()}@aims.test`;
  await admin.auth.admin.createUser({email:email2,password:'password-original',email_confirm:true});
  await mk().auth.resetPasswordForEmail(email2,{captchaToken:'x'});
  const m2=await latestCode(email2);
  const v2=await mk().auth.verifyOtp({email:email2,token:m2.code,type:'recovery'});
  console.log('CONTROL verifyOtp(mail code), no generateLink ->', v2.error?`${v2.error.status} ${v2.error.code}`:'SUCCESS');
  // generateLink's own otp works?
  const email3=`mc3-${Date.now()}@aims.test`;
  await admin.auth.admin.createUser({email:email3,password:'password-original',email_confirm:true});
  await mk().auth.resetPasswordForEmail(email3,{captchaToken:'x'}); const m3=await latestCode(email3); await sleep(1500);
  const g3=await admin.auth.admin.generateLink({type:'recovery',email:email3});
  const v3=await mk().auth.verifyOtp({email:email3,token:g3.data.properties.email_otp,type:'recovery'});
  console.log('verifyOtp(generateLink own otp) ->', v3.error?`${v3.error.status} ${v3.error.code}`:'SUCCESS');
  const v3b=await mk().auth.verifyOtp({email:email3,token:m3.code,type:'recovery'});
  console.log('verifyOtp(mailed code, after own-otp consumed) ->', v3b.error?`${v3b.error.status} ${v3b.error.code}`:'SUCCESS');
  // generateLink called twice in a row without mail: still fine; and mail code vs. a *second* mail resend
  // DB view of recovery_token columns
  const cp=require('child_process');
  const email4=`mc4-${Date.now()}@aims.test`;
  await admin.auth.admin.createUser({email:email4,password:'password-original',email_confirm:true});
  const q=()=>cp.execSync(`psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -Atc "select left(recovery_token,12), recovery_sent_at from auth.users where email='${email4}'"`).toString().trim();
  console.log('DB recovery_token/sent_at initial:', q());
  await mk().auth.resetPasswordForEmail(email4,{captchaToken:'x'}); await latestCode(email4);
  console.log('after resetPasswordForEmail:', q()); await sleep(1500);
  await admin.auth.admin.generateLink({type:'recovery',email:email4});
  console.log('after admin generateLink recovery:', q());
  // unconfirmed signup OTP unaffected by generateLink recovery?
  const email5=`mc5-${Date.now()}@aims.test`;
  const su=await mk().auth.signUp({email:email5,password:'password-original1',options:{captchaToken:'x'}});
  console.log('signUp ->', su.error?su.error.message:'ok');
  const m5=await latestCode(email5); await sleep(1500);
  const g5=await admin.auth.admin.generateLink({type:'recovery',email:email5});
  console.log('generateLink recovery on UNCONFIRMED user ->', g5.error?`${g5.error.code}`:'ok, email_confirmed_at='+(g5.data.user.email_confirmed_at||'null'));
  const v5=await mk().auth.verifyOtp({email:email5,token:m5.code,type:'email'});
  console.log('verifyOtp(signup code, type=email) after generateLink ->', v5.error?`${v5.error.status} ${v5.error.code}`:'SUCCESS');
})().catch(e=>{console.error('ERR',e);process.exit(1)});
