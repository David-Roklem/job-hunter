/**
 * Импорт содержимого резюме из markdown и PDF.
 *
 * Markdown — основной формат (passthrough с минимальной нормализацией).
 * PDF — извлечение текста через pdf-parse v2 (PDFParse), текст сохраняется
 * в content_md; бинарный файл НЕ хранится.
 *
 * Обе функции возвращают { content_md } — единый контракт для UI action'ов.
 */
import { PDFParse } from "pdf-parse";

/** Тип импортируемого файла по расширению. null — неподдерживаемое. */
export function detectKind(filename: string): "md" | "pdf" | null {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "md";
  if (lower.endsWith(".pdf")) return "pdf";
  return null;
}

/**
 * Импорт markdown: passthrough с минимальной нормализацией.
 * Удаляет BOM, тримит trailing whitespace. Точка для будущей нормализации.
 */
export function importMarkdown(content: string): { content_md: string } {
  // BOM (U+FEFF) в начале — частый артефакт редакторов Windows.
  const withoutBom = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
  return { content_md: withoutBom.trim() };
}

/**
 * Импорт PDF: извлечение текста через pdf-parse v2.
 * Бинарник не сохраняется — только текст в content_md.
 *
 * Бросает понятную ошибку при пустом результате (скан-резюме без OCR,
 * защищённый паролем PDF, повреждённый файл).
 */
export async function importPdf(buffer: Buffer): Promise<{ content_md: string }> {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText();
    const text = result.text.trim();
    if (!text) {
      throw new Error(
        "PDF без извлекаемого текста (возможно, скан без OCR, защита или пустой файл)",
      );
    }
    return { content_md: text };
  } finally {
    await parser.destroy();
  }
}
