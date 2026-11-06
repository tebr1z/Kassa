# RestaMarket

Next.js və PostgreSQL əsaslı satış, anbar, sifariş, maliyyə və insan resursları sistemi.

## Cari əhatə

- İdarə paneli və canlı göstəricilər
- Barkod axtarışlı POS ekranı və səbət
- Məhsul kataloqu, anbar qalığı və rəf mövqeləri
- Satış sifarişləri və satınalma görünüşləri
- Maliyyə, işçilər, hesabatlar və tənzimləmələr
- PostgreSQL üçün əsas Drizzle sxemi
- Kassir növbəsi və dəyişdirilməz audit məlumat modeli

Vergi/e-kassa, bank e-POS inteqrasiyası və xarici satış bu versiyaya daxil deyil.

## İşə salma

1. `config/environment.example` faylını `.env` kimi kopyalayın və şəxsi `DATABASE_URL` yazın. `.env` Git-ə daxil edilmir.
2. Asılılıqları quraşdırın: `npm ci`
3. İnkişaf serverini başladın: `npm run dev`

## GitHub və deploy

Bu repozitoriya yalnız proqramın mənbə kodudur. `.exe`, `.birkassa`, lokal baza,
real şifrələr və istifadəçi faylları GitHub-a qoyulmur. Açıq repozitoriyaya heç vaxt
`.env`, `.private`, `.local-desktop-data`, `desktop-release` və ya media ehtiyatı göndərməyin.

- Node.js 22.13+ və PostgreSQL tələb olunur. GitHub Pages/static export uyğun deyil.
- Yoxlama: `npm run test:seo`, `node scripts/test-commerce.mjs`, `npm run test:account-translations`, `npm run build`.
- `node scripts/check-public-source.mjs --staged` commit üçün seçilmiş fayllarda
  məlum credential formalarını və məxfi məlumat yollarını yoxlayır; tam təhlükəsizlik zəmanəti deyil.
- Hosting secret manager-də `DATABASE_URL`, `BIRKASSA_ADMIN_SETUP_TOKEN` qurulur.
  `SITE_URL=https://restamarket.az`, `BIRKASSA_LOCAL=0` olmalıdır. Preview-da
  `SEO_INDEXING=0` saxlayın; indekslənmə yalnız əsas HTTPS domenində açılır.
- Mövcud bazanı dəyişməzdən əvvəl backup alın. `npm run db:migrate` migration
  tarixçəsinə əsaslanır; naməlum/köhnə bazada yoxlamadan və backup-sız işlətməyin.
  `seed` əmri canlı bazada avtomatik işə salınmır.
- Adi Node.js hostinqində `npm run build` sonrası `.next/standalone` istifadə
  oluna bilər. `public` və `.next/static` uyğun standalone qovluqlarına köçürülür;
  hostinq `HOSTNAME`/`PORT` ilə `node server.js` başladır. HTTPS reverse proxy tələb olunur.
- `BIRKASSA_PUBLIC_MEDIA_DIR` üçün koddan ayrı, qorunan daimi disk lazımdır.
  Vercel kimi serverless hostinqin diski daimi media saxlaması deyil: həmin hostinqə
  keçməzdən əvvəl yükləmələr obyekt yaddaşına uyğunlaşdırılmalıdır. Sadəcə `/tmp`
  seçmək şəkilləri daimi saxlamır. Mövcud şəkillər avtomatik GitHub-la daşınmır.

Ətraflı: `WEB-ADMIN-SECURITY.txt`, `SEO-RESTAMARKET.txt`, `OPERATIONS-0.5.txt`.
Masaüstü quraşdırma və məlumat köçürməsi: `desktop/TRANSFER.txt`.
Veb və masaüstü bazaları ayrıdır; variantlar məhsulun ümumi stokunu paylaşır.
