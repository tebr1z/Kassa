'use client';
import {useTranslations} from '@/lib/language';
import './google-maps-setup.css';

export default function GoogleMapsSetup(){
 const {t}=useTranslations();
 return <section className="google-setup" aria-labelledby="google-setup-title">
  <h3 id="google-setup-title">{t('Google xəritəni necə qoşmalı?')}</h3>
  <p>{t('Müştəri ünvan axtarışından nəticə seçəndə ünvan və xəritə nöqtəsi birlikdə doldurulur. Əl ilə ünvan yazmaq həmişə mümkündür.')}</p>
  <ol>
   <li><strong>{t('Google Cloud layihəsi və billing')}</strong><span>{t('Öz layihənizi yaradın, billing-i aktivləşdirin. Xərcləri izləmək üçün büdcə bildirişləri və API kvotaları qoyun.')}</span></li>
   <li><strong>{t('Brauzer açarı: xəritə və ünvan axtarışı')}</strong><span>{t('Maps JavaScript API və Places API (New) aktiv olsun. Açarı yalnız bu API-lərə və sayt ünvanlarına məhdudlaşdırın.')}</span><code>https://kassa.nex.autos/*</code><code>https://restamarket.az/*</code><small>{t('Yalnız istifadə etdiyiniz domenləri əlavə edin; limitsiz açar saxlamayın.')}</small></li>
   <li><strong>{t('Server açarı: kilometr hesablaması')}</strong><span>{t('Ayrı açar yaradın: yalnız Routes API və serverin çıxış IP-si. Bu açarı brauzer sahəsinə yazmayın.')}</span></li>
   <li><strong>{t('Açarları aşağıda saxlayın')}</strong><span>{t('Xəritə üçün brauzer açarı kifayətdir. Kilometr hesablaması üçün server açarı, mərkəz koordinatları və km tarifi də lazımdır.')}</span></li>
  </ol>
  <div className="google-setup-links"><a href="https://console.cloud.google.com/google/maps-apis/overview" target="_blank" rel="noopener noreferrer">{t('Google Cloud konsolunu aç')} ↗</a><a href="https://developers.google.com/maps/documentation/javascript/get-api-key" target="_blank" rel="noopener noreferrer">{t('Rəsmi qoşulma təlimatı')} ↗</a></div>
  <small>{t('Bu təlimat billing-i aktivləşdirmir. Açarları söhbətə göndərməyin; yalnız aşağıdakı müvafiq sahələrə daxil edin.')}</small>
 </section>;
}
