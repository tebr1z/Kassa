export const productRemovalDuration=340;
export type ExitingProduct<T>={row:T;index:number};
// Keep an exit snapshot even when a fast refresh already omits the archived row.
// Tombstones also prevent stale responses from resurrecting a successful deletion.
export function productRemovalRows<T extends {id:string|number}>(rows:readonly T[],exiting:readonly ExitingProduct<T>[],hidden:ReadonlySet<string>):T[]{
 const result=rows.filter(row=>!hidden.has(String(row.id)));
 for(const entry of [...exiting].sort((a,b)=>a.index-b.index)){
  if(!result.some(row=>String(row.id)===String(entry.row.id)))result.splice(Math.min(entry.index,result.length),0,entry.row);
 }
 return result;
}
