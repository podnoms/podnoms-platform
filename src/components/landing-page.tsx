import { Link } from '@tanstack/react-router'
import { Icons, type Icon } from '~/components/icons'
import { Button } from '~/components/ui/button'
import { Card, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'

// Placeholder marketing copy — replace with the real pitch.
const features: { icon: Icon; title: string; description: string }[] = [
  {
    icon: Icons.broadcast,
    title: 'Create',
    description: 'Your own podcast feeds from diverse sources.',
  },
  {
    icon: Icons.list,
    title: 'Curate',
    description: 'Add YouTube videos, Mixcloud/Soundcloud audio and many, many more.',
  },
  {
    icon: Icons.database,
    title: 'Monitor',
    description: 'Automatically add new episodes as they arrive.',
  }, {
    icon: Icons.database,
    title: 'Customise',
    description: 'Custom domains, notifications and much more!!.',
  },
]

// Pick a column count that fills every row: 4 features become 2×2, 6 become
// 3×2. Full class names so Tailwind can see them.
function featureColumns(count: number) {
  if (count % 3 === 0) return 'md:grid-cols-3'
  if (count % 2 === 0) return 'md:grid-cols-2'
  return 'md:grid-cols-3'
}

export function LandingPage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-16 px-4 py-16 md:py-24">
      <section className="flex flex-col items-center gap-6 text-center">
        <img src="/logo.png" alt="" className="size-16 rounded-xl" />
        <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">Welcome to podnoms</h1>
        <p className="max-w-xl text-lg text-muted-foreground">
          Robot powered podcasts
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <Button size="lg" asChild>
            <Link to="." search={(prev) => ({ ...prev, login: 'signup' as const })}>
              Get started
            </Link>
          </Button>
          <Button size="lg" variant="outline" asChild>
            <Link to="." search={(prev) => ({ ...prev, login: true as const })}>
              Sign in
            </Link>
          </Button>
        </div>
      </section>
      <section className={`grid gap-4 ${featureColumns(features.length)}`}>
        {features.map(({ icon: FeatureIcon, title, description }) => (
          <Card key={title}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FeatureIcon className="size-5 text-primary" />
                {title}
              </CardTitle>
              <CardDescription>{description}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </section>
    </main>
  )
}
