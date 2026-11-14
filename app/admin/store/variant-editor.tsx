"use client";
/* eslint-disable @next/next/no-img-element -- Small, validated admin upload previews do not need image optimisation. */
import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {Check,ImagePlus,LoaderCircle,Plus,Ruler,Palette,SlidersHorizontal,Trash2,Upload} from 'lucide-react';
import {variantLabel,type EditableVariant} from '@/lib/variant-draft';
import {isProductOptionImage} from '@/lib/product-option-image';
import {useTranslations} from '@/lib/language';
import './variant-editor.css';
export type {EditableVariant} from '@/lib/variant-draft';
type Dimension='size'|'color'|'custom';
type Props={options:EditableVariant[];onChange:(rows:EditableVariant[])=>void;busy?:boolean;canManageImages?:boolean;canManageCosts?:boolean;onUploadBusyChange?:(busy:boolean)=>void};
type ImageUpload={target:EditableVariant;initialImage:string|undefined;controller:AbortController};
const sameRow=(left:EditableVariant,right:EditableVariant)=>left.id&&right.id?left.id===right.id:left===right;
const normalizedColor=(color:string)=>color.trim().replace(/\s+/g,' ').normalize('NFC').toLocaleLowerCase('az');
const acceptedFile=(file:File)=>file.size>0&&file.size<=4000000&&(['image/jpeg','image/jpg','image/pjpeg','image/png','image/x-png','image/webp'].includes(file.type.toLowerCase())||!file.type&&/\.(?:jpe?g|png|webp)$/i.test(file.name));
export default function VariantEditor({options,onChange,busy=false,canManageImages=false,canManageCosts=true,onUploadBusyChange}:Props){
 const {t}=useTranslations();
 const [enabled,setEnabled]=useState<Record<Dimension,boolean>>(()=>({size:options.some(v=>!!v.size),color:options.some(v=>!!v.color),custom:options.some(v=>!!v.kind||Object.keys(v.attributes||{}).length>0||(!v.size&&!v.color))}));
 const [error,setError]=useState('');
 const [uploading,setUploading]=useState<EditableVariant|null>(null),[imageFeedback,setImageFeedback]=useState<{target:EditableVariant;text:string;error:boolean}|null>(null);
 const mounted=useRef(true),rowsRef=useRef(options),propsRef=useRef({onChange,busy,canManageImages,canManageCosts,onUploadBusyChange}),request=useRef<ImageUpload|null>(null);
 useLayoutEffect(()=>{rowsRef.current=options;propsRef.current={onChange,busy,canManageImages,canManageCosts,onUploadBusyChange};},[options,onChange,busy,canManageImages,canManageCosts,onUploadBusyChange]);
 const locked=busy||Boolean(uploading);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;const pending=request.current;request.current=null;pending?.controller.abort();if(pending)propsRef.current.onUploadBusyChange?.(false);};},[]);
 useEffect(()=>{
  const pending=request.current;if(!pending)return;
  const current=options.find(row=>sameRow(row,pending.target));
  if(!canManageImages||!current||current.image_url!==pending.initialImage){request.current=null;pending.controller.abort();setUploading(null);propsRef.current.onUploadBusyChange?.(false);}
 },[options,canManageImages]);
 const any=enabled.size||enabled.color||enabled.custom;
 const blank=():EditableVariant=>({id:'draft-'+crypto.randomUUID(),label:'',size:'',color:'',kind:'',price:null,...(canManageCosts?{cost_price:null}:{}),position:options.length,is_active:true,attributes:{}});
 const isLocked=()=>propsRef.current.busy||Boolean(request.current);
 function emit(rows:EditableVariant[]){rowsRef.current=rows;propsRef.current.onChange(rows);}
 function update(index:number,patch:Partial<EditableVariant>){if(isLocked()||Object.hasOwn(patch,'cost_price')&&!propsRef.current.canManageCosts)return;emit(rowsRef.current.map((v,i)=>i===index?{...v,...patch}:v));setError('');}
 function removeImage(target:EditableVariant){
  if(isLocked()||!propsRef.current.canManageImages)return;
  emit(rowsRef.current.map(row=>sameRow(row,target)?{...row,image_url:''}:row));
  setImageFeedback({target,text:'Seçim şəkli silindi. Məhsulu saxlayanda əsas məhsul şəkli görünəcək.',error:false});
 }
 function applyImageToColor(target:EditableVariant){
  if(isLocked()||!propsRef.current.canManageImages)return;
  const current=rowsRef.current.find(row=>sameRow(row,target)),color=current&&normalizedColor(current.color);
  if(!current?.image_url||!isProductOptionImage(current.image_url)||!color)return;
  emit(rowsRef.current.map(row=>normalizedColor(row.color)===color?{...row,image_url:current.image_url}:row));
  setImageFeedback({target,text:'Şəkil eyni rəngin bütün seçimlərinə tətbiq edildi. Məhsulu saxlayın.',error:false});
 }
 async function uploadImage(target:EditableVariant,file?:File){
  if(!file||isLocked()||!propsRef.current.canManageImages)return;
  if(!acceptedFile(file)){setImageFeedback({target,text:'Seçim şəkli üçün JPG, PNG və ya WebP faylı seçin (maksimum 4 MB).',error:true});return;}
  const current=rowsRef.current.find(row=>sameRow(row,target));if(!current)return;
  const pending:ImageUpload={target:current,initialImage:current.image_url,controller:new AbortController()};
  request.current=pending;setUploading(current);setImageFeedback(null);propsRef.current.onUploadBusyChange?.(true);
  try{
   const form=new FormData();form.set('file',file);form.set('purpose','variant');
   const response=await fetch('/api/store-admin/upload',{method:'POST',body:form,signal:pending.controller.signal});
   const result=await response.json() as {url?:unknown};
   if(!mounted.current||request.current!==pending||pending.controller.signal.aborted)return;
   if(!response.ok||!result.url||!isProductOptionImage(result.url)){
    setImageFeedback({target:current,text:response.status===401||response.status===403?'Şəkil yükləmək üçün səlahiyyətli hesabla yenidən daxil olun.':'Seçim şəklinin yüklənməsi alınmadı. Yenidən cəhd edin.',error:true});return;
   }
   const latest=rowsRef.current.find(row=>sameRow(row,pending.target));
   if(!propsRef.current.canManageImages||!latest||latest.image_url!==pending.initialImage)return;
   const image=result.url;emit(rowsRef.current.map(row=>sameRow(row,latest)?{...row,image_url:image}:row));
   setImageFeedback({target:latest,text:'Şəkil yükləndi. Dəyişikliyi tətbiq etmək üçün məhsulu saxlayın.',error:false});
  }catch{
   if(mounted.current&&request.current===pending&&!pending.controller.signal.aborted)setImageFeedback({target:current,text:'Seçim şəklinin yüklənməsi alınmadı. Yenidən cəhd edin.',error:true});
  }finally{
   if(request.current===pending){request.current=null;if(mounted.current)setUploading(null);propsRef.current.onUploadBusyChange?.(false);}
  }
 }
 function toggle(key:Dimension){
  if(isLocked())return;
  const next={...enabled,[key]:!enabled[key]};
  if(!next[key]&&options.some(v=>key==='custom'?v.label||v.kind||Object.keys(v.attributes||{}).length:v[key])){
   if(!window.confirm('Bu seçim sahəsi bağlansın? Dəyişiklik yalnız məhsulu saxlayanda tətbiq olunur. Köhnə çeklər saxlanılır.'))return;
  }
  setEnabled(next);setError('');
  if(!Object.values(next).some(Boolean)){emit([]);return;}
  if(!options.length){emit([blank()]);return;}
  if(!next[key])emit(options.map(v=>key==='custom'?{...v,label:'',kind:'',attributes:{},attributePairs:[]}:{...v,[key]:'',label:''}));
 }
 function add(){if(!isLocked()&&rowsRef.current.length<100)emit([...rowsRef.current,blank()]);}
 return <section className="variant-panel" aria-label="Məhsul seçimləri">
  <header><span>MƏHSULUN SEÇİMLƏRİ</span><h4>Bu məhsulda hansı seçimlər var?</h4><p>Lazım olan düyməni açın, hər ölçü və rəng kombinasiyasını ayrıca sətrə yazın. Hər sətrin öz qiyməti ola bilər.</p></header>
  <div className="variant-switches">{([['size','Ölçü seçimi var',Ruler],['color','Rəng seçimi var',Palette],['custom','Başqa seçim var',SlidersHorizontal]] as const).map(([key,label,Icon])=><button key={key} type="button" role="switch" aria-checked={enabled[key]} className={enabled[key]?'is-on':''} onClick={()=>toggle(key)} disabled={locked}><Icon size={19}/><strong>{label}</strong><span className="variant-switch-indicator">{enabled[key]?<Check size={14}/>:<Plus size={14}/>}</span></button>)}</div>
  {!any?<p className="variant-hint">Sadə məhsuldur — müştəri ölçü və rəng seçmədən əsas qiymətlə alacaq.</p>:<>
   <div className="variant-rows">{options.map((row,index)=>{
    const pairs=row.attributePairs||Object.entries(row.attributes||{});
    const heading=variantLabel({...row,attributes:Object.fromEntries(pairs.filter(([k,v])=>k&&v))})||'Yeni seçim';
    const image=row.image_url&&isProductOptionImage(row.image_url)?row.image_url:'';
    const rowUploading=Boolean(uploading&&sameRow(row,uploading)),feedback=imageFeedback&&sameRow(row,imageFeedback.target)?imageFeedback:null;
    const sharesColor=Boolean(normalizedColor(row.color)&&options.some(other=>!sameRow(other,row)&&normalizedColor(other.color)===normalizedColor(row.color)));
    return <div className="variant-row" key={row.id||index}>
     <div className="variant-row-heading"><span>{index+1}</span><strong>{heading}</strong><button type="button" title="Məhsulu saxlayanda bu seçim siyahıdan çıxarılacaq" aria-label={heading+' seçimini sil'} disabled={locked} onClick={()=>{if(!isLocked())emit(rowsRef.current.filter(other=>!sameRow(other,row)));}}><Trash2 size={16}/>Seçimi sil</button></div>
     <div className="variant-row-fields">
      {enabled.size&&<label>Ölçü<input aria-label={'Ölçü '+(index+1)} required maxLength={80} placeholder="30 sm, 40 sm, 1 metr…" value={row.size} disabled={locked} onChange={e=>update(index,{size:e.target.value,...(!enabled.custom?{label:''}:{})})}/></label>}
      {enabled.color&&<label>Rəng<input aria-label={'Rəng '+(index+1)} required maxLength={80} placeholder="Qara, qırmızı, ağ…" value={row.color} disabled={locked} onChange={e=>update(index,{color:e.target.value,...(!enabled.custom?{label:''}:{})})}/></label>}
      {enabled.custom&&<label>Seçimin adı<input required={!enabled.size&&!enabled.color&&!row.kind&&!pairs.length} maxLength={120} placeholder="Məsələn: Qalın dəmir" value={row.label} disabled={locked} onChange={e=>update(index,{label:e.target.value})}/></label>}
      <label className="variant-sale-price">Bu seçimin qiyməti ₼<input aria-label={'Seçimin qiyməti '+(index+1)} type="number" min="0.01" max="1000000" step="0.01" value={row.price??''} placeholder="Boşdursa əsas qiymət" disabled={locked} onChange={e=>update(index,{price:e.target.value||null})}/><small>Boş saxlasanız əsas satış/endirim qiyməti tətbiq olunur.</small></label>
     </div>
     {canManageImages&&<div className="variant-image-editor" aria-busy={rowUploading}>
      <div className="variant-image-preview">{image?<img src={image} width={96} height={96} alt={t('Seçim şəkli')+': '+heading} loading="lazy" referrerPolicy="no-referrer"/>:<ImagePlus size={26} aria-hidden="true"/>}</div>
      <div className="variant-image-content"><strong>{t('Seçim şəkli')}</strong><p>{t('Müştəri bu rəngi və ya ölçünü seçəndə həmin şəkil görünəcək. Şəkilsiz seçimlər əsas məhsul şəklini istifadə edir.')}</p>
       <div className="variant-image-actions"><label className={'variant-image-picker'+(locked?' is-disabled':'')}>
        <input type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" aria-label={t('Seçim şəkli')+': '+heading} disabled={locked} onChange={event=>{const file=event.currentTarget.files?.[0];event.currentTarget.value='';void uploadImage(row,file);}}/>
        {rowUploading?<LoaderCircle size={15} aria-hidden="true"/>:<Upload size={15} aria-hidden="true"/>}<span>{t(rowUploading?'Şəkil yüklənir…':image?'Şəkli dəyiş':'Şəkil əlavə et')}</span>
       </label>{image&&<button className="variant-image-remove" type="button" aria-label={t('Seçim şəklini sil')+': '+heading} disabled={locked} onClick={()=>removeImage(row)}><Trash2 size={15}/>{t('Seçim şəklini sil')}</button>}
       {image&&sharesColor&&<button className="variant-image-copy" type="button" disabled={locked} title={t('Eyni rəngin digər ölçülərinə də bu şəkli tətbiq edir.')} onClick={()=>applyImageToColor(row)}><Palette size={15}/>{t('Eyni rəngə tətbiq et')}</button>}</div>
       <small>{t('PNG, JPG və ya WebP · maksimum 4 MB')}</small>
       {rowUploading&&<p className="variant-image-status" role="status">{t('Seçim şəklini yükləyənədək gözləyin.')}</p>}
       {feedback&&<p className={feedback.error?'variant-image-status is-error':'variant-image-status'} role={feedback.error?'alert':'status'}>{t(feedback.text)}</p>}
      </div>
     </div>}
     {(canManageCosts||enabled.custom)&&<details className="variant-extra"><summary>{canManageCosts?<>Alış qiyməti{enabled.custom?', material və öz xüsusiyyətləriniz':''}</>:t('Material və öz xüsusiyyətləriniz')}</summary><div className="variant-row-fields">{canManageCosts&&<label>Seçimin alış qiyməti ₼<input aria-label={'Seçimin alış qiyməti '+(index+1)} type="number" min="0" max="1000000" step="0.01" value={row.cost_price??''} placeholder="Boşdursa əsas alış qiyməti" disabled={locked} onChange={e=>update(index,{cost_price:e.target.value===''?null:e.target.value})}/><small>Yalnız administrator görür.</small></label>}{enabled.custom&&<label>Növ / material<input maxLength={80} value={row.kind} placeholder="Dəmir, qalın, nazik…" disabled={locked} onChange={e=>update(index,{kind:e.target.value})}/></label>}</div>
      {enabled.custom&&<div className="variant-attributes">{pairs.map(([key,value],i)=><div key={i}><input aria-label="Xüsusiyyətin adı" required maxLength={60} placeholder="Məsələn: Qalınlıq" value={key} disabled={locked} onChange={e=>update(index,{attributePairs:pairs.map((p,j)=>j===i?[e.target.value,p[1]]:p)})}/><input aria-label="Xüsusiyyətin dəyəri" required maxLength={120} placeholder="Məsələn: 2 mm" value={value} disabled={locked} onChange={e=>update(index,{attributePairs:pairs.map((p,j)=>j===i?[p[0],e.target.value]:p)})}/><button type="button" aria-label="Xüsusiyyəti sil" disabled={locked} onClick={()=>update(index,{attributePairs:pairs.filter((_,j)=>j!==i)})}>×</button></div>)}<button type="button" disabled={locked||pairs.length>=12} onClick={()=>update(index,{attributePairs:[...pairs,['','']]})}>+ Öz xüsusiyyətini əlavə et</button></div>}
     </details>}
    </div>;
   })}</div>
   {error&&<p role="alert">{error}</p>}<button className="variant-add" type="button" disabled={locked||options.length>=100} onClick={add}><Plus size={18}/> Başqa ölçü / rəng əlavə et</button>
   <p className="variant-save-note">{canManageCosts?'Seçimlər aşağıdakı “Məhsulu saxla” düyməsi ilə birlikdə saxlanır. Mövcud ayrı məhsullar avtomatik birləşdirilmir. Variantlar məhsulun ümumi stokunu paylaşır.':t('Seçimlər aşağıdakı “Məhsulu saxla” düyməsi ilə birlikdə saxlanır. Vebdə stok və alış qiyməti dəyişdirilmir.')}</p>
  </>}
 </section>;
}
