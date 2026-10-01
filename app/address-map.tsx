"use client";
import {useEffect,useRef} from "react";
type Pin={lat:number;lng:number};
type MapApi={map:(el:HTMLElement,o:object)=>MapApi;setView:(c:[number,number],z:number)=>MapApi;on:(e:string,fn:(ev:{latlng:{lat:number;lng:number}})=>void)=>void;remove:()=>void;marker:(c:[number,number],o?:object)=>{addTo:(m:MapApi)=>{setLatLng:(c:[number,number])=>void};};tileLayer:(u:string,o:object)=>{addTo:(m:MapApi)=>void};};
export function AddressMap({pin,onPick}:{pin:Pin|null;onPick:(pin:Pin)=>void}){
 const box=useRef<HTMLDivElement>(null),map=useRef<MapApi|null>(null),marker=useRef<{setLatLng:(c:[number,number])=>void}|null>(null),pick=useRef(onPick);
 pick.current=onPick;
 useEffect(()=>{
  let gone=false;
  const link=document.createElement("link");link.rel="stylesheet";link.href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";document.head.appendChild(link);
  const script=document.createElement("script");script.src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";script.async=true;
  script.onload=()=>{
   if(gone||!box.current||map.current)return;
   const L=(window as unknown as {L:MapApi}).L;
   const start:Pin=pin||{lat:40.4093,lng:49.8671};
   const view=L.map(box.current,{scrollWheelZoom:true}).setView([start.lat,start.lng],pin?16:12);
   L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{attribution:"© OpenStreetMap"}).addTo(view);
   view.on("click",event=>pick.current({lat:Number(event.latlng.lat.toFixed(6)),lng:Number(event.latlng.lng.toFixed(6))}));
   if(pin)marker.current=L.marker([pin.lat,pin.lng]).addTo(view);
   map.current=view;
  };
  document.body.appendChild(script);
  return()=>{gone=true;map.current?.remove();map.current=null;marker.current=null;};
 },[]);
 useEffect(()=>{
  const view=map.current;if(!view||!pin)return;
  const L=(window as unknown as {L:MapApi}).L;
  if(!marker.current)marker.current=L.marker([pin.lat,pin.lng]).addTo(view);
  else marker.current.setLatLng([pin.lat,pin.lng]);
  view.setView([pin.lat,pin.lng],16);
 },[pin]);
 return <div ref={box} className="address-map" role="application" aria-label="Ünvan xəritəsi. Nöqtə seçmək üçün xəritəyə basın."/>;
}
