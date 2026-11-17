"use client";

import {useCallback,useEffect,useRef,useState,useSyncExternalStore,type FormEvent} from 'react';
import {Archive,ArrowRight,DatabaseBackup,FolderOutput,LoaderCircle,RotateCcw,ShieldCheck} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Dialog,DialogContent,DialogDescription,DialogFooter,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {languageAmount,languageLocale,useLanguage} from '@/lib/language';
import {desktopMaintenanceLabel} from '@/lib/desktop-maintenance-labels';
import './desktop-maintenance.css';

type ResetPolicy={master:boolean;used:number;remaining:number;limit:3;exhausted:boolean};
type NativeResult={ok:boolean;canceled?:boolean;error?:string;code?:string;resetPolicy?:ResetPolicy};
type MaintenanceBridge={storageMode?:'central'|'local';exportTransfer?:()=>Promise<NativeResult>;resetSalesPeriod?:(payload:{confirm:string;reason:string;preview:string})=>Promise<NativeResult>};
type Preview={preview:string;currentPeriod:{startedAt:string|null;resetId:string|null};sales:{receipts:number;completed:number;returned:number;total:number};openShiftCount:number;archive:{receipts:number};serverTime:string;resetPolicy:ResetPolicy};
export type SalesPeriodScope='current'|'all';
export type SalesPeriodMetadata={scope:SalesPeriodScope;startedAt:string|null;resetId:string|null;stockPreserved:true;financialExpensesPreserved:true;receiptsPreserved:true};
const confirmation='YENİ DÖVR';
function bridge(){return window.birkassaDesktop as (NonNullable<typeof window.birkassaDesktop>&MaintenanceBridge)|undefined;}
const subscribeNative=()=>()=>{};
function hasNativeMaintenance(){const api=bridge();return typeof api?.exportTransfer==='function'&&typeof api?.resetSalesPeriod==='function';}
function storageMode(){return bridge()?.storageMode==='central'?'central':'local';}
function validPolicy(value:unknown):value is ResetPolicy{
 if(!value||typeof value!=='object')return false;
 const policy=value as ResetPolicy;
 return typeof policy.master==='boolean'&&policy.limit===3&&Number.isInteger(policy.used)&&policy.used>=0&&policy.used<=3&&policy.remaining===3-policy.used&&policy.exhausted===(policy.remaining===0);
}

export function SalesPeriodScopeControl({value,onChange,metadata,finance=false,disabled=false}:{value:SalesPeriodScope;onChange:(value:SalesPeriodScope)=>void;metadata?:SalesPeriodMetadata;finance?:boolean;disabled?:boolean}){
 const language=useLanguage(),copy=(key:Parameters<typeof desktopMaintenanceLabel>[1])=>desktopMaintenanceLabel(language,key);
 return <div className="sales-period-scope"><label><Archive size={16}/>{copy('scope')}<select value={value} onChange={event=>onChange(event.target.value==='all'?'all':'current')} disabled={disabled}><option value="current">{copy('current')}</option><option value="all">{copy('all')}</option></select></label><p>{copy(value==='all'?'scopeAll':'scopeCurrent')}{metadata?.startedAt&&<> <strong>{copy('started')}: {new Date(metadata.startedAt).toLocaleString(languageLocale(),{timeZone:'Asia/Baku'})}.</strong></>}{value==='all'&&<> {copy('archiveRange')}</>}{finance&&<> {copy('financeNote')}</>}</p></div>;
}

export default function DesktopMaintenancePanel({onReset}:{onReset?:()=>void|Promise<void>}){
 const language=useLanguage(),copy=useCallback((key:Parameters<typeof desktopMaintenanceLabel>[1])=>desktopMaintenanceLabel(language,key),[language]);
 const native=useSyncExternalStore(subscribeNative,hasNativeMaintenance,()=>false);
 const central=useSyncExternalStore(subscribeNative,storageMode,()=> 'local')==='central';
 const [dialog,setDialog]=useState<'transfer'|'reset'|null>(null),[busy,setBusy]=useState(false),[loading,setLoading]=useState(false),[preview,setPreview]=useState<Preview|null>(null),[error,setError]=useState(''),[message,setMessage]=useState(''),[reason,setReason]=useState(''),[typed,setTyped]=useState(''),[policy,setPolicy]=useState<ResetPolicy|null>(null);
 const request=useRef(0),lock=useRef(false),mounted=useRef(true),abort=useRef<AbortController|null>(null);
 const friendlyError=useCallback((code?:string,fallback?:string)=>code==='MASTER_REQUIRED'?copy('masterRequired'):code==='RESET_LIMIT_EXHAUSTED'?copy('resetExhausted'):fallback||copy('failed'),[copy]);
 const loadPreview=useCallback(async()=>{
  const id=++request.current;abort.current?.abort();const controller=new AbortController();abort.current=controller;
  setLoading(true);setError('');setPreview(null);
  try{
   const response=await fetch('/api/sales-period',{cache:'no-store',signal:controller.signal}),result=await response.json() as Partial<Preview>&{error?:string;code?:string};
   if(controller.signal.aborted||!mounted.current||id!==request.current)return;
   const nextPolicy=validPolicy(result.resetPolicy)?result.resetPolicy:null;setPolicy(nextPolicy);
   if(!response.ok)throw Error(friendlyError(result.code||result.error,result.error||copy('loadError')));
   if(typeof result.preview!=='string'||!result.sales||!Number.isFinite(result.openShiftCount)||!nextPolicy)throw Error(copy('loadError'));
   setPreview(result as Preview);
  }catch(cause){if(mounted.current&&id===request.current&&!controller.signal.aborted)setError(cause instanceof Error?cause.message:copy('loadError'));}
  finally{if(mounted.current&&id===request.current)setLoading(false);}
 },[copy,friendlyError]);
 useEffect(()=>{mounted.current=true;let active=true;queueMicrotask(()=>{if(active&&native)void loadPreview();});return()=>{active=false;mounted.current=false;abort.current?.abort();};},[native,loadPreview]);
 const canReset=policy?.master===true&&policy.remaining>0&&!policy.exhausted;
 const resetReady=canReset&&preview!==null&&validPolicy(preview.resetPolicy)&&preview.resetPolicy.master&&preview.resetPolicy.remaining>0&&preview.resetPolicy.used===policy?.used&&!loading&&preview.openShiftCount===0&&typed===confirmation&&reason.trim().length>=3&&reason.trim().length<=500&&!/[\x00-\x1f\x7f]/.test(reason);
 function open(value:'transfer'|'reset'){
  if(lock.current||(value==='transfer'&&central)||(value==='reset'&&(!canReset||loading)))return;
  setError('');setMessage('');setReason('');setTyped('');setDialog(value);if(value==='reset'&&native)void loadPreview();
 }
 function close(){if(lock.current)return;request.current++;abort.current?.abort();setDialog(null);setPreview(null);setLoading(false);setError('');}
 async function run(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(lock.current||!native)return;const api=bridge(),action=dialog;if(!api||!action||(action==='transfer'&&central))return;
  if(action==='reset'&&!resetReady)return;
  lock.current=true;setBusy(true);setError('');
  try{
   const result=action==='transfer'?await api.exportTransfer!():await api.resetSalesPeriod!({confirm:typed,reason:reason.trim(),preview:preview!.preview});
   if(!mounted.current)return;if(result.canceled)return;
   if(!result.ok){if(validPolicy(result.resetPolicy))setPolicy(result.resetPolicy);throw Error(friendlyError(result.code||result.error,result.error));}
   setMessage(copy(action==='transfer'?'transferReady':'resetDone'));setDialog(null);setPreview(null);
   if(action==='reset'){void loadPreview();await onReset?.();}
  }catch(cause){if(mounted.current){setError(cause instanceof Error?cause.message:copy('failed'));if(action==='reset')setPreview(null);}}
  finally{lock.current=false;if(mounted.current)setBusy(false);}
 }
 const quota=policy&&<div className="maintenance-quota" role="status"><span>{copy('resetAllowance')}</span><dl><div><dt>{copy('resetUsed')}</dt><dd>{policy.used} / {policy.limit}</dd></div><div><dt>{copy('resetRemaining')}</dt><dd>{policy.remaining}</dd></div></dl><p>{copy(!policy.master?'masterRequired':policy.exhausted?'resetExhausted':'resetLimitHelp')}</p></div>;
 return <section className="desktop-maintenance panel" aria-labelledby="maintenance-title">
  <header><div className="maintenance-mark"><DatabaseBackup size={23}/></div><div><span>RestaMarket · Desktop</span><h2 id="maintenance-title">{copy('title')}</h2><p>{copy(central?'centralIntro':'intro')}</p></div></header>
  {central&&<p className="maintenance-native maintenance-central" role="status"><ShieldCheck size={17}/>{copy('centralOnline')}</p>}
  {!native&&<p className="maintenance-native" role="status"><ShieldCheck size={17}/>{copy('nativeRequired')}</p>}
  {message&&<p className="form-success" role="status">{message}</p>}{error&&!dialog&&<p className="form-error" role="alert">{error}</p>}
  <div className="maintenance-cards">
   <article><FolderOutput size={23}/><h3>{copy(central?'centralStorage':'transfer')}</h3><p>{copy(central?'centralTransferHelp':'transferHelp')}</p>{!central&&<Button variant="outline" onClick={()=>open('transfer')} disabled={!native||busy}>{copy('createTransfer')}<ArrowRight size={16}/></Button>}</article>
   <article className="maintenance-reset-card"><RotateCcw size={23}/><h3>{copy('reset')}</h3><p>{copy('resetHelp')}</p>{quota}{loading&&!policy&&<p className="maintenance-loading" role="status"><LoaderCircle className="maintenance-spinner" size={18}/>{copy('loading')}</p>}{(!policy||canReset)&&<Button variant="outline" onClick={()=>open('reset')} disabled={!native||busy||loading||!canReset}>{copy('reviewReset')}<ArrowRight size={16}/></Button>}{native&&!loading&&!policy&&<Button type="button" variant="outline" onClick={()=>void loadPreview()}>{copy('retry')}</Button>}</article>
  </div>
  <Dialog open={dialog!==null} onOpenChange={value=>{if(!value)close();}}><DialogContent className="desktop-maintenance-dialog" showCloseButton={!busy} onEscapeKeyDown={event=>{if(busy)event.preventDefault();}} onInteractOutside={event=>{if(busy)event.preventDefault();}}>
   <DialogHeader><DialogTitle>{copy(dialog==='transfer'?'transfer':'reset')}</DialogTitle><DialogDescription>{copy(dialog==='transfer'?'transferHelp':'resetHelp')}</DialogDescription></DialogHeader>
   <form onSubmit={run}>
    <div className="maintenance-notice"><ShieldCheck size={19}/><p>{copy(dialog==='transfer'?'sensitive':central?'centralBackupRequired':'backupRequired')}</p></div>
    {dialog==='reset'&&<><p className="maintenance-preserved">{copy('retained')}</p>{quota}{loading?<p className="maintenance-loading" role="status"><LoaderCircle className="maintenance-spinner" size={18}/>{copy('loading')}</p>:preview&&canReset?<>
     <dl className="maintenance-preview"><div><dt>{copy('receipts')}</dt><dd>{preview.sales.receipts}</dd></div><div><dt>{copy('total')}</dt><dd>{languageAmount(preview.sales.total)} ₼</dd></div><div><dt>{copy('completed')}</dt><dd>{preview.sales.completed}</dd></div><div><dt>{copy('returned')}</dt><dd>{preview.sales.returned}</dd></div><div><dt>{copy('openShifts')}</dt><dd>{preview.openShiftCount}</dd></div><div><dt>{copy('archived')}</dt><dd>{preview.archive.receipts}</dd></div></dl>
     <p className="maintenance-start">{copy('started')}: {preview.currentPeriod.startedAt?new Date(preview.currentPeriod.startedAt).toLocaleString(languageLocale(),{timeZone:'Asia/Baku'}):copy('initial')}</p>
     {preview.openShiftCount>0&&<p role="alert" className="form-error">{copy('closeShifts')}</p>}
     <label htmlFor="period-reason">{copy('reason')}<textarea id="period-reason" value={reason} onChange={event=>setReason(event.target.value)} required minLength={3} maxLength={500} rows={2} placeholder={copy('reasonPlaceholder')} disabled={busy}/></label>
     <label htmlFor="period-confirm">{copy('confirmLabel')}: <strong>{confirmation}</strong><Input id="period-confirm" value={typed} onChange={event=>setTyped(event.target.value)} autoComplete="off" spellCheck={false} required disabled={busy}/></label><p className="maintenance-small">{copy('backupChanging')}</p>
    </>:(!policy||canReset)&&<Button type="button" variant="outline" onClick={()=>void loadPreview()}>{copy('retry')}</Button>}</>}
    {error&&<p className="form-error" role="alert">{error}</p>}
    <DialogFooter><Button type="button" variant="outline" onClick={close} disabled={busy}>{copy('cancel')}</Button>{(dialog==='transfer'?!central:canReset)&&<Button type="submit" variant={dialog==='reset'?'destructive':'default'} disabled={!native||busy||(dialog==='reset'&&!resetReady)}>{busy?<><LoaderCircle className="maintenance-spinner" size={16}/>{copy('working')}</>:copy(dialog==='transfer'?'createTransfer':central?'centralConfirmAction':'confirmAction')}</Button>}</DialogFooter>
   </form>
  </DialogContent></Dialog>
 </section>;
}
