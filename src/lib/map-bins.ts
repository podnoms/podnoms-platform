// Ranges for colouring the listener map: up to `steps` bins between 1 and the
// largest count, spaced on a log scale so one busy country doesn't leave the
// rest the same pale shade. Each bin is [from, to], whole numbers.
export function mapBins(max: number, steps = 5) {
  const bins: { from: number; to: number }[] = []
  let from = 1
  for (let i = 1; i <= steps && from <= max; i++) {
    const to = i === steps ? max : Math.max(from, Math.round(max ** (i / steps)))
    if (to < from) continue
    bins.push({ from, to })
    from = to + 1
  }
  return bins
}

// Which bin a count falls in, or -1 for none.
export function binIndex(bins: { from: number; to: number }[], value: number) {
  return bins.findIndex((bin) => value >= bin.from && value <= bin.to)
}
