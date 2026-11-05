const { createRequire } = require('module');
const req = createRequire('/home/user/aims/apps/web/package.json');
const { createClient } = req('@supabase/supabase-js');
const URL_='http://127.0.0.1:54321', ANON='sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH', SECRET='<LOCAL_SECRET_KEY: supabase status で得る>';
const cap={captchaToken:'x'};
const mk=()=>createClient(URL_,ANON,{auth:{persistSession:false,autoRefreshToken:false}});
const admin=createClient(URL_,SECRET,{auth:{persistSession:false,autoRefreshToken:false}});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function code(email){ for(let i=0;i<30;i++){ const l=await (await fetch('http://127.0.0.1:54324/api/v1/search?query='+encodeURIComponent('to:'+email))).json(); const m=l.messages?.[0]; if(m){const d=await (await fetch('http://127.0.0.1:54324/api/v1/message/'+m.ID)).json(); const x=/(\d{6})/.exec(d.HTML); if(x) return x[1];} await sleep(500);} throw new Error('no mail'); }
async function recoverySession(email){ const c=mk(); const r=await c.auth.resetPasswordForEmail(email,{captchaToken:'x'}); if(r.error) throw r.error; const cd=await code(email); const v=await c.auth.verifyOtp({email,token:cd,type:'recovery'}); if(v.error) throw v.error; return {c,session:v.data.session}; }
async function probe(label, sess, noRefresh){ // sess: {access_token, refresh_token}
  const c=mk();
  const g=await fetch(URL_+'/auth/v1/user',{headers:{apikey:ANON,Authorization:'Bearer '+sess.access_token}});
  const gb=await g.json();
  if(noRefresh) return `${label}: GET /user -> ${g.status} ${gb.error_code||gb.code||'ok'}`;
  const rf=await fetch(URL_+'/auth/v1/token?grant_type=refresh_token',{method:'POST',headers:{apikey:ANON,'Content-Type':'application/json'},body:JSON.stringify({refresh_token:sess.refresh_token})});
  const rb=await rf.json();
  return `${label}: GET /user -> ${g.status} ${gb.error_code||gb.code||'ok'} ; refresh -> ${rf.status} ${rb.error_code||rb.code||'ok'}`;
}
async function scenario(name, finish){
  const email=`mA-${name}-${Date.now()}@aims.test`;
  await admin.auth.admin.createUser({email,password:'password-original',email_confirm:true});
  // other devices: password sign-in x2
  const d1=mk(), d2=mk();
  const s1=(await d1.auth.signInWithPassword({email,password:'password-original',options:cap})).data.session;
  const s2=(await d2.auth.signInWithPassword({email,password:'password-original',options:cap})).data.session;
  const rec=await recoverySession(email);
  const out=[`--- ${name} (${email})`];
  out.push(await probe('before: otherDev1',s1,true));
  out.push('DB sessions before: '+require('child_process').execSync(`psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -Atc "select count(*) from auth.sessions s join auth.users u on u.id=s.user_id where u.email=lower('${email}')"`).toString().trim());
  if(name.startsWith('z')){ out.push(await probe('control (no updateUser): otherDev1',s1)); out.push(await probe('control: otherDev2',s2)); console.log(out.join('\n')); return; }
  const u=await rec.c.auth.updateUser({password:'password-changed1'});
  out.push('updateUser -> '+(u.error?u.error.code+' '+u.error.message:'ok'));
  out.push(await probe('after updateUser: otherDev1',s1));
  out.push(await probe('after updateUser: otherDev2',s2));
  out.push(await probe('after updateUser: recoverySession(self)',rec.session));
  if(finish){ const so=await rec.c.auth.signOut({scope:finish}); out.push(`signOut(${finish}) -> ${so.error?so.error.message:'ok'}`);
    out.push(await probe(`after signOut(${finish}): otherDev1`,s1));
    out.push(await probe(`after signOut(${finish}): otherDev2`,s2));
    out.push(await probe(`after signOut(${finish}): recoverySession(self)`,rec.session)); }
  out.push('DB sessions at end: '+require('child_process').execSync(`psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -Atc "select count(*) from auth.sessions s join auth.users u on u.id=s.user_id where u.email=lower('${email}')"`).toString().trim());
  console.log(out.join('\n'));
  return email;
}
(async()=>{
  await scenario('z-control',null);
  await scenario('a-updateUser-only',null);
  await scenario('b-global','global');
  await scenario('c-local','local');
})().catch(e=>{console.error('ERR',e);process.exit(1)});
