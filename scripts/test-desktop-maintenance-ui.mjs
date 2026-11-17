import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import ts from 'typescript';
import postcss from 'postcss';

// Render real components with deterministic React hooks and a mocked native
// bridge. Never contact the web, open a desktop profile, reset sales or export data.
const require=createRequire(import.meta.url);
async function load(path,mocks={}){
 const result=ts.transpileModule(await readFile(path,'utf8'),{fileName:path,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true},reportDiagnostics:true});
 assert.deepEqual((result.diagnostics||[]).filter(row=>row.category===ts.DiagnosticCategory.Error),[],path);
 const loaded={exports:{}};new Function('require','module','exports',result.outputText)(name=>Object.hasOwn(mocks,name)?mocks[name]:require(name),loaded,loaded.exports);return loaded.exports;
}
const labels=await load('lib/desktop-maintenance-labels.ts'),labelSource=await readFile('lib/desktop-maintenance-labels.ts','utf8');
const keys=[...labelSource.matchAll(/^\s+([a-zA-Z]\w*):\[/gm)].map(row=>row[1]);assert.ok(keys.length>35);
const dummy=()=>null;
function nodes(node){return node&&typeof node==='object'?[node,...[node.props?.children].flat(Infinity).flatMap(nodes)]:[];}
function text(node){return node==null||node===false?'':typeof node==='string'||typeof node==='number'?String(node):[node.props?.children].flat(Infinity).map(text).join(' ');}
function react(states={}){let cursor=0;return {useState(initial){const index=cursor++,logical=index>=1?index+1:index;return [Object.hasOwn(states,logical)?states[logical]:typeof initial==='function'?initial():initial,()=>{}];},useRef:value=>({current:value}),useEffect(){},useSyncExternalStore:()=>states[1]===true};}
const preview={preview:'fixture-preview-unchanged',currentPeriod:{startedAt:null,resetId:null},sales:{receipts:3,completed:2,returned:1,total:42.5},openShiftCount:0,archive:{receipts:4},serverTime:'2026-11-17T10:00:00Z'};
let exported=0,resets=0,refreshes=0,payload=null;
globalThis.window={birkassaDesktop:{exportTransfer:async()=>{exported++;return {ok:true};},resetSalesPeriod:async value=>{resets++;payload=value;return {ok:true};}}};
globalThis.fetch=()=>{throw Error('A native action must not POST from the renderer or touch a real endpoint');};
for(const language of ['az','en','ru','tr','zh']){
 const copy=key=>labels.desktopMaintenanceLabel(language,key);for(const key of keys)assert.ok(copy(key)?.trim(),language+' '+key);
 const mocks={'@/lib/language':{useLanguage:()=>language,languageLocale:()=>({az:'az-AZ',en:'en-US',ru:'ru-RU',tr:'tr-TR',zh:'zh-CN'}[language]),languageAmount:value=>String(value)},'@/lib/desktop-maintenance-labels':labels,'@/components/ui/button':{Button:dummy},'@/components/ui/input':{Input:dummy},'@/components/ui/dialog':Object.fromEntries(['Dialog','DialogContent','DialogDescription','DialogFooter','DialogHeader','DialogTitle'].map(key=>[key,dummy])),'lucide-react':Object.fromEntries(['Archive','ArrowRight','DatabaseBackup','FolderOutput','LoaderCircle','RotateCcw','ShieldCheck'].map(key=>[key,dummy])),'./desktop-maintenance.css':{}};
 const render=async(states={})=>{const loaded=await load('app/admin/desktop-maintenance-panel.tsx',{...mocks,react:react(states)});return loaded.default({onReset:()=>{refreshes++;}});};
 const browser=await render(),browserNodes=nodes(browser);assert.ok(text(browser).includes(copy('nativeRequired')));assert.equal(browserNodes.filter(node=>node.type===dummy&&[copy('createTransfer'),copy('reviewReset')].some(label=>text(node).includes(label))).every(node=>node.props.disabled===true),true,'Ordinary browser exposes no actionable native maintenance controls');
 const transfer=await render({0:'transfer',1:true}),transferForm=nodes(transfer).find(node=>node.type==='form');assert.ok(text(transfer).includes(copy('sensitive')));assert.ok(text(transfer).includes(copy('intro')));await transferForm.props.onSubmit({preventDefault(){}});assert.equal(exported,['az','en','ru','tr','zh'].indexOf(language)+1);
 const reset=await render({0:'reset',1:true,4:preview,7:'Disposable test reset',8:'YENİ DÖVR'}),resetNodes=nodes(reset),resetText=text(reset);for(const key of ['resetHelp','retained','backupRequired','receipts','archived','reason','confirmLabel'])assert.ok(resetText.includes(copy(key)),language+' '+key);
 const submit=resetNodes.find(node=>node.type===dummy&&node.props.type==='submit');assert.equal(submit.props.disabled,false);await resetNodes.find(node=>node.type==='form').props.onSubmit({preventDefault(){}});assert.deepEqual(payload,{confirm:'YENİ DÖVR',reason:'Disposable test reset',preview:'fixture-preview-unchanged'});
 const previousResets=resets;
 for(const fixture of [{4:{...preview,openShiftCount:1},8:'YENİ DÖVR',7:'Test reason'},{4:preview,8:'YES',7:'Test reason'},{4:preview,8:'YENİ DÖVR',7:''},{4:null,8:'YENİ DÖVR',7:'Test reason'}]){const blocked=await render({0:'reset',1:true,...fixture}),items=nodes(blocked);assert.equal(items.find(node=>node.type===dummy&&node.props.type==='submit').props.disabled,true);await items.find(node=>node.type==='form').props.onSubmit({preventDefault(){}});assert.equal(resets,previousResets,'Closed shifts, fresh preview, exact phrase and reason are enforced before native handoff');}
 const {SalesPeriodScopeControl}=await load('app/admin/desktop-maintenance-panel.tsx',{...mocks,react:react()});let chosen=null;const scoped=SalesPeriodScopeControl({value:'all',finance:true,onChange:value=>{chosen=value;},metadata:{startedAt:'2026-11-17T10:00:00Z'}});const scopeText=text(scoped);for(const key of ['all','scopeAll','archiveRange','financeNote'])assert.ok(scopeText.includes(copy(key)));nodes(scoped).find(node=>node.type==='select').props.onChange({target:{value:'current'}});assert.equal(chosen,'current');
}
assert.equal(resets,5);assert.equal(refreshes,5);
const dashboard=await readFile('app/admin/staff-dashboard.tsx','utf8'),finance=await readFile('app/admin/finance-overview.tsx','utf8'),panel=await readFile('app/admin/desktop-maintenance-panel.tsx','utf8');
assert.match(dashboard,/auth\.user\.role==="admin"&&<DesktopMaintenancePanel/);
assert.match(dashboard,/auth\.local===true\?<><DesktopConnection\/>/);
assert.match(dashboard,/reportAbort\.current\?\.abort\(\)/);assert.match(dashboard,/request===reportRequest\.current/);assert.match(dashboard,/scope:nextScope/);
assert.match(finance,/financeAbort\.current\?\.abort\(\)/);assert.match(finance,/request===financeRequest\.current/);assert.match(finance,/scope:nextScope/);
const dashboardAst=ts.createSourceFile('staff-dashboard.tsx',dashboard,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
for(const statement of dashboardAst.statements)if(ts.isVariableStatement(statement))assert.doesNotMatch(statement.getText(dashboardAst),/=\s*use(?:State|Ref|Effect)\(/,'Hooks must be inside the actual component, not module scope');
assert.doesNotMatch(panel,/method\s*:\s*['"]POST['"]|Authorization|Bearer|apiKey|backupPath/,'Renderer receives no privileged maintenance credentials or filesystem capability');
postcss.parse(await readFile('app/admin/desktop-maintenance.css','utf8'));
console.log('Desktop maintenance UI PASS: 5 languages, native-only transfer/reset, preserved-data notices, closed-shift/phrase/preview guards, current/archive scope and stale-request protection; no real business data used');
