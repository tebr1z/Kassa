'use client';
import {useEffect,useRef,useState} from 'react';
import {LocateFixed,MapPin} from 'lucide-react';
import {t,useLanguage} from '@/lib/language';
export type DeliveryPin={lat:number;lng:number};
type Listener={remove:()=>void};
type MapInstance={addListener:(name:string,callback:(event:{latLng:{lat:()=>number;lng:()=>number}|null})=>void)=>Listener;panTo:(pin:DeliveryPin)=>void};
type CircleInstance={setCenter:(pin:DeliveryPin)=>void;setMap:(map:MapInstance|null)=>void};
type MapsApi={Map:new(element:HTMLElement,options:object)=>MapInstance;Circle:new(options:object)=>CircleInstance};
type MapsWindow=Window & {google?:{maps:MapsApi};__restamarketMapsReady?:()=>void};
let loading:Promise<MapsApi>|null=null;
function loadGoogleMaps(key:string){
 const browser=window as MapsWindow;if(browser.google?.maps)return Promise.resolve(browser.google.maps);
 if(loading)return loading;
 loading=new Promise<MapsApi>((resolve,reject)=>{
  const script=document.createElement('script');script.id='restamarket-google-map';script.async=true;script.referrerPolicy='strict-origin-when-cross-origin';
  const fail=()=>{clearTimeout(timer);delete browser.__restamarketMapsReady;script.remove();loading=null;reject(new Error('Xəritə yüklənmədi.'));};
  const timer=setTimeout(fail,15000);
  browser.__restamarketMapsReady=()=>{clearTimeout(timer);delete browser.__restamarketMapsReady;if(browser.google?.maps)resolve(browser.google.maps);else fail();};
  script.onerror=fail;script.src='https://maps.googleapis.com/maps/api/js?key='+encodeURIComponent(key)+'&loading=async&callback=__restamarketMapsReady';document.head.appendChild(script);
 });return loading;
}
export default function DeliveryLocationPicker({browserKey,pin,onPick,disabled=false}:{browserKey:string;pin:DeliveryPin|null;onPick:(pin:DeliveryPin)=>void;disabled?:boolean}){
 useLanguage();const box=useRef<HTMLDivElement>(null),view=useRef<MapInstance|null>(null),marker=useRef<CircleInstance|null>(null),pick=useRef(onPick),blocked=useRef(disabled),latestPin=useRef(pin);
 const [opened,setOpened]=useState(false),[loadingMap,setLoadingMap]=useState(false),[error,setError]=useState(''),[loadAttempt,setLoadAttempt]=useState(0);
 useEffect(()=>{pick.current=onPick;blocked.current=disabled;latestPin.current=pin;},[onPick,disabled,pin]);
 useEffect(()=>{
  if(!opened||!browserKey)return;let gone=false,listener:Listener|undefined;
  loadGoogleMaps(browserKey).then(api=>{
   if(gone||!box.current)return;const center=latestPin.current||{lat:40.4093,lng:49.8671};
   const map=new api.Map(box.current,{center,zoom:latestPin.current?16:11,streetViewControl:false,mapTypeControl:false,fullscreenControl:false,gestureHandling:'cooperative'});view.current=map;
   marker.current=new api.Circle({map,center,radius:12,fillColor:'#176747',fillOpacity:1,strokeColor:'#ffffff',strokeWeight:3,clickable:false});
   listener=map.addListener('click',event=>{if(!blocked.current&&event.latLng)pick.current({lat:Number(event.latLng.lat().toFixed(6)),lng:Number(event.latLng.lng().toFixed(6))});});setLoadingMap(false);
  }).catch(()=>{if(!gone){setLoadingMap(false);setError('Xəritə yüklənmədi.');}});
  return()=>{gone=true;listener?.remove();marker.current?.setMap(null);marker.current=null;view.current=null;};
  // The map starts once; later pin changes update the existing view below.
 },[opened,browserKey,loadAttempt]);
 useEffect(()=>{if(pin){view.current?.panTo(pin);marker.current?.setCenter(pin);}},[pin]);
 function locate(){setError('');if(!navigator.geolocation){setError('Məkan icazəsi alınmadı.');return;}navigator.geolocation.getCurrentPosition(position=>{if(!blocked.current)pick.current({lat:Number(position.coords.latitude.toFixed(6)),lng:Number(position.coords.longitude.toFixed(6))});},()=>setError('Məkan icazəsi alınmadı.'),{enableHighAccuracy:true,timeout:10000});}
 return <section className="sf-location-picker" aria-label={t('Çatdırılma nöqtəsi')}><div className="sf-location-actions">{browserKey&&!opened&&<button type="button" className="sf-map-open" disabled={disabled} onClick={()=>{setOpened(true);setLoadingMap(true);setError('');}}><MapPin size={17}/>{t('Google xəritəsində seç')}</button>}<button type="button" className="sf-map-open" disabled={disabled} onClick={locate}><LocateFixed size={17}/>{t('Cari məkanım')}</button></div>{!browserKey&&<p>{t('Google xəritəsi hələ qoşulmayıb. Ünvanı yaza bilərsiniz.')}</p>}{opened&&<><div ref={box} className="sf-google-map" aria-label={t('Nöqtə seçmək üçün xəritəyə basın.')}/><small>{t(loadingMap?'Xəritə yüklənir…':'Nöqtə seçmək üçün xəritəyə basın.')}</small></>}{pin&&<p className="sf-pin-status"><MapPin size={14}/>{t('Seçilmiş nöqtə')}: {pin.lat.toFixed(6)}, {pin.lng.toFixed(6)}</p>}{error&&<p role="alert" className="sf-form-error">{t(error)}{opened&&<button type="button" className="sf-map-open" onClick={()=>{setError('');setLoadingMap(true);setLoadAttempt(value=>value+1);}}>{t('Yenidən yoxla')}</button>}</p>}{browserKey&&!opened&&<small>{t('Xəritəni açanda Google Maps xidmətinə qoşulursunuz.')}</small>}</section>;
}
