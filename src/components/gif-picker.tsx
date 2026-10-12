import { useEffect, useState } from 'react'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '~/components/ui/popover'
import { gifAttribution, searchGifs, type ChatGif, type GifConfig, type GifResult } from '~/lib/gifs'

// How long typing has to pause before searching.
const searchDelayMs = 350

// A button opening a GIF search (trending GIFs until something's typed).
// Searches and GIFs load straight from the provider, as its terms require.
export function GifPicker({
  config,
  disabled,
  onPick,
}: {
  config: GifConfig
  disabled?: boolean
  onPick: (gif: ChatGif) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="icon" disabled={disabled} title="Send a GIF">
          <span className="text-xs font-bold">GIF</span>
          <span className="sr-only">Send a GIF</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top" align="end" className="w-80 p-0">
        {/* Only mounted while open, so nothing loads until it's wanted. */}
        {open && (
          <GifSearch
            config={config}
            onPick={(gif) => {
              setOpen(false)
              onPick(gif)
            }}
          />
        )}
      </PopoverContent>
    </Popover>
  )
}

function GifSearch({ config, onPick }: { config: GifConfig; onPick: (gif: ChatGif) => void }) {
  const [query, setQuery] = useState('')
  const [searched, setSearched] = useState('')
  const [results, setResults] = useState<GifResult[]>([])
  const [next, setNext] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setSearched(query.trim()), searchDelayMs)
    return () => clearTimeout(timer)
  }, [query])

  useEffect(() => {
    const abort = new AbortController()
    setLoading(true)
    setFailed(false)
    searchGifs(config, searched, undefined, abort.signal).then(
      (page) => {
        setResults(page.results)
        setNext(page.next)
        setLoading(false)
      },
      () => {
        if (abort.signal.aborted) return
        setFailed(true)
        setLoading(false)
      },
    )
    return () => abort.abort()
  }, [config, searched])

  async function loadMore() {
    if (next === null) return
    setLoading(true)
    try {
      const page = await searchGifs(config, searched, next)
      setResults((current) => [...current, ...page.results])
      setNext(page.next)
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }

  const attribution = gifAttribution[config.provider]
  return (
    <div className="flex flex-col">
      <div className="border-b p-2">
        <Input
          autoFocus
          aria-label="Search GIFs"
          placeholder="Search GIFs…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <div className="h-72 overflow-y-auto overscroll-contain p-2">
        {/* In the order the provider gave them, as its terms require. */}
        <div className="grid grid-cols-3 gap-1">
          {results.map(({ preview, ...gif }) => (
            <button
              key={gif.id}
              type="button"
              title={gif.title}
              className="overflow-hidden rounded-sm bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              onClick={() => onPick(gif)}
            >
              <img
                src={preview.url}
                width={preview.width}
                height={preview.height}
                alt={gif.title || 'GIF'}
                loading="lazy"
                className="aspect-square size-full object-cover"
              />
            </button>
          ))}
        </div>
        {failed ? (
          <p className="py-6 text-center text-sm text-muted-foreground">GIFs couldn't be loaded. Try again shortly.</p>
        ) : loading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
        ) : results.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No GIFs found.</p>
        ) : (
          next !== null && (
            <Button variant="ghost" size="sm" className="mt-2 w-full" onClick={() => void loadMore()}>
              More
            </Button>
          )
        )}
      </div>
      {attribution && <p className="border-t px-3 py-1.5 text-right text-xs text-muted-foreground">{attribution}</p>}
    </div>
  )
}
