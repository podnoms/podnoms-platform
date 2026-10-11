// Combines a waveform's bars (see waveforms.server.ts) into `count` of them,
// or leaves them be if there are no more than that.
export function resample(values: number[], count: number) {
  if (count <= 0 || values.length === 0) return []
  if (values.length <= count) return values
  return Array.from({ length: count }, (_, bar) => {
    const start = Math.floor((bar * values.length) / count)
    const end = Math.max(start + 1, Math.floor(((bar + 1) * values.length) / count))
    let sum = 0
    for (let i = start; i < end; i++) sum += values[i]!
    return sum / (end - start)
  })
}
