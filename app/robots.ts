import type {MetadataRoute} from 'next';
import {headers} from 'next/headers';
import {absoluteUrl,canIndex} from '@/lib/seo';
export const dynamic='force-dynamic';
export default async function robots():Promise<MetadataRoute.Robots>{
 if(!canIndex((await headers()).get('host')))return {rules:{userAgent:'*',disallow:'/'}};
 return {rules:{userAgent:'*',allow:['/','/api/catalog-media/'],disallow:['/admin','/account','/api/']},sitemap:absoluteUrl('/sitemap.xml')};
}
