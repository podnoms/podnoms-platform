import { useEffect, useState, type ReactNode } from 'react'
import { Icons } from '~/components/icons'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '~/components/ui/input-group'

// A read-only field with a button that copies its value, and room for more
// buttons. A masked value (a secret) is hidden until shown, but copies either way.
export function CopyField({
  label,
  value,
  onCopy,
  masked = false,
  children,
}: {
  label: string
  value: string
  // After the button copies the value.
  onCopy?: () => void
  masked?: boolean
  children?: ReactNode
}) {
  const [copied, setCopied] = useState(false)
  const [shown, setShown] = useState(false)

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
      <InputGroupInput
        aria-label={label}
        readOnly
        type={masked && !shown ? 'password' : 'text'}
        value={value}
        onFocus={(event) => event.currentTarget.select()}
      />
      <InputGroupAddon align="inline-end">
        {masked && (
          <InputGroupButton size="icon-xs" onClick={() => setShown(!shown)} title={shown ? 'Hide' : 'Show'}>
            {shown ? <Icons.hide /> : <Icons.show />}
            <span className="sr-only">{shown ? 'Hide' : 'Show'}</span>
          </InputGroupButton>
        )}
        <InputGroupButton size="icon-xs" onClick={copy} title="Copy">
          {copied ? <Icons.check /> : <Icons.copy />}
          <span className="sr-only">{copied ? 'Copied' : 'Copy'}</span>
        </InputGroupButton>
        {children}
      </InputGroupAddon>
    </InputGroup>
  )
}
