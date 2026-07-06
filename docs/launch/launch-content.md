# Launch content — drafts (GTM Faz 1)

Copy-paste-ready launch copy for Mega Saver. All numbers here are **illustrative
examples**, not universal claims — real savings vary and the product labels every
dollar `(est.)`. Keep that honesty in every post; it's the brand.

**Before posting:** replace `github.com/haJ1t/MegaSaver` with the final repo URL
if it changes, and the landing URL once the domain is live. Attach `site/og.png`
(or a real savings-card screenshot) where an image is called for.

---

## 1. Show HN (the primary launch for this audience)

**Title:**
`Show HN: Mega Saver – cut coding-agent token usage without blinding the model`

**Body:**
> I kept watching Claude Code re-read files it half-needed and pour raw tool
> output into context, so I built a local-first tool that sits between the agent
> and the model and compresses what the model doesn't need.
>
> The part I cared about: it's evidence-preserving. Every compressed result is
> expandable back to the complete original text — one call away — and re-reading
> an unchanged file returns a lossless pointer, not a re-summary. It declutters
> the context; it doesn't blind the model. What to keep is ranked by your
> project's approved memory (human-gated), not a blind truncation.
>
> It also shares that memory across agents (Claude Code, Cursor, Codex, Aider)
> and exposes a decision-trace — which memory boosted which chunk, the ranking
> scores, the redaction — so you can see *why* a context decision happened.
>
> Local-first: no account, no cloud, secrets redacted before anything is stored.
> The optional metering proxy records token counts only, over your own API key,
> on loopback.
>
> `npm i -g @megasaver/cli && mega init`
> Repo: github.com/haJ1t/MegaSaver (MIT)
>
> Honest caveat: the dashboard's dollar figure is an estimate at a representative
> input rate, floored — never rounded up. I'd genuinely like feedback on the
> evidence-preserving compression approach and where it breaks.

*(HN tone: humble, technical, no marketing adjectives, invite critique. Post
Tue–Thu ~8–10am ET. Reply to every comment.)*

---

## 2. X / Twitter thread — English

**1/** Your coding agent burns tokens re-reading files it half-needs and dumping
raw tool output into context. I got tired of paying for it — so I built Mega
Saver. 🧵 *[attach og.png]*

**2/** It compresses what the model doesn't need. A 3,981-token file read becomes
~214 tokens of signal — but the full output is always one `proxy_expand_chunk`
call away. It doesn't blind the model. It declutters it. *[attach demo screenshot]*

**3/** The twist: it ranks what to keep using YOUR project's memory —
approved, human-gated — not a blind truncation. And what Claude Code learns about
your repo, Codex / Cursor / Aider inherit. One memory, every agent.

**4/** It also shows you *why*: a decision-trace of which memory boosted which
chunk, the ranking scores, the redaction. No other agent tool I've seen does this.

**5/** Local-first. No account, no cloud, secrets redacted before storage. Your
keys, your machine. The metering proxy (opt-in) records token counts only.

**6/** Free, open source (MIT):
`npm i -g @megasaver/cli && mega init`
→ github.com/haJ1t/MegaSaver
(honest note: the $ figure is an estimate, floored — never rounded up.)

---

## 3. X / Twitter thread — Türkçe

**1/** Coding agent'ın yarısını okuduğu dosyaları tekrar tekrar okuyor, ham tool
çıktısını context'e döküyor — token yakıyor. Bıktım, Mega Saver'ı yaptım. 🧵
*[og.png ekle]*

**2/** Modelin ihtiyacı olmayanı sıkıştırıyor: 3.981 token'lık bir dosya okuması
~214 token'lık öze iniyor — ama tam çıktı her zaman tek `proxy_expand_chunk`
çağrısı uzağında. Modeli körleştirmiyor, önünü açıyor. *[demo ekran görüntüsü]*

**3/** Farkı: neyi tutacağını **senin projenin hafızasıyla** (onaylı, insan-kapılı)
sıralıyor — kör kesme değil. Claude Code repo'nu öğrenince Codex / Cursor / Aider
de miras alıyor. Tek hafıza, tüm agent'lar.

**4/** Ve **neden**ini gösteriyor: hangi memory hangi chunk'ı boost etti, ranking
skorları, redaction — her kararın nedensel zinciri. Başka hiçbir araçta yok.

**5/** Local-first. Hesap yok, cloud yok, secret'lar saklanmadan redakte ediliyor.
Kendi makinen, kendi key'in.

**6/** Ücretsiz, açık kaynak (MIT):
`npm i -g @megasaver/cli && mega init`
→ github.com/haJ1t/MegaSaver
(dürüst not: $ rakamı bir tahmin, yukarı değil aşağı yuvarlanıyor.)

---

## 4. Product Hunt

**Name:** Mega Saver
**Tagline:** `Cut coding-agent token usage — without hiding what the model needs`

**Description:**
> Mega Saver is a local-first ContextOps tool for coding agents (Claude Code,
> Cursor, Codex, Aider). It compresses the tool output your agent reads —
> evidence-preserving, so every result expands back to the full original — ranks
> what to keep with your project's shared memory, and shows a decision-trace of
> why each context happened. No cloud, no account, secrets redacted. Free & MIT.

**First comment (maker):**
> Hi PH 👋 I built this because my coding agents kept burning tokens on context
> the model half-needed, and every "output compressor" I tried just truncated —
> hiding things the model actually needed. Mega Saver's rule is the opposite:
> compress aggressively, but keep every byte recoverable and rank by your
> project's memory. It's local-first and open source. The dashboard turns saved
> tokens into a number (labeled an estimate, floored). Would love your feedback —
> especially where the compression is too aggressive or not enough.
> `npm i -g @megasaver/cli && mega init`

---

## Posting checklist

- [ ] Domain live + landing deployed (`site/`), `og.png` unfurls correctly (test
      the link in a Slack/X preview).
- [ ] A real savings-card screenshot ready (run the saver a while, `mega gui` →
      Share) — more credible than the sample og.png for the thread's tweet 2.
- [ ] GitHub repo README polished, `mega init` verified on a clean machine.
- [ ] Post order: Show HN first (weekday morning ET) → X threads (TR + EN) same
      day → Product Hunt (its own 12:01am PT slot).
- [ ] Every claim honest: savings are estimates, floored; "without hiding what
      the model needs" is the differentiator — never overstate the $.
