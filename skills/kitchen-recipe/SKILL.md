---
name: kitchen-recipe
description: Use when the user wants to create, plan, scale, or format a cooking recipe — asks for "a recipe for X", wants to turn ingredients on hand into a dish, needs a shopping list for a meal, wants to scale a recipe up or down for a different number of servings, or convert between metric and US units. A lighthearted test/demo skill for generating clean, well-structured kitchen recipes.
---

# Kitchen Recipe

## Overview

Turn a vague food idea ("something with chicken and lemon", "a cozy soup for
4", "what can I make with these 5 things?") into a clean, cookable recipe. The
goal is a recipe someone can actually follow: real quantities, ordered steps,
sensible timing — not a wall of prose.

## Step 1 — Understand the ask

Before writing, pin down the four things that change everything:

1. **Dish / craving** — what are they making? If they only gave ingredients,
   propose 1–2 dishes those ingredients can become and pick one.
2. **Servings** — default to 2 if unstated, but say so.
3. **Constraints** — dietary (vegan, gluten-free, nut allergy), time
   ("under 30 min"), equipment ("no oven"), skill level. Honor them all.
4. **Units** — US customary or metric. If unstated, give both for key
   quantities.

If any of these materially changes the recipe and you can't guess, ask one
quick question. Otherwise, make a reasonable call and note your assumption.

## Step 2 — Design the recipe

- Choose ingredients that are commonly available. Flag anything specialty.
- Balance the dish: something savory usually wants acid, fat, salt, and often
  a little sweetness or heat. Don't ship a bland recipe.
- Keep the step count honest. A weeknight dish should not have 22 steps.

## Step 3 — Output format

Always render the recipe in this structure:

```
# <Recipe Name>

*<one-line description — what it is, why it's good>*

**Serves:** N  ·  **Prep:** X min  ·  **Cook:** Y min  ·  **Total:** Z min

## Ingredients
- <quantity + unit> <ingredient>, <prep note if any>
- ...

## Equipment
- <only if anything non-obvious is needed>

## Steps
1. <action, in the order it happens, with times and visual cues>
2. ...

## Notes
- Substitutions, make-ahead tips, storage, or scaling advice.
```

Rules for the output:

- **Quantities are specific.** "2 tbsp olive oil", not "some oil". Give a
  weight *and* a volume for baking-critical items.
- **Steps describe doneness, not just time.** "Sauté 5 min until translucent",
  not "sauté for a while".
- **Group prep into the steps** where it's used, unless a mise-en-place list is
  clearly better for a complex dish.

## Step 4 — Scaling & conversion (when asked)

- To scale, multiply ingredient quantities by the serving ratio, but **don't
  linearly scale cook times** — larger volumes take longer to heat, and pan
  size caps how much you can brown at once. Note this.
- Salt and strong spices scale sub-linearly: scale to ~75% of the linear amount
  first, then say "taste and adjust".
- Common conversions: 1 tbsp = 3 tsp = 15 ml · 1 cup = 240 ml · 1 stick butter
  = 113 g · 1 oz = 28 g · 350°F = 175°C.

## Example

**User:** "quick pasta with what's in the fridge — garlic, spinach, parmesan"

**Output:**

# Garlic Parmesan Spinach Pasta

*A 15-minute weeknight pasta — garlicky, cheesy, with wilted greens.*

**Serves:** 2  ·  **Prep:** 5 min  ·  **Cook:** 12 min  ·  **Total:** 17 min

## Ingredients
- 200 g (7 oz) spaghetti or your pasta of choice
- 3 tbsp olive oil
- 4 cloves garlic, thinly sliced
- 120 g (4 packed cups) fresh spinach
- 40 g (1/2 cup) parmesan, finely grated, plus more to serve
- Salt and black pepper, to taste
- Pinch red pepper flakes (optional)

## Steps
1. Boil salted water and cook pasta until al dente per package (~9 min).
   Reserve 1/2 cup pasta water before draining.
2. Meanwhile, warm olive oil over medium. Add garlic and flakes; cook 1–2 min
   until fragrant and just golden — don't let it brown.
3. Add spinach; toss 1–2 min until just wilted.
4. Add drained pasta, parmesan, and a splash of pasta water. Toss until a
   glossy sauce coats the noodles, adding more water as needed.
5. Season with salt and pepper. Serve with extra parmesan.

## Notes
- Add a squeeze of lemon for brightness, or white beans to make it a meal.
- Swap spinach for kale (cook 1 min longer) or frozen peas.
