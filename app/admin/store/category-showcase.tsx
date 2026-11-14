"use client";
import {useEffect,useState} from "react";

type Category={id:string;name:string;isActive:boolean;imageUrl:string;showOnHome:boolean};

export default function CategoryShowcase({configured,local=false}:{configured:boolean;local?:boolean}){
 const [rows,setRows]=useState<Category[]>([]),[message,setMessage]=useState(""),[busy,setBusy]=useState(false);
 const canUpload=local===true||configured;
 async function load(){const response=await fetch("/api/categories",{cache:"no-store"});if(response.ok)setRows(await response.json());}
 useEffect(()=>{void load();},[]);
 async function toggle(row:Category){
  setBusy(true);setMessage("");
  const response=await fetch("/api/categories",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:row.id,showOnHome:!row.showOnHome})});
  const result=await response.json() as {error?:string};
  if(!response.ok)setMessage(result.error||"Saxlanmadı");else await load();
  setBusy(false);
 }
 async function upload(id:string,file?:File){
  if(!file)return;setBusy(true);setMessage("");
  try{
   const body=new FormData();body.set("file",file);body.set("categoryId",id);
   const response=await fetch("/api/store-admin/upload",{method:"POST",body});
   const result=await response.json() as {error?:string};
   if(!response.ok)throw new Error(result.error||"Şəkil yüklənmədi");
   setMessage(local?'Şəkil kompüterdə saxlanıldı.':'Şəkil Cloudinary-ə yükləndi.');await load();
  }catch(error){setMessage(error instanceof Error?error.message:"Şəkil yüklənmədi.");}
  finally{setBusy(false);}
 }
 const selected=rows.filter(row=>row.showOnHome).length;
 return <section className="panel settings-form" style={{marginBottom:20}}><div className="sa-title"><div><h2>Kateqoriya şəkilləri</h2><p>{local?'Şəkillər bu kompüterdə saxlanılır.':'Şəkil Cloudinary-ə düşür.'} “Ana səhifədə” işarələnən kateqoriyalar saytda menyu kimi görünür. Populyar məhsullar öz yerində qalır.</p></div><span className="sa-count">{selected} seçilib</span></div>{!canUpload&&<p role="alert" style={{marginTop:12,color:"#92400e"}}>Şəkil yükləmək üçün əvvəl Cloudinary və mesaj bölməsində cloud name, API key və API secret saxlayın.</p>}{message&&<p role="alert" style={{marginTop:12,color:message.startsWith("Şəkil Cloudinary")||message==='Şəkil kompüterdə saxlanıldı.'?"#166534":"#92400e"}}>{message}</p>}<div style={{display:"grid",marginTop:8}}>{rows.map(row=><div key={row.id} style={{display:"flex",alignItems:"center",gap:16,padding:"14px 0",borderBottom:"1px solid #eee",flexWrap:"wrap"}}>{row.imageUrl?<img src={row.imageUrl} alt="" style={{width:72,height:72,objectFit:"cover",borderRadius:12}}/>:<div style={{width:72,height:72,borderRadius:12,background:"#f1f3ed"}}/>}<strong style={{flex:"1 1 160px"}}>{row.name}{!row.isActive&&<small style={{display:"block",color:"#92400e",fontWeight:500}}>Deaktiv</small>}</strong><label style={{display:"flex",alignItems:"center",gap:8}}><input type="checkbox" checked={row.showOnHome} disabled={busy} onChange={()=>void toggle(row)}/> Ana səhifədə</label><input aria-label={row.name+" şəkli"} type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" disabled={busy||!canUpload} onChange={event=>{void upload(row.id,event.target.files?.[0]);event.currentTarget.value="";}}/></div>)}</div></section>;
}
