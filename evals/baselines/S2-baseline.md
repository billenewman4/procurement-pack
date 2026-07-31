# S2 baseline (no skill) — 2026-07-31

I can point you in the right direction, but I need one critical piece of information first: **what exactly is the connector on the pier?** "Industrial connector" covers several incompatible families, and the adapter you need depends entirely on which one it is. A photo of the receptacle, or the text stamped on its face (amperage, voltage, NEMA or IEC designation), would let me narrow this to a specific part.

The most likely candidates on a fish pier:

1. **Marine shore power (twist-lock)** — most common on piers/docks in North America. Typically NEMA L5-30 (30A/125V) or SS2/50A pedestals. If this is what you have, off-the-shelf adapters to a standard 15A household outlet are readily available:
   - Marinco/ParkPower "30A male to 15A female" pigtail adapters — sold at [West Marine](https://www.westmarine.com/adapters-plugs-outlets/) and [Fisheries Supply](https://www.fisheriessupply.com/marine-shore-power/shore-power-adapters), usually $25–50.
   - For 50A pedestals, 50A-to-30A-to-15A step-down adapter chains exist from the same vendors.

2. **IEC 60309 pin-and-sleeve** (round plug, colored ring — blue = 125V, yellow = 125/250V, red = 480V) — common on commercial/industrial piers, especially for hoists, ice machines, or European-built equipment. Ready-made adapters to a standard 5-15 outlet are much less common here; you'd typically buy a matching pin-and-sleeve plug (e.g., from [McMaster-Carr](https://www.mcmaster.com/products/pin-and-sleeve-plugs/) or [Legrand/Pass & Seymour](https://www.legrand.us/wiring-devices/plugs-and-connectors/iec-309-pin-and-sleeve/c/lgnd030702)) and have a short adapter cord assembled with a GFCI-protected 5-15R box on the other end. I haven't verified a specific off-the-shelf IEC-309-to-5-15R adapter product — this may need to be a custom-assembled cord.

3. **Higher-voltage or 3-phase service** — if the receptacle is 208V, 240V, or 480V (common for pier cranes and pumps), you can't just adapt it with a plug adapter; you'd need a transformer to get 120V. That's a different purchase entirely and worth confirming before buying anything.

A few cautions regardless of which it is:

- **Verify voltage before plugging anything in.** An adapter that physically fits does not mean the voltage is right — 240V into a 120V device will destroy it.
- **Use GFCI protection.** Over water, any 120V outlet you create should be GFCI-protected (NEC requires it for marina/dock receptacles).
- **Match the wet environment.** Get marine-rated or at least watertight (IP67) components, not indoor-rated hardware.
- If the pier's service turns out to be anything other than straightforward 120V single-phase, it's worth a quick consult with a marine electrician — dock wiring faults are a known electrocution hazard (electric shock drowning).

Send me a photo or the markings on the receptacle and I can identify the exact connector and find you a specific part number.

Sources: [West Marine adapters](https://www.westmarine.com/adapters-plugs-outlets/), [Fisheries Supply shore power adapters](https://www.fisheriessupply.com/marine-shore-power/shore-power-adapters), [McMaster-Carr pin-and-sleeve plugs](https://www.mcmaster.com/products/pin-and-sleeve-plugs/), [Legrand IEC 309](https://www.legrand.us/wiring-devices/plugs-and-connectors/iec-309-pin-and-sleeve/c/lgnd030702)
