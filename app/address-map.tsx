'use client';

import {useEffect,useRef,useState} from 'react';
import type {CircleMarker,Map as LeafletMap} from 'leaflet';
import {Crosshair,LoaderCircle,RefreshCw} from 'lucide-react';
import {useTranslations} from '@/lib/language';
import {azerbaijanMapBounds,defaultAzerbaijanMapCenter,isAzerbaijanCoordinate} from '@/lib/azerbaijan-location';
import type {DeliveryPin} from './delivery-location-picker';
import 'leaflet/dist/leaflet.css';
import './open-map.css';

type Props={pin:DeliveryPin|null;onPick:(pin:DeliveryPin)=>void;disabled?:boolean;tileUrl?:string};
const defaultTiles='https://tile.openstreetmap.org/{z}/{x}/{y}.png';

// Leaflet is bundled locally and evaluated only after the customer opens a map.
// Each effect owns its map/listeners; a late import cannot revive an old map.
export function AddressMap({pin,onPick,disabled=false,tileUrl=defaultTiles}:Props){
 const {t}=useTranslations();
 const box=useRef<HTMLDivElement>(null),view=useRef<LeafletMap|null>(null),marker=useRef<CircleMarker|null>(null);
 const latest=useRef({pin,onPick,disabled});
 const [ready,setReady]=useState(false),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
 useEffect(()=>{latest.current={pin,onPick,disabled};},[pin,onPick,disabled]);
 useEffect(()=>{
  let gone=false,ownView:LeafletMap|undefined,resize:ResizeObserver|undefined;
  void import('leaflet').then(L=>{
   if(gone||!box.current)return;
   const current=latest.current.pin,start=current&&isAzerbaijanCoordinate(current.lat,current.lng)?current:defaultAzerbaijanMapCenter;
   ownView=L.map(box.current,{scrollWheelZoom:false,keyboard:true,maxBounds:azerbaijanMapBounds,maxBoundsViscosity:0.85,minZoom:6,maxZoom:19}).setView([start.lat,start.lng],current?16:11);
   const map=ownView;view.current=map;
   L.tileLayer(tileUrl||defaultTiles,{maxZoom:19,updateWhenIdle:true,keepBuffer:1,referrerPolicy:'strict-origin-when-cross-origin',attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}).on('tileerror',()=>{if(!gone)setError('Xəritə şəkilləri yüklənmədi. Ünvanı əl ilə yaza bilərsiniz.');}).addTo(map);
   if(current&&isAzerbaijanCoordinate(current.lat,current.lng))marker.current=L.circleMarker([current.lat,current.lng],{radius:9,color:'#fff',weight:3,fillColor:'#176747',fillOpacity:1,interactive:false}).addTo(map);
   map.on('click',event=>{if(!gone&&!latest.current.disabled)latest.current.onPick({lat:Number(event.latlng.lat.toFixed(6)),lng:Number(event.latlng.lng.toFixed(6))});});
   if(typeof ResizeObserver!=='undefined'){resize=new ResizeObserver(()=>{if(!gone)map.invalidateSize({pan:false});});resize.observe(box.current);}
   setReady(true);
  }).catch(()=>{if(!gone)setError('Xəritə yüklənmədi. Ünvanı əl ilə yaza bilərsiniz.');});
  return()=>{gone=true;resize?.disconnect();ownView?.remove();if(view.current===ownView){view.current=null;marker.current=null;}};
 },[tileUrl,attempt]);
 useEffect(()=>{
  const map=view.current;if(!map)return;
  if(!pin||!isAzerbaijanCoordinate(pin.lat,pin.lng)){marker.current?.remove();marker.current=null;return;}
  if(marker.current)marker.current.setLatLng([pin.lat,pin.lng]);
  else{
   let gone=false;
   void import('leaflet').then(L=>{if(!gone&&view.current===map&&!marker.current)marker.current=L.circleMarker([pin.lat,pin.lng],{radius:9,color:'#fff',weight:3,fillColor:'#176747',fillOpacity:1,interactive:false}).addTo(map);});
   map.setView([pin.lat,pin.lng],16);return()=>{gone=true;};
  }
  map.setView([pin.lat,pin.lng],16);
 },[pin]);
 return <div className="open-address-map-wrap">
  <div ref={box} className="address-map open-address-map" role="region" aria-label={t('Azərbaycan xəritəsi. Klaviatura oxları ilə hərəkət edə bilərsiniz.')} aria-busy={!ready&&!error}/>
  {!ready&&!error&&<p className="open-address-status" role="status"><LoaderCircle size={16} className="open-address-spin" aria-hidden="true"/>{t('Xəritə yüklənir…')}</p>}
  {error&&<p className="open-address-status is-warning" role="status">{t(error)} <button type="button" disabled={disabled} onClick={()=>{setError('');setReady(false);setAttempt(value=>value+1);}}><RefreshCw size={14} aria-hidden="true"/>{t('Yenidən yoxla')}</button></p>}
  <div className="open-address-map-tools"><button type="button" className="open-address-button" disabled={disabled||!ready} onClick={()=>{const center=view.current?.getCenter();if(center&&!latest.current.disabled)latest.current.onPick({lat:Number(center.lat.toFixed(6)),lng:Number(center.lng.toFixed(6))});}}><Crosshair size={16} aria-hidden="true"/>{t('Xəritənin mərkəzini seç')}</button><small>{t('Nöqtə üçün xəritəyə toxunun və ya oxlarla hərəkət edib mərkəzi seçin.')}</small></div>
 </div>;
}
