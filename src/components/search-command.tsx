// The search box in the top nav: opens a command palette that searches the
// user's podcasts and episodes as they type. Also opened with ⌘K / Ctrl+K.
import { useEffect, useState } from 'react'
import { useLoaderData, useNavigate } from '@tanstack/react-router'
import { Icons } from '~/components/icons'
import { Button } from '~/components/ui/button'
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '~/components/ui/command'
import { Kbd } from '~/components/ui/kbd'
import { Spinner } from '~/components/ui/spinner'
import { searchMyLibrary } from '~/functions/search'
import { imageSrc } from '~/lib/images'
import type { SearchResults } from '~/server/search.server'

// Waits for a pause in typing before searching.
const debounceMs = 200

export function SearchCommand() {
  const [open, setOpen] = useState(false)
  const [modifier, setModifier] = useState('⌘')

  useEffect(() => {
    if (!/Mac|iPhone|iPad/.test(navigator.platform)) setModifier('Ctrl')
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        setOpen((open) => !open)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <>
      <Button
        variant="outline"
        onClick={() => setOpen(true)}
        className="relative h-8 justify-start rounded-md bg-muted/25 px-2 font-normal text-muted-foreground shadow-none hover:bg-muted/50 sm:w-40 sm:pe-12 lg:w-56 xl:w-64"
      >
        <Icons.search aria-hidden="true" className="size-4" />
        <span className="hidden sm:inline">Search</span>
        <span className="sr-only sm:hidden">Search</span>
        <Kbd className="absolute top-1/2 right-1.5 hidden -translate-y-1/2 border bg-muted sm:inline-flex">
          {modifier === '⌘' ? <span className="text-xs">⌘</span> : 'Ctrl'}K
        </Kbd>
      </Button>
      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title="Search"
        description="Search your podcasts and episodes"
        className="sm:max-w-xl"
      >
        {/* Remounted on each opening, so it starts with an empty search. */}
        {open && <SearchPalette close={() => setOpen(false)} />}
      </CommandDialog>
    </>
  )
}

function SearchPalette({ close }: { close: () => void }) {
  const navigate = useNavigate()
  const { podcasts } = useLoaderData({ from: '__root__' })
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<{ query: string; found: SearchResults } | null>(null)
  const [failed, setFailed] = useState(false)

  const trimmed = query.trim()
  useEffect(() => {
    setFailed(false)
    if (!trimmed) return
    let current = true
    const timer = setTimeout(() => {
      searchMyLibrary({ data: { query: trimmed } })
        .then((found) => current && setResults({ query: trimmed, found }))
        .catch(() => current && setFailed(true))
    }, debounceMs)
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [trimmed])

  const go = (to: () => Promise<void>) => {
    close()
    void to()
  }
  const openPodcast = (slug: string) => go(() => navigate({ to: '/podcasts/$slug', params: { slug } }))
  const openEpisode = (slug: string, episodeSlug: string) =>
    go(() => navigate({ to: '/podcasts/$slug/episodes/$episodeSlug', params: { slug, episodeSlug } }))

  // Results for an earlier query stay up until the new ones arrive.
  const found = trimmed ? results?.found : null
  const searching = Boolean(trimmed) && results?.query !== trimmed && !failed

  return (
    // Filtering is done by the server.
    <Command shouldFilter={false}>
      <CommandInput value={query} onValueChange={setQuery} placeholder="Search podcasts and episodes…" />
      <CommandList className="max-h-[min(60vh,28rem)]">
        {!trimmed && podcasts.length > 0 && (
          <CommandGroup heading="Your podcasts">
            {podcasts.map((podcast) => (
              <CommandItem key={podcast.id} value={`podcast-${podcast.id}`} onSelect={() => openPodcast(podcast.slug)}>
                <Artwork url={podcast.imageUrl} />
                <span className="truncate">{podcast.title}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {searching && !found && (
          <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
            <Spinner /> Searching…
          </div>
        )}
        {failed && <p className="py-6 text-center text-sm text-destructive">Searching failed. Please try again.</p>}
        {found && !failed && (
          <>
            {!searching && <CommandEmpty>No podcasts or episodes match “{trimmed}”.</CommandEmpty>}
            {found.podcasts.length > 0 && (
              <CommandGroup heading="Podcasts">
                {found.podcasts.map((podcast) => (
                  <CommandItem
                    key={podcast.id}
                    value={`podcast-${podcast.id}`}
                    onSelect={() => openPodcast(podcast.slug)}
                  >
                    <Artwork url={podcast.imageUrl} />
                    <ResultText title={podcast.title} detail={podcast.excerpt} />
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {found.episodes.length > 0 && (
              <CommandGroup heading="Episodes">
                {found.episodes.map((episode) => (
                  <CommandItem
                    key={episode.id}
                    value={`episode-${episode.id}`}
                    onSelect={() => openEpisode(episode.podcastSlug, episode.slug)}
                  >
                    <Artwork url={episode.imageUrl} />
                    <ResultText title={episode.title} detail={episode.excerpt ?? episode.podcastTitle} />
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </>
        )}
      </CommandList>
    </Command>
  )
}

function Artwork({ url }: { url: string | null }) {
  return url ? (
    <img src={imageSrc(url, 32)} alt="" className="size-8 shrink-0 rounded-sm object-cover" />
  ) : (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-sm bg-muted">
      <Icons.logo className="size-4 text-muted-foreground" />
    </span>
  )
}

function ResultText({ title, detail }: { title: string; detail: string | null }) {
  return (
    <span className="grid min-w-0 flex-1">
      <span className="truncate">{title}</span>
      {detail && <span className="truncate text-xs text-muted-foreground">{detail}</span>}
    </span>
  )
}
