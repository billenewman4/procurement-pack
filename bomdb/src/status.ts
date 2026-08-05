export const STATUSES = ['researching', 'rfq', 'po_placed', 'delivered'] as const;
export type Status = (typeof STATUSES)[number];

const FORWARD_ORDER: readonly string[] = ['researching', 'rfq', 'po_placed', 'delivered'];

/** True only for a strictly-forward move along the lifecycle. */
export function isForwardMove(from: string, to: string): boolean {
  const a = FORWARD_ORDER.indexOf(from);
  const b = FORWARD_ORDER.indexOf(to);
  return a >= 0 && b >= 0 && b > a;
}

/** Map an order_events.event to the line-item status it implies, or null if
 *  it must never auto-apply (backordered/issue → flag, don't move). Shipping
 *  is an event, not a status: a shipped email implies the PO is placed, and
 *  the dashboard derives the shipped badge from the event itself. */
export function eventToStatus(event: string): Status | null {
  switch (event) {
    case 'confirmed': return 'po_placed';
    case 'shipped': return 'po_placed';
    case 'delivered': return 'delivered';
    default: return null;
  }
}

/** Pre-redesign statuses → the four-state lifecycle (2026-08-04 vendor-CRM
 *  redesign). shipped/issue now live in order_events; import_json and the
 *  migration remap them, new code never writes them. */
export const LEGACY_STATUS_MAP: Record<string, Status> = {
  needed: 'researching',
  ordered: 'po_placed',
  shipped: 'po_placed',
  issue: 'po_placed',
};

/** Accept old bom.json / pre-migration status values without breaking. */
export function normalizeStatus(status: string): string {
  return LEGACY_STATUS_MAP[status] ?? status;
}
