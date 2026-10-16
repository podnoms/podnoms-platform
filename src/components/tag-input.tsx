import { useEffect, useId, useRef, useState } from 'react'
import { Combobox as ComboboxPrimitive } from '@base-ui/react'
import { XIcon } from 'lucide-react'
import { Button } from '~/components/ui/button'
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxGroup,
  ComboboxItem,
  ComboboxList,
  ComboboxValue,
  useComboboxAnchor,
} from '~/components/ui/combobox'
import { Field, FieldDescription, FieldError, FieldLabel } from '~/components/ui/field'
import { fetchTagSuggestions } from '~/functions/tags'
import { maxTagLength, maxTags, normalizeTagName, tagNamesSchema, type Tag } from '~/lib/tag-schema'

type Search = { query: string; tags: Tag[]; status: 'loading' | 'ready' | 'error' }

export function TagInput({
  id,
  value,
  onChange,
  disabled = false,
}: {
  id?: string
  value: string[]
  onChange: (tags: string[]) => void
  disabled?: boolean
}) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  const anchor = useComboboxAnchor()
  const highlighted = useRef<string | undefined>(undefined)
  const [input, setInput] = useState('')
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState<Search>()
  const [error, setError] = useState<string>()
  const query = normalizeTagName(input)

  useEffect(() => {
    if (!open || disabled) return
    let cancelled = false
    setSearch({ query, tags: [], status: 'loading' })
    const timeout = setTimeout(async () => {
      try {
        const tags = await fetchTagSuggestions({ data: { query } })
        if (!cancelled) setSearch({ query, tags, status: 'ready' })
      } catch {
        if (!cancelled) setSearch({ query, tags: [], status: 'error' })
      }
    }, 200)
    return () => {
      cancelled = true
      clearTimeout(timeout)
    }
  }, [query, open, disabled])

  // Never show suggestions from an earlier query while its replacement is loading.
  const currentSearch = search?.query === query ? search : undefined
  const existing = currentSearch?.tags.map((tag) => tag.name) ?? []
  const selected = new Set(value.map(normalizeTagName))
  const canCreate = query !== '' && !selected.has(query) && !existing.includes(query)
  const items = existing.filter((name) => !selected.has(name))
  if (canCreate) items.push(query)

  function update(next: string[]) {
    setOpen(false)
    const parsed = tagNamesSchema.safeParse([...new Set(next.map(normalizeTagName))])
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message)
      return
    }
    onChange(parsed.data)
    setInput('')
    setError(undefined)
    highlighted.current = undefined
  }

  return (
    <Field data-invalid={!!error} data-disabled={disabled}>
      <FieldLabel htmlFor={inputId}>Tags</FieldLabel>
      <Combobox
        multiple
        value={value}
        onValueChange={update}
        items={items}
        filter={null}
        inputValue={input}
        onInputValueChange={(next, details) => {
          setInput(next)
          if (details.reason === 'input-change') setError(undefined)
          highlighted.current = undefined
        }}
        open={open}
        onOpenChange={setOpen}
        onItemHighlighted={(item) => { highlighted.current = item }}
        disabled={disabled}
      >
        <ComboboxChips ref={anchor}>
          <ComboboxValue>
            {value.map((name) => (
              <ComboboxChip key={name} showRemove={false}>
                {name}
                <ComboboxPrimitive.ChipRemove
                  aria-label={`Remove ${name}`}
                  render={<Button type="button" variant="ghost" size="icon-xs" />}
                >
                  <XIcon />
                </ComboboxPrimitive.ChipRemove>
              </ComboboxChip>
            ))}
          </ComboboxValue>
          <ComboboxChipsInput
            id={inputId}
            placeholder="Search or add a tag…"
            maxLength={maxTagLength}
            autoComplete="off"
            aria-invalid={!!error}
            aria-describedby={`${inputId}-hint${error ? ` ${inputId}-error` : ''}`}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return
              event.preventBaseUIHandler()
              if (event.nativeEvent.isComposing || event.keyCode === 229) return
              // Enter adds a tag without submitting the surrounding details form.
              event.preventDefault()
              const name = open && highlighted.current && items.includes(highlighted.current)
                ? highlighted.current
                : query
              if (name) update([...value, name])
            }}
          />
        </ComboboxChips>
        {/* Stay within the dialog's pointer and focus boundary when editing details. */}
        <ComboboxContent anchor={anchor} container={anchor.current?.closest<HTMLElement>('[role="dialog"]') ?? undefined}>
          <ComboboxList>
            <ComboboxGroup>
              {items.map((name) => (
                <ComboboxItem key={name} value={name} disabled={value.length >= maxTags}>
                  {canCreate && name === query ? `Add “${name}”` : name}
                </ComboboxItem>
              ))}
            </ComboboxGroup>
          </ComboboxList>
          <FieldDescription role="status" className="px-3 py-2">
            {value.length >= maxTags
              ? `You can add up to ${maxTags} tags. Remove a tag to add another.`
              : currentSearch?.status === 'error'
                ? 'Suggestions are unavailable. You can still add a tag.'
                : !currentSearch || currentSearch.status === 'loading'
                  ? 'Searching tags…'
                  : items.length === 0
                    ? query ? 'This tag is already added.' : 'Type to add a tag.'
                    : 'Choose an existing tag or add your own.'}
          </FieldDescription>
        </ComboboxContent>
      </Combobox>
      <FieldDescription id={`${inputId}-hint`}>Choose a suggestion or press Enter to add a tag. Up to {maxTags} tags.</FieldDescription>
      {error && <FieldError id={`${inputId}-error`}>{error}</FieldError>}
    </Field>
  )
}
