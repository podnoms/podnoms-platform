// Searching a show's episodes by title, on its page. The list only loads
// episodes as it's scrolled, so the browser's find can't look through them
// all; this asks the server instead.
import { useEffect, useRef, useState } from 'react'
import { Icons } from '~/components/icons'
import { Button } from '~/components/ui/button'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '~/components/ui/input-group'

// Waits for a pause in typing before searching.
const debounceMs = 250
// How many matches come at a time.
const pageSize = 20

// Episodes whose titles contain `query` (trimmed; nothing while it's empty),
// a page at a time, newest first, as the list is.
export function useEpisodeTitleSearch<T extends { id: string }>(
  query: string,
  fetchPage: (titleQuery: string, offset: number, limit: number) => Promise<T[]>,
) {
  const trimmed = query.trim()
  const [state, setState] = useState<{ query: string; episodes: T[]; done: boolean } | null>(null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const latest = useRef(fetchPage)
  latest.current = fetchPage
  // Answers to older searches are dropped.
  const generation = useRef(0)

  async function load(titleQuery: string, offset: number) {
    const current = ++generation.current
    setLoading(true)
    setFailed(false)
    try {
      const page = await latest.current(titleQuery, offset, pageSize)
      if (current !== generation.current) return
      setState((previous) => ({
        query: titleQuery,
        episodes: offset === 0 || previous?.query !== titleQuery ? page : [...previous.episodes, ...page],
        done: page.length < pageSize,
      }))
    } catch {
      if (current === generation.current) setFailed(true)
    } finally {
      if (current === generation.current) setLoading(false)
    }
  }

  useEffect(() => {
    if (!trimmed) {
      generation.current++
      setState(null)
      setLoading(false)
      setFailed(false)
      return
    }
    const timer = setTimeout(() => void load(trimmed, 0), debounceMs)
    return () => clearTimeout(timer)
  }, [trimmed])

  // Earlier results stay up while the next ones load.
  const current = trimmed ? state : null
  return {
    active: Boolean(trimmed),
    query: trimmed,
    episodes: current?.episodes ?? [],
    // Whether the results shown are for what's typed now.
    settled: current?.query === trimmed && !loading,
    loading,
    failed,
    hasMore: Boolean(current && !current.done && current.query === trimmed),
    loadMore: () => current && void load(trimmed, current.episodes.length),
  }
}

// A subtle search button beside the show's stats, which opens into a
// box. Closing it (or Escape) clears the search.
export function EpisodeTitleSearchBox({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false)

  function close() {
    onChange('')
    setOpen(false)
  }

  if (!open) {
    return (
      <Button
        variant="ghost"
        size="icon-sm"
        className="text-muted-foreground"
        onClick={() => setOpen(true)}
        title="Search episodes"
      >
        <Icons.search />
        <span className="sr-only">Search episodes</span>
      </Button>
    )
  }
  return (
    <InputGroup className="h-8 w-56 sm:w-64">
      <InputGroupAddon>
        <Icons.search />
      </InputGroupAddon>
      <InputGroupInput
        type="search"
        aria-label="Search episode titles"
        placeholder="Search episode titles"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => event.key === 'Escape' && close()}
        maxLength={200}
        autoFocus
      />
      <InputGroupAddon align="inline-end">
        <InputGroupButton size="icon-xs" onClick={close} title="Close search">
          <Icons.close />
          <span className="sr-only">Close search</span>
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  )
}
