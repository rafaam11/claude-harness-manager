import DOMPurify from "dompurify";
import { marked } from "marked";

export interface MarkdownRenderOptions {
  breaks?: boolean;
}

export function renderMarkdownSafe(markdown: string, options: MarkdownRenderOptions = {}): string {
  return DOMPurify.sanitize(marked.parse(markdown, options) as string);
}
