# T1 debug-then-source, current skill — 2026-08-01

Before I recommend anything to buy, I want to be sure the fix isn't a part at all — there are two red flags in your description that need to be resolved first, or a third buck converter goes the way of the first one.

(Heads up: I don't have a project store connected here — no Postgres MCP and no local bom.json — so I'm working from what you tell me in this chat and nothing will persist between sessions.)

**Red flag 1 — were those power bricks even DC?** Many small vibratory feeders are driven by an AC electromagnet coil, not a DC motor, and their plug-in bricks output **AC** (label reads something like "OUTPUT: 24V ~ 1A" — the ~ means AC) or feed a small controller. A buck converter's 15V DC output will not run an AC-coil feeder at all — it just sits there silently, which is exactly your symptom. If the bricks were AC, the right purchase is a transformer or replacement OEM-style adapters, and no buck converter will ever work.

**Red flag 2 — the explosion may have taken the feeders with it.** When the first buck failed reversed, its output stage can have passed raw 24V (or a spike) straight through to whatever was connected downstream. If the feeders were hooked up at that moment, their coils or internal drive boards may now be dead — in which case the new buck is fine and the feeders are the casualty.

So, one round of questions — photos are ideal:

1. **Photos of the rating labels**: the label on each feeder (or its motor/coil housing) and on one of the original power bricks if you still have them. I need output voltage, **AC or DC**, and current rating. If the bricks are gone, the feeder make/model number works too.
2. Were all three bricks identical? Three feeders in parallel at, say, 1A each means 3A+ continuous from one buck — what's the buck's rated output current, and does it have a model/part number I can pull a datasheet for?
3. Were the feeders connected to the buck at the moment it was reversed and exploded?
4. With the new buck wired correctly: what does a multimeter read at the buck's **output terminals** with the feeders connected, and does your bench supply show any current draw? (If you haven't metered it yet, that's the first move before buying anything.)
5. Is there any controller or speed-knob box between the plug and the vibration element on these feeders, or did the brick wire straight to the motor?

I can tell you one thing that will be on the buy list no matter how the answers come back: an **inline fuse** on the buck's input, and either a converter with documented reverse-polarity protection on its datasheet or a series protection diode/ideal-diode module. The first buck exploded precisely because generic bucks have neither, and an identical replacement has the identical failure mode waiting in it.

Send the label photos and meter readings and I'll pull 2–4 verified options with real datasheets and links.
