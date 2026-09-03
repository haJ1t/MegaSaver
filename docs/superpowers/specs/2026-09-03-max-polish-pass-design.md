# Max Polish Pass - Design Spec

Risk: MEDIUM. Branch: feat/max-polish-pass. Date: 2026-09-03.
Skills: superpowers:brainstorming (architectural path) + impeccable polish.

## 1. Goal

GUI, site ve CLI metinlerini Console dunyasini koruyarak maksimum polish seviyesine cikarmak: kutu ve kart oranlari tutarli, sayfa ritmi dengeli, sitedeki AI-slop hissi temizlenmis, CLI dili tek sese inmis bir Mega Saver. Yeniden tasarim yok; kimlik, icerik ve davranis korunur.

## 2. Non-goals

- Yeni sayfa, yeni ozellik, yeni bridge route, yeni bagimlilik yok.
- Core mantigi, flag davranisi, komut cikti verisi degismez.
- Renk paleti degismez (kontrast-pinned accent dahil). Font ailesi degismez.

## 3. Evidence (2026-09-03 incelemesi)

### 3a. GUI oran sapmalari

- Sayfa genisligi daginik: 880px, 900px, 1180px, 1280px karisik. DESIGN.md max-w-5xl diyor; hicbir sayfa uymuyor.
- Kart radius daginik: rounded-2xl (5), rounded-xl (32), rounded-lg (49), rounded-md (64). Kart icin tek deger yok.
- Overview hero grid 1.55fr/1fr keyfi oran; yan kartlar Card icinde Card yapisi (nested card).
- Sayfa gap ritmi daginik: gap-3.5, gap-4, gap-5 ayni rolde karisik.
- Memory sekmeleri ve sidebar unicode glif ikonlu (cizilmis ikon degil).

### 3b. Site AI-slop sinyalleri

- label eyebrow ve kicker etiketleri (craft-floor ban).
- Art arda dizilmis h2 basliklar (kart izgarasi hissi). Jenerik bolum basliklari.

### 3c. CLI dil daginikligi

- Flag aciklamalarinda buyuk/kucuk harf ve noktalama tutarsiz.
- Hata ve mesaj metinlerinde terminoloji daginik.

## 4. Design

### 4a. Oran sistemi (DESIGN.md amendment)

- Sayfa genisligi tek deger: icerik sayfalari max-w-5xl; Memory ve Workspace veri-yogun sayfalar icin max-w-6xl istisnasi belgeli.
- Hero grid orani 8/5. Yan kartlar hero icine gomulmez; es duzey grid uyesi olur.
- Kart radius tek deger: rounded-xl. Hap kontroller rounded-full kalir.
- Gap ritmi: kart ici gap-4, bolum arasi gap-6; gap-3.5 ve gap-5 ayni rolde kullanilmaz.
- Nested card yasak: Card icinde Card yerine bolum basligi ve hairline ayrac.

### 4b. Ikon dili

- Unicode glif ve emoji ikonlar cizilmis tek-aile SVG ikonlara doner (sidebar GLYPHS, palette ikonlari, Memory sekmeleri, top-bar ok isareti).
- Ikon yoksa metin tek basina durur; yer tutucu glif konmaz.

### 4c. Site dili

- Kicker ve eyebrow etiketleri kalkar; baslik kendi agirligini tasir.
- Es-buyuklukte kart izgarasi yerine icerik hiyerarsisi: birincil mesaj buyuk, destekleyici bolumler kucuk.
- Bolum basliklari urunun kendi diline cekilir (receipt, saver, memory, evidence kelimeleri).
- Dort sayfa ayni tip olcegi ve aralik ritmini kullanir.

### 4d. CLI dili

- Sadece kullaniciya gorunen metinler: flag description, help, hata ve uyari mesajlari.
- Cumle standardi: kucuk harfle baslar, noktasiz biter (mevcut citty stilinin baskin hali); istisnalar belgeli.
- Terminoloji sozlugu spec ekinde: store dir, JSON emit, workspace ifadeleri tek form.

### 4e. Faz plani

- Faz 1: GUI oran sistemi (sayfa genisligi, grid, radius, gap, nested-card temizligi, ikon dili).
- Faz 2: Site dili (kicker temizligi, hiyerarsi, tip ritmi, 4 sayfa).
- Faz 3: CLI metin standardi (sozluk ve description/message gecisi).
- Her faz: desktop ve mobil gezme, bos/yukleniyor/hata durumlari, kontrast testi, ilgili paket testleri yesil.

## 5. Acceptance

- Tum GUI sayfalari oran sistemine uyuyor (tek genislik seti, tek kart radiusu, tek gap ritmi).
- Nested card kalmadi; unicode-glif ikon kalmadi.
- Sitede kicker ve eyebrow kalmadi; 4 sayfa ayni ritimde.
- CLI metinleri sozluge uyuyor; snapshot testleri guncel.
- pnpm verify yesil; kontrast testi yesil.
- Masaustu ve mobil gezme tamam; wiki log guncellendi.

## 6. Risk

MEDIUM: tam superpowers zinciri, worktree olan bu branch, code-reviewer dis review. Renk ve font degismedigi icin kontrast riski dusuk; oran degisiklikleri gorsel review gerektirir.
