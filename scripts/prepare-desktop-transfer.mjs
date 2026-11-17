import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {createTransferPackage} from '../desktop/transfer-package.mjs';
// Never bootstrap/migrate the source shop. RestaMarket must be closed first.
if(process.argv.length!==2)throw new Error('İstifadə: npm run desktop:transfer (əvvəlcə RestaMarket-i bağlayın).');
const pkg=JSON.parse(await readFile('package.json','utf8'));
const dataRoot=process.env.BIRKASSA_DATA_DIR||(process.env.APPDATA?path.join(process.env.APPDATA,'BirKassa','local-data'):null);
if(!dataRoot)throw new Error('Mövcud məlumat qovluğu göstərilməyib.');
const result=await createTransferPackage({dataRoot,version:pkg.version,
 installer:path.resolve('desktop-release','v'+pkg.version,`RestaMarket-Setup-${pkg.version}.exe`),
 outputParent:path.resolve('desktop-release'),pgBin:process.env.BIRKASSA_PG_BIN||path.resolve('desktop/vendor/postgres/bin')});
console.log('Verified private transfer folder: '+result.output);
console.log('Local data included: '+JSON.stringify(result.counts));
console.log('The archive was restored and every user table matched. No live migrations, seed or restore were run. Do not upload this private folder.');
