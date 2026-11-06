export type OptionAttributes=Record<string,string>;
export function optionDetails(option:{size?:string;color?:string;kind?:string;attributes?:OptionAttributes}){
 return [option.size,option.color,option.kind,...Object.entries(option.attributes||{}).map(([key,value])=>`${key}: ${value}`)].filter(Boolean).join(' · ');
}
export function optionSnapshot(option:{label:string;size?:string;color?:string;kind?:string;attributes?:OptionAttributes}){
 const details=optionDetails({...option,size:undefined,color:undefined,kind:undefined});
 return [option.label,details].filter(Boolean).join(' · ');
}
