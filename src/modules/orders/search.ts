// O-12 search (P3-01): "12" or "#012" finds queue number 12; any text also
// finds a payment or refund reference that contains it (any case). Pure, so
// the screen filters refunds the same way the server filters orders.
export function orderSearch(
  q: string | undefined,
): (queueNumber: number | null, refs: readonly (string | null)[]) => boolean {
  const needle = q?.trim().toLowerCase();
  if (!needle) return () => true;
  const number = /^#?\d{1,6}$/.test(needle)
    ? Number(needle.replace("#", ""))
    : null;
  return (queueNumber, refs) =>
    (number !== null && queueNumber === number) ||
    refs.some((ref) => ref?.toLowerCase().includes(needle) ?? false);
}
