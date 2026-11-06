import 'server-only';
import {headers} from 'next/headers';
import {canIndex,privateRobots} from './seo';
export async function indexingRobots(){
 const host=(await headers()).get('host');
 return canIndex(host)?{index:true,follow:true,googleBot:{index:true,follow:true,'max-image-preview':'large' as const}}:privateRobots;
}
