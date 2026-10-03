import { useEffect, useState, type ReactNode } from 'react'
import { Icons } from '~/components/icons'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '~/components/ui/input-group'

// A read-only field with a button that copies its value, and room for more buttons.
export function CopyField({
  label,
  value,
  onCopy,
  children,
}: {
  label: string
  value: string
  // After the button copies the value.
  onCopy?: () => void
  children?: ReactNode
}) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timer)
  }, [copied])

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      onCopy?.()
    } catch {
      // Clipboard access can be refused; the value is selectable in the field.
    }
  }

  return (
    <InputGroup>
      <InputGroupInput aria-label={label} readOnly value={value} onFocus={(event) => event.currentTarget.select()} />
      <InputGroupAddon align="inline-end">
        <InputGroupButton size="icon-xs" onClick={copy} title="Copy">
          {copied ? <Icons.check /> : <Icons.copy />}
          <span className="sr-only">{copied ? 'Copied' : 'Copy'}</span>
        </InputGroupButton>
        {children}
      </InputGroupAddon>
    </InputGroup>
  )
}
