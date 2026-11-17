import {createCentralGateway} from '../desktop/central-gateway.mjs';
const port=Number(process.env.RESTAMARKET_CENTRAL_GATEWAY_PORT||5790);
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid private gateway port');
const server=createCentralGateway({registryFile:process.env.RESTAMARKET_CENTRAL_REGISTRY,backendOrigin:process.env.RESTAMARKET_CENTRAL_BACKEND_ORIGIN,accessToken:process.env.BIRKASSA_DESKTOP_ACCESS_TOKEN,nativeToken:process.env.BIRKASSA_DESKTOP_TOKEN});
server.once('error',()=>{console.error('Private central gateway could not start');process.exitCode=1;});
server.listen(port,'127.0.0.1',()=>console.log('RestaMarket private central gateway ready on loopback'));
let polling=false,pollAbort;
const poll=async()=>{if(polling)return;polling=true;pollAbort=new AbortController();try{await fetch(process.env.RESTAMARKET_CENTRAL_BACKEND_ORIGIN+'/api/desktop-poll',{method:'POST',headers:{Authorization:'Bearer '+process.env.BIRKASSA_DESKTOP_TOKEN,'x-restamarket-desktop-access':process.env.BIRKASSA_DESKTOP_ACCESS_TOKEN},redirect:'error',signal:AbortSignal.any([pollAbort.signal,AbortSignal.timeout(120000)])});}catch{}finally{polling=false;pollAbort=null;}};
const timer=process.env.BIRKASSA_CENTRAL_POLL==='1'?setInterval(()=>void poll(),30000):null;
if(timer){timer.unref();void poll();}
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{clearInterval(timer);pollAbort?.abort();server.close(()=>process.exit(0));setTimeout(()=>{server.closeAllConnections();process.exit(0);},10000).unref();});
