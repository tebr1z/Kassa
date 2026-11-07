'use client';

import {useEffect,useId,useRef,useState} from 'react';
import {LoaderCircle,LocateFixed,MapPin,Search,X} from 'lucide-react';
import {useTranslations} from '@/lib/language';
import {isAzerbaijanCoordinate} from '@/lib/azerbaijan-location';
import {AddressMap} from './address-map';
import './open-map.css';

export type DeliveryPin={lat:number;lng:number};
type Place=DeliveryPin&{label:string};
type Props={browserKey?:string;pin:DeliveryPin|null;onPick:(pin:DeliveryPin)=>void;address?:string;onAddressPick?:(address:string,pin:DeliveryPin)=>void;selectionVersion?:()=>number;disabled?:boolean;tileUrl?:string};
type Results={places:Place[];version:string};
const searchFailure='Ünvan axtarışı hazırda əlçatan deyil. Ünvanı əl ilə yazın və xəritədə nöqtə seçin.';

// browserKey is accepted only for older callers. Customer maps need no API key.
export default function DeliveryLocationPicker({pin,onPick,address='',onAddressPick,selectionVersion,disabled=false,tileUrl}:Props){
 const {t,language}=useTranslations(),id=useId();
 const mounted=useRef(true),geoRun=useRef(0),searchRun=useRef(0),request=useRef<AbortController|null>(null);
 const latest=useRef({pin,address,onPick,onAddressPick,selectionVersion,disabled,language});
 const [opened,setOpened]=useState(false),[query,setQuery]=useState(''),[results,setResults]=useState<Results|null>(null);
 const [searching,setSearching]=useState(false),[locating,setLocating]=useState(false),[error,setError]=useState('');
 const [tileSettings,setTileSettings]=useState<{loaded:boolean;url?:string}>({loaded:false});
 useEffect(()=>{latest.current={pin,address,onPick,onAddressPick,selectionVersion,disabled,language};},[pin,address,onPick,onAddressPick,selectionVersion,disabled,language]);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;request.current?.abort();};},[]);
 useEffect(()=>{
  if(!opened||tileUrl||tileSettings.loaded)return;
  const controller=new AbortController();
  void fetch('/api/delivery-settings',{cache:'no-store',signal:controller.signal}).then(async response=>{
   if(!response.ok)throw new Error();const data=await response.json() as {settings?:{tileUrl?:string}};
   if(!controller.signal.aborted)setTileSettings({loaded:true,url:typeof data.settings?.tileUrl==='string'?data.settings.tileUrl:undefined});
  }).catch(()=>{if(!controller.signal.aborted)setTileSettings({loaded:true});});
  return()=>controller.abort();
 },[opened,tileUrl,tileSettings.loaded]);
 function version(){const current=latest.current;return String(current.selectionVersion?.()??0)+'|'+current.address+'|'+JSON.stringify(current.pin)+'|'+current.language;}
 function invalidateSearch(){searchRun.current++;request.current?.abort();request.current=null;setSearching(false);setResults(null);}
 function acceptPin(point:DeliveryPin){
  if(latest.current.disabled)return;
  geoRun.current++;setLocating(false);invalidateSearch();
  if(!isAzerbaijanCoordinate(point.lat,point.lng)){setError('Azərbaycan daxilində nöqtə seçin. Ünvanı əl ilə də yaza bilərsiniz.');return;}
  setError('');latest.current.onPick(point);
 }
 function locate(){
  if(latest.current.disabled)return;
  setError('');invalidateSearch();
  if(!navigator.geolocation){setError('Məkan icazəsi alınmadı.');return;}
  const run=++geoRun.current,selected=version();setLocating(true);
  const current=()=>mounted.current&&!latest.current.disabled&&run===geoRun.current&&selected===version();
  navigator.geolocation.getCurrentPosition(position=>{
   if(!mounted.current||run!==geoRun.current)return;
   setLocating(false);if(!current())return;
   const point={lat:Number(position.coords.latitude.toFixed(6)),lng:Number(position.coords.longitude.toFixed(6))};
   if(!isAzerbaijanCoordinate(point.lat,point.lng)){setError('Azərbaycan daxilində nöqtə seçin. Ünvanı əl ilə də yaza bilərsiniz.');return;}
   latest.current.onPick(point);
  },()=>{if(!mounted.current||run!==geoRun.current)return;setLocating(false);if(current())setError('Məkan icazəsi alınmadı.');},{enableHighAccuracy:true,timeout:10000});
 }
 async function search(){
  if(latest.current.disabled||request.current)return;
  const q=query.trim();if(q.length<3||q.length>120){setError('Axtarış 3–120 simvol olmalıdır.');return;}
  geoRun.current++;setLocating(false);
  const controller=new AbortController();request.current=controller;
  const run=++searchRun.current,selected=version();setSearching(true);setResults(null);setError('');
  const current=()=>mounted.current&&!latest.current.disabled&&run===searchRun.current&&selected===version();
  try{
   const response=await fetch('/api/places',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({q,lang:latest.current.language}),cache:'no-store',signal:controller.signal});
   const data=await response.json() as {places?:Place[];error?:string};
   if(!current())return;
   if(!response.ok)throw new Error(data.error||searchFailure);
   const places=Array.isArray(data.places)?data.places.filter(place=>place&&typeof place.label==='string'&&place.label.trim()&&typeof place.lat==='number'&&typeof place.lng==='number'&&isAzerbaijanCoordinate(place.lat,place.lng)).slice(0,6):[];
   setResults({places,version:selected});if(!places.length)setError('Bu axtarışla ünvan tapılmadı.');
  }catch(cause){if(current()&&!controller.signal.aborted)setError(cause instanceof TypeError||cause instanceof SyntaxError?searchFailure:cause instanceof Error?cause.message:searchFailure);}
  finally{if(mounted.current&&run===searchRun.current){setSearching(false);request.current=null;}}
 }
 function choose(place:Place){
  if(latest.current.disabled)return;
  if(results?.version!==version()){invalidateSearch();setError('Ünvan dəyişib. Lazımdırsa, yenidən axtarın.');return;}
  geoRun.current++;setLocating(false);invalidateSearch();setError('');
  const point={lat:Number(place.lat.toFixed(6)),lng:Number(place.lng.toFixed(6))};
  if(latest.current.onAddressPick)latest.current.onAddressPick(place.label.trim().slice(0,500),point);else latest.current.onPick(point);
 }
 return <section className="sf-location-picker open-address-picker" aria-label={t('Çatdırılma nöqtəsi')}>
  <div className="open-address-actions"><button type="button" className="open-address-button" disabled={disabled} aria-expanded={opened} aria-controls={id+'-map-panel'} onClick={()=>{if(latest.current.disabled)return;geoRun.current++;setLocating(false);invalidateSearch();setError('');setOpened(value=>!value);}}><MapPin size={17} aria-hidden="true"/>{t(opened?'Xəritəni bağla':'Xəritəni aç və ünvan axtar')}</button><button type="button" className="open-address-button" disabled={disabled} onClick={locate}>{locating?<LoaderCircle size={17} className="open-address-spin" aria-hidden="true"/>:<LocateFixed size={17} aria-hidden="true"/>}{t('Cari məkanım')}</button></div>
  {!opened&&<small className="open-address-hint">{t('Xəritə və axtarış yalnız açdıqda qoşulur. Ünvanı əl ilə də yaza bilərsiniz.')}</small>}
  {opened&&<div id={id+'-map-panel'} className="open-address-panel">
   <p className="open-address-hint">{t('Xəritə OpenStreetMap, axtarış Nominatim xidmətindən istifadə edir. Axtarışa mənzil və şəxsi məlumat yazmayın.')}</p>
   <div className="open-address-search"><label htmlFor={id+'-query'}>{t('Ünvan axtar')}<span className="open-address-query"><Search size={17} aria-hidden="true"/><input id={id+'-query'} value={query} disabled={disabled} onChange={event=>{invalidateSearch();setQuery(event.target.value);setError('');}} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();void search();}}} maxLength={120} autoComplete="off" placeholder={t('Küçə, məhəllə və ya nişan')}/>{query&&<button type="button" disabled={disabled} aria-label={t('Axtarışı təmizlə')} onClick={()=>{invalidateSearch();setQuery('');setError('');}}><X size={16} aria-hidden="true"/></button>}</span></label><button type="button" className="open-address-button" disabled={disabled||searching||query.trim().length<3} onClick={()=>void search()}>{searching?<LoaderCircle size={16} className="open-address-spin" aria-hidden="true"/>:<Search size={16} aria-hidden="true"/>}{t(searching?'Axtarılır…':'Axtar')}</button></div>
   <small className="open-address-hint">{t('Axtarış yalnız düyməyə basanda göndərilir. Nəticədən sonra bina və mənzili əl ilə dəqiqləşdirin.')}</small>
   {results&&results.places.length>0&&<ul className="open-address-results" aria-label={t('Ünvan nəticələri')}>{results.places.map(place=><li key={place.lat+','+place.lng+','+place.label}><button type="button" disabled={disabled} onClick={()=>choose(place)}><MapPin size={17} aria-hidden="true"/><span>{place.label}</span></button></li>)}</ul>}
   {tileUrl||tileSettings.loaded?<AddressMap pin={pin} onPick={acceptPin} disabled={disabled} tileUrl={tileUrl||tileSettings.url}/>:<p className="open-address-status" role="status"><LoaderCircle size={16} className="open-address-spin" aria-hidden="true"/>{t('Xəritə yüklənir…')}</p>}
   <small className="open-address-attribution">© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a> · <a href="https://nominatim.org/" target="_blank" rel="noopener noreferrer">Nominatim</a></small>
  </div>}
  {pin&&<p className="sf-pin-status open-address-pin"><MapPin size={14} aria-hidden="true"/>{t('Seçilmiş nöqtə')}: {pin.lat.toFixed(6)}, {pin.lng.toFixed(6)}</p>}
  {error&&<p className="open-address-status is-warning" role="status">{t(error)}</p>}
 </section>;
}
