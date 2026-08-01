# T2 navigate-my-results, current skill — 2026-08-01

Good list — you've actually got all three of the usual suspects in it (L298N, DRV8833, TB6612FNG), so no new searching needed. I pulled the actual manufacturer datasheets for the three driver chips and checked them against your motor (6V, ~1A stall) and the Uno's 5V logic. The short answer: **get #3, the KOOBOOK DRV8833 5-pack ($8.29)** — and skip all three L298N boards even though they look the friendliest.

Quick heads-up before the details: I don't have a BOM store connected in this session (no database, no local `bom.json`), so nothing I track here will persist unless we start one.

## Why the L298N is the wrong chip at 6V

This is the trap in your list. The L298N (#1, #5, #6) is an old bipolar-Darlington bridge, and per the ST datasheet its total saturation drop is **1.8V typical / 3.2V max at 1A** — the drop comes out of your motor's supply. From a 6V supply your N20 would see roughly **4.2V typical, potentially under 3V near stall**. You'd lose a third or more of your torque and speed and wonder why the motor is anemic. The datasheet also lists the operative supply condition as Vs ≥ VIH + 2.5V, which with the Uno's 5V logic puts you below spec at 6V. The L298N boards are the easiest to wire (screw terminals, no soldering) — which is exactly why they get bought for jobs they're wrong for. Great chip for a 12V motor; wrong chip for yours.

The modern MOSFET drivers (DRV8833, TB6612FNG) drop tenths of a volt instead — that's the whole game at 6V.

## The four candidates

| | #3 KOOBOOK DRV8833 x5 | #4 HiLetgo TB6612FNG | #1/#5/#6 L298N boards | #2 HiLetgo BTS7960 |
|---|---|---|---|---|
| **Part / MPN** | Driver IC: TI DRV8833; module itself is a generic clone, no board MPN | Driver IC: Toshiba TB6612FNG; generic clone board | Driver IC: ST L298N; generic clone boards | BTN7960/BTS7960 half-bridge pair board |
| **Vendor + link** | Amazon — your listing #3 (you didn't paste URLs, so I'm not inventing them) | Amazon — your listing #4 | Amazon — your listings #1, #5, #6 | Amazon — your listing #2 |
| **Datasheet** | [TI SLVSAR1E PDF](https://www.ti.com/lit/ds/symlink/drv8833.pdf) — read it | [Toshiba 2008 PDF (Pololu mirror)](https://www.pololu.com/file/0J86/TB6612FNG.pdf) — read it | [ST L298 PDF (mirror)](https://hades.mech.northwestern.edu/images/a/ad/L298N.pdf) — read it | not fetched — rejected on class, see below |
| **Price** | $8.29 / 5 pcs (~$1.66 ea) | $9.99 / 1 | $6.99–8.99 / 1 | $11.49 / 1 |
| **Lead time** | ? — not in your list (Amazon, likely Prime) | ? | ? | ? |
| **6V motor supply** | ✓ datasheet — VM 2.7–10.8V; MOSFET bridge, ~0.36Ω total, so ~0.4V drop at 1A → motor sees ~5.6V | ✓ datasheet — VM 2.5–13.5V, 0.5Ω typical on-resistance | ✗ miss — 1.8V typ / 3.2V max drop at 1A; motor sees ~4.2V or less | ✓ listing-only (min ~5.5V) |
| **1A stall current** | ✓ datasheet — 1.5A RMS / 2A peak per bridge; real headroom | ✓ datasheet, borderline — operating max is 1.0A continuous (VM ≥ 4.5V); 2A only as ≤20ms pulses. Stall sits exactly at the limit | ✓ datasheet (2A) — current is the one thing it does fine | ✓ listing-only — 43A, absurd overkill |
| **Uno 5V logic** | ✓ datasheet — inputs rated to 5.75V | ✓ datasheet — VIN to 6V | ✓ datasheet — TTL inputs | ✓ listing-only |
| **Wiring practicality** | Bare mini breakout: solder the header pins, then breadboard/jumper | Same — breakout, soldering required | Screw terminals + pin headers, zero soldering — easiest of the lot | Screw terminals, but a physically large board for an N20 |
| **Risk notes** | ? unverified at module level: no-name clone, chip-level specs verified but board thermals/authenticity aren't. TI's 1.5A rating assumes the PowerPAD package is properly soldered down — brief stalls are fine, don't hold it hard-stalled for long | Same clone caveat; zero current margin at stall | Right part for 12V builds, wrong at 6V | Nothing wrong with it, it's just a sledgehammer: one motor per board, big, and you learn nothing about your actual current budget |

## Recommendation

**#3, the DRV8833 5-pack.** It's the only option that clears your 1A stall with datasheet margin (1.5A RMS, 2A peak) *and* delivers nearly the full 6V to the motor, and at $1.66 a board you get spares for when you inevitably let the magic smoke out of one. The tradeoff you're accepting: it's a bare breakout — you'll solder a couple of header strips and wire it on a breadboard, versus the L298N's screw-terminal convenience. If you genuinely can't solder, tell me and we'll find a DRV8833/TB6612 carrier with terminals instead — but don't buy the L298N to avoid soldering; you'd be trading ten minutes with an iron for a permanently sluggish motor.

#4 (TB6612FNG) is a fine runner-up, but its datasheet operating limit is 1.0A continuous — your stall current exactly, with no margin — so between the two, the DRV8833 is the safer match.

Wiring notes for the DRV8833: power the motor side from your 6V pack directly (4xAA or similar) — **not** the Uno's 5V pin, which can't source a 1A stall and will brown-out the board — and tie the grounds together. AIN1/AIN2 to two PWM-capable pins gives you speed and direction on one channel.

One thing that would sharpen this: is it one N20 or two, and what's actually supplying the 6V? (All of these are dual-channel except the BTS7960, so the pick holds either way — but the power source matters for the wiring.)

**Want me to add one of these to the BOM?** Since no store is connected, saying yes means I'll start a local `bom.json` in this workspace to track it.
