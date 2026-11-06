"use client";
import {useState} from 'react';
import {Check,Plus,Ruler,Palette,SlidersHorizontal,Trash2} from 'lucide-react';
import {variantLabel,type EditableVariant} from '@/lib/variant-draft';
import './variant-editor.css';
export type {EditableVariant} from '@/lib/variant-draft';
type Dimension='size'|'color'|'custom';
export default function VariantEditor({options,onChange,busy=false}:{options:EditableVariant[];onChange:(rows:EditableVariant[])=>void;busy?:boolean}){
 const [enabled,setEnabled]=useState<Record<Dimension,boolean>>(()=>({size:options.some(v=>!!v.size),color:options.some(v=>!!v.color),custom:options.some(v=>!!v.kind||Object.keys(v.attributes||{}).length>0||(!v.size&&!v.color))}));
 const [error,setError]=useState('');
 const any=enabled.size||enabled.color||enabled.custom;
 const blank=():EditableVariant=>({id:'draft-'+crypto.randomUUID(),label:'',size:'',color:'',kind:'',price:null,cost_price:null,position:options.length,is_active:true,attributes:{}});
 function update(index:number,patch:Partial<EditableVariant>){onChange(options.map((v,i)=>i===index?{...v,...patch}:v));setError('');}
 function toggle(key:Dimension){
  const next={...enabled,[key]:!enabled[key]};
  if(!next[key]&&options.some(v=>key==='custom'?v.label||v.kind||Object.keys(v.attributes||{}).length:v[key])){
   if(!window.confirm('Bu seçim sahəsi bağlansın? Dəyişiklik yalnız məhsulu saxlayanda tətbiq olunur. Köhnə çeklər saxlanılır.'))return;
  }
  setEnabled(next);setError('');
  if(!Object.values(next).some(Boolean)){onChange([]);return;}
  if(!options.length){onChange([blank()]);return;}
  if(!next[key])onChange(options.map(v=>key==='custom'?{...v,label:'',kind:'',attributes:{},attributePairs:[]}:{...v,[key]:'',label:''}));
 }
 function add(){if(options.length<100)onChange([...options,blank()]);}
 return <section className="variant-panel" aria-label="Məhsul seçimləri">
  <header><span>MƏHSULUN SEÇİMLƏRİ</span><h4>Bu məhsulda hansı seçimlər var?</h4><p>Lazım olan düyməni açın, hər ölçü və rəng kombinasiyasını ayrıca sətrə yazın. Hər sətrin öz qiyməti ola bilər.</p></header>
  <div className="variant-switches">{([['size','Ölçü seçimi var',Ruler],['color','Rəng seçimi var',Palette],['custom','Başqa seçim var',SlidersHorizontal]] as const).map(([key,label,Icon])=><button key={key} type="button" role="switch" aria-checked={enabled[key]} className={enabled[key]?'is-on':''} onClick={()=>toggle(key)} disabled={busy}><Icon size={19}/><strong>{label}</strong><span className="variant-switch-indicator">{enabled[key]?<Check size={14}/>:<Plus size={14}/>}</span></button>)}</div>
  {!any?<p className="variant-hint">Sadə məhsuldur — müştəri ölçü və rəng seçmədən əsas qiymətlə alacaq.</p>:<>
   <div className="variant-rows">{options.map((row,index)=>{
    const pairs=row.attributePairs||Object.entries(row.attributes||{});
    const heading=variantLabel({...row,attributes:Object.fromEntries(pairs.filter(([k,v])=>k&&v))})||'Yeni seçim';
    return <div className="variant-row" key={row.id||index}>
     <div className="variant-row-heading"><span>{index+1}</span><strong>{heading}</strong><button type="button" title="Məhsulu saxlayanda bu seçim siyahıdan çıxarılacaq" aria-label={heading+' seçimini sil'} disabled={busy} onClick={()=>onChange(options.filter((_,i)=>i!==index))}><Trash2 size={16}/>Seçimi sil</button></div>
     <div className="variant-row-fields">
      {enabled.size&&<label>Ölçü<input aria-label={'Ölçü '+(index+1)} required maxLength={80} placeholder="30 sm, 40 sm, 1 metr…" value={row.size} disabled={busy} onChange={e=>update(index,{size:e.target.value,...(!enabled.custom?{label:''}:{})})}/></label>}
      {enabled.color&&<label>Rəng<input aria-label={'Rəng '+(index+1)} required maxLength={80} placeholder="Qara, qırmızı, ağ…" value={row.color} disabled={busy} onChange={e=>update(index,{color:e.target.value,...(!enabled.custom?{label:''}:{})})}/></label>}
      {enabled.custom&&<label>Seçimin adı<input required={!enabled.size&&!enabled.color&&!row.kind&&!pairs.length} maxLength={120} placeholder="Məsələn: Qalın dəmir" value={row.label} disabled={busy} onChange={e=>update(index,{label:e.target.value})}/></label>}
      <label className="variant-sale-price">Bu seçimin qiyməti ₼<input aria-label={'Seçimin qiyməti '+(index+1)} type="number" min="0.01" max="1000000" step="0.01" value={row.price??''} placeholder="Boşdursa əsas qiymət" disabled={busy} onChange={e=>update(index,{price:e.target.value||null})}/><small>Boş saxlasanız əsas satış/endirim qiyməti tətbiq olunur.</small></label>
     </div>
     <details className="variant-extra"><summary>Alış qiyməti{enabled.custom?', material və öz xüsusiyyətləriniz':''}</summary><div className="variant-row-fields"><label>Seçimin alış qiyməti ₼<input aria-label={'Seçimin alış qiyməti '+(index+1)} type="number" min="0" max="1000000" step="0.01" value={row.cost_price??''} placeholder="Boşdursa əsas alış qiyməti" disabled={busy} onChange={e=>update(index,{cost_price:e.target.value===''?null:e.target.value})}/><small>Yalnız administrator görür.</small></label>{enabled.custom&&<label>Növ / material<input maxLength={80} value={row.kind} placeholder="Dəmir, qalın, nazik…" disabled={busy} onChange={e=>update(index,{kind:e.target.value})}/></label>}</div>
      {enabled.custom&&<div className="variant-attributes">{pairs.map(([key,value],i)=><div key={i}><input aria-label="Xüsusiyyətin adı" required maxLength={60} placeholder="Məsələn: Qalınlıq" value={key} disabled={busy} onChange={e=>update(index,{attributePairs:pairs.map((p,j)=>j===i?[e.target.value,p[1]]:p)})}/><input aria-label="Xüsusiyyətin dəyəri" required maxLength={120} placeholder="Məsələn: 2 mm" value={value} disabled={busy} onChange={e=>update(index,{attributePairs:pairs.map((p,j)=>j===i?[p[0],e.target.value]:p)})}/><button type="button" aria-label="Xüsusiyyəti sil" disabled={busy} onClick={()=>update(index,{attributePairs:pairs.filter((_,j)=>j!==i)})}>×</button></div>)}<button type="button" disabled={busy||pairs.length>=12} onClick={()=>update(index,{attributePairs:[...pairs,['','']]})}>+ Öz xüsusiyyətini əlavə et</button></div>}
     </details>
    </div>;
   })}</div>
   {error&&<p role="alert">{error}</p>}<button className="variant-add" type="button" disabled={busy||options.length>=100} onClick={add}><Plus size={18}/> Başqa ölçü / rəng əlavə et</button>
   <p className="variant-save-note">Seçimlər aşağıdakı “Məhsulu saxla” düyməsi ilə birlikdə saxlanır. Mövcud ayrı məhsullar avtomatik birləşdirilmir. Variantlar məhsulun ümumi stokunu paylaşır.</p>
  </>}
 </section>;
}
