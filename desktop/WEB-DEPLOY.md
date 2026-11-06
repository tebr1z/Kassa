# BirKassa 0.3.0 — canlı veb yeniləməsi

Bu paket mənbə kodudur; parol, .env, real baza, istifadəçi faylları və Windows runtime daxil deyil.

## Tətbiq etmək

1. Mövcud canlı bazanın və cari işləyən versiyanın ehtiyatını alın.
2. Paketdəki mənbəni mövcud BirKassa tətbiqinin build qovluğuna açın. Serverdə olan .env və .private qovluqlarını qoruyun. Node.js 22.13+ və mövcud PostgreSQL bağlantısı tələb olunur.
3. `npm ci`, sonra mövcud canlı DATABASE_URL ilə `npm run db:migrate` işlədin. 0026, 0027 və 0028 miqrasiyaları da tətbiq olunmalıdır.
4. `npm run build:desktop` istehsal Next.js build-i yaradır (əmrin adı desktop olsa da bu, eyni veb server build-idir).
5. Mövcud hostinq qaydasına uyğun yeni build-i yayımlayın. Standalone işlədilirsə, public qovluğunu .next/standalone/public, .next/static hissəsini .next/standalone/.next/static kimi yerləşdirin. Host/port və HTTPS reverse-proxy parametrini mövcud hostinqə uyğun saxlayın. Canlı serverdə BIRKASSA_LOCAL=1 istifadə etməyin.
6. `/api/auth` cavabını və kataloqu yoxlayın. Açar olmadan `/api/desktop-feed` 401 qaytarmalıdır. Bu endpoint yoxdur və ya HTML qaytarırsa, köhnə build hələ işləyir.
7. Canlı vebdə Administrator → Tənzimləmələr → Masaüstü bağlantısı → Sinxronizasiya açarı yarat. Yeni açar əvvəlkini ləğv edir.
8. Windows 0.3.0 tətbiqində həmin HTTPS ünvanını və açarı daxil edib Yoxla və qoş seçin. SKU və anbar kodları uyğun gəlməlidir. Desktop stok əsas götürüləcək.
9. Son sinxronizasiya vaxtını, hər anbarın qalığını və bir sınaq sifarişinin statusunu yoxlayın. Maliyyə, PIN, alış qiyməti və çek vebə göndərilmir.

Bir kompüterə məhdud açar verilir. Yalnız sifarişləri almaq üçün daha dar səlahiyyətli Yalnız sifariş açarı yarat seçin. Masaüstü açıq qaldıqda hər 30 saniyədən bir yoxlayır.

Yerli server/build və iki test bazasında sınaqlar aparılıb. Canlı yayımlama yalnız doğru sayt və hostinq müəyyən edildikdən sonra təsdiqlənə bilər.
