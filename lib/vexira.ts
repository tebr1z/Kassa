import "server-only";
import {readFile} from "node:fs/promises";
import path from "node:path";
import {logSystemError} from "@/lib/log-error";

export const vexiraPath=path.join(process.cwd(),".private","vexira.json");
export async function vexiraSettings(){
 try{const parsed=JSON.parse(await readFile(vexiraPath,"utf8")) as {key?:string;phones?:string[]};return {key:parsed.key||process.env.VEXIRA_API_KEY||"",phones:Array.isArray(parsed.phones)?parsed.phones.filter(phone=>whatsappPhone(phone)):[]};}
 catch{return {key:process.env.VEXIRA_API_KEY||"",phones:[] as string[]};}
}
export async function vexiraKey(){return (await vexiraSettings()).key;}
export function parseNotifyPhones(value:string){
 const parts=value.split(/[\n,;]+/).map(part=>part.trim()).filter(Boolean);
 if(parts.length>5)return {error:"Ən çoxu 5 nömrə yaza bilərsiniz."};
 const phones:string[]=[];
 for(const part of parts){const phone=whatsappPhone(part);if(!phone)return {error:"Nömrəni ölkə kodu ilə yazın: "+part};if(!phones.includes(phone))phones.push(phone);}
 return {phones};
}
export function whatsappPhone(value:string){
 let digits=value.replace(/\D/g,"").replace(/^00/,"");
 if(digits.startsWith("0")&&digits.length===10)digits="994"+digits.slice(1);
 else if(digits.length===9)digits="994"+digits;
 return /^[1-9]\d{7,14}$/.test(digits)?"+"+digits:null;
}
export async function sendWhatsApp(phone:string,message:string){
 const key=await vexiraKey();const to=whatsappPhone(phone);
 if(!key||!to)return false;
 const response=await fetch("https://api.vexirahost.com/api/v1/whatsapp/messages",{method:"POST",headers:{"Content-Type":"application/json","X-API-Key":key},body:JSON.stringify({phone:to,message:message.slice(0,1000)}),signal:AbortSignal.timeout(8000)});
 if(!response.ok)throw Object.assign(new Error("Vexira mesajı göndərilmədi."),{statusCode:502});
 return true;
}
export async function notifyCatalogOrder(order:{orderNo:string;total:number;name:string;phone:string;fulfillment:"pickup"|"delivery";address:string;lines:{name:string;quantity:number}[];storePhones:string[]}){
 if(!await vexiraKey())return;
 const items=order.lines.slice(0,8).map(line=>line.name+" × "+line.quantity).join("\n");
 const place=order.fulfillment==="delivery"?"Ünvan: "+order.address:"Mağazadan götürmə";
 const staff=[...new Set(order.storePhones.map(whatsappPhone).filter((phone):phone is string=>!!phone))];
 const customerPhone=whatsappPhone(order.phone);
 const storeMessage=`Yeni sifariş #${order.orderNo}\n${order.name}\n${customerPhone||order.phone}\n${order.total.toFixed(2)} AZN\n${place}\n${items}`;
 const customerMessage=`Salam ${order.name}. Sifarişiniz qəbul olundu.\nNömrə: ${order.orderNo}\nMəbləğ: ${order.total.toFixed(2)} AZN\n${place}\nÖdəniş təhvil zamanı.`;
 const jobs:Promise<unknown>[]=[];
 for(const phone of staff)jobs.push(sendWhatsApp(phone,storeMessage).catch(error=>logSystemError("vexira.order",error)));
 if(customerPhone&&!staff.includes(customerPhone))jobs.push(sendWhatsApp(customerPhone,customerMessage).catch(error=>logSystemError("vexira.order",error)));
 await Promise.all(jobs);
}
