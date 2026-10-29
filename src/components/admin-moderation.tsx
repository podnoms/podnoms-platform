import { useState, type FormEvent } from 'react'
import { Link, useRouter } from '@tanstack/react-router'
import { Icons } from '~/components/icons'
import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '~/components/ui/alert-dialog'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '~/components/ui/empty'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '~/components/ui/field'
import { NativeSelect, NativeSelectOption } from '~/components/ui/native-select'
import { resolveAdminReport, saveAdminImageModeration } from '~/functions/admin'
import { formatRelative } from '~/lib/format'
import {
  imageModerationSchema,
  moderationCategories,
  moderationCategoryNames,
  moderationLevels,
  type ImageModerationLimits,
} from '~/lib/image-moderation'
import { imageSrc } from '~/lib/images'
import { reportReasonNames, type ReportResolution } from '~/lib/report-schema'
import type { OpenReport } from '~/server/reports.server'

type Moderation = {
  checking: boolean
  limits: ImageModerationLimits
  purging: boolean
  reports: OpenReport[]
}

// The admin page's Moderation tab: how strict the image check is, and the
// images people have reported.
export function AdminModeration({ moderation }: { moderation: Moderation }) {
  return (
    <>
      {!moderation.checking && (
        <Alert>
          <Icons.moderation />
          <AlertTitle>Images aren't being checked</AlertTitle>
          <AlertDescription>
            Set AZURE_CONTENT_SAFETY_ENDPOINT and AZURE_CONTENT_SAFETY_KEY to have every image checked with Azure AI
            Content Safety before it's used. Until then, only reports catch unsuitable images.
          </AlertDescription>
        </Alert>
      )}
      <Reports reports={moderation.reports} purging={moderation.purging} />
      <Limits limits={moderation.limits} />
    </>
  )
}

function Limits({ limits }: { limits: ImageModerationLimits }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string>()

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const parsed = imageModerationSchema.safeParse(Object.fromEntries(new FormData(event.currentTarget)))
    if (!parsed.success) return setError(parsed.error.issues[0]?.message)
    setError(undefined)
    setPending(true)
    try {
      await saveAdminImageModeration({ data: parsed.data })
      await router.invalidate()
      setSaved(true)
    } catch {
      setError('Something went wrong saving the settings. Please try again.')
    } finally {
      setPending(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Image check</CardTitle>
        <CardDescription>
          Every uploaded image, suggested photo and downloaded thumbnail is rated for each of these. Images over the
          limit are refused; thumbnails that are refused are simply left out.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} onChange={() => setSaved(false)}>
          <FieldGroup>
            <div className="grid gap-6 sm:grid-cols-2">
              {moderationCategories.map((category) => (
                <Field key={category}>
                  <FieldLabel htmlFor={`moderation-${category}`}>{moderationCategoryNames[category]}</FieldLabel>
                  <NativeSelect id={`moderation-${category}`} name={category} defaultValue={String(limits[category])}>
                    {moderationLevels.map((level) => (
                      <NativeSelectOption key={level.value} value={String(level.value)}>
                        {level.label}: {level.description}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                  {category === 'sexual' && (
                    <FieldDescription>Strict keeps the site family-friendly; it also refuses swimwear and the like.</FieldDescription>
                  )}
                </Field>
              ))}
            </div>
            {error && <FieldError>{error}</FieldError>}
            <div className="flex items-center gap-3">
              <Button type="submit" disabled={pending}>
                Save image check
              </Button>
              {saved && <span className="text-sm text-muted-foreground">Saved</span>}
            </div>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  )
}

function Reports({ reports, purging }: { reports: OpenReport[]; purging: boolean }) {
  const [notice, setNotice] = useState<string>()
  return (
    <Card>
      <CardHeader>
        <CardTitle>Reports</CardTitle>
        <CardDescription>
          Images people have reported. Child abuse imagery must be preserved and reported, never just deleted: choose
          Preserve and take down, then report it to{' '}
          <a href="https://report.hotline.ie" target="_blank" rel="noreferrer" className="underline">
            hotline.ie
          </a>{' '}
          (Ireland),{' '}
          <a href="https://report.iwf.org.uk" target="_blank" rel="noreferrer" className="underline">
            the IWF
          </a>{' '}
          (UK) or{' '}
          <a href="https://report.cybertip.org" target="_blank" rel="noreferrer" className="underline">
            NCMEC
          </a>{' '}
          (US). Don't download or share it.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {notice && (
          <Alert>
            <AlertDescription>{notice}</AlertDescription>
          </Alert>
        )}
        {reports.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Icons.check />
              </EmptyMedia>
              <EmptyTitle>Nothing reported</EmptyTitle>
              <EmptyDescription>Reports of images will be listed here.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          reports.map((report) => (
            <ReportItem key={report.reportId} report={report} purging={purging} onResolved={setNotice} />
          ))
        )}
      </CardContent>
    </Card>
  )
}

function ReportItem({
  report,
  purging,
  onResolved,
}: {
  report: OpenReport
  purging: boolean
  onResolved: (notice: string | undefined) => void
}) {
  const router = useRouter()
  // Possible child abuse imagery isn't shown until asked for.
  const [revealed, setRevealed] = useState(!report.childSafety)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()

  async function resolve(resolution: ReportResolution) {
    setPending(true)
    setError(undefined)
    try {
      const { purged } = await resolveAdminReport({ data: { reportId: report.reportId, resolution } })
      onResolved(
        resolution !== 'dismissed' && purging && purged === false
          ? "The image was taken down, but purging it from Cloudflare's cache failed. Purge it there by hand."
          : resolution !== 'dismissed' && !purging
            ? `The image was taken down. If the site is behind a CDN, purge ${report.imageUrl} from its cache.`
            : undefined,
      )
      await router.invalidate()
    } catch {
      setError("Couldn't do that. Please try again.")
      setPending(false)
    }
  }

  const reasons = [...new Set(report.reports.map((r) => r.reason))]
  const details = report.reports.flatMap((r) => (r.details ? [r.details] : []))

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row">
      <button
        type="button"
        className="relative size-24 shrink-0 overflow-hidden rounded-md bg-muted"
        onClick={() => setRevealed(true)}
        aria-label={revealed ? 'Reported image' : 'Show the reported image'}
      >
        <img
          src={imageSrc(report.imageUrl, 96)}
          alt=""
          className={revealed ? 'size-full object-cover' : 'size-full scale-110 object-cover blur-xl'}
        />
        {!revealed && (
          <span className="absolute inset-0 flex items-center justify-center text-xs font-medium text-foreground">
            Show
          </span>
        )}
      </button>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {report.path ? (
            <Link to={report.path} className="font-medium underline-offset-4 hover:underline">
              {report.what}
            </Link>
          ) : (
            <span className="font-medium">{report.what}</span>
          )}
          {!report.current && <Badge variant="outline">Image since changed</Badge>}
        </div>
        <p className="text-sm text-muted-foreground">
          {report.owner ? `Belongs to ${report.owner}. ` : ''}
          Reported {report.reports.length === 1 ? 'once' : `${report.reports.length} times`}, most recently{' '}
          {formatRelative(report.reports[0]!.createdAt)}.
        </p>
        <div className="flex flex-wrap gap-1">
          {reasons.map((reason) => (
            <Badge key={reason} variant={reason === 'childSafety' ? 'destructive' : 'secondary'}>
              {reportReasonNames[reason]}
            </Badge>
          ))}
        </div>
        {details.length > 0 && (
          <ul className="flex flex-col gap-1 text-sm">
            {details.map((detail, index) => (
              <li key={index} className="border-l-2 pl-2 text-muted-foreground">
                {detail}
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap gap-2 pt-1">
          <Confirm
            label="Preserve and take down"
            title="Preserve and take down this image?"
            description="It's taken off the site at once, and a copy is kept in the media folder's quarantine (never served) with a record of whose it was, for a report to the authorities."
            destructive={report.childSafety}
            disabled={pending}
            onConfirm={() => resolve('preserved')}
          />
          <Confirm
            label="Remove image"
            title="Remove this image?"
            description="It's deleted and taken off the site; the owner can choose another. This can't be undone."
            destructive={!report.childSafety}
            disabled={pending}
            onConfirm={() => resolve('removed')}
          />
          <Button variant="ghost" size="sm" disabled={pending} onClick={() => resolve('dismissed')}>
            Dismiss
          </Button>
        </div>
        {error && <FieldError>{error}</FieldError>}
      </div>
    </div>
  )
}

function Confirm({
  label,
  title,
  description,
  destructive,
  disabled,
  onConfirm,
}: {
  label: string
  title: string
  description: string
  destructive: boolean
  disabled: boolean
  onConfirm: () => void
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button size="sm" variant={destructive ? 'destructive' : 'outline'} disabled={disabled}>
          {label}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>{label}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
