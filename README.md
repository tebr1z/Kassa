# BirKassa

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

1. `.env.example` faylını `.env.local` kimi kopyalayın və `DATABASE_URL` yazın.
2. Asılılıqları quraşdırın: `npm install`
3. İnkişaf serverini başladın: `npm run dev`
