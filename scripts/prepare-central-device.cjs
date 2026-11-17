/* eslint-disable @typescript-eslint/no-require-imports */
// Native Windows DPAPI enrollment: prints ONLY the public registration path/ID.
const {app,safeStorage}=require('electron');
const path=require('node:path');
const {centralIdentity}=require('../desktop/central-client.cjs');
app.setName('RestaMarket');
const profile=process.env.BIRKASSA_DATA_DIR?path.join(process.env.BIRKASSA_DATA_DIR,'electron-profile'):path.join(app.getPath('appData'),'BirKassa');
require('node:fs').mkdirSync(profile,{recursive:true,mode:0o700});
app.setPath('userData',profile);
app.setPath('sessionData',profile);
if(!app.requestSingleInstanceLock()){console.error('RestaMarket-i bağlayıb qeydiyyatı yenidən yoxlayın.');app.exit(1);}
app.whenReady().then(async()=>{
 if(process.platform!=='win32')throw Error('Windows enrollment is required.');
 const dataRoot=process.env.BIRKASSA_DATA_DIR||path.join(profile,'local-data');
 const identity=await centralIdentity(dataRoot,safeStorage);
 console.log(JSON.stringify({id:identity.id,registration:identity.registration,privateKeyWindowsProtected:true}));app.quit();
}).catch(()=>{console.error('Device enrollment failed. No private key was printed.');app.exit(1);});
