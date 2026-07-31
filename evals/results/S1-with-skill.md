# S1 with part-search skill — 2026-07-31

Happy to find you a step-down (buck) converter — but before I search, I need to pin down the specs so I don't recommend something that doesn't fit your setup.

One note first: I don't have a Postgres store connected and there's no local BOM at `~/.procurement-pack/`, so I have no saved context for your project — and anything we decide here won't persist to a BOM store. Can you briefly describe your setup?

Then, in the same reply, answer whichever of these apply:

1. **Voltages** — input voltage (or range) and required output voltage? Is the output fixed or does it need to be adjustable?
2. **Current** — maximum output current the load will draw?
3. **Connections** — how does it wire in? Bare screw terminals / solder pads, or a specific connector type and pin count? Any polarity or protection needs (reverse-polarity, fusing, over-current)?
4. **Fit** — what is it powering, and what's the source (wall adapter, battery pack, car 12V, bench supply)? Any size or mounting constraints?
5. **Tier** — is this a prototype (cheap, next-day is fine) or production (quality, traceability, country-of-origin constraints)?
6. **Quantity and lead time** — how many do you need, and does fast delivery beat price?

Reply with what you know and I'll search Amazon / Digi-Key / Mouser (and others if needed) for real, in-stock options, with each spec verified against the listing details.
