# S4 datasheet-verification loop — 2026-07-31

Heads-up first: I don't have a Postgres connection or a local BOM store for this project, so **nothing from this search will persist** — if you want these tracked, tell me a bit about the project and I can set up a `bom.json` next time.

Your spec: 12V in → 5V out, 3A **continuous**, screw-terminal or JST, reverse-polarity protection required, prototype tier, ~2 days.

I checked every candidate against its actual datasheet, not the listing — and the headline finding is awkward but important: **no part I could verify has both screw terminals AND datasheet-confirmed reverse-polarity protection.** You get one or the other, so I'm showing the trade-off explicitly.

---

## Option 1 — Mean Well SD-15A-5 (quality unit, screw terminals, but NO reverse protection)

| field | |
|---|---|
| Part + MPN | Mean Well **SD-15A-5** (a.k.a. SD-15A-05), 15W enclosed DC-DC converter |
| Vendor + link | Digi-Key — https://www.digikey.com/en/products/detail/mean-well-usa-inc/SD-15A-5/7706481 |
| Datasheet | **Read it:** https://www.meanwell.com/Upload/PDF/SD-15/SD-15-SPEC.PDF (rev 2024-11-22) |
| Price + qty | $14.80 ea (Digi-Key, per search result; page itself bot-walled → exact stock `?`) |
| Lead time | In stock, same-day ship → ~2 days with fast shipping |
| Spec check | 12V in: **✓ datasheet** (9.2–18VDC range) · 5V out: **✓ datasheet** · 3A continuous: **✓ datasheet** (rated 0–3A; derating starts ~50°C ambient, fine indoors) · screw terminals: **✓ datasheet** (5-position terminal block, pinout on p.2) · reverse-polarity protection: **✗ MISS** — datasheet protection section lists overload (hiccup) and overvoltage **only**; reverse polarity appears nowhere |
| Risk notes | This is the exploded-board spec, and this part does not have it. Only take this one if you add a series Schottky diode or fuse+diode at the input (~$1). Otherwise it's the best-built unit here: isolated (1.5kVAC), EMI-filtered, 2-yr warranty. |

## Option 2 — Pololu D36V50F5 (verified reverse protection, but pin headers, not screw terminals)

| field | |
|---|---|
| Part + MPN | Pololu **D36V50F5** — 5V, 5.5A step-down regulator |
| Vendor + link | Pololu direct — https://www.pololu.com/product/4091 (also at The Pi Hut and Amazon) |
| Datasheet | No PDF datasheet exists; the manufacturer product page **is** the spec doc, and I read it: https://www.pololu.com/product/4091 |
| Price + qty | $39.95 ea (volume discounts listed) |
| Lead time | In stock at Pololu; 2-day shipping available |
| Spec check | 12V in: **✓ datasheet** (5.5–50V) · 5V out: **✓ datasheet** · 3A continuous: **✓ datasheet** (typ. max continuous 3.5–8A depending on Vin — lots of margin at 12V) · connector: **✗ MISS** — 0.1" through-hole pins with included male headers, no screw terminal or JST; you'd solder leads or a screw-terminal adapter · reverse-polarity protection: **✓ datasheet** — "Integrated reverse-voltage protection up to 40 V", plus a dedicated VRP (post-protection) pin |
| Risk notes | The only candidate with manufacturer-verified reverse protection. Pricey for a prototype, and you do 2 minutes of soldering. Cheaper sibling D36V28F5 ($14.95, 3.2A) exists but 3.2A leaves ~no margin over your 3A continuous — I'd stay with the 50F5. |

## Option 3 — DROK LM2596 board, screw terminals (Amazon, cheap+fast, protection claims unverifiable)

| field | |
|---|---|
| Part + MPN | DROK LM2596 adjustable buck board (Amazon ASIN B0F6SKTP1P); regulator IC is TI **LM2596** — no board-level MPN/datasheet findable |
| Vendor + link | Amazon — https://www.amazon.com/DROK-Display-LM2596-Buck-Converter/dp/B0F6SKTP1P |
| Datasheet | Board: **none found.** IC: TI LM2596 datasheet (SNVS124G), **read it:** https://www.ti.com/lit/ds/symlink/lm2596.pdf |
| Price + qty | ~$19.99 (from search snippet; Amazon page bot-walled, HTTP 500 → `?`) |
| Lead time | Prime, likely 1–2 days (`?` — couldn't confirm on-page) |
| Spec check | 12V in: **✓ datasheet** (IC: 4.5–40V operating) · 5V out (adjustable, set by pot): **✓ listing-only** · 3A continuous: **? unverified** — the LM2596 IC is rated 3A (tested 0.2–3A, 80% eff. at 12Vin/3A), but at 3A continuous it dissipates ~2–3W and these bare boards have no heatsink; expect thermal throttling · screw terminals: **✓ listing-only** · reverse-polarity protection: **? unverified** — DROK listings are inconsistent: some claim "input reverse connection protection," others for near-identical boards explicitly say it is NOT included and to "add a large-current diode at input." The TI datasheet confirms the IC itself has **no** reverse-input protection (only current limit + thermal shutdown), so any protection is an undocumented board add-on |
| Risk notes | **This is the exploded-board class of part** — no board datasheet, contradictory protection claims across the same vendor's listings, marginal thermals at your exact operating point. Fine for a $20 experiment; do not trust it as your polarity insurance. |

---

**My recommendation:** Pololu D36V50F5 — it's the only one whose reverse-polarity protection I could verify in manufacturer documentation, and it has real thermal margin at 3A. Solder on a 2-pos screw-terminal block and you've met every spec. If screw terminals out-of-the-box are non-negotiable, take the SD-15A-5 and add a series Schottky at the input — knowing the datasheet says it has no reverse protection of its own.

**Want me to add one of these to the BOM?** (Reminder: no store is connected, so I'd need project details to create one — otherwise this stays untracked.)

Sources: [Digi-Key SD-15A-5](https://www.digikey.com/en/products/detail/mean-well-usa-inc/SD-15A-5/7706481) · [Mean Well SD-15 spec PDF](https://www.meanwell.com/Upload/PDF/SD-15/SD-15-SPEC.PDF) · [Pololu D36V50F5](https://www.pololu.com/product/4091) · [TI LM2596 datasheet](https://www.ti.com/lit/ds/symlink/lm2596.pdf) · [DROK LM2596 board on Amazon](https://www.amazon.com/DROK-Display-LM2596-Buck-Converter/dp/B0F6SKTP1P)
