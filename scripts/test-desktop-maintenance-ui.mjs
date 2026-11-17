import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import ts from 'typescript';
import postcss from 'postcss';

// Render real components with deterministic hooks and native/fetch fakes. Never
// contact a server, open a desktop profile, reset sales or export business data.
const require=createRequire(import.meta.url);
async function load(path,mocks={}){
 const result=ts.transpileModule(await readFile(path,'utf8'),{fileName:path,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true},reportDiagnostics:true});
 assert.deepEqual((result.diagnostics||[]).filter(row=>row.category===ts.DiagnosticCategory.Error),[],path);
 const loaded={exports:{}};new Function('require','module','exports',result.outputText)(name=>Object.hasOwn(mocks,name)?mocks[name]:require(name),loaded,loaded.exports);return loaded.exports;
}
const labels=await load('lib/desktop-maintenance-labels.ts'),labelSource=await readFile('lib/desktop-maintenance-labels.ts','utf8');
const keys=[...labelSource.matchAll(/^\s+([a-zA-Z]\w*):\[/gm)].map(row=>row[1]);assert.ok(keys.length>45);
const dummy=()=>null;
function nodes(node){return node&&typeof node==='object'?[node,...[node.props?.children].flat(Infinity).flatMap(nodes)]:[];}
function text(node){return node==null||node===false?'':typeof node==='string'||typeof node==='number'?String(node):[node.props?.children].flat(Infinity).map(text).join(' ');}
const resetPolicy=(used=0,master=true)=>({master,used,remaining:3-used,limit:3,exhausted:used===3});
const preview={preview:'fixture-preview-unchanged',currentPeriod:{startedAt:null,resetId:null},sales:{receipts:3,completed:2,returned:1,total:42.5},openShiftCount:0,archive:{receipts:4},serverTime:'2026-11-17T10:00:00Z',resetPolicy:resetPolicy()};
let exported=0,resets=0,refreshes=0,payload=null,fetches=0;
const nativeBridge={storageMode:'local',exportTransfer:async()=>{exported++;return {ok:true};},resetSalesPeriod:async value=>{resets++;payload=value;return {ok:true};}};
const flush=async()=>{for(let index=0;index<10;index++)await Promise.resolve();};
globalThis.fetch=async(url,options)=>{
 assert.equal(url,'/api/sales-period');assert.equal(options.cache,'no-store');assert.ok(options.signal instanceof AbortSignal);
 assert.equal(options.method,undefined);assert.equal(options.headers,undefined);fetches++;return {ok:true,json:async()=>preview};
};
function harness(initial={},effects=false){
 const state={...initial},refs=[],setters=[],callbacks=[];let stateCursor=0,refCursor=0;
 return {state,setters,callbacks,reset(){stateCursor=0;refCursor=0;},hooks:{
  useState(initialValue){const index=stateCursor++;if(!Object.hasOwn(state,index))state[index]=typeof initialValue==='function'?initialValue():initialValue;return [state[index],value=>{state[index]=typeof value==='function'?value(state[index]):value;setters.push(index);}];},
  useRef(value){const index=refCursor++;return refs[index]??(refs[index]={current:value});},
  useCallback:callback=>callback,useEffect(callback){if(effects)callbacks.push(callback);},
  useSyncExternalStore:(_subscribe,snapshot)=>snapshot(),
 }};
}
for(const language of ['az','en','ru','tr','zh']){
 const copy=key=>labels.desktopMaintenanceLabel(language,key);for(const key of keys)assert.ok(copy(key)?.trim(),language+' '+key);
 const mocks={'@/lib/language':{useLanguage:()=>language,languageLocale:()=>({az:'az-AZ',en:'en-US',ru:'ru-RU',tr:'tr-TR',zh:'zh-CN'}[language]),languageAmount:value=>String(value)},'@/lib/desktop-maintenance-labels':labels,'@/components/ui/button':{Button:dummy},'@/components/ui/input':{Input:dummy},'@/components/ui/dialog':Object.fromEntries(['Dialog','DialogContent','DialogDescription','DialogFooter','DialogHeader','DialogTitle'].map(key=>[key,dummy])),'lucide-react':Object.fromEntries(['Archive','ArrowRight','DatabaseBackup','FolderOutput','LoaderCircle','RotateCcw','ShieldCheck'].map(key=>[key,dummy])),'./desktop-maintenance.css':{}};
 async function renderer(initial={},options={}){
  const h=harness(initial,options.effects);globalThis.window={birkassaDesktop:options.native===false?undefined:{...nativeBridge,storageMode:options.mode||'local'}};
  const loaded=await load('app/admin/desktop-maintenance-panel.tsx',{...mocks,react:h.hooks});
  const render=()=>{h.reset();return loaded.default({onReset:()=>{refreshes++;}});};
  return {...h,render,loaded,tree:render()};
 }
 const browser=(await renderer({}, {native:false})).tree,browserNodes=nodes(browser);assert.ok(text(browser).includes(copy('nativeRequired')));
 assert.equal(browserNodes.filter(node=>node.type===dummy&&[copy('createTransfer'),copy('reviewReset')].some(label=>text(node).includes(label))).every(node=>node.props.disabled===true),true,'Ordinary browser exposes no actionable native maintenance controls');
 const transfer=(await renderer({0:'transfer'})).tree,transferForm=nodes(transfer).find(node=>node.type==='form');
 assert.ok(text(transfer).includes(copy('sensitive')));assert.ok(text(transfer).includes(copy('intro')));await transferForm.props.onSubmit({preventDefault(){}});assert.equal(exported,['az','en','ru','tr','zh'].indexOf(language)+1);
 for(let used=0;used<=3;used++){
  const policy=resetPolicy(used),current={...preview,resetPolicy:policy};
  const reset=(await renderer({0:'reset',3:current,6:'Disposable test reset',7:'YENİ DÖVR',8:policy})).tree,items=nodes(reset),rendered=text(reset);
  for(const key of ['resetHelp','retained','backupRequired','resetAllowance','resetUsed','resetRemaining'])assert.ok(rendered.includes(copy(key)),language+' '+key);
  assert.ok(rendered.includes(`${used}  /  3`));assert.ok(items.some(node=>node.type==='dd'&&node.props.children===3-used));
  const submit=items.find(node=>node.type===dummy&&node.props.type==='submit'),before=resets;
  if(used===3){
   assert.equal(submit,undefined,'Exhausted allowance has no reset submission control');assert.ok(rendered.includes(copy('resetExhausted')));
   assert.equal(items.some(node=>node.props?.id==='period-confirm'||node.props?.id==='period-reason'),false,'No reset phrase/reason controls survive exhaustion');
   assert.equal(items.some(node=>node.type===dummy&&text(node).includes(copy('reviewReset'))),false);
  }else{
   assert.equal(submit.props.disabled,false);for(const key of ['receipts','archived','reason','confirmLabel','resetLimitHelp'])assert.ok(rendered.includes(copy(key)));
  }
  await items.find(node=>node.type==='form').props.onSubmit({preventDefault(){}});assert.equal(resets,before+(used===3?0:1));
  if(used<3)assert.deepEqual(payload,{confirm:'YENİ DÖVR',reason:'Disposable test reset',preview:'fixture-preview-unchanged'});
 }
 const previousResets=resets;
 for(const fixture of [
  {3:{...preview,openShiftCount:1},7:'YENİ DÖVR',6:'Test reason'},
  {3:preview,7:'YES',6:'Test reason'},{3:preview,7:'YENİ DÖVR',6:''},
  {3:preview,7:'YENİ DÖVR',6:'x'.repeat(501)},{3:preview,7:'YENİ DÖVR',6:'Test\nreason'},
  {3:null,7:'YENİ DÖVR',6:'Test reason'},
  {3:{...preview,resetPolicy:resetPolicy(3)},7:'YENİ DÖVR',6:'Test reason'},
 ]){
  const blocked=(await renderer({0:'reset',8:resetPolicy(),...fixture})).tree,items=nodes(blocked),submit=items.find(node=>node.type===dummy&&node.props.type==='submit');
  if(!fixture[6]?.includes('\n'))assert.equal(submit.props.disabled,true);
  await items.find(node=>node.type==='form').props.onSubmit({preventDefault(){}});assert.equal(resets,previousResets,'Native handoff requires master quota, closed shifts, exact phrase, reason and a matching fresh preview');
 }
 const otherAdmin=(await renderer({0:'reset',3:{...preview,resetPolicy:resetPolicy(1,false)},8:resetPolicy(1,false)})).tree;
 assert.ok(text(otherAdmin).includes(copy('masterRequired')));assert.equal(nodes(otherAdmin).some(node=>node.type===dummy&&node.props.type==='submit'),false);
 assert.ok(nodes(otherAdmin).some(node=>node.type===dummy&&text(node).includes(copy('createTransfer'))&&!node.props.disabled),'Non-master policy does not disable independent local transfer');
 const central=(await renderer({0:'transfer'}, {mode:'central'})).tree,centralItems=nodes(central),beforeTransfer=exported;
 for(const key of ['centralIntro','centralOnline','centralStorage','centralTransferHelp'])assert.ok(text(central).includes(copy(key)));
 assert.equal(centralItems.some(node=>node.type===dummy&&text(node).includes(copy('createTransfer'))),false,'Central mode has no local transfer action');
 await centralItems.find(node=>node.type==='form').props.onSubmit({preventDefault(){}});assert.equal(exported,beforeTransfer,'Forged central transfer dialog cannot invoke native export');
 const centralReset=(await renderer({0:'reset',3:preview,8:resetPolicy()}, {mode:'central'})).tree;
 assert.ok(text(centralReset).includes(copy('centralBackupRequired')));assert.ok(text(centralReset).includes(copy('centralConfirmAction')));

 // Mount fetch results after disposal must not call React setters. The AbortSignal
 // is supplied too, but the stale guard must work even if a fetch ignores abort.
 const originalFetch=globalThis.fetch;let resolveFetch,observedSignal;
 globalThis.fetch=(_url,options)=>{observedSignal=options.signal;return new Promise(resolve=>{resolveFetch=resolve;});};
 const disposed=await renderer({}, {effects:true});assert.equal(disposed.callbacks.length,1);
 const cleanup=disposed.callbacks[0]();await flush();const beforeDispose=disposed.setters.length;cleanup();assert.equal(observedSignal.aborted,true);
 resolveFetch({ok:true,json:async()=>preview});await flush();assert.equal(disposed.setters.length,beforeDispose,'Disposed preview request cannot change component state');
 globalThis.fetch=originalFetch;

 for(const code of ['MASTER_REQUIRED','RESET_LIMIT_EXHAUSTED']){
  const policy=code==='MASTER_REQUIRED'?resetPolicy(1,false):resetPolicy(3);
  globalThis.fetch=async()=>({ok:false,json:async()=>({code,error:'Opaque server error',resetPolicy:policy})});
  const denied=await renderer({}, {effects:true}),cleanup=denied.callbacks[0]();await flush();const deniedTree=denied.render(),deniedText=text(deniedTree);
  assert.ok(deniedText.includes(copy(code==='MASTER_REQUIRED'?'masterRequired':'resetExhausted')));assert.equal(deniedText.includes('Opaque server error'),false);
  assert.ok(deniedText.includes(copy('transfer')),'Policy GET denial does not remove the independent transfer card');
  assert.equal(nodes(deniedTree).some(node=>node.type===dummy&&text(node).includes(copy('reviewReset'))),false);cleanup();
 }
 globalThis.fetch=originalFetch;
 const {SalesPeriodScopeControl}=(await renderer()).loaded;let chosen=null;const scoped=SalesPeriodScopeControl({value:'all',finance:true,onChange:value=>{chosen=value;},metadata:{startedAt:'2026-11-17T10:00:00Z'}});
 for(const key of ['all','scopeAll','archiveRange','financeNote'])assert.ok(text(scoped).includes(copy(key)));nodes(scoped).find(node=>node.type==='select').props.onChange({target:{value:'current'}});assert.equal(chosen,'current');
}
assert.equal(resets,15);assert.equal(refreshes,15);assert.equal(exported,5);assert.ok(fetches>=15);
const dashboard=await readFile('app/admin/staff-dashboard.tsx','utf8'),finance=await readFile('app/admin/finance-overview.tsx','utf8'),panel=await readFile('app/admin/desktop-maintenance-panel.tsx','utf8');
assert.match(dashboard,/auth\.user\.role==="admin"&&<DesktopMaintenancePanel/);
assert.match(dashboard,/auth\.local===true\?<><DesktopConnection\/>/);
assert.match(dashboard,/reportAbort\.current\?\.abort\(\)/);assert.match(dashboard,/request===reportRequest\.current/);assert.match(dashboard,/scope:nextScope/);
assert.match(finance,/financeAbort\.current\?\.abort\(\)/);assert.match(finance,/request===financeRequest\.current/);assert.match(finance,/scope:nextScope/);
const dashboardAst=ts.createSourceFile('staff-dashboard.tsx',dashboard,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
for(const statement of dashboardAst.statements)if(ts.isVariableStatement(statement))assert.doesNotMatch(statement.getText(dashboardAst),/=\s*use(?:State|Ref|Effect)\(/,'Hooks must be inside the actual component, not module scope');
assert.doesNotMatch(panel,/method\s*:\s*['"]POST['"]|Authorization|Bearer|apiKey|backupPath/,'Renderer receives no privileged maintenance credentials or filesystem capability');
postcss.parse(await readFile('app/admin/desktop-maintenance.css','utf8'));
console.log('Desktop maintenance UI PASS: 5 languages; master quota 0–3, exhausted reset controls removed; central/local separation; friendly denials, disposal/stale guards, native-only handoff and archive scope; no real business data used');
