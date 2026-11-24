import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';

// Isolated provider/store unit test. No browser requests, catalogue, account,
// database or real localStorage are used. This complements browser hydration QA.
const nativeRequire=createRequire(import.meta.url);
const menuNames=['DropdownMenu','DropdownMenuTrigger','DropdownMenuContent','DropdownMenuLabel','DropdownMenuRadioGroup','DropdownMenuRadioItem','DropdownMenuSeparator'];
const originalGlobals=new Map(['window','document','localStorage'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));

function harness(saved){
 const storage=new Map(saved===undefined?[]:[['birkassa-language',saved]]),events=new Map(),cache=new Map(),effectSlots=[];
 let mode='server',effectIndex=0,subscribed=false,notifications=0;
 const pending=[],serverSnapshots=[];
 const context={current:'az',Provider:'LanguageContextProvider'};
 const react={
  createContext:()=>context,
  useContext:()=>context.current,
  useEffect(callback,dependencies){
   if(mode==='server')return;
   const index=effectIndex++,previous=effectSlots[index];
   if(!previous||dependencies.some((item,offset)=>!Object.is(item,previous[offset]))){effectSlots[index]=dependencies;pending.push(callback);}
  },
  useSyncExternalStore(subscribe,snapshot,serverSnapshot){
   serverSnapshots.push(serverSnapshot());
   if(mode!=='server'&&!subscribed){subscribe(()=>notifications++);subscribed=true;}
   return mode==='client'?snapshot():serverSnapshot();
  },
 };
 const document={documentElement:{lang:'az'}};
 const desktopLanguages=[];
 const window={
  addEventListener:(name,callback)=>events.set(name,callback),
  removeEventListener:(name,callback)=>{if(events.get(name)===callback)events.delete(name);},
  birkassaDesktop:{setLanguage:language=>desktopLanguages.push(language)},
 };
 const localStorage={getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,String(value))};
 Object.assign(globalThis,{window,document,localStorage});
 function load(file){
  file=path.resolve(file);
  if(cache.has(file))return cache.get(file).exports;
  const record={exports:{}};cache.set(file,record);
  const compiled=ts.transpileModule(readFileSync(file,'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX},reportDiagnostics:true});
  assert.deepEqual((compiled.diagnostics||[]).filter(item=>item.category===ts.DiagnosticCategory.Error),[]);
  const output=compiled.outputText+(file.endsWith(`${path.sep}language.tsx`)?'\nexports.__testRows=rows;':'');
  new Function('require','module','exports',output)(name=>{
   if(name==='react')return react;
   if(name==='lucide-react')return {Check:'Check',Languages:'Languages',ChevronDown:'ChevronDown'};
   if(name==='@/components/ui/dropdown-menu')return Object.fromEntries(menuNames.map(value=>[value,value]));
   if(name.startsWith('.'))return load(path.resolve(path.dirname(file),name+'.ts'));
   return nativeRequire(name);
  },record,record.exports);
  return record.exports;
 }
 const language=load('lib/language.tsx');
 function render(nextMode='client'){
  mode=nextMode;effectIndex=0;
  const provider=language.LanguageProvider({children:null});context.current=provider.props.value;
  const {t,languageAmount}=language.useTranslations();
  return renderToStaticMarkup(createElement('p',{'data-language':context.current},t('Məhsullar')+' '+languageAmount(1234.5)));
 }
 function flush(){for(const callback of pending.splice(0))callback();}
 function find(node,type){if(!node||typeof node!=='object')return;return node.type===type?node:[node.props?.children].flat(Infinity).map(child=>find(child,type)).find(Boolean);}
 function select(value){const group=find(language.LanguageSwitcher(),'DropdownMenuRadioGroup');assert.ok(group);group.props.onValueChange(value);}
 return {language,storage,events,document,desktopLanguages,serverSnapshots,render,flush,select,get current(){return context.current;},get notifications(){return notifications;}};
}

try{
 for(const saved of [undefined,'','de','constructor','__proto__','{"language":"ru"}','en-US','zh-CN']){
  const test=harness(saved),server=test.render('server'),hydrating=test.render('hydrate');
  assert.equal(hydrating,server,'Server and first hydration snapshots must agree');
  test.flush();test.render();test.flush();
  assert.equal(test.current,'az','Unknown saved language must not enter the provider');
  assert.equal(test.document.documentElement.lang,'az');
 }
 const expected={ru:'Товары',en:'Products',zh:'商品'};
 for(const [saved,label] of Object.entries(expected)){
  const test=harness(saved),server=test.render('server'),hydrating=test.render('hydrate');
  assert.equal(hydrating,server,'Saved language is restored after hydration, not during SSR');
  assert.match(server,/data-language="az"/);
  test.flush();const restored=test.render();test.flush();
  assert.equal(test.current,saved);assert.ok(restored.includes(label));
  assert.equal(test.document.documentElement.lang,saved);assert.equal(test.desktopLanguages.at(-1),saved);
  assert.ok(test.notifications>0,'Restoring saved language must notify subscribers');
  for(const [next,nextLabel] of Object.entries(expected)){
   test.select(next);const markup=test.render();test.flush();
   assert.equal(test.current,next);assert.equal(test.storage.get('birkassa-language'),next);
   assert.ok(markup.includes(nextLabel));assert.equal(test.document.documentElement.lang,next);
   assert.equal(test.desktopLanguages.at(-1),next);
  }
  const before=test.storage.get('birkassa-language');
  test.select('constructor');test.render();test.flush();assert.equal(test.current,before);assert.equal(test.storage.get('birkassa-language'),before);
  test.storage.set('birkassa-language','ru');test.events.get('storage')({key:'birkassa-language',newValue:'ru'});test.render();test.flush();
  assert.equal(test.current,'ru','A valid change from another tab must update the current tab');
  test.events.get('storage')({key:'unrelated',newValue:'en'});test.events.get('storage')({key:'birkassa-language',newValue:'constructor'});test.render();test.flush();assert.equal(test.current,'ru');
  assert.ok(test.serverSnapshots.every(value=>value==='az'),'SSR snapshot is stable even after switching');
 }
 const {language}=harness();
 const codes=['az','ru','en','tr','zh'];
 for(const row of language.__testRows){
  assert.equal(row.length,5,`Five language columns required for ${row[0]}`);
  assert.ok(row.every(value=>typeof value==='string'&&value.trim().length),`Empty translation for ${row[0]}`);
 }
 const lastRows=new Map(language.__testRows.map(row=>[row[0],row]));
 for(const [key,row] of lastRows)for(const [index,code] of codes.entries())assert.equal(language.t(key,code),row[index],`Translation column mismatch for ${code}: ${key}`);
 console.log('PASS: five-column dictionary consistency; safe saved-language fallback; RU/EN/ZH restore, menu switching, persistence, cross-tab and desktop language sync; stable SSR/first-hydration snapshots. No network or business data used.');
}finally{
 for(const [key,descriptor] of originalGlobals){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
}

