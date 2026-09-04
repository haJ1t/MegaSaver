# Max Polish Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Spec'teki oran sistemi, ikon dili, site dili ve CLI standardini uc fazda gerceklestirmek.

**Architecture:** Mevcut Console dunyasi korunur; degisiklikler class-name ve metin seviyesindedir. Her task kendi test dongusunu tasir; faz sonlarinda gozle gezme kaniti alinir.

**Tech Stack:** React 18 + Tailwind v3.4 (apps/gui), statik HTML (site/), Citty CLI (apps/cli), Vitest, tsc, Biome.

**Spec:** docs/superpowers/specs/2026-09-03-max-polish-pass-design.md

## Global Constraints

- Renk paleti degismez; accent hex'lere dokunulmaz (accent-contrast testi pinli).
- Font ailesi degismez.
- Yeni bridge route, yeni bagimlilik, yeni sayfa yok.
- Core mantigi ve flag davranisi degismez; sadece gorunum ve kullanici metni.
- Her task sonunda ilgili paket testleri yesil; faz sonunda pnpm verify kaniti.
- Commit mesaji Conventional Commits (feat/fix/refactor/docs) + kisa subject.

---

## Dosya Haritasi

- Faz 1 (GUI): apps/gui/src/views/overview-page.tsx, token-saver-page.tsx, memory-page.tsx, workspace-page.tsx, agent-office-view.tsx, agent-setup-doctor.tsx, workspace-session-list.tsx, planner-page.tsx, apps/gui/src/components/sidebar.tsx, top-bar.tsx, command-palette.tsx, apps/gui/src/cockpit/session-cockpit.tsx, apps/gui/DESIGN.md, apps/gui/test/styles/.
- Faz 2 (Site): site/index.html, site/pro/index.html, site/specs/index.html, site/harnesses/index.html.
- Faz 3 (CLI): apps/cli/src/commands/**/*.ts (description/help/error metinleri), apps/cli/test/commands/ snapshot'lari.

---

### Task 1: Oran sistemi pin testi (GUI guard)

**Files:**
- Create: apps/gui/test/styles/layout-ratio.test.ts
- Modify: yok

**Interfaces:**
- Consumes: yok
- Produces: LAYOUT_RULES (sayfa genisligi, kart radiusu, gap ritmi kurallari) - Task 2-4 bu kurallara uyar.

- [ ] **Step 1: Pin testini yaz (kirmizi)**

Sayfa kok class'larini ve kart radius/gap kullanimini pinleyen test:

```ts
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const VIEWS = join(__dirname, "..", "..", "src", "views");

describe("layout ratio system", () => {
  it("page roots use the documented width set", () => {
    const files = readdirSync(VIEWS).filter((f) => f.endsWith("-page.tsx") || f.endsWith("-view.tsx"));
    const bad: string[] = [];
    for (const f of files) {
      const src = readFileSync(join(VIEWS, f), "utf8");
      const widths = src.match(/max-w-\[[0-9]+px\]/g) ?? [];
      for (const w of widths) {
        if (w !== "max-w-[1024px]" && w !== "max-w-[1152px]") bad.push(f + ":" + w);
      }
    }
    expect(bad).toEqual([]);
  });

  it("cards use rounded-xl, never rounded-2xl", () => {
    const files = readdirSync(VIEWS).filter((f) => f.endsWith(".tsx"));
    const bad: string[] = [];
    for (const f of files) {
      const src = readFileSync(join(VIEWS, f), "utf8");
      if (/rounded-2xl/.test(src)) bad.push(f);
    }
    expect(bad).toEqual([]);
  });
});
```

- [ ] **Step 2: Testi calistir, kirmizi gor**

Run: `pnpm --filter @megasaver/gui vitest run test/styles/layout-ratio.test.ts`
Expected: FAIL (mevcut max-w daginikligi ve rounded-2xl kullanimlari yakalanir).

- [ ] **Step 3: Henuz implementasyon yok - bu task sadece guard**

Implementasyon Task 2-4'te; bu task test dosyasini commitler.

- [ ] **Step 4: Commit**

```bash
git add apps/gui/test/styles/layout-ratio.test.ts
git commit -m "test(gui): pin layout ratio system widths and card radius"
```

---

### Task 2: GUI sayfa genisligi ve gap ritmi (Faz 1a)

**Files:**
- Modify: apps/gui/src/views/overview-page.tsx (max-w-[1180px] -> max-w-[1024px]; grid-cols-[1.55fr_1fr] -> grid-cols-[8fr_5fr]; gap-5/gap-3.5 -> gap-6/gap-4 ritmi)
- Modify: apps/gui/src/views/token-saver-page.tsx (max-w-[900px] -> max-w-[1024px]; gap-3.5 -> gap-4/6)
- Modify: apps/gui/src/views/workspace-session-list.tsx (max-w-[1180px] -> max-w-[1024px])
- Modify: apps/gui/src/views/agent-office-view.tsx (max-w-[1280px] -> max-w-[1152px])
- Modify: apps/gui/src/views/memory-page.tsx (max-w-[1280px] -> max-w-[1152px])
- Modify: apps/gui/src/views/workspace-page.tsx (max-w-[1280px] -> max-w-[1152px])
- Modify: apps/gui/src/views/agent-setup-doctor.tsx (max-w-[880px] -> max-w-[1024px])
- Test: apps/gui/test/styles/layout-ratio.test.ts (Task 1)

**Interfaces:**
- Consumes: LAYOUT_RULES (Task 1)
- Produces: tutarli sayfa kok class'lari - Task 3-4 uzerine insa eder.

- [ ] **Step 1: Mevcut kok class'larini listele**

Run: `grep -rn -E 'max-w-\[[0-9]+px\]' apps/gui/src/views --include='*.tsx'`
Expected: Task 1'de pinlenen daginik degerler gorunur.

- [ ] **Step 2: Kok genislikleri ve gap'leri tek sete cevir**

Her sayfada: icerik sayfalari max-w-[1024px] (max-w-5xl esdegeri), veri-yogun sayfalar (memory, workspace, agent-office) max-w-[1152px] (max-w-6xl esdegeri). Kart ici bosluk gap-4, bolum arasi gap-6. Overview hero grid `grid-cols-[8fr_5fr]`.

- [ ] **Step 3: Pin testini calistir, yesil gor**

Run: `pnpm --filter @megasaver/gui vitest run test/styles/layout-ratio.test.ts`
Expected: PASS.

- [ ] **Step 4: GUI paket testlerini calistir**

Run: `pnpm --filter @megasaver/gui vitest run`
Expected: tum testler PASS (snapshot etkilenmemeli; etkilenirse snapshot diff'i incele, sadece class-name degisikligi oldugunu dogrula).

- [ ] **Step 5: Commit**

```bash
git add apps/gui/src/views apps/gui/test/styles/layout-ratio.test.ts
git commit -m "refactor(gui): unify page widths gaps and hero ratio"
```

---

### Task 3: Kart radiusu ve nested-card temizligi (Faz 1b)

**Files:**
- Modify: apps/gui/src/views/overview-page.tsx (Card helper rounded-2xl -> rounded-xl; hero section rounded-2xl -> rounded-xl; ic ice Card yapisini bolum basligi + hairline ayraca cevir)
- Modify: rounded-2xl kalan tum kullanimlar (command-palette modal haric - modal kart degil, Task 5'te karar)
- Test: apps/gui/test/styles/layout-ratio.test.ts

**Interfaces:**
- Consumes: tutarli sayfa kokleri (Task 2)
- Produces: tek kart radiusu, nested-card'siz hiyerarsi.

- [ ] **Step 1: rounded-2xl kullanimlarini listele**

Run: `grep -rn 'rounded-2xl' apps/gui/src --include='*.tsx'`
Expected: overview-page Card helper + hero + system-readiness/live-now section'lari + command-palette modal.

- [ ] **Step 2: Kartlari rounded-xl'e cevir, nested Card'i duzlestir**

Overview'daki `Card` helper rounded-xl olur. Yan kartlar (Tokens saved, Average reduction) hero section'inin icinden cikarilip grid'in es duzey uyesi olur; hero kendi basligini tasir, yan kartlar kendi basligini. Command-palette modal rounded-2xl kalir (modal yuzeyi, kart degil) ve test istisnasi olarak isaretlenir.

- [ ] **Step 3: Pin testini guncelle ve calistir**

Testin rounded-2xl kontrolu command-palette.tsx'i istisna tutar. Run: `pnpm --filter @megasaver/gui vitest run test/styles/layout-ratio.test.ts`. Expected: PASS.

- [ ] **Step 4: GUI paket testleri**

Run: `pnpm --filter @megasaver/gui vitest run`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/gui/src/views apps/gui/src/components apps/gui/test/styles/layout-ratio.test.ts
git commit -m "refactor(gui): single card radius and flat card hierarchy"
```

---

### Task 4: SVG ikon dili (Faz 1c)

**Files:**
- Create: apps/gui/src/components/icons.tsx (tek-aile 16px stroke SVG seti: overview, sessions, token-saver, memory, workspace, planner, agent-office, agent-setup + chevron-down + check + warn)
- Modify: apps/gui/src/components/sidebar.tsx (GLYPHS map -> Icon bileseni)
- Modify: apps/gui/src/app.tsx (PALETTE_VIEWS ikonlari -> Icon bileseni)
- Modify: apps/gui/src/views/memory-page.tsx (emoji sekme ikonlari -> Icon bileseni)
- Modify: apps/gui/src/components/top-bar.tsx (acilir ok glifi -> chevron Icon)
- Test: apps/gui/test/components/icons.test.tsx

**Interfaces:**
- Consumes: yok (bagimsiz, Task 2-3 ile paralel yurutulebilir)
- Produces: `Icon({ name, className })` - name union: overview | sessions | token-saver | memory | workspace | planner | agent-office | agent-setup | chevron-down | check | warn.

- [ ] **Step 1: Ikon testini yaz (kirmizi)**

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Icon, ICON_NAMES } from "../../src/components/icons.js";

describe("Icon", () => {
  it("renders an svg with aria-hidden for every name", () => {
    for (const name of ICON_NAMES) {
      const { unmount } = render(<Icon name={name} />);
      const svg = document.querySelector("svg");
      expect(svg?.getAttribute("aria-hidden")).toBe("true");
      unmount();
    }
  });
  it("exposes a labelled variant for standalone use", () => {
    render(<Icon name=\"check\" label=\"Ready\" />);
    expect(screen.getByLabelText("Ready")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Calistir, kirmizi gor**

Run: `pnpm --filter @megasaver/gui vitest run test/components/icons.test.tsx`
Expected: FAIL (icons.tsx henuz yok).

- [ ] **Step 3: icons.tsx'i yaz (16px stroke, tek aile, currentColor)**

Tum ikonlar 16x16 viewBox, 1.5px stroke, round cap/join, currentColor. Emoji ve unicode glif yok. ICON_NAMES dizisi name union ile birebir eslesir.

- [ ] **Step 4: Tuketicileri cevir (sidebar, palette, memory sekmeleri, top-bar)**

GLYPHS Record ve PALETTE_VIEWS ikon string'leri kaldirilir; yerine `<Icon name={id} />` kullanilir. Aktif/pasif renk mevcut class'larla calismaya devam eder (currentColor).

- [ ] **Step 5: Testleri calistir**

Run: `pnpm --filter @megasaver/gui vitest run test/components/icons.test.tsx` + tam paket `pnpm --filter @megasaver/gui vitest run`. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/gui/src/components/icons.tsx apps/gui/src/components/sidebar.tsx apps/gui/src/app.tsx apps/gui/src/views/memory-page.tsx apps/gui/src/components/top-bar.tsx apps/gui/test/components/icons.test.tsx
git commit -m "refactor(gui): single-family SVG icon language"
```

---

### Task 5: DESIGN.md amendment + Faz 1 goz gezmesi

**Files:**
- Modify: apps/gui/DESIGN.md (Layout bolumu: max-w-5xl icerik / max-w-6xl veri-yogun istisnasi; kart radius rounded-xl; gap-4 ici / gap-6 bolum arasi; nested-card yasagi; modal istisnasi; Icon bileseni ve name listesi)
- Modify: wiki/log.md (tarihli Faz 1 girisi)

**Interfaces:**
- Consumes: Task 2-4 sonuclari
- Produces: guncel DESIGN.md - Faz 2-3 ve gelecek isler icin otorite.

- [ ] **Step 1: DESIGN.md Layout ve Components bolumlerini guncelle**

Degisen degerleri belgele; renk ve font bolumlerine dokunma.

- [ ] **Step 2: Faz 1 gezme kaniti (manuel)**

GUI'yi calistir (`pnpm --filter @megasaver/gui dev`), Overview / Token Saver / Memory / Workspace / Sessions sayfalarini masaustu (1440px) ve mobil (390px) genislikte gez; bos/yukleniyor/hata durumlarini tetikle (bridge kapali + bos workspace). Gercek kusurlari duzelt; gezme notlarini commit mesajina ozet olarak ekle.

- [ ] **Step 3: Kontrast testini calistir**

Run: `pnpm --filter @megasaver/gui vitest run test/styles/accent-contrast.test.ts`. Expected: PASS (renk degismedi).

- [ ] **Step 4: Commit**

```bash
git add apps/gui/DESIGN.md wiki/log.md
git commit -m "docs(gui): amend DESIGN.md with ratio system and icon language"
```

---

### Task 6: Site dili pass (Faz 2)

**Files:**
- Modify: site/index.html (kicker/eyebrow kaldirma, h2 hiyerarsisi, tip ritmi)
- Modify: site/pro/index.html, site/specs/index.html, site/harnesses/index.html (ayni ritim)
- Modify: landing.html SADECE site/index.html ile ayni icerikse (diff kontrol edilir; farkli urunse dokunulmaz)

**Interfaces:**
- Consumes: DESIGN.md oran dili (Task 5) - site tip olcegi GUI ile ayni aileden
- Produces: kicker'siz, hiyerarsik 4 sayfa.

- [ ] **Step 1: landing.html vs site/index.html iliskisini belirle**

Run: `diff -q landing.html site/index.html; grep -c -i -E 'eyebrow|kicker' site/*.html site/*/*.html landing.html`. Expected: hangi dosyalarin kicker tasidigi listelenir; landing farkli urunse (Pro ledger) kapsam disi kalir.

- [ ] **Step 2: Kicker ve eyebrow etiketlerini kaldir**

Her `label eyebrow` / kicker elementi silinir; baslik metni guclendirilir (ornek: goz kirpan etiket yerine dogrudan urun cumlesi). Baslik agirligi tip olcegiyle tasinir, ek etiketle degil.

- [ ] **Step 3: Kart izgarasi hiyerarsisini duzelt**

Es-buyuklukte kart dizileri: birincil mesaj buyuk tip + genis olcu; destekleyici bolumler kucuk tip + dar olcu. Bolum basliklari urun diline cekilir (receipt, saver, memory, evidence). Icerik cumleleri korunur; iddia degismez.

- [ ] **Step 4: Dort sayfada tip ve aralik ritmini esitle**

Ayni baslik olcegi, ayni bolum araligi, ayni max-width (1080px mevcut deger korunur). Masaustu + mobil goz kontrolu.

- [ ] **Step 5: Commit**

```bash
git add site landing.html
git commit -m "refactor(site): remove kickers and set content hierarchy"
```

---

### Task 7: CLI metin sozlugu + description pass (Faz 3a)

**Files:**
- Create: docs/superpowers/specs/2026-09-03-cli-copy-dictionary.md (terminoloji sozlugu: store dir, JSON emit, workspace, session ifadeleri; cumle standardi: kucuk harf baslangic, noktasiz bitis, istisnalar)
- Modify: apps/cli/src/commands/**/*.ts flag description'lari (sozluge gore)
- Test: mevcut apps/cli snapshot testleri guard olarak kullanilir

**Interfaces:**
- Consumes: sozluk (bu task'ta yazilir)
- Produces: CLI_COPY_DICT - Task 8'in dayanagi.

- [ ] **Step 1: Mevcut description stillerini ornekle**

Run: `grep -r -h -E 'description: "' apps/cli/src/commands --include='*.ts' | sort | uniq -c | sort -rn | head -n 40`. Expected: baskin stil (kucuk harf, noktasiz) ve aykiri ornekler listelenir.

- [ ] **Step 2: Sozlugu yaz**

docs/superpowers/specs/2026-09-03-cli-copy-dictionary.md: her terim icin tek dogru form + 2-3 ornek duzeltme. Istisnalar (ozel isim, --md dosya yazma cumleleri) belgeli.

- [ ] **Step 3: description'lari sozluge cevir**

Sadece metin degisikligi; flag adi, tip, default degismez. Her komut dosyasi icin ilgili test dosyasini calistir.

- [ ] **Step 4: CLI testlerini calistir**

Run: `pnpm --filter @megasaver/cli vitest run`. Expected: PASS (snapshot diff'leri sadece metin degisikligi icerir; davranis diff'i varsa dur ve incele).

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-09-03-cli-copy-dictionary.md apps/cli/src/commands apps/cli/test
git commit -m "refactor(cli): standardize flag descriptions per copy dictionary"
```

---

### Task 8: CLI hata ve mesaj pass (Faz 3b)

**Files:**
- Modify: apps/cli/src/**/*.ts kullaniciya gorunen hata/uyari/bilgi mesajlari (sozluge gore)
- Test: apps/cli/test/** ilgili testler

**Interfaces:**
- Consumes: CLI_COPY_DICT (Task 7)
- Produces: tek sesli CLI metinleri.

- [ ] **Step 1: KullanicI mesajlarini tara**

Run: `grep -rn -E 'throw new Error|console\.(error|warn|log)' apps/cli/src --include='*.ts' | head -n 60`. Expected: sozluk disi ifadeler listelenir.

- [ ] **Step 2: Mesajlari sozluge cevir (TDD: once ilgili testi guncelle)**

Her mesaj degisikliginde once testi kirmiziya cevir (beklenen metni guncelle), sonra kaynagi degistir, yesile dondur. Davranis (exit code, kosul) degismez.

- [ ] **Step 3: CLI paket testleri**

Run: `pnpm --filter @megasaver/cli vitest run`. Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/cli/src apps/cli/test
git commit -m "refactor(cli): standardize user-facing error and info messages"
```

---

### Task 9: Final verify + review handoff

**Files:**
- Modify: wiki/log.md (tarihli kapanis girisi)
- Modify: wiki/agent-channel.md (diger ajanlara durum notu)

**Interfaces:**
- Consumes: Faz 1-3 sonuclari
- Produces: review'e hazir branch.

- [ ] **Step 1: Tam verify**

Run: `pnpm verify`. Expected: lint + typecheck + test yesil (68 turbo task).

- [ ] **Step 2: Wiki'yi guncelle**

wiki/log.md kapanis girisi + wiki/agent-channel.md durum notu. Ham log dokumu yok; kok neden + ilk hata + exit code disiplini.

- [ ] **Step 3: Reviewer'a devret**

superpowers:requesting-code-review ile dis reviewer (author ile ayni context degil). Review bulgulari superpowers:receiving-code-review ile karsilanir.

- [ ] **Step 4: Commit**

```bash
git add wiki/log.md wiki/agent-channel.md
git commit -m "docs(wiki): max polish pass completion log"
```

