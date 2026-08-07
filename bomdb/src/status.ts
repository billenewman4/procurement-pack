export const STATUSES = ['quoting', 'cart', 'ordered', 'delivered'] as const;
export type Status = (typeof STATUSES)[number];

// quoting and cart are BOTH pre-order stages (cart = ready to buy; quoting =
// out to suppliers), so moving between them is routine in either direction —
// they share a rank. Only rank regressions (ordered → cart, delivered →
// anything) count as backward moves needing user confirmation.
const RANK: Record<string, number> = { quoting: 0, cart: 0, ordered: 1, delivered: 2 };

/** True for any move that doesn't regress the lifecycle (quoting ↔ cart is
 *  free; same-status is not a move). */
export function isForwardMove(from: string, to: string): boolean {
  return from !== to && RANK[from] !== undefined && RANK[to] !== undefined
    && RANK[to] >= RANK[from];
}

/** Map an order_events.event to the line-item status it implies, or null if
 *  it must never auto-apply (backordered/issue → flag, don't move). Shipping
 *  is an event, not a status: a shipped email implies the order is placed,
 *  and the dashboard derives the shipped badge from the event itself. */
export function eventToStatus(event: string): Status | null {
  switch (event) {
    case 'confirmed': return 'ordered';
    case 'shipped': return 'ordered';
    case 'delivered': return 'delivered';
    default: return null;
  }
}

/** Old status vocabularies → the current lifecycle. Two generations:
 *  pre-2026-08-04 (needed/shipped/issue) and the 2026-08-06 rename
 *  (researching→cart, rfq→quoting, po_placed→ordered). import_json and the
 *  migration remap stored rows; normalizeStatus keeps stale callers (cached
 *  skills, old chats) writing valid values. */
export const LEGACY_STATUS_MAP: Record<string, Status> = {
  needed: 'cart',
  researching: 'cart',
  rfq: 'quoting',
  po_placed: 'ordered',
  shipped: 'ordered',
  issue: 'ordered',
};

/** Accept old bom.json / pre-migration status values without breaking. */
export function normalizeStatus(status: string): string {
  return LEGACY_STATUS_MAP[status] ?? status;
}
