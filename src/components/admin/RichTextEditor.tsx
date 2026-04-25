"use client"

import { useEffect, useCallback } from "react"
import { useEditor, EditorContent, type Editor } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import Link from "@tiptap/extension-link"
import {
    Bold, Italic, Strikethrough, List, ListOrdered, Quote,
    Heading2, Heading3, Link as LinkIcon, Undo, Redo, Eraser,
} from "lucide-react"
import { cn } from "@/lib/utils"

type RichTextEditorProps = {
    value: string
    onChange: (html: string) => void
    placeholder?: string
    className?: string
}

type ToolbarButtonProps = {
    onClick: () => void
    isActive?: boolean
    disabled?: boolean
    title: string
    children: React.ReactNode
}

function ToolbarButton({ onClick, isActive, disabled, title, children }: ToolbarButtonProps) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            title={title}
            className={cn(
                "flex h-8 w-8 items-center justify-center rounded text-gray-600 transition-colors",
                "hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40",
                isActive && "bg-blue-50 text-blue-700"
            )}
        >
            {children}
        </button>
    )
}

function Toolbar({ editor }: { editor: Editor }) {
    const setLink = useCallback(() => {
        const previous = editor.getAttributes("link").href as string | undefined
        const url = window.prompt("URL del enlace:", previous || "https://")
        if (url === null) return
        if (url === "") {
            editor.chain().focus().extendMarkRange("link").unsetLink().run()
            return
        }
        editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run()
    }, [editor])

    return (
        <div className="flex flex-wrap items-center gap-0.5 border-b border-gray-200 bg-gray-50 p-1">
            <ToolbarButton
                onClick={() => editor.chain().focus().toggleBold().run()}
                isActive={editor.isActive("bold")}
                title="Negrita (Ctrl+B)"
            >
                <Bold className="h-4 w-4" />
            </ToolbarButton>
            <ToolbarButton
                onClick={() => editor.chain().focus().toggleItalic().run()}
                isActive={editor.isActive("italic")}
                title="Cursiva (Ctrl+I)"
            >
                <Italic className="h-4 w-4" />
            </ToolbarButton>
            <ToolbarButton
                onClick={() => editor.chain().focus().toggleStrike().run()}
                isActive={editor.isActive("strike")}
                title="Tachado"
            >
                <Strikethrough className="h-4 w-4" />
            </ToolbarButton>

            <div className="mx-1 h-5 w-px bg-gray-300" />

            <ToolbarButton
                onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
                isActive={editor.isActive("heading", { level: 2 })}
                title="Título"
            >
                <Heading2 className="h-4 w-4" />
            </ToolbarButton>
            <ToolbarButton
                onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
                isActive={editor.isActive("heading", { level: 3 })}
                title="Subtítulo"
            >
                <Heading3 className="h-4 w-4" />
            </ToolbarButton>

            <div className="mx-1 h-5 w-px bg-gray-300" />

            <ToolbarButton
                onClick={() => editor.chain().focus().toggleBulletList().run()}
                isActive={editor.isActive("bulletList")}
                title="Lista con viñetas"
            >
                <List className="h-4 w-4" />
            </ToolbarButton>
            <ToolbarButton
                onClick={() => editor.chain().focus().toggleOrderedList().run()}
                isActive={editor.isActive("orderedList")}
                title="Lista numerada"
            >
                <ListOrdered className="h-4 w-4" />
            </ToolbarButton>
            <ToolbarButton
                onClick={() => editor.chain().focus().toggleBlockquote().run()}
                isActive={editor.isActive("blockquote")}
                title="Cita"
            >
                <Quote className="h-4 w-4" />
            </ToolbarButton>

            <div className="mx-1 h-5 w-px bg-gray-300" />

            <ToolbarButton
                onClick={setLink}
                isActive={editor.isActive("link")}
                title="Insertar enlace"
            >
                <LinkIcon className="h-4 w-4" />
            </ToolbarButton>
            <ToolbarButton
                onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}
                title="Quitar formato"
            >
                <Eraser className="h-4 w-4" />
            </ToolbarButton>

            <div className="ml-auto flex items-center gap-0.5">
                <ToolbarButton
                    onClick={() => editor.chain().focus().undo().run()}
                    disabled={!editor.can().undo()}
                    title="Deshacer (Ctrl+Z)"
                >
                    <Undo className="h-4 w-4" />
                </ToolbarButton>
                <ToolbarButton
                    onClick={() => editor.chain().focus().redo().run()}
                    disabled={!editor.can().redo()}
                    title="Rehacer (Ctrl+Y)"
                >
                    <Redo className="h-4 w-4" />
                </ToolbarButton>
            </div>
        </div>
    )
}

export function RichTextEditor({ value, onChange, placeholder, className }: RichTextEditorProps) {
    const editor = useEditor({
        extensions: [
            StarterKit.configure({
                heading: { levels: [2, 3] },
            }),
            Link.configure({
                openOnClick: false,
                HTMLAttributes: { rel: "noopener noreferrer nofollow", target: "_blank" },
            }),
        ],
        content: value || "",
        immediatelyRender: false,
        editorProps: {
            attributes: {
                class: cn(
                    "prose prose-sm max-w-none min-h-[160px] px-3 py-2 focus:outline-none",
                    "prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-headings:my-3"
                ),
                "data-placeholder": placeholder ?? "",
            },
        },
        onUpdate: ({ editor: ed }) => {
            const html = ed.getHTML()
            onChange(html === "<p></p>" ? "" : html)
        },
    })

    useEffect(() => {
        if (!editor) return
        const current = editor.getHTML()
        const next = value || ""
        if (next !== current && next !== (current === "<p></p>" ? "" : current)) {
            editor.commands.setContent(next, { emitUpdate: false })
        }
    }, [editor, value])

    if (!editor) {
        return (
            <div className={cn("rounded-md border border-input bg-white", className)}>
                <div className="border-b border-gray-200 bg-gray-50 p-1 h-10" />
                <div className="min-h-[160px] px-3 py-2 text-sm text-gray-400">Cargando editor...</div>
            </div>
        )
    }

    return (
        <div className={cn("rounded-md border border-input bg-white overflow-hidden", className)}>
            <Toolbar editor={editor} />
            <EditorContent editor={editor} />
        </div>
    )
}
