import { useState, type FormEvent } from 'react'
import { Icons } from '~/components/icons'
import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '~/components/ui/dialog'
import { Field, FieldError, FieldLabel, FieldSet, FieldLegend } from '~/components/ui/field'
import { RadioGroup, RadioGroupItem } from '~/components/ui/radio-group'
import { Textarea } from '~/components/ui/textarea'
import { reportImage } from '~/functions/reports'
import { reportReasonNames, reportReasons, type ReportReason, type ReportTargetKind } from '~/lib/report-schema'

// Lets anyone tell the site's admins that an image (a show's or episode's
// artwork, or a profile picture) shouldn't be here (see reports.server.ts).
export function ReportImageButton({ targetKind, targetId }: { targetKind: ReportTargetKind; targetId: string }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState<ReportReason>()
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!reason) return
    setState('sending')
    try {
      const details = new FormData(event.currentTarget).get('details')
      await reportImage({ data: { targetKind, targetId, reason, details: typeof details === 'string' ? details : undefined } })
      setState('sent')
    } catch {
      setState('error')
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) {
          setReason(undefined)
          setState('idle')
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" title="Report image">
          <Icons.report />
          <span className="sr-only">Report image</span>
        </Button>
      </DialogTrigger>
      <DialogContent>
        {state === 'sent' ? (
          <>
            <DialogHeader>
              <DialogTitle>Thanks for telling us</DialogTitle>
              <DialogDescription>
                The site's admins will look at it. If you think a child is in danger, please also contact the police.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button onClick={() => setOpen(false)}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>Report this image</DialogTitle>
              <DialogDescription>Tell the site's admins why it shouldn't be here.</DialogDescription>
            </DialogHeader>
            <FieldSet>
              <FieldLegend variant="label">What's wrong with it?</FieldLegend>
              <RadioGroup value={reason ?? ''} onValueChange={(value) => setReason(value as ReportReason)}>
                {reportReasons.map((value) => (
                  <Field key={value} orientation="horizontal">
                    <RadioGroupItem value={value} id={`report-${value}`} />
                    <FieldLabel htmlFor={`report-${value}`} className="font-normal">
                      {reportReasonNames[value]}
                    </FieldLabel>
                  </Field>
                ))}
              </RadioGroup>
            </FieldSet>
            <Field>
              <FieldLabel htmlFor="report-details">Anything else? (optional)</FieldLabel>
              <Textarea id="report-details" name="details" maxLength={1000} rows={3} />
            </Field>
            {state === 'error' && <FieldError>Something went wrong sending that. Please try again.</FieldError>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!reason || state === 'sending'}>
                Send report
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
