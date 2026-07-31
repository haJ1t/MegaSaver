# MegaSaver 4.0 — Ultra-Deep Specification: Autonomous Context Surgery (S7) & Multi-Agent Distributed Brain Mesh (S8)

> **Tarih:** 1 Ağustos 2026  
> **Proje:** MegaSaver (`@megasaver/*`) — Monorepo Architecture  
> **Doküman Türü:** Tam Mimari ve Mühendislik Spesifikasyonu (Sütun S7 & S8)  
> **Risk Seviyesi (risk-modes §12):** **HIGH** (S7: Bağlam Manipülasyonu & Gölge Doğrulama) + **CRITICAL** (S8: Çoklu-Ajan Hafıza Senkronizasyonu & Çapraz-Ajan Devir)  
> **Sayı Disiplini:** Tüm sayısal iddialar **ÖLÇÜLDÜ**, **HEDEF**, **HİPOTEZ** etiketlidir.

---

## 0. Yürütücü Özeti ve Üç Kol Uyum Matrisi

MegaSaver 3.0 v3 mimarisi 6 sütunu üç kola (Bayt / Tur / Fiyat) bağlamıştı. **MegaSaver 4.0**, ajanın hata düzeltme döngülerinde ve çoklu-ajan çalışmalarında yaşadığı iki büyük verimsizlik duvarını yıkmak üzere iki yeni sütun ekler:

```
                                    KOL 1: BAYT            KOL 2: TUR             KOL 3: FİYAT
                                 (Sıkıştırma & Teslim)  (Davranış & Döngü)      (Yönlendirme)
                                ┌──────────────────────┬──────────────────────┬──────────────────┐
   S7: Autonomous Surgery       │  ████ (Sıfır ham log)│  ████ (3 tura inme)  │                  │
   S8: Distributed Brain Mesh   │  ████ (Sıfır tekrar) │  ████ (Anında ısınma)│                  │
                                └──────────────────────┴──────────────────────┴──────────────────┘
```

1. **Sütun 7 (S7) — Autonomous Context Surgery (Öz-İyileştiren Bağlam Cerrahisi):**  
   Ajan bir derleme, tip veya test hatası aldığında, 500+ satırlık ham stack-trace bağlama enjekte edilmez. `context-gate` hatayı yakalar, CAS deposuna kaldırır (`msr://log_<hash>`), Gölge Worktree (`S5`) arka planda AST farkını çıkarır ve ajanın bağlamına yalnız 3 satırlık cerrahi yama uyarısı (`mesh://patch_<hash>`) basar. **HEDEF: Hata düzeltme turlarını 11 turdan 3 tura düşürmek (%72 Tur Tasarrufu), hata logu baytlarını %98 azaltmak.**

2. **Sütun 8 (S8) — Distributed Brain Mesh & Memory Consensus (Dağıtık Hafıza ve Mutabakat):**  
   Claude Code, Codex, Cursor veya Gemini arasında geçiş yapıldığında, 50.000 token'lık geçmiş sohbet bağlamı yeniden yüklenmez; redakte edilmiş, bayt-stabil `StateVector` (`mesh://state_<hash>`) devredilir. Farklı ajanların hafızaları çeliştiğinde, LLM çağırmadan deterministik Code-Truth AST doğrulaması ile çelişkiler çözülür. **HEDEF: Çapraz-ajan devir bağlam şişkinliğini %98.8 azaltmak.**

---

## 1. Ekonomi & Matematiksel Modelleme

### 1.1 S7 Context Surgery Net Tasarruf Denklem Kümesi

Bir hata düzeltme oturumunda $k$ adet deneme turu yapılsın. Ham log büyüklüğü $L_i$ (token), cerrahi yama handle büyüklüğü $P_i$ (token, sabit $\approx 40$ token), genişletme borcu $E_i$ (token) olsun:

$$S_{\text{surgery}} = \sum_{i=1}^{k} \left( L_i - P_i \right) \cdot p_{\text{write}} - \sum_{j \in \text{expands}} E_j \cdot p_{\text{read}}$$

$$\text{Burada } P_i \ll L_i \quad (40 \text{ tok} \ll 2000 \text{ tok}) \implies \mathbf{S_{\text{surgery}} > 0 \text{ (Daima Net Pozitif)}}$$

### 1.2 S8 Memory Consensus Skoru ve AST Öncelik Fonksiyonu

İki hafıza $M_1$ ve $M_2$ aynı kod varlığı $E$ için çeliştiğinde, deterministik skoru $C(M_i, \text{AST}, t)$ hesaplanır:

$$C(M_i, \text{AST}, t) = w_1 \cdot \mathbb{I}(\text{AST}_{\text{match}}(M_i)) + w_2 \cdot \text{Confidence}(M_i) + w_3 \cdot e^{-\lambda(t_{\text{now}} - t_i)}$$

$$\text{Ağırlıklar: } w_1 = 0.60 \text{ (AST Kod-Gerçekliği)}, \quad w_2 = 0.25 \text{ (Ajan Güveni)}, \quad w_3 = 0.15 \text{ (Zaman Tazeliği)}$$

> **Değişmez Kural (I17):** $w_1$ ağırlığı ezicidir. Kodun canlı AST'si ile uyuşan hafıza ($M_2$), zaman damgası daha eski olsa bile, kodda artık var olmayan bir yapıyı iddia eden hafızayı ($M_1$) deterministik olarak **supersede** eder (yürürlükten kaldırır).

---

## 2. S7 — Autonomous Context Surgery Engine (Derin Detaylar)

### 2.1 4-Aşamalı Hata Ayrıştırma ve Parser Matrisi

`context-gate` altındaki `surgery-classifier` şu 4 ana hata sınıfını deterministik regex ve AST pattern ile tespit eder:

| Hata Sınıfı | Örnek Kod/Mesaj | Yakalama Stratejisi | AST Hipotez Üretici |
|---|---|---|---|
| `type_mismatch` | `TS2322: Type 'string' is not assignable to type 'number'` | TS Compiler API / AST parser | Tip dönüşümü (`Number()`, `as ...`) veya metot imza uyarlaması |
| `missing_symbol` | `TS2304: Cannot find name 'calculateRoute'` | Unbound identifier scan | Proje AST `CodeBlock` indeksinde sembol ara $\rightarrow$ `import` satırı ekle |
| `test_assertion_fail` | `expected 'foo' to deeply equal 'bar'` | Vitest / Pytest / Cargo test format parser | Beklenen/gelen farkını L0 satır aralığıyla `@start-end` eşle |
| `syntax_error` | `Unexpected token '}' at line 42` | AST Parser syntax boundary check | Eksik parantez/virgül/süslü parantez yerini nokta atışı işaretle |

### 2.2 Shadow Counterfactual Mutation & Circuit Breaker

```
[Tool Result Failure]
        │
        ▼
   ContextGate Interceptor ──> Hata boyutu > 500B mi?
        │                             │ (Evet)
        │                             ▼
        │                     Shadow Worktree (S5) Başlat
        │                             │
        │                             ├──> Hipotez 1: Import ekle/düzelt
        │                             ├──> Hipotez 2: Tip dönüşümü yap
        │                             └──> Hipotez 3: Eşleşen sembolü değiştir
        │                                     │
        │                                     ▼
        │                             `tsc --incremental` ile doğrula (<1500ms)
        │                                     │
        │                   ┌─────────────────┴─────────────────┐
        │                   ▼                                   ▼
        │         [Doğrulandı: Clean Patch]           [Zaman Aşımı / Başarısız]
        │                   │                                   │
        │                   ▼                                   ▼
        └─────────> Mint `mesh://patch_<hash>`            Fallback: 5 Satırlık Kırpılmış
                    Modele 3 satır cerrahi bas            Ham Log Enjekte Et (Safe Mode)
```

**Circuit Breaker (Devre Kesici) Kuralları:**
1. **1500ms Hard Timeout:** Gölge worktree'de hipotez testi 1500ms'yi geçerse cerrahi işlem durdurulur ve sistem `fallback_raw` moduna düşer.
2. **Never Stalled:** Ajan asla cerrahi yama için bekletilerek kilitlenemez.
3. **Lossless Recovery:** Ham log daima `msr://log_<hash>` altında saklanır; model `proxy_expand_chunk` çağırarak ham logun tamamını görebilir.

---

## 3. S8 — Distributed Brain Mesh & Consensus Protocol (Derin Detaylar)

### 3.1 StateVector Handoff Paketi (`mesh://state_<hash>`)

Ajanlar arası geçişte üretilen `StateVector` paketi şu bileşenlerden oluşur:

```json
{
  "scheme": "msr",
  "kind": "state_vector",
  "workspaceKey": "wsk_8f9a2b1c",
  "runNamespace": "run_20260801_001",
  "sourceAgent": "claude-code",
  "targetAgent": "codex",
  "timestamp": 1785536640000,
  "payload": {
    "activeTaskBrief": "Fix session memory leak in background worker queue",
    "dirtyFilesHash": "sha256_e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "consensusMemoryIds": ["mem_approved_001", "mem_approved_004"],
    "unresolvedFailureIds": ["fail_rule_009"]
  }
}
```

### 3.2 5-Aşamalı Deterministik Mutabakat Algoritması

1. **Aşama 1 — Entity Extraction:** Çelişen hafızalar semantik olarak aynı kod varlığına (`entityId`) bağlanır (Örn: `src/auth/service.ts::authService`).
2. **Aşama 2 — Code-Truth AST Scan:** `@megasaver/indexer` canlı projenin AST'sini tarar. Koddaki mevcut sembolleri ve tipleri çıkarır.
3. **Aşama 3 — Hard AST Match:** AST verisi ile uyuşan hafıza `approved` durumuna yükseltilir; uyuşmayan hafıza `superseded` durumuna düşürülür.
4. **Aşama 4 — Soft Recency Decay Scoring:** AST belirleyici değilse (örn. mimari ilke hafızaları), Skoru $C(M_i) = \text{confidence} \cdot e^{-\lambda \Delta t}$ formülüyle hesaplanır.
5. **Aşama 5 — Ledger Commit:** Karar `memory-consensus-ledger.jsonl` dosyasına atomik olarak işlenir.

---

## 4. Yeni Sistem Değişmezleri (I15–I20)

| # | Kural | Yaptırım | Regresyon Test Sınıfı |
|---|---|---|---|
| **I15** | **Sıfır Ham Stack Şişkinliği:** 500 baytı aşan hata logları cerrahi yama üretilebildiğinde asla ham metin olarak bağlama girmez. | `context-gate` interception | `surgery/no-raw-stack-trace` |
| **I16** | **Tek Koordinatlı Adreslenebilir Yama:** Cerrahi yamalar L0 satır aralığı ve AST CodeBlock kimliği taşımak zorundadır. | `content-store` doğrulaması | `surgery/addressable-patch` |
| **I17** | **LLM-Free Deterministik Mutabakat:** Hafıza çelişkileri LLM çağrısı yapılmadan Code-Truth AST ve zaman skoru ile çözülür. | `core/memory-recall` engine | `consensus/deterministic-resolution` |
| **I18** | **Redakte Çapraz-Ajan Bütünlüğü:** Ajanlar arası `StateVector` devri öncesi `policy.redact` çalıştırmak zorunludur. | `policy` gate filtresi | `handoff/redacted-state` |
| **I19** | **Devre Kesici Güvenliği (1500ms):** Cerrahi yama üretimi 1500ms'yi geçerse sistem duraksamadan ham kırpılmış loga düşer. | `context-gate` timeout guard | `surgery/circuit-breaker-timeout` |
| **I20** | **Hafıza Yürürlükten Kaldırma İzlenebilirliği:** Çelişen hafızalar asla sessizce silinmez; `superseded` durumuyla loglanır. | `core/registry` audit | `consensus/traceable-supersession` |

---

## 5. TypeScript Veri Yapıları ve Şemalar

```typescript
// packages/shared/src/surgery/schemas.ts
import { z } from "zod";

export const surgicalPatchHandleSchema = z.object({
  scheme: z.literal("msr"),
  workspaceKey: z.string(),
  runNamespace: z.string(),
  patchHash: z.string(),
  targetFile: z.string(),
  l0StartLine: z.number().int().positive(),
  l0EndLine: z.number().int().positive(),
  errorClass: z.enum(["type_mismatch", "missing_symbol", "test_assertion_fail", "syntax_error", "runtime_panic"]),
  summaryHint: z.string().max(120),
});
export type SurgicalPatchHandle = z.infer<typeof surgicalPatchHandleSchema>;

// packages/shared/src/consensus/schemas.ts
export const memoryConsensusRecordSchema = z.object({
  entityId: z.string(),
  activeMemoryId: z.string(),
  supersededMemoryIds: z.array(z.string()),
  resolutionMethod: z.enum(["code_truth_ast_match", "recency_confidence_decay", "operator_override"]),
  scoreDelta: z.number(),
  timestamp: z.number().int().positive(),
  workspaceKey: z.string(),
});
export type MemoryConsensusRecord = z.infer<typeof memoryConsensusRecordSchema>;
```

---

## 6. Eşzamanlılık, Dosya Kilitleme ve Platform Kuralları (T1–T6 / P1–P7)

1. **Advisory Lease Locking (T2):** `memory-consensus-ledger.jsonl` dosyasına yazılırken P2 doğrudan yazım ve P3 advisory kilit kullanılır. Windows üzerinde `EPERM` hatası oluşursa, süreç durmadan hafızada bekletilir ve ilk fırsatta flushtan geçer.
2. **Atomic JSON Store Disiplini (P2):** StateVector ve Patch kayıtları geçici `.tmp` dosyasına yazılıp atomik olarak `rename` (Unix) veya kilitli doğrudan yazım (Windows) ile kalıcı hale getirilir.
3. **FNV-1a / SHA-256 Handle Minting:** `mesh://patch_<hash>` ve `mesh://state_<hash>` handle kimlikleri içerikten türetilir; tamamen deterministiktir (DZ1).

---

## 7. Ölçüm Anayasası ve Falsifikasyon Cümleleri

### 7.1 Falsifikasyon Cümleleri (Sütunların Ölüm Koşulları)
* **S7 (Autonomous Context Surgery):** Replay korpusunda cerrahi yama kullanımı onarım turlarını %30'dan az düşürürse VEYA `proxy_expand_chunk` geri çağırma oranı %50'yi aşarsa $\rightarrow$ **S7 varsayılan olarak kapatılır, cerrahi yama yerine L1 outline moduna düşülür.**
* **S8 (Distributed Brain Mesh):** Ajanlar arası devirde mutabakatlı hafızaların kod tutarsızlığı oranı %1'den fazla çıkarsa $\rightarrow$ **S8 Code-Truth AST ağırlığı $w_1 = 1.0$ yapılarak zaman skoru tamamen devre dışı bırakılır.**

---

## 8. Çocuk-Spec Bölünme Planı (Implementation Roadmap)

Bu şemsiye mimari spesifikasyon 4 bağımsız çocuk-spec'e bölünerek uygulanacaktır:

1. `docs/superpowers/specs/2026-08-01-context-surgery-classifier-design.md` (MEDIUM)
2. `docs/superpowers/specs/2026-08-01-shadow-ast-patch-synthesis-design.md` (HIGH)
3. `docs/superpowers/specs/2026-08-01-cross-agent-state-vector-design.md` (HIGH)
4. `docs/superpowers/specs/2026-08-01-deterministic-memory-consensus-design.md` (CRITICAL)
