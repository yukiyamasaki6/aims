import { allowedReturnTo } from "/root/worktrees/aims-batch1-simplify/apps/web/src/features/auth/domain/auth-routes.ts";
for (const v of ["//evil.com/rounds","/\\evil.com/rounds","/\t/evil.com/rounds","/.//evil.com/rounds","https://evil.com/rounds","javascript:alert(1)","rounds","/rounds/new?a=1"]) console.log(JSON.stringify(v), "=>", allowedReturnTo(v,"/rounds"));
