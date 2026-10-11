import { Link } from '@tanstack/react-router'
import { Icons } from '~/components/icons'
import { Button } from '~/components/ui/button'

// What the router shows for an unknown URL, or a podcast or episode that
// doesn't exist (or is private and isn't the visitor's). It renders inside
// whatever layout the page would have had, so it brings its own way home.
export function NotFound() {
  return (
    <main className="flex min-h-[60svh] flex-1 flex-col items-center justify-center gap-8 px-4 py-16 text-center">
      <div className="relative flex items-center justify-center" aria-hidden>
        <span className="text-[8rem] leading-none font-black tracking-tighter text-muted-foreground/15 select-none sm:text-[10rem]">
          404
        </span>
        <span className="absolute flex size-20 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg ring-8 ring-background sm:size-24">
          <Icons.logo className="size-9 sm:size-11" />
        </span>
      </div>
      <div className="flex max-w-md flex-col gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">This page is off the air</h1>
        <p className="text-pretty text-muted-foreground">
          The link may be mistyped or out of date, or the podcast or episode it pointed to has been removed or made
          private.
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <Button asChild>
          <Link to="/">
            <Icons.home />
            Go home
          </Link>
        </Button>
        <Button variant="outline" onClick={() => window.history.back()}>
          <Icons.back />
          Go back
        </Button>
      </div>
    </main>
  )
}
