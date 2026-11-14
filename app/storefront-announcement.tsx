'use client';
import Link from 'next/link';
import {ArrowUpRight,PackageCheck} from 'lucide-react';
import {useTranslations} from '@/lib/language';

export default function StorefrontAnnouncement(){const {t}=useTranslations();
 return <aside className="sf-announcement sf-wholesale-notice" aria-label={t('Topdan alış üçün RestaMarket')}>
  <div className="sf-wholesale-message"><span className="sf-wholesale-symbol" aria-hidden="true"><PackageCheck size={17}/></span><span>{t('Topdan seçim, işinizə rahatlıq.')}</span></div>
  <Link href="/#contact" className="sf-wholesale-link">{t('Topdan və pərakəndə satış')}<ArrowUpRight size={15} aria-hidden="true"/></Link>
 </aside>;
}
