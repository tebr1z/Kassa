export type EditableVariant={id?:string;label:string;size:string;color:string;kind:string;price:string|null;cost_price?:string|null;image_url?:string;position:number;is_active:boolean;attributes?:Record<string,string>;attributePairs?:[string,string][]};
export const variantLabel=(v:Pick<EditableVariant,'label'|'size'|'color'|'kind'|'attributes'>)=>v.label.trim()||[v.size.trim(),v.color.trim(),v.kind.trim(),...Object.entries(v.attributes||{}).map(([k,value])=>`${k}: ${value}`)].filter(Boolean).join(' · ');
export function variantDraft(value:{id?:string;label:string;size?:string;color?:string;kind?:string;price?:string|number|null;cost_price?:string|number|null;image_url?:string;position?:number;is_active?:boolean;attributes?:Record<string,string>}):EditableVariant{
 return {...value,size:value.size||'',color:value.color||'',kind:value.kind||'',price:value.price==null?null:String(value.price),cost_price:value.cost_price==null?null:String(value.cost_price),position:value.position||0,is_active:value.is_active!==false,attributes:value.attributes||{}};
}
export function serializeVariants(rows:EditableVariant[],{includeCosts=true}:{includeCosts?:boolean}={}){
 if(rows.length>100)throw Error('Maksimum 100 seçim əlavə edilə bilər.');
 const labels=new Set<string>();
 return rows.map((row,index)=>{
  const pairs=(row.attributePairs||Object.entries(row.attributes||{})).map(([k,v])=>[k.trim(),v.trim()]);
  if(pairs.some(([k,v])=>!k||!v)||new Set(pairs.map(([k])=>k.toLocaleLowerCase('az'))).size!==pairs.length)throw Error('Xüsusiyyət adını və dəyərini doldurun; eyni adı təkrarlamayın.');
  const attributes=Object.fromEntries(pairs),label=variantLabel({...row,attributes});
  if(!label||label.length>120)throw Error('Hər seçimdə ölçü, rəng və ya seçim adı yazın (maksimum 120 simvol).');
  const key=label.toLocaleLowerCase('az');if(labels.has(key))throw Error('Eyni seçim iki dəfə əlavə edilib. Ölçü, rəng və ya adı fərqli yazın.');labels.add(key);
  const price=row.price==null||row.price===''?null:Number(row.price),cost=row.cost_price==null||row.cost_price===''?null:Number(row.cost_price);
  if(price!==null&&(!Number.isFinite(price)||price<=0||price>1000000))throw Error('Seçimin satış qiyməti 0-dan böyük olmalıdır.');
  if(includeCosts&&cost!==null&&(!Number.isFinite(cost)||cost<0||cost>1000000))throw Error('Seçimin alış qiymətini düzgün yazın.');
  return {...(row.id&&/^[a-f0-9-]{36}$/i.test(row.id)?{id:row.id}:{}),label,size:row.size.trim(),color:row.color.trim(),kind:row.kind.trim(),price,...(includeCosts?{cost_price:cost}:{}),...(row.image_url!==undefined?{image_url:row.image_url.trim()}:{}),position:index,is_active:row.is_active,attributes};
 });
}
