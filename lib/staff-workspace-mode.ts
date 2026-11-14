// UI convenience only. Server-side inventory boundaries make the security decision.
const localSections=new Set(['Satış / POS','Məhsullar','Anbar','Sifarişlər','Satınalma','Maliyyə','Hesabatlar','Nəzarət jurnalı','Mağazalar və kassirlər','Veb sifarişləri']);
type WorkspaceAuth={local?:boolean;user?:{permissions:string[]}};
export function localStockSection(section:string){return localSections.has(section);}
export function canOpenWorkspaceSection(auth:WorkspaceAuth,section:string){
 if(auth.local!==true&&section==='İdarə paneli')return true;
 const permissions=auth.user?.permissions||[];
 return (permissions.includes('*')||permissions.includes(section))&&(auth.local===true||!localStockSection(section));
}
