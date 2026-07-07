---
title: GTM & Monetization Plan — the 3-element framework applied
tags: [synthesis, business, gtm, monetization]
sources: [X/@Techburhan 3-element framework (2026-07-05 screenshot), internal product research (wiki+repo), external market scan (web, mid-2026)]
status: approved — model + market locked (2026-07-05)
created: 2026-07-05
updated: 2026-07-05
---

# MegaSaver GTM planı — "tutan uygulama / içerik / pazarlama" çerçevesi

Framework (Burhan Kocabıyık): para kazanan uygulama = **(1) tutan uygulama**
(doğru problem, doğru market, az rakip) + **(2) düzgün içerik** (organik +
reklam) + **(3) pazarlama/satış** (B2C=reklam, B2B=mail+toplantı). Bu sayfa o
çerçeveyi MegaSaver'a kanıt-temelli uygular.

## Yönetici özeti

- Problem doğru ve kanıtlı; market büyüyor; ama blue ocean DEĞİL — her pillar
  ücretsiz OSS'le dolu. Savunulabilir tek SKU **entegre bundle** + güven
  (decision-trace, honest metrics, local-first).
- En büyük engel ürün-pazar değil **ürün-görünürlük**: GUI (wow yüzeyi)
  paketlenmemiş; npm kullanıcısı değeri hiç görmüyor; savings on-demand.
- En büyük kitle (Pro/Max) fatura değil **limit** hissediyor → birincil mesaj
  "aynı planla daha çok seans", ikincil mesaj "$ tasarrufu" (API/kurumsal).
- Yol: Faz 0 satılabilirlik (GUI paketle + $/limit metriği + onboarding +
  landing) → Faz 1 ücretsiz launch + içerik motoru → Faz 2 open-core Pro →
  Faz 3 B2B/team.

## Kanıt tabanı (mid-2026 araştırması)

**Talep:** Claude Code ~%18 developer adoption (Oca 2026), $2.5B run-rate;
"cost volatility" takımların #1 endişesi; $81k bill-shock (Slash) viral;
weekly-limit söylemi sürekli; "tokenmaxxing" kültürü (Viberank, CCgather,
Meta'nın 85k kişilik iç leaderboard'u).

**Rakipler (hepsi kısmi, çoğu ücretsiz):** claude-mem (~72k★, memory+compression
— en yakın), ccusage ekosistemi (metering), claude-code-router (proxy),
Repo Prompt ($14.99/mo — solo-dev'in context'e para verdiğinin kanıtı), RepoMix,
rulesync (config sync), Mem0/Zep/Letta (farklı alıcı: agent builder). Packmind
"ContextOps" kategorisini markalıyor. **Entegre paket sahipsiz.**

**Fiyat bandı:** solo-dev QoL $8–20/mo (Raycast $8, Copilot $10, Repo Prompt
$14.99, Cursor $20). Open-core infra: OSS free + team/enterprise paid
(LiteLLM, Helicone, Packmind şablonu).

**Riskler:** (1) Anthropic native absorption — Claude Code'un kendi compaction/
memory'si (EN BÜYÜK risk; cevap: agent-AGNOSTIK + explainability farkı),
(2) prompt-cache matematiği — naif "X token kurtardık" cache-read'lerde dolar
bazında abartır; savings matematiği cache-aware olmalı, (3) **proxy ToS**:
subscription OAuth token'larını 3P proxy'den geçirmek yasak (Oca-Şub 2026) —
proxy yalnız kendi API-key'inle pazarlanır, dokümantasyonda net, (4) ücretsiz
klonlar — tek feature haftalar içinde klonlanır; bundle + güven savunur,
(5) pain döngüsel — limit artışları/fiyat düşüşleri aciliyeti söndürür;
konumlanma "tasarruf"tan öte "kontrol + görünürlük + hafıza".

## Element 1 — Tutan uygulama (ürün)

**Verdict:** çekirdek güçlü (evidence-preserving compression + memory-aware
ranking + decision-trace + agent-agnostik 8 connector + honest metrics — hiçbir
rakipte bu küme yok), ama **tutma döngüsü zayıf**: değer görünmez.

Faz 0 işleri (satılabilirlik, hepsi ürün işi):
1. **GUI'yi paketle** (Tauri; post-v1.1 deferred item öne çekilir). Wow yüzeyi
   (savings chart, decision-trace, memory graph) kurulumla gelsin. En yüksek
   kaldıraç.
2. **Headline metrik**: GUI ana ekrana + haftalık özete kümülatif
   "≈$X kurtarıldı / ≈Y ekstra seans" (proxy usage.jsonl'de model+token var;
   $ mapping eklenir; cache-aware dipnot). Pro/Max için limit-stretch, API
   için $ framing.
3. **Onboarding'i teke indir**: `mega init` benzeri tek komut → hook + mcp +
   saver enable + (ops.) GUI aç; ilk 5 dakikada ilk görünür tasarruf. Bugün
   drop-off: proje/session kavramı, session-id, Claude-Code-only hooks,
   audit'e kadar görünmez değer.
4. **Retention döngüsü**: haftalık digest (yerel bildirim/CLI banner) +
   kümülatif sayaç + "paylaş" kartı (Element 2'ye köprü).
5. **Hijyen**: npm `license: MIT` metadata (1 satır, şimdi unlicensed
   görünüyor); proxy ToS dokümantasyon netliği; güvenlik sayfası (local-first
   iddiası denetlenebilir olmalı — claude-mem HIGH-risk flag'i ders).

## Element 2 — İçerik

Nişin doğal para birimi **usage-screenshot**. Ürün kendi reklam kreatifini
üretir:

1. **Paylaşılabilir savings kartı** (ürün özelliği): "Bu hafta MegaSaver
   X token / ≈$Y kurtardı — Z seans daha" görseli; tek tık X'e. ccusage'ın
   viral scorecard mekaniği, verimlilik kimliğiyle.
2. **Decision-trace teardown içeriği**: "MCP server'ların turn başına 18K
   token yiyor" tarzı exposé postları bu nişte tutarlı çalışıyor —
   decision-trace bu içeriği otomatik üretir. Haftalık 1 teardown.
3. **Benchmark postları** (vibes değil sayı): kontrollü before/after,
   `mega audit honest` çıktısıyla — honest-metrics zaten anti-vanity, bunu
   pazarlama diline taşı.
4. **Bill-shock newsjacking**: her viral fatura hikâyesine "metering + cap
   5. dakikada yakalardı" cevabı.
5. **SEO cluster**: "reduce claude code token usage" kanıtlı yüksek hacim —
   docs sitesinde sahiplen.
6. **Build-in-public**: X'te EN + TR paralel (TR dev sahnesi beachhead —
   framework'ün kaynağı da orası); haftalık ilerleme + sayılar.
7. **Ters leaderboard**: "en çok token KURTARAN" (tokenmaxxing mekaniğinin
   tersi) — topluluk + viral döngü (Faz 2+).

## Element 3 — Pazarlama / satış

**B2C (önce):** launch dizisi — X thread (TR+EN) → Show HN → Product Hunt →
r/ClaudeAI + ilgili Discord'lar. Ücretsiz + open-core; yıldız/kurulum hedefli.
Reklam ancak kart/landing dönüşümü kanıtlandıktan sonra (küçük bütçe, X).

**B2B (sonra, Faz 3):** bill'i gerçekten hisseden segment. Phase-10 deferred
team/cloud slice (org rules, hosted sync, web approval) doğal paid tier.
Kanal: outbound mail + vaka çalışması ("takım faturası -%30").

**Monetizasyon modeli — KARAR (2026-07-05, user-approved): open-core.**
CLI çekirdeği MIT/ücretsiz (yıldız + dağıtım; claude-mem 72k★ tavanı kanıtlıyor),
**Pro = paketlenmiş GUI + digest/paylaşım kartı + gelişmiş trace/analitik**
**$10–15/mo** (Repo Prompt bandı). Gerekçe: Vibe Kanban dersi (popüler OSS ≠
gelir); ödeme isteği metering/kontrol + team'de yoğunlaşıyor; Packmind/Repo
Prompt şablonu kanıtlı.

> ✅ **Fiyat kararı ÇÖZÜLDÜ (2026-07-07, user-approved):** fiyat sitede
> yazan şekilde — **$7.99/mo (Gumroad)** kanonik. Yukarıdaki $10–15 bandı
> tarihsel karar; güncel karar bu satır (source: user session 2026-07-07;
> docs/launch/owner-pre-launch-checklist.md).

**Dil/market — KARAR (2026-07-05, user-approved): TR beachhead + EN paralel.**
TR dev sahnesinde erken görünürlük + feedback; eş zamanlı EN launch dizisi
(HN/PH global). İçerik iki dilde üretilir (kart/landing çift dilli).

## Fazlar + KPI

| Faz | İçerik | Süre | KPI |
|---|---|---|---|
| 0 Satılabilirlik | GUI paketleme, $/limit headline, `mega init`, landing+domain, license fix, share kartı | 2–4 hafta | kurulum→ilk görünür tasarruf < 5 dk |
| 1 Launch | PH/HN/X dizisi, içerik motoru start (haftalık teardown+benchmark), ücretsiz | 2 hafta | ★, kurulum, kart paylaşımı |
| 2 Monetize | Pro tier + entitlement, opt-in telemetry, ters leaderboard | 4–6 hafta | dönüşüm %, MRR |
| 3 B2B | Team slice (Phase-10), outbound, vaka çalışması | sonra | pilot takım sayısı |

**Tweet'in "DOA V1" kıyası:** tweet hazır-uygulama+hazır-içerik satıyor
(white-label). Bizde uygulama ZATEN var ve kanıtlı (dogfood); eksik olan
tweet'in 2. ve 3. elementi — bu plan tam o boşluğu kapatıyor.

## Karar durumu

1. ✅ Monetizasyon: open-core (2026-07-05); Pro fiyat **$7.99/mo** — site/
   Gumroad kanonik (user revizyonu 2026-07-07; eski $10–15 bandı tarihsel).
2. ✅ Market: TR beachhead + EN paralel (2026-07-05).
3. ✅ Faz 0 fiilen kapandı (launch dalgası #231–#251, 2026-07-06): GUI
   paketleme Tauri yerine `mega gui` (npm) ile çözüldü; headline, `mega init`,
   landing + domain (megasaver.dev), license fix, share kartı shipped.
4. ✅ Faz 2 çekirdeği ERKEN shipped: entitlement + 3 Pro modül
   (history/insights/forecast) + /pro pricing + Gumroad checkout canlı.
   Kalan tek aktivasyon blocker'ı: npm publish 1.5.0 (owner).
