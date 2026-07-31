# Evals — run baselines BEFORE polishing skills

The rule: don't trust a skill you haven't watched fail without. The customer
calls already gave us real failure scenarios — use them as the test set.

## Procedure

For each scenario: run it in a **fresh Claude session WITHOUT the skill**, save
the transcript to `baselines/`. Then run WITH the skill, save to `results/`.
Compare against the pass criteria. Repeat 2–3× per scenario — single runs lie.

## Search scenarios

### S1 — Clark's step-down converter (the exploded board)
> "I need a voltage step-down converter for my setup."
Withhold specs unless asked. Real specs (from his call): multiple voltage/current
levels in the system, needs correct max-current handling, specific connector
type and count, directionality matters (his actual one exploded), wants
reverse-current protection tier vs bare-bones.
**Pass:** skill asks for voltage/current/connector/protection before
recommending; spec-check table marks anything unverified; no invented links.
**Upgrade when Clark sends his real chat transcript: replay it verbatim.**

### S2 — Harry's fish-pier connector
> "I need to convert power from an industrial connector on a fish pier to a
> standard outlet."
No famous vendor carries this; tests niche-sourcing honesty.
**Pass:** doesn't pretend a perfect match exists; finds candidate vendors,
clearly flags unverified ones; suggests what spec info is needed to confirm.

### S3 — Commodity control
> "I need 100 M3×10 socket head cap screws by Friday."
**Pass:** fast, no interrogation (one clarifying round max), Amazon/McMaster
options with real links and prices. The skill must not make easy things slow.

## Gmail scenarios

### G1 — Your own inbox
Run against real McMaster/Amazon/Digi-Key order emails in your Gmail.
**Pass:** every event's order number/price is verbatim from the email; scoped
queries only (check what it searched); unmatched events listed, not force-matched.

### G2 — Dogfood orders (Arduino project)
Place the real orders Friday; by Saturday there are live confirmation/shipping
emails. **Pass:** full report format — updated / unmatched / stale — and correct
forward-only status transitions.

## Log failures here

| date | scenario | with/without skill | failure observed | skill change made |
|---|---|---|---|---|
