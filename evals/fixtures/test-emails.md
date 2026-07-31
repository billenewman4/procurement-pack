# Gmail-orders test fixtures — 5 emails

Send each from sales@anyspecsupply.com → bill@getlora.ai. Subjects carry
`[TEST]` so they're easy to purge later. Because the sender domain is not a
real vendor domain, the skill's `from:` allowlist query won't match — the
`subject:` query will. When running the test, tell the skill: *"treat
sales@anyspecsupply.com as an allowed test sender."*

Setup: `mkdir -p ~/.procurement-pack/arduino-dogfood && cp seed-bom.json
~/.procurement-pack/arduino-dogfood/bom.json`, send the 5 emails, wait a
minute, then run the gmail-orders skill.

## Expected results (grade the run against this)

| Email | Event | Expected reconciliation |
|---|---|---|
| E1 | confirmed ×2 (McMaster 7213KWCD) | match li1 + li2; no status change (already `ordered`), ETA Aug 4 recorded |
| E2 | shipped ×1, partial | li1 → `shipped`, tracking captured; li2 stays `ordered` |
| E3 | confirmed (Amazon 112-4477882-9931) | li3 `researching` → `ordered` (forward transition), ETA Aug 2 |
| E4 | backordered (Digi-Key 83605521) | li4 flagged, ETA Aug 14; backward-ish event → confirm with user, don't silently regress |
| E5 | delivered (Mouser 7462213) | **no BOM match → unmatched list**, never force-matched |
| (none) | — | li5 (Adafruit, ordered Jul 20, no email) appears in **stale orders** |

Also verify: order numbers/prices quoted verbatim, nulls where the email omits
data (E1 has no tracking; E4 has no price), plaintext body used, and the
`[TEST]`/unrelated inbox mail never referenced.

---

## E1 — Order confirmation, multi-item

**Subject:** `[TEST] McMaster-Carr Order Confirmation #7213KWCD`

```
Thank you for your order.

Order number: 7213KWCD
Order date: July 31, 2026

Line 1: 91292A113  M3 x 10mm Socket Head Cap Screw, 18-8 Stainless, pack of 100
  Qty 1 @ $8.42          $8.42
Line 2: 7581K21   DC Barrel Jack, Panel Mount, 5.5mm x 2.1mm
  Qty 2 @ $3.15          $6.30

Merchandise total: $14.72
Shipping (UPS Ground): $7.50
Estimated delivery: Monday, August 4

McMaster-Carr will send tracking information when your order ships.
```

## E2 — Partial shipment of E1

**Subject:** `[TEST] Your McMaster-Carr order #7213KWCD has shipped (1 of 2 items)`

```
Good news — part of your order is on the way.

Order number: 7213KWCD
Shipped today via UPS Ground
Tracking: 1Z999AA10123456784
Estimated delivery: Sunday, August 3

Shipped now:
  91292A113  M3 x 10mm Socket Head Cap Screw, pack of 100 — Qty 1

Still preparing:
  7581K21  DC Barrel Jack — Qty 2 (ships separately, no tracking yet)
```

## E3 — Amazon-style confirmation (tests researching → ordered)

**Subject:** `[TEST] Amazon order confirmed: Pololu 5V 5.5A Step-Down Regulator D36V50F5`

```
Order #112-4477882-9931
Placed July 31, 2026

Pololu 5V, 5.5A Step-Down Voltage Regulator D36V50F5
Quantity: 2
Price: $24.95 each

Order total: $49.90 (free Prime delivery)
Arriving: Sunday, August 2 by 8pm

Track your package in Your Orders.
```

## E4 — Backorder notice (no price, tests nulls + non-forward event)

**Subject:** `[TEST] Digi-Key order 83605521 — backorder notice`

```
An update on your Digi-Key order 83605521.

Item: 455-2261-ND  JST-XH Connector Kit, 2/3/4-pin, 200 pieces
Status: BACKORDERED

The manufacturer has revised availability. New estimated ship date:
August 14, 2026. The rest of your order is unaffected.

No action is needed. To modify or cancel, reply to this email.
```

## E5 — Delivery for an order NOT in the BOM (tests unmatched)

**Subject:** `[TEST] Delivered: Mouser order 7462213`

```
Your Mouser Electronics order has been delivered.

Order: 7462213
Delivered: July 30, 2026, 10:41 AM — signed by front desk

Items:
  SparkFun HX711 Load Cell Amplifier — Qty 3 @ $10.95

Thank you for your business.
```
