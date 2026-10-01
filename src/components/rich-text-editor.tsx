import { useState, type ReactNode } from 'react'
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Placeholder } from '@tiptap/extensions'
import { Icons, type Icon } from '~/components/icons'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '~/components/ui/popover'
import { Separator } from '~/components/ui/separator'
import { Toggle } from '~/components/ui/toggle'

// A small rich text editor for descriptions. It produces the HTML the server
// keeps (see rich-text.server.ts), so it offers no more than that allows:
// paragraphs, bold, italic, underline, strikethrough, links, lists and quotes.
// `value` is only read when the editor mounts.
export function RichTextEditor({
  id,
  value,
  onChange,
  placeholder,
}: {
  id?: string
  value: string
  onChange: (html: string) => void
  placeholder?: string
}) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        code: false,
        codeBlock: false,
        horizontalRule: false,
        link: { openOnClick: false, autolink: true, defaultProtocol: 'https' },
      }),
      Placeholder.configure({ placeholder }),
    ],
    content: value,
    // The page is rendered on the server, where there's no editor to render.
    immediatelyRender: false,
    editorProps: {
      attributes: {
        ...(id ? { id } : {}),
        class: 'rich-text min-h-32 max-h-80 overflow-y-auto px-3 py-2 outline-none',
      },
    },
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  })

  return (
    <div className="overflow-hidden rounded-md border border-input shadow-xs focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50">
      {editor && <Toolbar editor={editor} />}
      <EditorContent editor={editor} />
    </div>
  )
}

function Toolbar({ editor }: { editor: Editor }) {
  const state = useEditorState({
    editor,
    selector: ({ editor }) => ({
      bold: editor.isActive('bold'),
      italic: editor.isActive('italic'),
      underline: editor.isActive('underline'),
      strike: editor.isActive('strike'),
      link: editor.isActive('link'),
      bulletList: editor.isActive('bulletList'),
      orderedList: editor.isActive('orderedList'),
      blockquote: editor.isActive('blockquote'),
      canUndo: editor.can().undo(),
      canRedo: editor.can().redo(),
    }),
  })
  const chain = () => editor.chain().focus()

  return (
    <div role="toolbar" aria-label="Formatting" className="flex flex-wrap items-center gap-0.5 border-b bg-muted/40 p-1">
      <Mark label="Bold" icon={Icons.bold} active={state.bold} onToggle={() => chain().toggleBold().run()} />
      <Mark label="Italic" icon={Icons.italic} active={state.italic} onToggle={() => chain().toggleItalic().run()} />
      <Mark
        label="Underline"
        icon={Icons.underline}
        active={state.underline}
        onToggle={() => chain().toggleUnderline().run()}
      />
      <Mark
        label="Strikethrough"
        icon={Icons.strikethrough}
        active={state.strike}
        onToggle={() => chain().toggleStrike().run()}
      />
      <LinkButton editor={editor} active={state.link} />
      <Separator orientation="vertical" className="mx-1 h-5" />
      <Mark
        label="Bulleted list"
        icon={Icons.bulletList}
        active={state.bulletList}
        onToggle={() => chain().toggleBulletList().run()}
      />
      <Mark
        label="Numbered list"
        icon={Icons.orderedList}
        active={state.orderedList}
        onToggle={() => chain().toggleOrderedList().run()}
      />
      <Mark
        label="Quote"
        icon={Icons.quote}
        active={state.blockquote}
        onToggle={() => chain().toggleBlockquote().run()}
      />
      <div className="ml-auto flex gap-0.5">
        <ToolbarButton label="Undo" disabled={!state.canUndo} onClick={() => chain().undo().run()}>
          <Icons.undo />
        </ToolbarButton>
        <ToolbarButton label="Redo" disabled={!state.canRedo} onClick={() => chain().redo().run()}>
          <Icons.redo />
        </ToolbarButton>
      </div>
    </div>
  )
}

function Mark({ label, icon: MarkIcon, active, onToggle }: { label: string; icon: Icon; active: boolean; onToggle: () => void }) {
  return (
    <Toggle size="sm" pressed={active} onPressedChange={onToggle} aria-label={label} title={label}>
      <MarkIcon />
    </Toggle>
  )
}

function ToolbarButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <Button type="button" variant="ghost" size="icon-sm" disabled={disabled} onClick={onClick} title={label}>
      {children}
      <span className="sr-only">{label}</span>
    </Button>
  )
}

// Adds a link to the selection, or edits or removes the one at the cursor.
function LinkButton({ editor, active }: { editor: Editor; active: boolean }) {
  const [open, setOpen] = useState(false)
  const [href, setHref] = useState('')

  function apply() {
    const url = href.trim()
    const chain = editor.chain().focus().extendMarkRange('link')
    if (!url) chain.unsetLink().run()
    else chain.setLink({ href: /^(https?:|mailto:)/i.test(url) ? url : `https://${url}` }).run()
    setOpen(false)
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) setHref((editor.getAttributes('link').href as string | undefined) ?? '')
      }}
    >
      <PopoverTrigger asChild>
        <Toggle size="sm" pressed={active} aria-label="Link" title="Link">
          <Icons.link />
        </Toggle>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        <div
          className="flex gap-2"
          onKeyDown={(event) => {
            // Enter applies the link rather than submitting the dialog's form.
            if (event.key === 'Enter') {
              event.preventDefault()
              apply()
            }
          }}
        >
          <Input
            aria-label="Link URL"
            placeholder="https://…"
            value={href}
            onChange={(event) => setHref(event.target.value)}
            autoFocus
          />
          <Button type="button" onClick={apply}>
            {active ? 'Update' : 'Add'}
          </Button>
          {active && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              title="Remove link"
              onClick={() => {
                editor.chain().focus().extendMarkRange('link').unsetLink().run()
                setOpen(false)
              }}
            >
              <Icons.unlink />
              <span className="sr-only">Remove link</span>
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
