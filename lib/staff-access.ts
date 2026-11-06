export const staffRoles=['admin','cashier'];
export function staffPermissions(role:string){return role==='admin'?['*']:role==='cashier'?['Satış / POS']:[];}
export function canUseStaffApi(role:string,path:string,method:string){
 if(role==='admin')return true;
 if(role!=='cashier')return false;
 const allowed:Record<string,string[]>={'/api/products':['GET','HEAD'],'/api/dashboard':['GET','HEAD'],'/api/sales':['POST'],'/api/shifts':['POST'],'/api/pos-options':['GET','HEAD','POST','DELETE'],'/api/client-errors':['POST']};
 return allowed[path]?.includes(method)||false;
}
