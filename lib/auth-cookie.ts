// Production cookies remain HTTPS-only, except the loopback-only desktop/local preview.
export function secureAuthCookie(request:Request){
 const url=new URL(request.url);
 return process.env.NODE_ENV==='production'&&!(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname));
}
