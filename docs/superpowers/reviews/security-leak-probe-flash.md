# Security Leak Probe & Volume Audit Report

**Dizin:** `/Users/ozger/Desktop/MegaSaver-review`  
**Tarih:** 2026-07-29  

---

## Adım 1: Sızıntı Probu (Leak Probe)

3000 satırlık ham çıktının ortasına (satır 1500–1502) gömülen üç sır için 4 farklı giriş noktasının oluşturduğu tüm `storeRoot` dizini altındaki dosyalar (`content/`, `stats/`, `evidence/`, `traces/` dahil) ham regex taramasıyla taranmıştır (`grep -r "<ham sır>"`).

### Üretilen Test Sırları (değerler redakte edildi)

> Bu rapor ilk hâlinde üretilen test sırlarını ham olarak taşıyordu ve GitHub'ın
> push koruması bunu haklı olarak reddetti. Değerler sentetikti ve hiçbir servise
> ait değildi, ama deseni gerçek anahtarlardan ayırt edilemez — tarayıcının
> yapması gereken tam olarak buydu. Probun kanıt değeri desende, değerde değil:
> her biri politikanın tanıdığı bir desenden üretildi ve store'da hiçbirine
> rastlanmadı. Yeniden üretmek için aynı desenlerden yenilerini oluşturun.

- **github_token:** `ghp_<redacted-36-char-token>`
- **anthropic_key:** `sk-ant-<redacted-40-char-key>`
- **stripe_key:** `sk_live_<redacted-24-char-key>`

### Rapor Tablosu (Giriş Yolu × Sır):

| Giriş Yolu | `github_token` | `anthropic_key` | `stripe_key` |
| :--- | :---: | :---: | :---: |
| **A) recordAndFilterOverlayOutput** | **CLEAN** | **CLEAN** | **CLEAN** |
| **B) readAndFilter + persistChunkSet** | **CLEAN** | **CLEAN** | **CLEAN** |
| **C) runOverlayOutputExecCommand** | **CLEAN** | **CLEAN** | **CLEAN** |
| **D) runOutputExecCommand** | **CLEAN** | **CLEAN** | **CLEAN** |

---

## Adım 2: Hacim Ölçümü (Volume Metrics)

3000 satırlık ham girdi boyutu: **213,825 bayt** (~213.8 KB)  
`storeRawOutput: true` modunda her bir yol için oluşan toplam `storeRoot` disk kullanımı:

| Giriş Yolu | Ham Çıktı Boyutu | Toplam Store Disk Boyutu | Oran (Store / Ham) |
| :--- | :---: | :---: | :---: |
| **A) recordAndFilterOverlayOutput** | 213,825 bayt | 237,568 bayt | **1.1110** |
| **B) readAndFilter + persistChunkSet** | 213,825 bayt | 229,376 bayt | **1.0727** |
| **C) runOverlayOutputExecCommand** | 213,825 bayt | 245,760 bayt | **1.1494** |
| **D) runOutputExecCommand** | 213,825 bayt | 258,048 bayt | **1.2068** |

---

## Adım 3: GC ve Saklama Sınırı Analizi

`grep -rn "RETENTION\|retention\|maxAge\|prune\|gc"` tarama sonuçları:

1. **`packages/context-gate/src/evidence-gc.ts:4`**
   - `gcEvidence` fonksiyonunu çağırarak evidence ledger üzerindeki süresi dolmuş kayıtları temizler.
2. **`packages/context-gate/src/evidence-gc.ts:5`**
   - Evidence saklama süresi sabiti olan `EVIDENCE_RETENTION_MS` tanımını import eder.
3. **`packages/context-gate/src/evidence-gc.ts:35`**
   - Evidence ledger üzerinde `EVIDENCE_RETENTION_MS` (30 gün) süresini dolduran kayıtları silmek için `gcEvidence` fonksiyonunu çalıştırır.
4. **`packages/context-gate/src/saver-heartbeat.ts:138`**
   - In-memory heartbeat eşlemelerinden eski çalışma zamanı kayıtlarını temizler.
5. **`packages/context-gate/src/saver-heartbeat.ts:150`**
   - Heartbeat failure/fallback map verilerini zaman damgasına göre budayan jenerik yardımcı fonksiyondur.
6. **`packages/context-gate/src/index.ts:20`**
   - Pinned/manual hold kayıtlarını koruyarak chunk set'leri budayan `pruneChunkSetsHonoringPins` fonksiyonunu dışa aktarır.
7. **`packages/context-gate/src/index.ts:53`**
   - Evidence store temizleme fonksiyonu olan `sweepEvidenceStore`'u dışa aktarır.
8. **`packages/context-gate/src/retention-prune.ts:50`**
   - Belirli bir tarihten eski (`olderThan`) chunk set'leri, pinned veya manual hold olanları koruyarak content store'dan siler.
9. **`packages/context-gate/src/run-command.ts:426`**
   - Komut çalıştırma tamamlandığında `pruneTraceSessions` çağırarak eski replay trace verilerini temizler.
10. **`packages/context-gate/src/run.ts:213`**
    - Pipeline çalışması sonunda `pruneTraceSessions` çağırarak eski replay trace verilerini temizler.
11. **`packages/context-gate/src/record-output.ts:43`**
    - `EVIDENCE_RETENTION_MS = 30 * 86_400_000` (30 gün) olarak varsayılan varsayılan saklama ömrünü tanımlar.
12. **`packages/content-store/src/store.ts:260`**
    - Verilen son saklama tarihinden (`olderThan`) daha eski chunk set dosyalarını disktan fiziksel olarak siler.

### Soru Yanıtı:
Yeni tam-ham saklama hacmini sınırlayan otomatik ve anlık bir disk kota / otomatik silme mekanizması komut çalıştırma anında **yoktur**. `EVIDENCE_RETENTION_MS` (30 gün) gibi zaman bazlı saklama politikaları tanımlanmış ve `pruneChunkSetsHonoringPins` / `pruneOlderThan` altyapısı yazılmış olsa da, bu fonksiyonlar periyodik bir cron/daemon görevi veya `mega output gc` komutu ile açıkça çağrılmadıkça veya tetiklenmedikçe disk üzerinde veriler zaman içinde birikir.
