// Split a number across N people such that:
//   - the sum exactly equals the input total (no rupees lost to rounding)
//   - each person gets either floor(total/n) or ceil(total/n)
//   - the larger shares go to the first people in the list
//
// distributeInt(1000, 3) -> [334, 333, 333]
// distributeInt(2500, 3) -> [834, 833, 833]
// distributeInt(2500, 4) -> [625, 625, 625, 625]
export function distributeInt(total: number, n: number): number[] {
  if (n <= 0) return [];
  const t = Math.round(total);
  const base = Math.floor(t / n);
  const extra = t - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < extra ? 1 : 0));
}
