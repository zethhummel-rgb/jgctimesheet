/** Web Push uses provider-owned endpoints. Arbitrary HTTPS URLs are never push services. */
export function isTrustedPushEndpoint(value:unknown):boolean{
 if(typeof value!=='string'||value.length>4096)return false;
 try{
  const url=new URL(value);
  if(url.protocol!=='https:'||url.username||url.password||url.port||url.hash||url.pathname==='/')return false;
  return ['web.push.apple.com','fcm.googleapis.com','updates.push.services.mozilla.com','notify.windows.com'].includes(url.hostname)
    || /^[a-z0-9-]+\.notify\.windows\.com$/.test(url.hostname);
 }catch{return false;}
}
