import { useEffect, useState } from 'react'
import { useLoaderData } from '@tanstack/react-router'
import { Icons } from '~/components/icons'
import { Button } from '~/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'

// Ways to support podnoms, from KOFI_URL and BITCOIN_ADDRESS. Hidden when
// neither is set.
export function DonateMenu() {
  const { kofiUrl, bitcoinAddress } = useLoaderData({ from: '__root__', select: (data) => data.siteLinks })
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
      // Clipboard access can be refused; the address is selectable in the menu.
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost">
          <Icons.donate />
          <span className="sr-only sm:not-sr-only">Donate</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        {kofiUrl && (
          <DropdownMenuItem asChild>
            <a href={kofiUrl} target="_blank" rel="noopener noreferrer">
              <Icons.donate />
              Buy me a coffee on Ko-fi
              <Icons.externalLink className="ml-auto text-muted-foreground" />
            </a>
          </DropdownMenuItem>
        )}
        {kofiUrl && bitcoinAddress && <DropdownMenuSeparator />}
        {bitcoinAddress && (
          <>
            <DropdownMenuLabel className="flex items-center gap-1.5">
              <Icons.bitcoin className="size-4" />
              Bitcoin
            </DropdownMenuLabel>
            <p className="px-1.5 pb-1 font-mono text-xs break-all text-muted-foreground select-all">{bitcoinAddress}</p>
            {/* Stays open, so the confirmation can be seen. */}
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault()
                void copyAddress()
              }}
            >
              {copied ? <Icons.check /> : <Icons.copy />}
              {copied ? 'Copied' : 'Copy address'}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
