# RestaMarket Windows tətbiqi — 0.5.0

Hazır quraşdırıcı: `desktop-release/v0.5.0/RestaMarket-Setup-0.5.0.exe`.
Proqram + cari lokal məlumatlar üçün `npm run desktop:transfer` işlədin. Nəticə
`desktop-release/RestaMarket-Kocurme-0.5.0-TARIX` qovluğunda quraşdırıcı,
`RestaMarket-data.birkassa`, yoxlama heşləri və `OXU-KOCURME.txt` olacaq.
`.exe` özü mağaza məlumatlarını daşımır. Qovluğun hamısını köçürün.
Ətraflı istifadəçi təlimatı: `desktop/TRANSFER.txt`.

Satış, stok, istifadəçi, maliyyə və çek məlumatları kompüterdə ayrıca PostgreSQL bazasında saxlanır. Kassa və endirilmiş şəkillər internet olmadan işləyir. Yeni veb sifarişləri və mesaj xidmətləri internet tələb edir.

## Quraşdırma

Windows quraşdırıcısını açın. PostgreSQL 17 və tələb olunan runtime paketə daxildir; ayrıca quraşdırma lazım deyil. Mövcud lokal məlumatlar saxlanır. İlk açılışda boş mağaza və Administrator yaradılır; ən azı 12 simvolluq şifrəni ekranda özünüz yaradın. Köhnə PIN-li hesab üçün əvvəl həmin PIN təsdiqlənir. Təmiz kompüterdə məlumat köçürürsünüzsə, ilk şifrəni yaratmadan RestaMarket → Ehtiyatdan bərpa et seçə bilərsiniz.

Baza `%APPDATA%/BirKassa/local-data/postgres` qovluğundadır. `BIRKASSA_DATA_DIR` ayrıca məlumat qovluğu seçir. PostgreSQL yalnız `127.0.0.1:55432`, tətbiq serveri `127.0.0.1:5760` ünvanında dinləyir. Paketə `.env` və veb baza parolu daxil edilmir.

Koddan açmaq: `npm install`, `npm run desktop:runtime`, `npm run build:desktop`, `npm run desktop`. İnkişaf rejimində quraşdırılmış PostgreSQL 17 də avtomatik tapılır; `BIRKASSA_PG_BIN` xüsusi yol təyin edir. Mövcud baza klasteri ilə eyni əsas PostgreSQL versiyası seçilir.

## Veb sifarişləri, stok və statuslar

1. Canlı serverə bu versiyanın kodunu və `0028_desktop_sync_outbox.sql` daxil olmaqla bütün miqrasiyaları tətbiq edin. Köhnə server yenilənmədən bağlantı işləmir.
2. Vebdə Administrator ilə daxil olun: **Tənzimləmələr → Masaüstü bağlantısı → Sinxronizasiya açarı yarat**. Açar yalnız bir dəfə göstərilir.
3. Windows tətbiqində eyni bölmədə mağazanın HTTPS ünvanını və açarı daxil edib **Yoxla və qoş** seçin.
4. Tətbiq açıq olduqda hər 30 saniyədən bir yeni sifarişlər alınır; açıq kataloq və sifariş statusları göndərilir. Giriş ekranında da arxa plan yoxlaması davam edir. Yeni sifarişlər Windows bildirişi yaradır.
5. **Veb sifarişləri → Kassaya köçür**, sonra **Sifarişlər** bölməsində hazırlayıb kassada ödənişi tamamlayın. Stok yalnız ödənişdə azalır. SKU və məhsul seçimlərinin adları uyğun gəlməlidir; naməlum məhsul ödənişə buraxılmır. Veb qiyməti və kupon saxlanır.

Sinxronizasiya açarı bir kompüter üçündür. Stok və maliyyə yalnız masaüstündə saxlanır. Vebə məhsul adı, satış qiyməti, təsviri, şəkilləri və seçimləri göndərilir; stok qalığı, alış qiyməti, maliyyə, PIN, çek və ödənişlər göndərilmir. Vebdə sifariş yaratmaq üçün stok saxlanması tələb olunmur. Son stok yoxlaması və azalma kassada satış tamamlananda edilir.

**Yalnız sifariş açarı yarat** əvvəlki kimi yalnız sifarişləri oxumağa icazə verir; stok/status yaza bilmir. Vebdə açarın yalnız heşi saxlanır. **Açarı ləğv et** hər iki girişi bağlayır. Yeni açarı masaüstündə də yeniləyin. Yerli bağlantı məlumatı `.private/desktop-sync.json` faylındadır və ehtiyat arxivinə əlavə edilmir.

İnternet olmadıqda yerli əməliyyatlar və son alınmış sifarişlər işləyir. Göndərilə bilməyən paket lokal bazada növbədə saxlanır. Təkrar və köhnə paket daha yeni stoku əvəz etmir. Son sinxronizasiya, gözləyən paketlər və xətalar bağlantı panelində görünür. Veb sifarişi dəyişibsə, köhnə yerli status onun üzərinə yazılmır. Vebdə ləğv edilən sifariş yerli ödənilməmiş sifarişi də bağlayır; artıq ödənilmiş çek saxlanır və ziddiyyət ayrıca yoxlanmalıdır.

## Oflayn şəkillər

Şəkillər tətbiq açıq olduqda arxa planda kompüterə endirilir. **Masaüstü bağlantısı → Şəkilləri kompüterə endir** dərhal yoxlama aparır və nəticəni göstərir. Endirilən şəkillər lokal ünvanla açılır. Vebdəki şəkillər dəyişdirilmir. Cloudinary JPEG/PNG/WebP/GIF faylları dəstəklənir (hər şəkil maksimum 8 MB). Fayllar məlumat qovluğunun `media` hissəsindədir.

## Veb məhsullarını boş lokal bazaya ilkin köçürmə

Bu texniki alət layihə qovluğunda işləyir. `.env` faylındakı `DATABASE_URL` yalnız oxunan veb mənbədir; ayrıca `SOURCE_DATABASE_URL` də verilə bilər. Masaüstü bazası əvvəlcədən açılıb yaradılmalıdır.

- Önbaxış: `node scripts/import-web-products.mjs`
- Köçürmə: `node scripts/import-web-products.mjs --apply`
- Sınaq: `node scripts/test-catalog-transfer.mjs`

Alət lokal `.dump` ehtiyatı yaradır, sonra məhsulları, qiymətləri, barkodları, kateqoriyaları, şəkil keçidlərini, seçimləri və anbar/rəf üzrə cari qalıqları bir tranzaksiyada köçürür. Veb satış anbarı lokal administratorun filialına bağlanır. Mənbədə bir neçə filial varsa, avtomatik köçürmə dayandırılır.

Keçmiş veb satışları, müştəri hesabları, PIN və maliyyə köçürülmür. Mənbəyə yazılmır. Eyni mənbədən təkrar icra heç nə dəyişmir; yerli satışlardan sonra stok yenidən əlavə edilmir. Dolu bazaya başqa mənbədən köçürmə rədd edilir. Bu, ilkin köçürmədir; sonrakı stok/status mübadiləsi üçün yuxarıdakı bağlantını qoşun. Şəkil fayllarını oflayn şəkillər bölməsindən endirin.

## Ehtiyat və bərpa

**RestaMarket → Ehtiyat nüsxə yarat** administrator girişindən sonra tam PostgreSQL nüsxəsini və endirilmiş şəkilləri `.birkassa` arxivində saxlayır. Hər açılışda tarixli avtomatik arxiv də yaradılır. Faylı ayrıca diskə köçürün. Arxiv şifrələnməyib və müştəri/maliyyə məlumatı daşıyır; ictimai yerdə paylaşmayın.

Administrator hesabında **RestaMarket → Ehtiyatdan bərpa et** ilə `.birkassa` və ya əvvəlki `.dump` seçin. Əvvəlcə hazırkı məlumatların ayrıca nüsxəsi yaradılır. Arxiv bütövlüyü yoxlanır, baza yeni adla bərpa olunur və yalnız uğurlu yoxlamadan sonra proqram yeni bazaya keçir. Əvvəlki baza saxlanır. Zədələnmiş arxiv aktiv bazanı dəyişmir. `.dump` formatına şəkil faylları daxil deyil. Başqa kompüterdə yeni sinxronizasiya identifikatoru yaradılır; mağaza bağlantısını ayrıca qoşun.

Paneldəki **Ehtiyat yarat/Bərpa et** də bütün davamlı cədvəlləri, o cümlədən filial, məhsul seçimi, şəkil qeydləri və veb sifariş qutusunu əhatə edir. Panel nüsxəsi bazanın içindədir; ayrıca disk üçün `.birkassa` seçin. Bərpadan sonra giriş sessiyaları bağlanır. Köhnə, natamam panel nüsxəsi açıq xəta ilə rədd edilir.

## Dil

Azərbaycan, English, Русский və 中文 yuxarıdakı seçicidədir. Seçim yadda saxlanır və Windows menyusu da dəyişir. Məhsul adları, SKU və müştəri məlumatları avtomatik tərcümə edilmir. Əvvəlki Türk dili də saxlanılıb.

## Paket və testlər

`npm run desktop:package` runtime hazırlığı, istehsal build-i və Windows quraşdırıcısını yaradır. Runtime qurulmuş PostgreSQL-in bin/lib/share hissələrindən lisenziyalarla yığılır. [PostgreSQL Windows runtime](https://www.postgresql.org/download/windows/) tətbiq quraşdırıcılarına daxil edilə bilər.

- `npm run test:desktop`: satış, stok, seçim və çek.
- `npm run test:desktop-sync`: iki ayrıca bazada sifariş axını, icazələr, stok/status göndərilməsi, təkrar göndərmə, ziddiyyətlər, oflayn şəkillər və panel bərpası.
- `node scripts/test-desktop-backup.mjs`: paket PostgreSQL-i, tam arxiv bərpası və zədələnmiş arxivin rəddi.
- `node scripts/smoke-desktop.mjs`: real `.exe` açılışı; quraşdırılmış PostgreSQL-ə keçid qadağandır.

Testlər yalnız `.local-desktop-data` istifadə edir və real mağaza bazasını dəyişdirmir.
