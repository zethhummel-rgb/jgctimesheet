type AuthClient = {rpc:(name:string,args:Record<string,unknown>)=>PromiseLike<{data:any;error:any}>;auth:{getUser:(token:string)=>Promise<{data:{user:any};error:any}>};from:(table:string)=>any};

// Compare the dedicated scheduler token inside Vault. Never return it to a browser or host.
export async function isJgcWorkerRequest(request:Request,db:AuthClient):Promise<boolean>{
 const token=request.headers.get('x-jgc-worker-token')||'';
 if(!/^[a-f0-9]{64}$/.test(token))return false;
 const result=await db.rpc('jgc_validate_worker_token',{p_token:token});
 return !result.error&&result.data===true;
}

export async function approvedJgcCaller(request:Request,db:AuthClient):Promise<{id:string;email:string;role:string;worker_key:string}|null>{
 const authorization=request.headers.get('authorization')||'';
 if(!/^Bearer\s+\S+$/i.test(authorization))return null;
 const result=await db.auth.getUser(authorization.replace(/^Bearer\s+/i,''));
 if(result.error||!result.data.user)return null;
 const user=result.data.user;
 const profile=await db.from('profiles').select('id,role,account_status,worker_key').eq('id',user.id).single();
 if(profile.error||profile.data?.account_status!=='approved')return null;
 return {id:user.id,email:String(user.email||'').toLowerCase(),role:String(profile.data.role||''),worker_key:String(profile.data.worker_key||'')};
}
