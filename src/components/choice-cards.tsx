import type { ComponentType, ReactNode } from 'react'
import { RadioGroup as RadioGroupPrimitive } from 'radix-ui'
import { cn } from '~/lib/utils'

export type Choice<T extends string> = {
  value: T
  icon: ComponentType<{ className?: string }>
  title: ReactNode
  hint: ReactNode
}

// A choice between ways of doing something (e.g. a link or an upload) as a
// row of cards, the chosen one highlighted. Keep hints to a few words; the
// dialogs these are in are only so wide. A radio group underneath, so the
// arrow keys move between them and screen readers announce them as a choice.
export function ChoiceCards<T extends string>({
  label,
  value,
  onValueChange,
  choices,
  className,
}: {
  label: string
  value: T
  onValueChange: (value: T) => void
  choices: Choice<T>[]
  className?: string
}) {
  return (
    <RadioGroupPrimitive.Root
      aria-label={label}
      value={value}
      onValueChange={(next) => onValueChange(next as T)}
      className={cn('grid gap-3 sm:grid-cols-2', className)}
    >
      {choices.map(({ value: choice, icon: Icon, title, hint }) => (
        <RadioGroupPrimitive.Item
          key={choice}
          value={choice}
          className={cn(
            'group flex items-center gap-2.5 rounded-lg border p-2.5 text-start transition-colors outline-none',
            'hover:border-foreground/30 hover:bg-accent/50',
            'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
            'data-[state=checked]:border-primary data-[state=checked]:bg-primary/10 dark:data-[state=checked]:bg-primary/15',
          )}
        >
          <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground transition-colors group-data-[state=checked]:bg-primary group-data-[state=checked]:text-primary-foreground">
            <Icon className="size-4" />
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="text-sm leading-tight font-medium">{title}</span>
            <span className="text-xs text-muted-foreground">{hint}</span>
          </span>
        </RadioGroupPrimitive.Item>
      ))}
    </RadioGroupPrimitive.Root>
  )
}
