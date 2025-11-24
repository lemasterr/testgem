export function resolveSessionCdpPort(
  session: { cdpPort?: number | null; id?: string; name?: string },
  fallback = 9222
): number {
  // Sora 9 compatibility: prefer explicit session port, otherwise use a single shared fallback.
  if (session.cdpPort !== undefined && session.cdpPort !== null && Number.isFinite(session.cdpPort)) {
    return Number(session.cdpPort);
  }
  if (Number.isFinite(fallback)) {
    return Number(fallback);
  }
  return 9222;
}
