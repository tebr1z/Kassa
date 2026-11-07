'use client';
import {useEffect,useRef,useState} from 'react';
import {LocateFixed,MapPin} from 'lucide-react';
import {useTranslations} from '@/lib/language';
import {attachGoogleAddressSearch,googleAddressLanguage,type GooglePlacesApi} from '@/lib/google-address';
import './google-address.css';
export type DeliveryPin={lat:number;lng:number};
type Listener={remove:()=>void};
type MapInstance={addListener:(name:string,callback:(event:{latLng:{lat:()=>number;lng:()=>number}|null})=>void)=>Listener;panTo:(pin:DeliveryPin)=>void};
type CircleInstance={setCenter:(pin:DeliveryPin)=>void;setMap:(map:MapInstance|null)=>void};
type MapsApi=GooglePlacesApi&{Map:new(element:HTMLElement,options:object)=>MapInstance;Circle:new(options:object)=>CircleInstance};
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
export default function DeliveryLocationPicker({browserKey,pin,onPick,address='',onAddressPick,selectionVersion,disabled=false}:{browserKey:string;pin:DeliveryPin|null;onPick:(pin:DeliveryPin)=>void;address?:string;onAddressPick?:(address:string,pin:DeliveryPin)=>void;selectionVersion?:()=>number;disabled?:boolean}){
 const {t,language}=useTranslations();const mounted=useRef(true),geoRun=useRef(0),latestVersion=useRef(selectionVersion),text=useRef(t),box=useRef<HTMLDivElement>(null),searchBox=useRef<HTMLDivElement>(null),search=useRef<Awaited<ReturnType<typeof attachGoogleAddressSearch>>>(null),view=useRef<MapInstance|null>(null),marker=useRef<CircleInstance|null>(null),pick=useRef(onPick),addressPick=useRef(onAddressPick),blocked=useRef(disabled),latestPin=useRef(pin),latestAddress=useRef(address),latestLanguage=useRef(language);
 const [opened,setOpened]=useState(false),[loadingMap,setLoadingMap]=useState(false),[error,setError]=useState(''),[loadAttempt,setLoadAttempt]=useState(0);
 const [searchError,setSearchError]=useState('');
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 useEffect(()=>{latestVersion.current=selectionVersion;text.current=t;pick.current=onPick;addressPick.current=onAddressPick;blocked.current=disabled;latestPin.current=pin;latestAddress.current=address;latestLanguage.current=language;if(search.current){search.current.widget.disabled=disabled;search.current.widget.requestedLanguage=googleAddressLanguage(language);search.current.widget.placeholder=t('Google-da ünvan axtarın');search.current.widget.setAttribute('aria-label',t('Google-da ünvan axtarın'));}},[onPick,onAddressPick,disabled,pin,address,language,t,selectionVersion]);
 useEffect(()=>{
  if(!opened||!browserKey)return;let gone=false,listener:Listener|undefined;
  loadGoogleMaps(browserKey).then(async api=>{
   if(gone||!box.current)return;const center=latestPin.current||{lat:40.4093,lng:49.8671};
   const map=new api.Map(box.current,{center,zoom:latestPin.current?16:11,streetViewControl:false,mapTypeControl:false,fullscreenControl:false,gestureHandling:'cooperative'});view.current=map;
   marker.current=new api.Circle({map,center,radius:12,fillColor:'#176747',fillOpacity:1,strokeColor:'#ffffff',strokeWeight:3,clickable:false});
   listener=map.addListener('click',event=>{if(!blocked.current&&event.latLng){geoRun.current++;pick.current({lat:Number(event.latLng.lat().toFixed(6)),lng:Number(event.latLng.lng().toFixed(6))});}});setLoadingMap(false);
   if(searchBox.current&&addressPick.current){
    try{const controller=await attachGoogleAddressSearch(api,searchBox.current,{placeholder:text.current('Google-da ünvan axtarın'),language:latestLanguage.current,isCurrent:()=>!gone,isBlocked:()=>blocked.current,version:()=>String(latestVersion.current?.()??0)+'|'+latestAddress.current+'|'+JSON.stringify(latestPin.current),onSelect:(label,point)=>{geoRun.current++;setSearchError('');addressPick.current?.(label,point);},onError:()=>setSearchError('Ünvan axtarışı alınmadı. Ünvanı əl ilə yaza və xəritədə nöqtə seçə bilərsiniz.')});if(gone)controller?.destroy();else search.current=controller;}
    catch{if(!gone)setSearchError('Ünvan axtarışı alınmadı. Ünvanı əl ilə yaza və xəritədə nöqtə seçə bilərsiniz.');}
   }
  }).catch(()=>{if(!gone){setLoadingMap(false);setError('Xəritə yüklənmədi.');}});
  return()=>{gone=true;listener?.remove();search.current?.destroy();search.current=null;marker.current?.setMap(null);marker.current=null;view.current=null;};
  // The map starts once; later pin changes update the existing view below.
 },[opened,browserKey,loadAttempt]);
 useEffect(()=>{if(pin){view.current?.panTo(pin);marker.current?.setCenter(pin);}},[pin]);
 function locate(){setError('');if(!navigator.geolocation){setError('Məkan icazəsi alınmadı.');return;}const run=++geoRun.current,version=latestVersion.current?.();navigator.geolocation.getCurrentPosition(position=>{if(mounted.current&&!blocked.current&&run===geoRun.current&&version===latestVersion.current?.())pick.current({lat:Number(position.coords.latitude.toFixed(6)),lng:Number(position.coords.longitude.toFixed(6))});},()=>{if(mounted.current&&run===geoRun.current&&version===latestVersion.current?.())setError('Məkan icazəsi alınmadı.');},{enableHighAccuracy:true,timeout:10000});}
 return <section className="sf-location-picker" aria-label={t('Çatdırılma nöqtəsi')}><div className="sf-location-actions">{browserKey&&!opened&&<button type="button" className="sf-map-open" disabled={disabled} onClick={()=>{setOpened(true);setLoadingMap(true);setError('');setSearchError('');}}><MapPin size={17}/>{t('Google xəritəsində seç')}</button>}<button type="button" className="sf-map-open" disabled={disabled} onClick={locate}><LocateFixed size={17}/>{t('Cari məkanım')}</button></div>{!browserKey&&<p>{t('Google xəritəsi hələ qoşulmayıb. Ünvanı yaza bilərsiniz.')}</p>}{opened&&<>{onAddressPick&&<div className="sf-google-address"><p>{t('Google-da ünvan axtarın')}</p><div ref={searchBox}/><small>{t('Nəticəni seçəndə ünvan və xəritə nöqtəsi birlikdə doldurulur. Bina və mənzili dəqiqləşdirin.')}</small>{searchError&&<p role="status">{t(searchError)}</p>}</div>}<div ref={box} className="sf-google-map" aria-label={t('Nöqtə seçmək üçün xəritəyə basın.')}/><small>{t(loadingMap?'Xəritə yüklənir…':'Nöqtə seçmək üçün xəritəyə basın.')}</small></>}{pin&&<p className="sf-pin-status"><MapPin size={14}/>{t('Seçilmiş nöqtə')}: {pin.lat.toFixed(6)}, {pin.lng.toFixed(6)}</p>}{error&&<p role="alert" className="sf-form-error">{t(error)}{opened&&<button type="button" className="sf-map-open" onClick={()=>{setError('');setSearchError('');setLoadingMap(true);setLoadAttempt(value=>value+1);}}>{t('Yenidən yoxla')}</button>}</p>}{browserKey&&!opened&&<small>{t('Xəritəni açanda Google Maps xidmətinə qoşulursunuz.')}</small>}</section>;
}
