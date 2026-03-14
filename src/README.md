# Source Modules (Roadmap)

Bu klasor, tek parca `index.html` yapisindan moduler yapiya gecis icin hazirlandi.

## Hedef moduller

- `core/`: uygulama durumu, localStorage, ortak utility fonksiyonlari
- `features/`: set manager, kart akisi, filtreleme gibi feature bazli moduller
- `ui/`: DOM render, event binding, tema ve gorunum katmani
- `shared/`: iki veya daha fazla modulu ilgilendiren ortak sabitler/yardimcilar

## Gecis stratejisi

1. `index.html` icindeki fonksiyonlari once mantik katmanina gore ayirin.
2. Her adimda sadece bir feature tasiyin (or: theme toggle).
3. Her tasimadan sonra `npm run test:smoke` calistirip davranisi koruyun.
