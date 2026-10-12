export function getHealth() {
  // Liveness only: no database, provider calls, environment exposure, or data writes.
  return { status: 'ok', application: 'Stock Research Lab' } as const;
}
