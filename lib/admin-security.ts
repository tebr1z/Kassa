// Remote administration requires HTTPS; HTTP is only for the loopback preview.
export function isLoopbackRequest(request: Request) {
  const allowed=['localhost', '127.0.0.1', '[::1]'];
  const url=new URL(request.url);
  // Next may use an internal loopback URL behind a proxy. The browser's Host
  // must also be loopback before granting the local HTTP exception.
  for(const host of [url.host,request.headers.get('host'),request.headers.get('x-forwarded-host')].filter(Boolean)){
    try{if(!allowed.includes(new URL('http://'+host).hostname))return false;}
    catch{return false;}
  }
  return true;
}

export function secureAdminRequest(request: Request) {
  return new URL(request.url).protocol === 'https:' || isLoopbackRequest(request);
}
