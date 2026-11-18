"use client";

import {ArrowUpRight, MapPin, Navigation} from "lucide-react";
import {useTranslations} from "@/lib/language";
import type {Language} from "@/lib/language-options";
import "./storefront-presence.css";

const storeMapUrl = "https://maps.app.goo.gl/oyjVNCWgfu4EoGnT8";
const storeMapEmbedUrl = "https://www.google.com/maps/embed?origin=mfe&pb=!1m3!3m2!1m1!4s12618702231415660293";

type PresenceCopy = {
  eyebrow:string;
  title:string;
  description:string;
  address:string;
  directions:string;
  mapTitle:string;
  mapFallback:string;
  mapLink:string;
  socialTitle:string;
  socialDescription:string;
  opensNewTab:string;
};

const presenceCopy:Record<Language, PresenceCopy> = {
  az:{
    eyebrow:"MAĞAZAMIZA BUYURUN",
    title:"Seçiminizi yaxından görün.",
    description:"Məhsullarla yerində tanış olun, seçim üçün komandamızla məsləhətləşin. Yolunuzu Google Maps ilə rahatlıqla planlaşdıra bilərsiniz.",
    address:"Abşeron Ticarət Mərkəzi · Sıra 1, korpus 6, mağaza 4",
    directions:"Google Maps ilə yol tarifi",
    mapTitle:"RestaMarket mağazasının Google Maps xəritəsində yeri",
    mapFallback:"Xəritə açılmır?",
    mapLink:"Google Maps-də baxın",
    socialTitle:"Bizi izləyin",
    socialDescription:"Məhsullar, yeniliklər və mağazamızdan görüntülər.",
    opensNewTab:"yeni səhifədə açılır",
  },
  ru:{
    eyebrow:"ПРИГЛАШАЕМ В МАГАЗИН",
    title:"Познакомьтесь с товарами поближе.",
    description:"Посмотрите товары в магазине и посоветуйтесь с нашей командой. Постройте удобный маршрут в Google Maps.",
    address:"Торговый центр Абшерон · Ряд 1, корпус 6, магазин 4",
    directions:"Маршрут в Google Maps",
    mapTitle:"Расположение магазина RestaMarket на Google Maps",
    mapFallback:"Карта не открывается?",
    mapLink:"Открыть в Google Maps",
    socialTitle:"Мы в соцсетях",
    socialDescription:"Товары, новинки и жизнь нашего магазина.",
    opensNewTab:"откроется в новой вкладке",
  },
  en:{
    eyebrow:"VISIT OUR STORE",
    title:"Take a closer look at your next choice.",
    description:"See our products in person and ask our team for help choosing. Plan your visit with Google Maps.",
    address:"Absheron Trade Centre · Row 1, building 6, store 4",
    directions:"Get directions with Google Maps",
    mapTitle:"RestaMarket store location on Google Maps",
    mapFallback:"Map not loading?",
    mapLink:"View on Google Maps",
    socialTitle:"Follow us",
    socialDescription:"Products, new arrivals and a look inside our store.",
    opensNewTab:"opens in a new tab",
  },
  tr:{
    eyebrow:"MAĞAZAMIZA BEKLERİZ",
    title:"Seçiminizi yakından inceleyin.",
    description:"Ürünleri mağazamızda görün, seçim yaparken ekibimizden destek alın. Google Maps ile yolunuzu kolayca planlayın.",
    address:"Abşeron Ticaret Merkezi · Sıra 1, blok 6, mağaza 4",
    directions:"Google Maps ile yol tarifi",
    mapTitle:"RestaMarket mağazasının Google Maps üzerindeki konumu",
    mapFallback:"Harita açılmıyor mu?",
    mapLink:"Google Maps üzerinde görün",
    socialTitle:"Bizi takip edin",
    socialDescription:"Ürünler, yenilikler ve mağazamızdan görüntüler.",
    opensNewTab:"yeni sekmede açılır",
  },
  zh:{
    eyebrow:"欢迎到店",
    title:"到店近距离了解心仪产品。",
    description:"亲自查看产品，并向我们的团队咨询选购建议。您可以通过 Google Maps 轻松规划到店路线。",
    address:"阿布歇隆贸易中心 · 第1排，6号楼，4号店",
    directions:"使用 Google Maps 导航",
    mapTitle:"Google Maps 上的 RestaMarket 门店位置",
    mapFallback:"地图未能加载？",
    mapLink:"在 Google Maps 中查看",
    socialTitle:"关注我们",
    socialDescription:"了解产品、新品以及我们的门店动态。",
    opensNewTab:"在新标签页中打开",
  },
};

export function AboutLocation({address}:{address?:string}) {
  const {language} = useTranslations();
  const copy = presenceCopy[language];

  return <div className="sf-presence-location">
    <div className="sf-presence-location-copy">
      <span className="sf-presence-eyebrow"><MapPin size={15} aria-hidden="true"/>{copy.eyebrow}</span>
      <h3>{copy.title}</h3>
      <p className="sf-presence-description">{copy.description}</p>
      <address className="sf-presence-address"><MapPin size={19} aria-hidden="true"/><span>{address?.trim() || copy.address}</span></address>
      <a className="sf-presence-directions" href={storeMapUrl} target="_blank" rel="noopener noreferrer" aria-label={`${copy.directions} (${copy.opensNewTab})`}>
        <Navigation size={17} aria-hidden="true"/><span>{copy.directions}</span><ArrowUpRight size={17} aria-hidden="true"/>
      </a>
    </div>
    <div className="sf-presence-map">
      <iframe src={storeMapEmbedUrl} title={copy.mapTitle} loading="lazy" referrerPolicy="no-referrer-when-downgrade" allowFullScreen/>
      <div className="sf-presence-map-fallback"><span>{copy.mapFallback}</span><a href={storeMapUrl} target="_blank" rel="noopener noreferrer" aria-label={`${copy.mapLink} (${copy.opensNewTab})`}>{copy.mapLink}<ArrowUpRight size={14} aria-hidden="true"/></a></div>
    </div>
  </div>;
}

function InstagramIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true" focusable="false"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/></svg>;
}

function YouTubeIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true" focusable="false"><rect x="2.5" y="5" width="19" height="14" rx="4"/><path d="m10 9 5 3-5 3Z" fill="currentColor" stroke="none"/></svg>;
}

function TikTokIcon() {
  return <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M16.5 3c.4 2.1 1.7 3.5 3.8 3.8v3.1a8 8 0 0 1-3.8-1.1v6.4a5.8 5.8 0 1 1-5-5.7v3.2a2.6 2.6 0 1 0 1.8 2.5V3h3.2Z"/></svg>;
}

const socialLinks = [
  {label:"Instagram", url:"https://www.instagram.com/restamarket.az/", Icon:InstagramIcon},
  {label:"TikTok", url:"https://www.tiktok.com/@restamarket.az", Icon:TikTokIcon},
  {label:"YouTube", url:"https://www.youtube.com/@restamarket_az", Icon:YouTubeIcon},
];

export function StoreSocialLinks() {
  const {language} = useTranslations();
  const copy = presenceCopy[language];

  return <div className="sf-presence-social">
    <div className="sf-presence-social-copy"><strong>{copy.socialTitle}</strong><p>{copy.socialDescription}</p></div>
    <div className="sf-presence-social-links" role="group" aria-label={copy.socialTitle}>
      {socialLinks.map(({label, url, Icon}) => <a key={label} href={url} target="_blank" rel="noopener noreferrer" aria-label={`${label} · RestaMarket (${copy.opensNewTab})`}><Icon/><span>{label}</span><ArrowUpRight className="sf-presence-social-arrow" size={14} aria-hidden="true"/></a>)}
    </div>
  </div>;
}
