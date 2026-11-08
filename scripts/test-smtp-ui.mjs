import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import ts from 'typescript';
import postcss from 'postcss';

// Real component handlers/effects with controlled fetch promises. Never opens
// an SMTP connection, sends email, reads secrets or touches a live database.
const require=createRequire(import.meta.url);
async function load(path,mocks={}){
 const result=ts.transpileModule(await readFile(path,'utf8'),{fileName:path,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true},reportDiagnostics:true});
 assert.deepEqual((result.diagnostics||[]).filter(value=>value.category===ts.DiagnosticCategory.Error),[],path);
 const loaded={exports:{}};new Function('require','module','exports',result.outputText)(name=>Object.hasOwn(mocks,name)?mocks[name]:require(name),loaded,loaded.exports);return loaded.exports;
}
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const flush=async()=>{for(let index=0;index<30;index++)await Promise.resolve();};
function nodes(node){if(!node||typeof node!=='object')return [];return [node,...[node.props?.children].flat(Infinity).flatMap(nodes)];}
function text(node){if(node==null||node===false)return '';if(typeof node==='string'||typeof node==='number')return String(node);return [node.props?.children].flat(Infinity).map(text).join(' ');}
function button(tree,label){const result=nodes(tree).find(node=>node.type==='button'&&text(node).includes(label));assert.ok(result,label);return result;}
function field(tree,label){const item=nodes(tree).find(node=>node.type==='label'&&text(node).startsWith(label));assert.ok(item,label);const input=nodes(item).find(node=>node.type==='input'||node.type==='select');assert.ok(input,label);return input;}
const event={preventDefault(){}};
const config={enabled:false,provider:'custom',host:'smtp.example.test',port:587,security:'starttls',username:'shop@example.test',fromEmail:'shop@example.test',fromName:'RestaMarket',replyTo:'',passwordConfigured:true,revision:7};
const data=(overrides={})=>({settings:{...config,...overrides},status:{lastTestAt:null,lastTestStatus:null,errorCode:null},delivery:{failed:0}});
const nativeFetch=globalThis.fetch;
let requests=[];
globalThis.fetch=(url,options={})=>{const work=deferred();requests.push({url:String(url),options,...work});return work.promise;};
async function fixture(initial=data()){
 let hooks=[],cursor=0,effects=[],writes=0;
 const react={useId:()=> 'smtp-ui-fixture',useRef(initial){const index=cursor++;if(!(index in hooks))hooks[index]={current:initial};return hooks[index];},useState(initial){const index=cursor++;if(!(index in hooks))hooks[index]=typeof initial==='function'?initial():initial;return [hooks[index],value=>{writes++;hooks[index]=typeof value==='function'?value(hooks[index]):value;}];},useEffect(callback,deps){const index=cursor++,previous=hooks[index];if(!previous||deps.some((value,offset)=>value!==previous.deps[offset])){hooks[index]={deps};effects.push(()=>{previous?.cleanup?.();hooks[index].cleanup=callback();});}}};
 const {default:Manager}=await load('app/admin/store/smtp-manager.tsx',{react,'lucide-react':new Proxy({},{get:()=>()=>null}),'@/lib/language':{useTranslations:()=>({t:value=>value,languageLocale:()=> 'en-GB'})},'./smtp-manager.css':{}});
 const f={render(){cursor=0;const tree=Manager();for(const node of nodes(tree)){const ref=node.props?.ref;if(ref&&typeof ref==='object'&&!ref.current)ref.current={focus(){}};}for(const effect of effects.splice(0))effect();return tree;},unmount(){for(const hook of hooks)hook?.cleanup?.();},get writes(){return writes;}};
 requests=[];assert.match(text(f.render()),/SMTP ayarları yüklənir/);assert.equal(requests.length,1);assert.equal(requests[0].url,'/api/admin/smtp');assert.equal(requests[0].options.cache,'no-store');
 if(initial){requests[0].resolve(Response.json(initial));await flush();}
 return f;
}
const configForm=tree=>nodes(tree).find(node=>node.type==='form'&&node.props.className==='smtp-config-form');
const testForm=tree=>nodes(tree).find(node=>node.type==='form'&&node.props.className==='smtp-test-form');
try{
 {
  const secret='NEVER-RETURNED-FIXTURE-SECRET';const initial=data();initial.settings.password=secret;initial.status={lastTestAt:'2026-11-08T10:00:00Z',lastTestStatus:'failed',errorCode:secret};initial.delivery.failed=2;
  const f=await fixture(initial),tree=f.render();assert.equal(field(tree,'SMTP şifrəsi / tətbiq şifrəsi').props.type,'password');assert.equal(field(tree,'SMTP şifrəsi / tətbiq şifrəsi').props.value,'');assert.ok(!text(tree).includes(secret),'Stored credentials or arbitrary provider error codes are never displayed');assert.match(text(tree),/başqa əlaqə vasitəsi/);assert.match(text(tree),/Avtomatik təkrar göndəriş edilmir/);assert.equal(button(tree,'Bağlantını yoxla').props.disabled,false,'Saved disabled config may be tested without enabling automatic mail');
  function forms(node,depth=0){if(!node||typeof node!=='object')return;if(node.type==='form'){assert.equal(depth,0,'Settings and test forms cannot nest');depth++;}for(const child of [node.props?.children].flat(Infinity))forms(child,depth);}forms(tree);f.unmount();
 }
 {
  const f=await fixture(),tree=f.render(),oldVerify=button(tree,'Bağlantını yoxla').props.onClick;field(tree,'SMTP server adı').props.onChange({target:{value:'new.example.test'}});oldVerify();assert.equal(requests.length,1,'Synchronous dirty guard blocks even a stale test-button handler');assert.equal(button(f.render(),'Bağlantını yoxla').props.disabled,true);button(f.render(),'Dəyişiklikləri geri al').props.onClick();assert.equal(button(f.render(),'Bağlantını yoxla').props.disabled,false);f.unmount();
 }
 {
  const f=await fixture(),tree=f.render(),oldVerify=button(tree,'Bağlantını yoxla').props.onClick;field(tree,'SMTP şifrəsi / tətbiq şifrəsi').props.onChange({target:{value:'fixture-new-password'}});oldVerify();assert.equal(requests.length,1,'An unsaved replacement password must not trigger a test');button(f.render(),'Dəyişiklikləri geri al').props.onClick();assert.equal(field(f.render(),'SMTP şifrəsi / tətbiq şifrəsi').props.value,'');f.unmount();
 }
 {
  const f=await fixture();field(f.render(),'E-poçt provayderi').props.onChange({target:{value:'gmail'}});let tree=f.render();assert.equal(field(tree,'SMTP server adı').props.value,'smtp.gmail.com');assert.equal(field(tree,'SMTP server adı').props.readOnly,true);assert.equal(field(tree,'Port və şifrələmə').props.value,465);assert.equal(field(tree,'Port və şifrələmə').props.disabled,true);assert.match(text(tree),/2 mərhələli/);assert.match(text(tree),/Adi hesab şifrəsini yazmayın/);
  field(tree,'E-poçt provayderi').props.onChange({target:{value:'custom'}});field(f.render(),'Port və şifrələmə').props.onChange({target:{value:'587'}});field(f.render(),'SMTP şifrəsi / tətbiq şifrəsi').props.onChange({target:{value:'fixture-app-password'}});configForm(f.render()).props.onSubmit(event);assert.equal(requests.length,2);assert.equal(requests[1].options.method,'POST');const payload=JSON.parse(requests[1].options.body);assert.deepEqual(payload,{action:'save',revision:7,enabled:false,provider:'custom',host:'smtp.gmail.com',port:587,security:'starttls',username:'shop@example.test',fromEmail:'shop@example.test',fromName:'RestaMarket',replyTo:'',password:'fixture-app-password'});
  requests[1].resolve(Response.json({ok:true,message:'SMTP ayarları saxlanıldı.'}));await flush();assert.equal(requests.length,3);tree=f.render();assert.equal(field(tree,'SMTP şifrəsi / tətbiq şifrəsi').props.value,'','New password is cleared after server accepts a save');assert.equal(button(tree,'Bağlantını yoxla').props.disabled,true,'Testing waits for authoritative post-save refresh');requests[2].resolve(Response.json(data({...payload,revision:8,passwordConfigured:true})));await flush();tree=f.render();assert.equal(button(tree,'Bağlantını yoxla').props.disabled,false);assert.equal(button(tree,'SMTP ayarlarını saxla').props.disabled,true);f.unmount();
 }
 {
  const f=await fixture();field(f.render(),'Göndərən adı').props.onChange({target:{value:'Updated store'}});configForm(f.render()).props.onSubmit(event);const payload=JSON.parse(requests[1].options.body);assert.equal(Object.hasOwn(payload,'password'),false,'Blank secret is omitted, not sent as an accidental erasure');assert.equal(payload.revision,7);requests[1].resolve(Response.json({error:'SMTP ayarları saxlanmadı.'},{status:503}));await flush();assert.equal(field(f.render(),'Göndərən adı').props.value,'Updated store','Failed saves retain editable values');assert.equal(button(f.render(),'SMTP ayarlarını saxla').props.disabled,false);f.unmount();
 }
 {
  const f=await fixture();const verify=button(f.render(),'Bağlantını yoxla').props.onClick;verify();verify();assert.equal(requests.length,2,'Duplicate verify click is blocked synchronously');assert.deepEqual(JSON.parse(requests[1].options.body),{action:'verify'},'Verify uses saved credentials only');requests[1].resolve(Response.json({ok:true,message:'SMTP bağlantısı yoxlanıldı.'}));await flush();requests[2].resolve(Response.json({...data(),status:{lastTestAt:'2026-11-08T10:00:00Z',lastTestStatus:'verified',errorCode:null}}));await flush();assert.match(text(f.render()),/SMTP bağlantısı yoxlanılıb/);assert.equal(nodes(f.render()).find(node=>node.type==='input'&&node.props.type==='checkbox').props.checked,false,'Verify does not enable automatic notifications');f.unmount();
 }
 {
  const f=await fixture();field(f.render(),'Test məktubunun alıcısı').props.onChange({target:{value:'first@example.test, second@example.test'}});testForm(f.render()).props.onSubmit(event);assert.equal(requests.length,1,'Test UI rejects multiple recipients');field(f.render(),'Test məktubunun alıcısı').props.onChange({target:{value:'one@example.test'}});testForm(f.render()).props.onSubmit(event);assert.deepEqual(JSON.parse(requests[1].options.body),{action:'test',to:'one@example.test'},'No arbitrary subject, body, sender, credentials or host can be injected by test UI');requests[1].resolve(Response.json({ok:true,message:'SMTP serveri məktubu qəbul etdi. Gələnlər və spam qovluğunu yoxlayın.'}));await flush();requests[2].resolve(Response.json({...data(),status:{lastTestAt:'2026-11-08T10:00:00Z',lastTestStatus:'sent',errorCode:null}}));await flush();assert.match(text(f.render()),/Test məktubu SMTP serverinə verilib/);f.unmount();
 }
 {
  const f=await fixture(data({passwordConfigured:false})),tree=f.render();assert.equal(button(tree,'Bağlantını yoxla').props.disabled,true);button(tree,'Bağlantını yoxla').props.onClick();assert.equal(requests.length,1,'No verify without saved secret');f.unmount();
 }
 {
  const f=await fixture();button(f.render(),'Bağlantını yoxla').props.onClick();requests[1].resolve(Response.json({error:'SMTP giriş məlumatları qəbul edilmədi. İstifadəçi adı və tətbiq şifrəsini yoxlayın.'},{status:502}));await flush();assert.equal(requests.length,3,'Failed verification refreshes the server-recorded failure status');requests[2].resolve(Response.json({...data(),status:{lastTestAt:'2026-11-08T10:00:00Z',lastTestStatus:'failed',errorCode:'EAUTH'}}));await flush();const tree=f.render();assert.match(text(tree),/Son yoxlama alınmadı/);assert.match(text(tree),/SMTP istifadəçi adını və tətbiq şifrəsini yoxlayın/);assert.match(text(tree),/SMTP giriş məlumatları qəbul edilmədi/,'The friendly failure alert survives status refresh');f.unmount();
 }
 {
  const f=await fixture();field(f.render(),'Göndərən adı').props.onChange({target:{value:'Updated name'}});configForm(f.render()).props.onSubmit(event);requests[1].resolve(Response.json({ok:true,message:'SMTP ayarları saxlanıldı.'}));await flush();requests[2].resolve(Response.json({error:'SMTP ayarları yüklənmədi.'},{status:503}));await flush();let tree=f.render();assert.equal(button(tree,'Bağlantını yoxla').props.disabled,true);assert.equal(button(tree,'SMTP ayarlarını saxla').props.disabled,true,'Unknown post-save revision must be reloaded, not overwritten');button(tree,'SMTP vəziyyətini yenilə').props.onClick();requests[3].resolve(Response.json(data({fromName:'Updated name',revision:8})));await flush();tree=f.render();assert.equal(button(tree,'Bağlantını yoxla').props.disabled,false);f.unmount();
 }
 {
  const f=await fixture();field(f.render(),'Göndərən adı').props.onChange({target:{value:'Unsaved changed name'}});configForm(f.render()).props.onSubmit(event);requests[1].resolve(Response.json({error:'SMTP ayarları dəyişib.'},{status:409}));await flush();assert.equal(button(f.render(),'Bağlantını yoxla').props.disabled,true);assert.ok(button(f.render(),'SMTP vəziyyətini yenilə'));f.unmount();
 }
 {
  const f=await fixture(null),work=requests[0];f.unmount();const before=f.writes;assert.equal(work.options.signal.aborted,true);work.resolve(Response.json(data()));await flush();assert.equal(f.writes,before,'Late initial reads do not revive an unmounted settings form');
 }
 {
  const f=await fixture();button(f.render(),'Bağlantını yoxla').props.onClick();const work=requests[1];f.unmount();const before=f.writes;assert.equal(work.options.signal.aborted,true);work.resolve(Response.json({ok:true}));await flush();assert.equal(f.writes,before,'Late mutations never write into an unmounted manager');
 }
}finally{globalThis.fetch=nativeFetch;}

const source=await readFile('app/admin/store/smtp-manager.tsx','utf8');
assert.doesNotMatch(source,/localStorage|sessionStorage|process\.env|nodemailer|node:fs|console\./,'UI never persists credentials, imports secret-bearing server code or logs SMTP details');
assert.match(source,/type="password"/);assert.doesNotMatch(source,/type=\{[^}]*password|showPassword/,'No saved/new password reveal control');
const css=await readFile('app/admin/store/smtp-manager.css','utf8');postcss.parse(css);assert.match(css,/minmax\(0,1fr\)/);assert.match(css,/focus-visible/);assert.match(css,/prefers-reduced-motion/);

const {smtpTranslations}=await load('lib/smtp-translations.ts');
const languageSource=await readFile('lib/language.tsx','utf8'),languageTree=ts.createSourceFile('language.tsx',languageSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),keys=new Set();
function rows(node){if(ts.isArrayLiteralExpression(node)&&node.elements.length===5&&node.elements.every(ts.isStringLiteral))keys.add(node.elements[0].text);ts.forEachChild(node,rows);}rows(languageTree);
for(const node of languageTree.statements)if(ts.isImportDeclaration(node)&&ts.isStringLiteral(node.moduleSpecifier)&&node.moduleSpecifier.text.endsWith('-translations')&&node.moduleSpecifier.text!=='./smtp-translations'){
 const path='lib/'+node.moduleSpecifier.text.replace(/^\.\//,'')+'.ts';rows(ts.createSourceFile(path,await readFile(path,'utf8'),ts.ScriptTarget.Latest,true));
}
for(const row of (await load('lib/desktop-translations.ts')).desktopTranslations)keys.add(row[0]);
for(const row of smtpTranslations){assert.equal(row.length,5);assert.ok(row.every(value=>typeof value==='string'&&value.trim()),row[0]);assert.equal(keys.has(row[0]),false,'SMTP row must not duplicate existing dictionary key: '+row[0]);keys.add(row[0]);}
const tree=ts.createSourceFile('smtp-manager.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),required=new Set();
function literal(node){if(ts.isStringLiteral(node))required.add(node.text);else if(ts.isConditionalExpression(node)){literal(node.whenTrue);literal(node.whenFalse);}}
function scan(node){if(ts.isCallExpression(node)&&['t','setError','setNotice'].includes(node.expression.getText(tree)))node.arguments.forEach(literal);if(ts.isFunctionDeclaration(node)&&['safeStatus','safeError'].includes(node.name?.text)){function returned(child){if(ts.isReturnStatement(child)&&child.expression)literal(child.expression);ts.forEachChild(child,returned);}returned(node);}ts.forEachChild(node,scan);}scan(tree);
for(const key of required)if(key)assert.ok(keys.has(key),'SMTP UI requires five-language translation: '+key);
assert.match(languageSource,/import\s*\{smtpTranslations\}\s*from\s*['"]\.\/smtp-translations['"]/);assert.match(languageSource,/\.\.\.smtpTranslations/);
console.log('PASS: SMTP UI saved-only verify/test, secret readback masking, Gmail/TLS presets, explicit opt-in, revision/save payload, duplicate/dirty/unmount guards, failed-save recovery, stale refresh gate, fixed single-recipient test transport, sanitized status and five-language responsive UI. No SMTP or live-data access.');
