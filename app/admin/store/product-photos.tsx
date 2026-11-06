"use client";

type Photo={id:string;url:string};
type Product={id:string;name:string;image_url:string;category:string;stock:number;images?:Photo[]};

export default function ProductPhotos({products,search,category,disabled,onChanged,onStatus,readOnly=false}:{products:Product[];search:string;category:string;disabled:boolean;readOnly?:boolean;onChanged:()=>void;onStatus:(message:string)=>void}){
 async function add(id:string,file?:File){
  if(!file)return;
  if(file.size>4000000){onStatus("Hər şəkil ən çoxu 4 MB ola bilər.");return;}
  try{
   const body=new FormData();body.set("file",file);body.set("productId",id);
   const response=await fetch("/api/store-admin/upload",{method:"POST",body});
   const result=await response.json() as {error?:string};
   if(!response.ok)throw new Error(result.error||"Şəkil yüklənmədi");
   onStatus("Şəkil əlavə olundu.");onChanged();
  }catch(error){onStatus(error instanceof Error?error.message:"Şəkil yüklənmədi.");}
 }
 async function remove(imageId:string){
  try{
   const response=await fetch("/api/store-admin/upload?imageId="+encodeURIComponent(imageId),{method:"DELETE"});
   const result=await response.json() as {error?:string};
   if(!response.ok)throw new Error(result.error||"Şəkil silinmədi");
   onStatus("Şəkil silindi.");onChanged();
  }catch(error){onStatus(error instanceof Error?error.message:"Şəkil silinmədi.");}
 }
 const shown=products.filter(product=>(category==="Hamısı"||(product.category||"Digər")===category)&&product.name.toLocaleLowerCase("az").includes(search.toLocaleLowerCase("az")));
 return <><p>JPG, PNG, WebP · hər şəkil ən çoxu 4 MB · bir məhsula ən çoxu 8 şəkil. Birinci şəkil kartda görünür.</p>{shown.map(product=>{
  const photos=Array.isArray(product.images)&&product.images.length?product.images:product.image_url?[{id:"",url:product.image_url}]:[];
  return <div key={product.id} style={{display:"flex",alignItems:"center",gap:20,padding:16,borderBottom:"1px solid #eee",flexWrap:"wrap"}}><div style={{display:"flex",gap:8,flexWrap:"wrap"}}>{photos.map(photo=><span key={photo.id||photo.url} style={{position:"relative"}}><img src={photo.url} alt={product.name} style={{width:70,height:70,objectFit:"cover",borderRadius:10}}/>{!readOnly&&photo.id&&<button type="button" aria-label={product.name+" şəklini sil"} disabled={disabled} onClick={()=>void remove(photo.id)} style={{position:"absolute",top:-6,right:-6,width:22,height:22,border:0,borderRadius:99,background:"#123d2b",color:"#fff",cursor:"pointer"}}>×</button>}</span>)}</div><div style={{flex:1}}><strong>{product.name}</strong><small className="sa-product-meta">{product.category||"Digər"} · {photos.length} şəkil · Kataloq şəkilləri</small></div>{!readOnly&&<label>Şəkil əlavə et<input aria-label={product.name+" şəkli"} type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" disabled={disabled||photos.length>=8} onChange={event=>{void add(product.id,event.target.files?.[0]);event.currentTarget.value="";}}/></label>}</div>;
 })}</>;
}
