import type { ReactNode } from 'react'
import { Link, type LinkProps } from '@tanstack/react-router'
import { Icons } from '~/components/icons'
import { Button } from '~/components/ui/button'

// The title at the top of a listener page (Explore, Likes, Following).
export function PageHeading({ icon, title, description }: { icon: ReactNode; title: string; description?: ReactNode }) {
  return (
    <header className="flex items-center gap-4">
      <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary [&_svg]:size-6">
        {icon}
      </span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">{title}</h1>
        {description && <p className="text-muted-foreground">{description}</p>}
      </div>
    </header>
  )
}

// A titled part of a listener page, optionally with a link to see all of it.
export function PageSection({
  title,
  description,
  count,
  more,
  children,
}: {
  title: string
  description?: string
  count?: number
  more?: { label: string } & Pick<LinkProps, 'to'>
  children: ReactNode
}) {
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <div className="flex items-end gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="flex items-baseline gap-2 text-lg font-semibold">
            {title}
            {count !== undefined && <span className="text-sm font-normal text-muted-foreground">{count}</span>}
          </h2>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
        {more && (
          <Button variant="ghost" size="sm" className="ml-auto" asChild>
            <Link to={more.to}>
              {more.label}
              <Icons.back className="rotate-180" />
            </Link>
          </Button>
        )}
      </div>
      {children}
    </section>
  )
}
