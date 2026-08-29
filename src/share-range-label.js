const DAY_MS = 24 * 60 * 60 * 1000;

export function shareRangeLabel(rows = [], requestedRange = null) {
  if (requestedRange === "1d") return "1D";
  if (requestedRange === "latest") return "LATEST";
  if (requestedRange === "7d") return "7D";

  const dates = rows
    .map((row) => {
      const value = row?.date ?? row?.generated_at ?? row?.observed_at;
      return value instanceof Date ? value : new Date(value);
    })
    .filter((date) => !Number.isNaN(date.getTime()))
    .sort((left, right) => left - right);

  if (dates.length < 2) return "1D";

  const days = Math.max(
    1,
    Math.ceil((dates.at(-1).getTime() - dates[0].getTime()) / DAY_MS),
  );
  if (days <= 1) return "1D";
  if (days < 31) return `${days}D`;
  if (days < 365) return `${Math.max(1, Math.floor(days / 30))}M+`;
  return `${Math.max(1, Math.floor(days / 365))}Y+`;
}
