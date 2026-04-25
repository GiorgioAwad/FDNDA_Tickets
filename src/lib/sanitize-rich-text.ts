import sanitizeHtml from "sanitize-html"

const ALLOWED_TAGS = [
    "p", "br", "strong", "em", "u", "s",
    "h1", "h2", "h3",
    "ul", "ol", "li",
    "blockquote", "hr",
    "a", "code", "pre",
    "span",
]

const ALLOWED_ATTRIBUTES: sanitizeHtml.IOptions["allowedAttributes"] = {
    a: ["href", "target", "rel"],
    span: ["class"],
}

const ALLOWED_SCHEMES = ["http", "https", "mailto", "tel"]

const HTML_TAG_PATTERN = /<\/?[a-z][\s\S]*?>/i

export function isLikelyHtml(value: string): boolean {
    return HTML_TAG_PATTERN.test(value)
}

export function plainTextToHtml(value: string): string {
    if (!value) return ""
    const escaped = value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
    const paragraphs = escaped
        .split(/\n{2,}/)
        .map((para) => `<p>${para.replace(/\n/g, "<br />")}</p>`)
        .join("")
    return paragraphs
}

export function sanitizeRichText(value: string): string {
    if (!value) return ""
    return sanitizeHtml(value, {
        allowedTags: ALLOWED_TAGS,
        allowedAttributes: ALLOWED_ATTRIBUTES,
        allowedSchemes: ALLOWED_SCHEMES,
        transformTags: {
            a: (_tagName, attribs) => ({
                tagName: "a",
                attribs: {
                    ...attribs,
                    target: "_blank",
                    rel: "noopener noreferrer nofollow",
                },
            }),
        },
    }).trim()
}

export function normalizeRichTextForDb(value: string): string {
    if (!value) return ""
    const html = isLikelyHtml(value) ? value : plainTextToHtml(value)
    return sanitizeRichText(html)
}

export function normalizeRichTextForDisplay(value: string): string {
    if (!value) return ""
    return isLikelyHtml(value) ? sanitizeRichText(value) : plainTextToHtml(value)
}

export function richTextToPlainText(value: string): string {
    if (!value) return ""
    return value
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, " ")
        .trim()
}
