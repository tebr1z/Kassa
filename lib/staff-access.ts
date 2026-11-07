// Role codes are stored as text in the database. Only these existing roles may
// obtain a staff session; unknown/custom strings do not inherit any access.
export const staffRoles:readonly string[]=Object.freeze([
 'admin','manager','cashier','warehouse','accountant','online_manager','online_assistant',
]);
export const staffRoleSqlList=staffRoles.map(role=>`'${role}'`).join(',');
export function isStaffRole(role:string){return staffRoles.includes(role);}

const sections:Record<string,readonly string[]>={
 admin:['*'],
 manager:['İdarə paneli','Satış / POS','Məhsullar','Anbar','Sifarişlər','Satınalma','Maliyyə','Hesabatlar','Nəzarət jurnalı'],
 cashier:['Satış / POS'],
 warehouse:['Məhsullar','Anbar','Satınalma'],
 accountant:['Maliyyə','Hesabatlar'],
 online_manager:[],
 online_assistant:[],
};
export function staffPermissions(role:string){return isStaffRole(role)?[...sections[role]]:[];}

type ApiAccess=Readonly<Record<string,readonly string[]>>;
const pos:ApiAccess={
 '/api/products':['GET','HEAD'],
 '/api/dashboard':['GET','HEAD'],
 '/api/sales':['POST'],
 '/api/shifts':['POST'],
 '/api/pos-options':['GET','HEAD','POST','DELETE'],
 '/api/client-errors':['POST'],
};
const inventory:ApiAccess={
 '/api/products':['GET','HEAD','POST','PATCH'],
 '/api/categories':['GET','HEAD','POST'],
 '/api/warehouses':['GET','HEAD'],
 '/api/stock/receipts':['POST'],
 '/api/stock/adjustments':['POST'],
 '/api/stock/transfers':['POST'],
 '/api/inventory-counts':['GET','HEAD','POST'],
 '/api/purchase-orders':['GET','HEAD','POST'],
 '/api/suppliers':['GET','HEAD','POST'],
 '/api/client-errors':['POST'],
};
const accounting:ApiAccess={
 '/api/finance':['GET','HEAD','POST'],
 '/api/reports':['GET','HEAD'],
 '/api/suppliers':['GET','HEAD'],
 '/api/client-errors':['POST'],
};
const online:ApiAccess={'/api/online-orders':['GET','HEAD','PATCH']};
const access:Readonly<Record<string,ApiAccess>>={
 cashier:pos,
 warehouse:inventory,
 accountant:accounting,
 manager:{
  ...pos,...accounting,...inventory,...online,
  '/api/orders':['GET','HEAD','POST'],
  '/api/returns':['POST'],
  '/api/audit':['GET','HEAD'],
 },
 online_manager:online,
 online_assistant:online,
};

// Exact paths and methods deliberately fail closed. In particular a permitted
// product/stock endpoint never grants access to new or similarly named routes.
// The online-order handler separately prevents assistants from cancelling.
export function canUseStaffApi(role:string,path:string,method:string){
 if(!isStaffRole(role))return false;
 if(role==='admin')return true;
 return access[role]?.[path]?.includes(method)===true;
}
