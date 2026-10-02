import { useState } from 'react'
import { Icons } from '~/components/icons'
import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'

// Shows newly made recovery codes. They're stored hashed, so this is the only
// time the user can see them.
export function RecoveryCodesDialog({ codes, onClose }: { codes: string[] | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  const text = codes?.join('\n') ?? ''

  async function copy() {
    await navigator.clipboard.writeText(text)
    setCopied(true)
  }

  function download() {
    const url = URL.createObjectURL(new Blob([`podnoms recovery codes\n\n${text}\n`], { type: 'text/plain' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'podnoms-recovery-codes.txt'
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Dialog
      open={Boolean(codes)}
      onOpenChange={(open) => {
        if (open) return
        setCopied(false)
        onClose()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save your recovery codes</DialogTitle>
          <DialogDescription>
            If you lose your phone or security key, each of these codes lets you sign in once. Keep them somewhere
            safe: you won't be able to see them again.
          </DialogDescription>
        </DialogHeader>
        <ul className="grid grid-cols-2 gap-x-6 gap-y-1 rounded-lg bg-muted p-4 text-center font-mono text-sm">
          {codes?.map((code) => (
            <li key={code}>{code}</li>
          ))}
        </ul>
        <DialogFooter>
          <Button variant="outline" onClick={copy}>
            {copied ? <Icons.check /> : <Icons.copy />}
            {copied ? 'Copied' : 'Copy'}
          </Button>
          <Button variant="outline" onClick={download}>
            <Icons.download />
            Download
          </Button>
          <Button onClick={onClose}>I've saved them</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
