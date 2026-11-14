import 'server-only';

// Only Electron's server process may enable inventory. No HTTP header, body,
// database setting or web administrator switch can opt a web request into it.
export const isLocalInventory=()=>process.env.BIRKASSA_LOCAL==='1';
export const inventoryLocalOnlyMessage='Stok, kassa və maliyyə yalnız kompüterdəki RestaMarket tətbiqində işləyir.';
const localPaths=[
 '/api/products','/api/warehouses','/api/stock','/api/inventory-counts',
 '/api/purchase-orders','/api/suppliers','/api/sales','/api/shifts',
 '/api/orders','/api/pos-options','/api/returns','/api/finance',
 '/api/reports','/api/dashboard','/api/audit','/api/system',
] as const;
export function inventoryPathRequiresLocal(path:string){return localPaths.some(prefix=>path===prefix||path.startsWith(prefix+'/'));}
export function inventoryLocalOnlyResponse(){return Response.json({error:inventoryLocalOnlyMessage,code:'INVENTORY_LOCAL_ONLY',inventoryLocalOnly:true},{status:403,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});}
