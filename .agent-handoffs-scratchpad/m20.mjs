const BASE="http://localhost", P="/rounds";
const isP=(p)=>p===P||p.startsWith(P+"/");
function allowed(raw){ if(typeof raw!=="string")return null; let u; try{u=new URL(raw,BASE)}catch{return null} if(u.origin!==BASE)return null; if(!isP(u.pathname))return null; return u.pathname+u.search;}
for (const v of ["//evil.com/rounds","/\\evil.com/rounds","/\t/evil.com/rounds","/\n/evil.com/rounds","/.//evil.com/rounds","https://evil.com/rounds","javascript:alert(1)","rounds","/rounds/new?a=1","/rounds/../signin","/rounds\\x","/rounds/"+"a".repeat(3000).slice(0,10),"/rounds?"+"a".repeat(3000).length]) console.log(JSON.stringify(v), "=>", allowed(v));
