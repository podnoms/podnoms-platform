import { useState, type FormEvent } from 'react'
import { CopyField } from '~/components/copy-field'
import { Icons } from '~/components/icons'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '~/components/ui/field'
import { Input } from '~/components/ui/input'
import { NativeSelect, NativeSelectOptGroup, NativeSelectOption } from '~/components/ui/native-select'
import { Switch } from '~/components/ui/switch'
import { saveDirectoryDetails, saveDirectoryLink, submitMyPodcastToIndex } from '~/functions/podcasts'
import {
  appleCategories,
  categoryNames,
  directories,
  isReady,
  languageName,
  podcastLanguages,
  type AppleCategory,
  type Directory,
  type DirectoryLinks,
  type ReadinessItem,
} from '~/lib/podcast-directories'
import { directoryDetailsSchema, directoryLinkSchema } from '~/lib/podcast-schema'

type Podcast = {
  id: string
  feedUrl: string
  category: string | null
  subcategory: string | null
  language: string
  explicit: boolean
  author: string | null
  ownerEmail: string | null
  directoryLinks: DirectoryLinks
}

type Distribution = {
  readiness: ReadinessItem[]
  accountName: string | null
  accountEmail: string | null
  podcastIndexAvailable: boolean
}

// Getting the podcast into Apple Podcasts, Spotify and the rest: what it still
// needs, the details directories show, and a card for each directory.
export function DistributionPanel({
  podcast,
  distribution,
  onChanged,
  onEditDetails,
}: {
  podcast: Podcast
  distribution: Distribution
  onChanged: () => Promise<void>
  // Opens the podcast's edit dialog, for the title, description and artwork.
  onEditDetails: () => void
}) {
  const ready = isReady(distribution.readiness)
  return (
    <div className="flex flex-col gap-6">
      <Readiness items={distribution.readiness} onEditDetails={onEditDetails} />
      <DetailsForm podcast={podcast} distribution={distribution} onSaved={onChanged} />
      <Card>
        <CardHeader>
          <CardTitle>Your feed</CardTitle>
          <CardDescription>Each directory asks for this address. Your episodes reach them through it.</CardDescription>
        </CardHeader>
        <CardContent>
          <CopyField label="RSS feed URL" value={podcast.feedUrl} />
        </CardContent>
      </Card>
      <div className="flex flex-col gap-1">
        <h3 className="font-semibold">Directories</h3>
        <p className="text-sm text-muted-foreground">
          {ready
            ? 'Add your podcast to each one. Overcast, Castro and most other apps find shows through Apple Podcasts, so listing there reaches them too.'
            : 'Once the checklist above is complete, you can add your podcast to each one.'}
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {directories.map((directory) => (
          <DirectoryCard
            key={directory.id}
            directory={directory}
            podcastId={podcast.id}
            link={podcast.directoryLinks[directory.id] ?? null}
            ready={ready}
            canSubmit={directory.id === 'podcastIndex' && distribution.podcastIndexAvailable}
            onChanged={onChanged}
          />
        ))}
      </div>
    </div>
  )
}

function Readiness({ items, onEditDetails }: { items: ReadinessItem[]; onEditDetails: () => void }) {
  const ready = isReady(items)
  // Title, description and artwork are edited in the podcast's edit dialog;
  // the rest in the form below.
  const inEditDialog = new Set(['title', 'description', 'artwork'])
  const fieldFor: Partial<Record<ReadinessItem['id'], string>> = {
    category: 'distribution-category',
    language: 'distribution-language',
    author: 'distribution-author',
    ownerEmail: 'distribution-owner-email',
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Ready for directories
          <Badge variant={ready ? 'default' : 'secondary'}>{ready ? 'Ready' : 'Not yet'}</Badge>
        </CardTitle>
        <CardDescription>What Apple Podcasts, Spotify and the others check before they list a show.</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-2 text-sm">
          {items.map((item) => (
            <li key={item.id} className="flex items-start gap-2">
              {item.ok ? (
                <Icons.check className="mt-0.5 size-4 shrink-0 text-green-600 dark:text-green-400" />
              ) : (
                <Icons.close className={`mt-0.5 size-4 shrink-0 ${item.optional ? 'text-muted-foreground' : 'text-destructive'}`} />
              )}
              <div className="flex min-w-0 flex-col">
                <span className={item.ok ? '' : 'font-medium'}>
                  {item.label}
                  {item.optional && !item.ok && <span className="font-normal text-muted-foreground"> (some directories)</span>}
                </span>
                {!item.ok && (
                  <span className="text-muted-foreground">
                    {item.fix}{' '}
                    {inEditDialog.has(item.id) ? (
                      <button type="button" className="underline underline-offset-4" onClick={onEditDetails}>
                        Edit podcast
                      </button>
                    ) : fieldFor[item.id] ? (
                      <button
                        type="button"
                        className="underline underline-offset-4"
                        onClick={() => document.getElementById(fieldFor[item.id]!)?.focus()}
                      >
                        Fix
                      </button>
                    ) : null}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

function DetailsForm({
  podcast,
  distribution,
  onSaved,
}: {
  podcast: Podcast
  distribution: Distribution
  onSaved: () => Promise<void>
}) {
  const [category, setCategory] = useState(podcast.category ?? '')
  const [ownerEmail, setOwnerEmail] = useState(podcast.ownerEmail ?? '')
  const [explicit, setExplicit] = useState(podcast.explicit)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()
  const [saved, setSaved] = useState(false)
  const subcategories: readonly string[] = appleCategories[category as AppleCategory] ?? []

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const parsed = directoryDetailsSchema.safeParse({
      id: podcast.id,
      category: form.get('category'),
      subcategory: form.get('subcategory') ?? null,
      language: form.get('language'),
      explicit,
      author: form.get('author'),
      ownerEmail: form.get('ownerEmail') ?? '',
    })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message)
      return
    }
    setError(undefined)
    setPending(true)
    try {
      await saveDirectoryDetails({ data: parsed.data })
      await onSaved()
      setSaved(true)
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setPending(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Directory details</CardTitle>
        <CardDescription>How your podcast is described in its feed, and so in every directory and app.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} onChange={() => setSaved(false)}>
          <FieldGroup>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="distribution-category">Category</FieldLabel>
                <NativeSelect
                  id="distribution-category"
                  name="category"
                  value={category}
                  onChange={(event) => setCategory(event.target.value)}
                  required
                >
                  <NativeSelectOption value="" disabled>
                    Choose a category
                  </NativeSelectOption>
                  {categoryNames.map((name) => (
                    <NativeSelectOption key={name} value={name}>
                      {name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
              <Field>
                <FieldLabel htmlFor="distribution-subcategory">Subcategory</FieldLabel>
                <NativeSelect
                  // A new list for each category, so a stale choice isn't kept.
                  key={category}
                  id="distribution-subcategory"
                  name="subcategory"
                  defaultValue={category === podcast.category ? (podcast.subcategory ?? '') : ''}
                  disabled={subcategories.length === 0}
                >
                  <NativeSelectOption value="">None</NativeSelectOption>
                  <NativeSelectOptGroup label={category || 'Subcategories'}>
                    {subcategories.map((name) => (
                      <NativeSelectOption key={name} value={name}>
                        {name}
                      </NativeSelectOption>
                    ))}
                  </NativeSelectOptGroup>
                </NativeSelect>
              </Field>
              <Field>
                <FieldLabel htmlFor="distribution-language">Language</FieldLabel>
                <NativeSelect id="distribution-language" name="language" defaultValue={podcast.language} required>
                  {podcastLanguages.map((code) => (
                    <NativeSelectOption key={code} value={code}>
                      {languageName(code)}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
              <Field>
                <FieldLabel htmlFor="distribution-author">Author</FieldLabel>
                <Input
                  id="distribution-author"
                  name="author"
                  defaultValue={podcast.author ?? distribution.accountName ?? ''}
                  placeholder="Who makes the podcast"
                  maxLength={255}
                  required
                />
              </Field>
            </div>
            <Field orientation="horizontal">
              <Switch id="distribution-explicit" checked={explicit} onCheckedChange={setExplicit} />
              <FieldLabel htmlFor="distribution-explicit" className="font-normal">
                Explicit content (strong language, adult themes)
              </FieldLabel>
            </Field>
            <Field>
              <FieldLabel htmlFor="distribution-owner-email">Owner email</FieldLabel>
              <div className="flex gap-2">
                <Input
                  id="distribution-owner-email"
                  name="ownerEmail"
                  type="email"
                  value={ownerEmail}
                  onChange={(event) => setOwnerEmail(event.target.value)}
                  placeholder="Not in your feed"
                />
                {distribution.accountEmail && ownerEmail !== distribution.accountEmail && (
                  <Button type="button" variant="outline" onClick={() => setOwnerEmail(distribution.accountEmail!)}>
                    Use my account email
                  </Button>
                )}
              </div>
              <FieldDescription>
                Public: anyone who reads your feed can see it. Spotify, Amazon and YouTube send a code here to confirm
                the podcast is yours, and it stops other hosts importing your feed without your say. Leave it empty to
                keep your email out of the feed.
              </FieldDescription>
            </Field>
            {error && <FieldError>{error}</FieldError>}
            <div className="flex items-center gap-3">
              <Button type="submit" disabled={pending}>
                Save details
              </Button>
              {saved && <span className="text-sm text-muted-foreground">Saved. Apps see the change next time they check your feed.</span>}
            </div>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  )
}

function DirectoryCard({
  directory,
  podcastId,
  link,
  ready,
  canSubmit,
  onChanged,
}: {
  directory: Directory
  podcastId: string
  link: string | null
  ready: boolean
  // Podcast Index can be submitted to from here, when this site has a key.
  canSubmit: boolean
  onChanged: () => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()

  async function run(action: () => Promise<string | undefined>) {
    setError(undefined)
    setPending(true)
    try {
      const failure = await action()
      if (failure) {
        setError(failure)
        return
      }
      setEditing(false)
      await onChanged()
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setPending(false)
    }
  }

  function saveLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const parsed = directoryLinkSchema.safeParse({
      id: podcastId,
      directory: directory.id,
      link: new FormData(event.currentTarget).get('link'),
    })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message)
      return
    }
    void run(async () => {
      await saveDirectoryLink({ data: parsed.data })
      return undefined
    })
  }

  const submit = () =>
    run(async () => {
      const result = await submitMyPodcastToIndex({ data: { id: podcastId } })
      return result.ok ? undefined : result.error
    })

  return (
    <Card className={ready || link ? '' : 'opacity-60'}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {directory.name}
          {link && <Badge>Listed</Badge>}
        </CardTitle>
        <CardAction>
          {canSubmit && !link ? (
            <Button size="sm" disabled={!ready || pending} onClick={submit}>
              Submit now
            </Button>
          ) : (
            <Button size="sm" variant="outline" asChild disabled={!ready}>
              <a href={directory.submitUrl} target="_blank" rel="noreferrer">
                <Icons.externalLink />
                Open
              </a>
            </Button>
          )}
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {link && !editing ? (
          <div className="flex items-center gap-2">
            <a href={link} target="_blank" rel="noreferrer" className="min-w-0 truncate underline underline-offset-4">
              {link}
            </a>
            <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setEditing(true)}>
              Change
            </Button>
          </div>
        ) : (
          <>
            <ol className="ml-5 list-decimal space-y-1 text-muted-foreground">
              {directory.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            <form onSubmit={saveLink} className="flex flex-col gap-2">
              <FieldLabel htmlFor={`listing-${directory.id}`}>Once it's listed, paste its link here</FieldLabel>
              <div className="flex gap-2">
                <Input
                  id={`listing-${directory.id}`}
                  name="link"
                  type="url"
                  defaultValue={link ?? ''}
                  placeholder={directory.example}
                />
                <Button type="submit" variant="outline" disabled={pending}>
                  Save
                </Button>
              </div>
            </form>
          </>
        )}
        {error && <FieldError>{error}</FieldError>}
      </CardContent>
    </Card>
  )
}
