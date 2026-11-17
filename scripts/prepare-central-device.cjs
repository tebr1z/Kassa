/* eslint-disable @typescript-eslint/no-require-imports */
// Native Windows DPAPI enrollment: prints ONLY the public registration path/ID.
const {app,safeStorage}=require('electron');
const path=require('node:path');
const {centralIdentity}=require('../desktop/central-client.cjs');
app.setName('RestaMarket');
app.whenReady().then(async()=>{
 if(process.platform!=='win32')throw Error('Windows enrollment is required.');
 const dataRoot=path.join(app.getPath('appData'),'BirKassa','local-data');
 const identity=await centralIdentity(dataRoot,safeStorage);
 console.log(JSON.stringify({id:identity.id,registration:identity.registration,privateKeyWindowsProtected:true}));app.quit();
}).catch(()=>{console.error('Device enrollment failed. No private key was printed.');app.exit(1);});
