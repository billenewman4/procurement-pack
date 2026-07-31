# S2 with part-search skill — 2026-07-31

Before I search for anything, I need to pin down exactly what's on that pier — "industrial connector" covers everything from a 20A twist-lock to a 480V three-phase pin-and-sleeve, and the wrong guess here isn't a returns hassle, it's a safety problem. Also a heads-up: I don't have a project store connected (no Postgres MCP and no local bom.json), so nothing from this search will persist to a BOM unless we set that up — I'll work from whatever you tell me here.

One round of questions:

**Identifying the connector (most important):**
1. Can you share a photo of the connector, or any markings on its body — brand (Hubbell, Leviton, Marinco, Meltric...) and a part/catalog number if printed?
2. If no markings: how many pins/blades, what shape (round pin-and-sleeve vs. flat twist-lock blades), and what color is the housing? (Pin-and-sleeve connectors are color-coded: blue ≈ 208–250V, red ≈ 480V, yellow ≈ 125V, etc.)
3. Is it a plug or a receptacle on the pier side — i.e., does the thing you buy need a female or male end to mate with it?

**Electrical:**
4. Do you know the voltage and phase behind it? Pier/dock power is often 240V single-phase or 208/480V three-phase — if it's anything other than 120/240V single-phase, you'll need a transformer, not just an adapter, and that changes the search entirely.
5. What are you plugging into the 120V outlet, and what's its max draw (amps or watts)? That sets the required current rating and whether one outlet is enough.
6. Outdoor marine environment — I'll assume you need GFCI protection and a weatherproof (wet-location rated) enclosure unless you tell me otherwise. Correct?

**Purchase details:**
7. Is this a one-off for your own use (prototype tier: cheap, fast shipping) or something going into service on the pier for others (inspection-grade, code compliance matters)?
8. Quantity, and does lead time beat price?

Answer what you can — a photo plus the load you're powering would get me most of the way. Once I know the connector and voltage, I'll search for real purchasable options and give you a spec-checked comparison. Fair warning: pier-connector-to-120V is niche enough that the answer may be an assembled adapter/transformer box from a marine or generator-accessory vendor rather than a mainstream catalog item — if I can't verify a listing's specs, I'll flag it rather than guess.
