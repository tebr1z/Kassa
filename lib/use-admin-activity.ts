"use client";
import {useEffect} from 'react';
import {staffPortalPath} from './staff-portal';
export function useAdminActivity(){
 useEffect(()=>{
  let authenticated=false,last=0,active=true;
  const check=async()=>{try{const response=await fetch('/api/auth',{cache:'no-store'}),state=await response.json() as {authenticated:boolean};if(!active)return;if(!state.authenticated){window.location.replace(staffPortalPath());return;}authenticated=true;}catch{}};
  const activity=()=>{if(!authenticated||Date.now()-last<60000)return;last=Date.now();void fetch('/api/auth',{method:'PATCH'}).then(response=>{if(response.status===401)window.location.replace(staffPortalPath());}).catch(()=>{});};
  void check();const timer=setInterval(()=>void check(),30000);const events=['keydown','pointerdown','touchstart'];events.forEach(event=>window.addEventListener(event,activity,{passive:true}));
  return()=>{active=false;clearInterval(timer);events.forEach(event=>window.removeEventListener(event,activity));};
 },[]);
}
