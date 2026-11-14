'use client';
import {ArrowUpRight,Boxes,Monitor,ShoppingBag} from 'lucide-react';
import Link from 'next/link';
import {useTranslations} from '@/lib/language';
import {staffPortalPath} from '@/lib/staff-portal';
import './web-workspace.css';

export default function WebWorkspace({role,onSupport}:{role:string;onSupport:()=>void}){
 const {t}=useTranslations(),admin=role==='admin',canManageOrders=admin||role==='manager';
 return <section className="web-workspace" aria-label={t('Veb iş sahəsi')}>
  <div className="web-workspace-intro"><span className="web-workspace-kicker">{t('VEB İŞ SAHƏSİ')}</span><h2>{t('Onlayn mağazanız üçün hər şey bir yerdə')}</h2><p>{t('Burada saytın kataloqu və onlayn işlər idarə olunur. Kassa və anbar əməliyyatları üçün kompüterdə RestaMarket tətbiqini açın.')}</p></div>
  <div className="web-local-stock-note" role="note"><span><Monitor size={26} aria-hidden="true"/></span><div><h3>{t('Stok yalnız masaüstü tətbiqdə saxlanılır')}</h3><p>{t('Mal qalığı, alış qiymətləri, anbar hərəkətləri və kassa satışları veb paneldə göstərilmir və buradan dəyişdirilmir.')}</p><small>{t('Masaüstü tətbiqin məlumatları avtomatik veb stoku ilə birləşdirilmir. Veb kataloq işləməyə davam edir.')}</small></div></div>
  <div className="web-workspace-links">
   <Link href="/" className="web-workspace-link"><ShoppingBag size={22} aria-hidden="true"/><div><strong>{t('Müştəri kataloqu')}</strong><p>{t('Məhsulların saytda necə göründüyünə baxın.')}</p></div><ArrowUpRight size={18} aria-hidden="true"/></Link>
   {admin&&<a href={staffPortalPath('/store')} className="web-workspace-link"><Boxes size={22} aria-hidden="true"/><div><strong>{t('Veb kataloqu və sayt ayarları')}</strong><p>{t('Məhsul, rəng, şəkil, satış qiyməti və endirimləri idarə edin.')}</p></div><ArrowUpRight size={18} aria-hidden="true"/></a>}
   {canManageOrders&&<a href={staffPortalPath('/online')} className="web-workspace-link"><ShoppingBag size={22} aria-hidden="true"/><div><strong>{t('Onlayn sifarişlər')}</strong><p>{t('Müştəri sifarişlərini yoxlayın və çatdırılmanı izləyin.')}</p></div><ArrowUpRight size={18} aria-hidden="true"/></a>}
   {admin&&<button type="button" className="web-workspace-link" onClick={onSupport}><div><strong>{t('Dəstək biletləri')}</strong><p>{t('Oxunmamış müraciətlərə və cavab gözləyən müştərilərə baxın.')}</p></div><ArrowUpRight size={18} aria-hidden="true"/></button>}
  </div>
 </section>;
}
