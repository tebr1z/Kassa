import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import nextEnv from '@next/env';
const development=process.argv[2]==='--dev';
process.env.NODE_ENV||=development?'development':'production';
nextEnv.loadEnvConfig(process.cwd(),development);
if(!process.env.BIRKASSA_ADMIN_SETUP_TOKEN){
 try{process.env.BIRKASSA_ADMIN_SETUP_TOKEN=(await readFile(path.resolve('.private','web-admin-setup-token.txt'),'utf8')).trim();}
 catch(error){if(error.code!=='ENOENT')throw error;}
}
const cli=path.resolve('node_modules/next/dist/bin/next');
process.argv=[process.execPath,cli,development?'dev':'start','--hostname','127.0.0.1','--port',process.env.PORT||'5757',...process.argv.slice(development?3:2)];
await import(pathToFileURL(cli).href);
