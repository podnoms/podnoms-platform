import { Link } from '@tanstack/react-router'
import { Icons } from '~/components/icons'
import { formatDate, pluralise } from '~/lib/format'
import { imageSrc } from '~/lib/images'

export type ShowCardData = {
  id: string
  title: string
  slug: string
  imageUrl: string | null
  author: string | null
  episodeCount: number
  latestAt: Date | null
  followerCount: number
}

// A show in a grid (Explore, Following): its artwork, and enough to tell
// whether it's worth a look.
export function ShowCard({ show }: { show: ShowCardData }) {
  const stats = [
    pluralise(show.episodeCount, 'episode'),
    show.followerCount > 0 ? pluralise(show.followerCount, 'follower') : null,
  ].filter(Boolean)
  return (
    <Link
      to="/$slug"
      params={{ slug: show.slug }}
      className="group flex min-w-0 flex-col gap-3 rounded-xl p-2 transition-colors outline-none hover:bg-muted/60 focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      {show.imageUrl ? (
        <img
          src={imageSrc(show.imageUrl, 224)}
          alt=""
          className="aspect-square w-full rounded-lg object-cover shadow-sm ring-1 ring-black/5 transition-transform group-hover:scale-[1.02]"
        />
      ) : (
        <div className="flex aspect-square w-full items-center justify-center rounded-lg bg-muted">
          <Icons.logo className="size-10 text-muted-foreground" />
        </div>
      )}
      <div className="flex min-w-0 flex-col gap-0.5 px-1">
        <p className="truncate font-semibold">{show.title}</p>
        {show.author && <p className="truncate text-sm text-muted-foreground">{show.author}</p>}
        <p className="truncate text-xs text-muted-foreground">
          {stats.join(' · ')}
          {show.latestAt && <> · {formatDate(show.latestAt)}</>}
        </p>
      </div>
    </Link>
  )
}

export function ShowGrid({ shows }: { shows: ShowCardData[] }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
      {shows.map((show) => (
        <ShowCard key={show.id} show={show} />
      ))}
    </div>
  )
}
