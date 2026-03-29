# Supabase Free Plan Backup Notes

Bu repo icin ucretsiz planda alinacak en pratik onlem, `public` semasini ve uygulama verisini duzenli olarak disa aktarmaktir.

## Bu uygulama Supabase'te ne kullaniyor?

- Supabase Auth
- `public.flashcard_sets`
- Opsiyonel `public.flashcard_user_state`
- Public `flashcard-media` Storage bucket'i

Set verisi yine en kritik kisimdir, ancak medya upload ozelligi acildiginda `flashcard-media` bucket'i de
yedek ve temizlik planina dahil edilmelidir.

## Neden bu ek onlem gerekli?

- Supabase gunluk backup aliyor, ancak ucretsiz planda kendi off-site yedeginin olmasi daha guvenli.
- Baska bir Supabase projesine veya baska bir backend'e gecmek istersen elde hazir SQL dump olur.
- Repo icindeki `docs/SUPABASE_FLASHCARD_SETS_SETUP.sql` dosyasi, uygulamanin ana tablosu icin kurtarma referansi saglar.
- Medya bucket/RPC kurulumu icin `docs/SUPABASE_MEDIA_STORAGE_SETUP.sql` referansi bulunur.

## Hazir backup komutu

En pratik ve tavsiye edilen yol:

```powershell
npm run backup:cloud-user
```

Bu komut:

- normal uygulama hesabinla giris yapar
- kendi kullanici verini okur
- `backups/cloud-user/<tarih-saat>/` altina ham yedek + import edilebilir set JSON'lari yazar
- DB sifresi ve Docker gerektirmez

DB seviyesinde daha kapsamli yedek almak istersen:

Baglanti dizesini ortam degiskeni olarak ver:

```powershell
$env:SUPABASE_DB_URL="postgresql://<gercek-baglanti-dizesi>"
npm run backup:supabase
```

Dry-run gormek icin:

```powershell
npm run backup:supabase:dry
```

Script su dosyalari `backups/supabase/<tarih-saat>/` altina yazar:

- `roles.sql`
- `public-schema.sql`
- `public-data.sql`

## Onerilen rutin

- Onemli veri degisikligi oncesi manuel backup al
- Kisisel kullanim icin varsayilan olarak `npm run backup:cloud-user` kullan
- En az haftada bir backup al
- Buyuk refactor veya backend degisikliginden hemen once yeni backup al

## Kurtarma / tasima notu

En minimum kurtarma yolu:

1. Yeni Supabase projesi ac
2. Gerekirse `docs/SUPABASE_FLASHCARD_SETS_SETUP.sql` dosyasini calistir
3. Varsa `docs/SUPABASE_SYNC_SETUP.sql` ile opsiyonel state tablosunu kur
4. Medya gerekiyorsa `docs/SUPABASE_MEDIA_STORAGE_SETUP.sql` dosyasini calistir ve bucket dosyalarini ayri aktar
5. `public-schema.sql` ve `public-data.sql` dump'larini iceri al
6. Yeni projenin URL ve anon key bilgisini uygulamaya tanit

Not:

- Bu hafif yedek akisinin odagi uygulamanin `public` semasindaki verisidir.
- Auth ayarlari, dashboard konfigurasyonlari ve Supabase proje anahtarlari ayri olarak yeniden tanimlanir.
- `backup:cloud-user` yalnizca kendi kullanici verini kapsar; tum projeyi degil.
