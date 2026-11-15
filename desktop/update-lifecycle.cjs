'use strict';
async function stopServer(server,timeout=15000){
 if(!server||server.exitCode!==null||server.signalCode!==null)return;
 await new Promise((resolve,reject)=>{
  let timer;
  const done=error=>{clearTimeout(timer);server.removeListener('exit',exit);server.removeListener('error',failed);if(error)reject(error);else resolve();};
  const exit=()=>done(),failed=()=>done(Error('Local server could not stop'));
  server.once('exit',exit);server.once('error',failed);
  timer=setTimeout(()=>done(Error('Local server did not stop in time')),timeout);
  try{if(!server.kill())failed();}catch{failed();}
 });
}
module.exports={stopServer};
