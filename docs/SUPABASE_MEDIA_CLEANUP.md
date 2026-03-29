# Supabase Media Cleanup

Bu uygulama medya yuklemelerini `flashcard-media` bucket'inda tutar ve 400 MB uygulama kotasini
`public.flashcard_media_quota` tablosu uzerinden izler.

## Onemli Kural

- Dosyalari SQL ile `storage.objects` tablosundan silmeyin.
- Supabase Storage API, Dashboard veya `supabase.storage.from(...).remove(...)` kullanin.

## Tekil Dosya Silme

1. Storage API veya Dashboard ile dosyayi silin.
2. Ardindan quota kaydini guncellemek icin su RPC'yi cagirın:

```sql
select *
from public.release_flashcard_media_asset('media/ornek-dosya-uuid.webp');
```

Bu fonksiyon sadece uygulamanin quota tablosunu azaltir. Storage dosyasini ayrica silmez.

## Toplu veya Manuel Temizlik Sonrasi

Dashboard uzerinden cok sayida dosya sildiyseniz ya da quota sayacinin senkronundan emin olmak
istiyorsaniz su fonksiyonu calistirin:

```sql
select *
from public.reconcile_flashcard_media_quota('flashcard-media');
```

Bu islem:

- Bucket icindeki gercek toplam boyutu `storage.objects` uzerinden yeniden hesaplar.
- Beklemede kalmis upload reservation kayitlarini temizler.
- Artık bulunmayan asset satirlarini `public.flashcard_media_assets` tablosundan siler.

## Yetim Dosyalar

Uygulama, markdown metninden cikartilan dosyalari otomatik olarak bucket'tan silmez. Bu nedenle:

- Kullanici bir gorsel veya ses etiketini editor'den kaldirsa bile bucket'taki fiziksel dosya kalir.
- Periyodik olarak Storage Dashboard'da en buyuk ve en eski dosyalari gozden gecirmek faydalidir.
- Markdown referanslari ile bucket nesnelerini eslestiren daha ileri seviye bir garbage-collection
  mekanizmasi istenirse sonraki adim olarak `flashcard_sets.raw_source` taramasi eklenebilir.
