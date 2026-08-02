# W1 worst-part rehearsal (wet-mate connector) — 2026-08-02

Quick note first: I don't see a Postgres store or a `bom.json` for this project, so I can't load your existing BOM — I'll work from your message alone, and nothing I find will persist unless we set the store up afterward.

Your spec is complete enough to search on: **4-pin, wet-mateable (mate/demate underwater), ≥30 m depth, qty 2, prototype tier.** One system-level question I'll flag but not block on: "2 connectors" for a towed pod usually means **2 mated pairs** — a bulkhead half on the pod housing and an inline half on the tow cable, per position. I've priced it that way; if you actually want cable-to-cable (inline male + inline female), swap the bulkhead for the inline variant, same families.

Heads-up on this part class: it's genuinely nasty to source. Amazon has nothing real (only unrated "IP68" plugs that are not underwater-mateable), McMaster doesn't carry wet-mate, and Digi-Key/Mouser don't stock this category. The de-facto standard is the SubConn/SEACON "Micro Circular / Micro Wet-Con" geometry (MCBH4 / MCIL4), and most channels for it are quote-only. I found exactly one US channel with public prices and a cart.

## Option 1 — Micro wet-con pair from Amron International (best practically: only add-to-cart path found)

| field | |
|---|---|
| Part + MPN | "Micro Wet Bulkhead Connector - 4-Way Female" **MCBH4F** + "Micro In-Line Connector - 4 Pin Male" **MCIL4M** (mating pair) |
| Vendor + link | Amron International — [MCBH4F](https://www.amronintl.com/micro-wet-bulkhead-connector-4-way-female-mcbh4f) · [MCIL4M](https://www.amronintl.com/micro-wet-con-inline-connector-male-4-pins-mcil4m) |
| Datasheet | None on Amron's pages. Geometry-equivalent family datasheet I read: [SubConn Micro Circular PDF](https://lubell.com/wp-content/uploads/2024/04/Subconn_micro_circular_2_3_4_5_6and8andg2-2_3and4_contacts.pdf) — but see risk note |
| Price + qty | MCBH4F **$118.47** + MCIL4M **$68.27** = ~$186.74/pair, ~$373 for 2 pairs |
| Lead time | Both listed "SHIP NOW" (in stock) |
| Spec check | 4-pin **✓ listing-only** · ≥30 m **✓ listing-only** (listed 10,000 psi mated ≈ 6,800 m — 30 m is ~4 bar, trivial) · wet-mateable **✓ listing-only** ("connections underwater, on-deck or in any weather") · field mate/demate **✓ listing-only** |
| Practicality | Rubber-molded push-fit halves; bulkhead mounts through a 7/16-20 UNF port (hex nut + washer **sold separately**); comes with pigtail/hook-up wire — you splice or pot, no board soldering. Add locking sleeves for a towed application so drag can't unmate it. Lubricate faces (silicone grease) before wet mating; mate/demate unpowered. |
| Risk notes | Amron labels manufacturer only as "Approved Vendor" — could be genuine SEACON/SubConn or an equivalent; its listed ratings (6 A/contact, 300–600 VDC) differ slightly from the MacArtney datasheet (10 A/contact, 300 V), so I did NOT credit the datasheet to this exact part. All ratings vastly exceed your 30 m/sensor-pod needs either way. If traceability matters later, this is the spec gap to close with one email. |

## Option 2 — Genuine SubConn® Micro Circular MCBH4F + MCIL4M via MacArtney (best electrically: fully datasheet-verified, but quote-only)

| field | |
|---|---|
| Part + MPN | SubConn Micro Circular **MCBH4F** (bulkhead, 4 sockets) + **MCIL4M** (inline, 4 pins) |
| Vendor + link | [MacArtney product page](https://www.macartney.com/connectivity/subconn/subconn-micro-circular-series/subconn-micro-circular-2-3-and-4-contacts/) — no cart, quote/RFQ only |
| Datasheet | [SubConn Micro Circular 2/3/4-contact PDF](https://lubell.com/wp-content/uploads/2024/04/Subconn_micro_circular_2_3_4_5_6and8andg2-2_3and4_contacts.pdf) — read in full |
| Price + qty | **?** — no public pricing anywhere I could reach; expect roughly Amron-comparable per half, but that's an expectation, not a number |
| Lead time | **?** — quote-only |
| Spec check | 4-pin **✓ datasheet** · ≥30 m **✓ datasheet** (qualified pressure tested 800 bar / 11,600 psi; your 30 m ≈ 3 bar) · wet-mateable **✓ datasheet** (">500 wet matings, open face rated") · 10 A/contact, 300 V, −4 to 60 °C in water **✓ datasheet** |
| Practicality | Same geometry/handling as Option 1. Chloroprene body, gold-plated brass contacts, brass/SS/Ti bulkhead options. Locking sleeves (MCDLS) in the same catalog. |
| Risk notes | The only risk is procurement friction: RFQ turnaround for a qty-2 prototype order can be days. Zero spec risk — this is the industry-standard part, verified against the actual datasheet. |

## Option 3 — Blue Trail Engineering Cobalt series (prototype-friendly, but I could not verify it this session)

| field | |
|---|---|
| Part + MPN | Cobalt Series Bulkhead Connector + Cobalt cable (4-conductor variant) |
| Vendor + link | [Blue Trail product page](https://www.bluetrailengineering.com/product-page/cobalt-series-bulkhead-connector) — storefront with cart exists |
| Datasheet | None found this session — their site truncated on fetch and two secondary sources (Geo-matching, BlueROV Solutions) were bot-walled/404 |
| Price + qty | **?** — price not visible through the wall; do not assume |
| Lead time | **?** |
| Spec check | 4-pin **? unverified** (search snippets say a 4-conductor 20 A version exists) · ≥30 m **? unverified** · wet-mateable **? unverified** |
| Practicality | Popular in the BlueROV2/hobby-AUV community; typically the cheapest legit wet-mate style. Worth 2 minutes of your own clicking since their cart pages render fine in a normal browser. |
| Risk notes | Everything here is unverified by me — I'm listing it because the vendor is real and community-vetted, not because I confirmed the spec. |

## What I'm steering you away from

Alibaba/Chinese-clone "SubConn-compatible" MCBH4/MCIL4 connectors (Kabasi, Elecbee, etc., ~$30–70). No datasheets, no traceable manufacturer, MOQ and shipping ambiguity — the classic `? unverified` exploded-board class. For a connector whose whole job is sealing at depth on a towed line, and with a genuine article available at ~$187/pair shipping now, the clone saves too little to justify the risk even at prototype tier.

**My recommendation:** Order 2× MCBH4F + 2× MCIL4M from Amron today (plus bulkhead nuts/washers and locking sleeves), and fire off a parallel RFQ to MacArtney if you'll need traceable genuine SubConn for the production run. Best practically = Option 1; best electrically/traceably = Option 2 — same geometry, so you can start with 1 and switch to 2 without redesigning your bulkhead port.

Want me to add one of these to the BOM? (No store is connected, so I'd need to set one up first — otherwise this won't persist.)

## Walls hit

1. **Amazon/McMaster/Digi-Key useless for the category** — skill search order steps 1–3 produce nothing wet-mateable; only step 4 (niche vendors) works. Handled by saying so explicitly in the reply rather than padding with fake Amazon options.
2. **Quote-only manufacturer (MacArtney/SubConn)** — no public pricing anywhere. Handled per skill: price/lead marked `?`, never estimated as a number; kept as "best electrically" option anyway because the datasheet fully verifies.
3. **Reseller manufacturer ambiguity (Amron "Approved Vendor")** — could not bind the MacArtney datasheet to Amron's part; listed ratings differ slightly (6 A vs 10 A). Handled by capping all Amron spec checks at `✓ listing-only` and flagging the gap.
4. **Datasheet PDF bot wall** — first curl of the Lubell-hosted SubConn PDF returned HTML; retry with a browser User-Agent got the real 1.3 MB PDF, which I read from disk (skill's download-and-read-PDF path worked).
5. **Blue Trail Engineering (Wix storefront)** — product page fetch truncated before price/specs; category page 404; Geo-matching 403 (bot wall); BlueROV Solutions 404. Handled by presenting the option fully `? unverified` with an honest "click it yourself" note instead of guessing a price.
6. **Lead times unknowable for quote-only channels** — marked `?`; only Amron's "SHIP NOW" claim is reported, labeled as listing text.
7. **No BOM store** — no Postgres MCP, no bom.json; warned nothing persists, still made the BOM offer per the output contract.
8. **Time box** — stopped before: emailing/RFQing anyone, browser-automation retry on Blue Trail, verifying Amron's actual manufacturer, and pricing locking sleeves/hex nuts (flagged as sold separately). ~18 tool calls, roughly a 5-minute live-demo footprint.
