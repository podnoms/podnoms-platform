import { useEffect, useState } from 'react'
import { useLoaderData } from '@tanstack/react-router'
import { Icons } from '~/components/icons'
import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '~/components/ui/dialog'
import { useBranding } from '~/lib/branding'

// Ways to support the site, from KOFI_URL and BITCOIN_ADDRESS. Hidden when
// neither is set.
export function DonateDialog() {
  const { kofiUrl, bitcoinAddress } = useLoaderData({ from: '__root__', select: (data) => data.siteLinks })
  const branding = useBranding()
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timer)
  }, [copied])

  if (!kofiUrl && !bitcoinAddress) return null

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(bitcoinAddress!)
      setCopied(true)
    } catch {
      // Clipboard access can be refused; the address is selectable in the dialog.
    }
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost">
          <Icons.donate />
          <span className="sr-only sm:not-sr-only">Donate</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Support {branding.name}</DialogTitle>
          <DialogDescription>
            {branding.name} is free to use, but hosting and serving this much audio doesn&apos;t come free. If you find it
            useful, a donation towards the running costs would be very much appreciated.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          {kofiUrl && (
            <Button asChild>
              <a href={kofiUrl} target="_blank" rel="noopener noreferrer">
                <Icons.donate />
                Buy me a coffee on Ko-fi
                <Icons.externalLink />
              </a>
            </Button>
          )}
          {bitcoinAddress && (
            <div className="flex flex-col gap-2 rounded-lg border p-3">
              <p className="flex items-center gap-1.5 text-sm font-medium">
                <Icons.bitcoin className="size-4" />
                Bitcoin
              </p>
              <p className="font-mono text-xs break-all text-muted-foreground select-all">{bitcoinAddress}</p>
              <Button variant="outline" size="sm" className="self-start" onClick={() => void copyAddress()}>
                {copied ? <Icons.check /> : <Icons.copy />}
                {copied ? 'Copied' : 'Copy address'}
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
