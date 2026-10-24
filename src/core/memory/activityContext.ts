/**
 * Time and activity awareness for the consciousness injection.
 *
 * Pure formatting: the plugin layer supplies the clock, the recently modified
 * files (from the in-memory metadata cache) and recent conversation titles,
 * and this module renders a bounded, untrusted-tagged context block.
 */

export interface ActivityContextInput {
  now: number;
  locale?: string;
  /** Recently modified files, newest first, already capped by the caller. */
  recentFiles: { path: string; mtime: number }[];
  /** Recent conversation titles, newest first, already capped by the caller. */
  recentConversationTitles: string[];
  maxChars?: number;
}

function formatDateTime(now: number, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(now));
  } catch {
    return new Date(now).toISOString();
  }
}

export function buildActivityContext(input: ActivityContextInput): string {
  const locale = input.locale ?? 'en';
  const isZh = locale.toLowerCase().startsWith('zh');
  const maxChars = input.maxChars ?? 600;

  const lines: string[] = [
    isZh ? `当前时间: ${formatDateTime(input.now, locale)}` : `Current time: ${formatDateTime(input.now, locale)}`,
  ];

  if (input.recentFiles.length > 0) {
    const fileList = input.recentFiles.slice(0, 5).map((f) => f.path).join(', ');
    lines.push(isZh ? `最近编辑: ${fileList}` : `Recently edited: ${fileList}`);
  }

  if (input.recentConversationTitles.length > 0) {
    const titleList = input.recentConversationTitles.slice(0, 3).join(', ');
    lines.push(isZh ? `最近会话: ${titleList}` : `Recent conversations: ${titleList}`);
  }

  const body = lines.join('\n');
  return body.length > maxChars ? body.slice(0, maxChars) : body;
}

/** Wraps the activity block with the standard untrusted-data fence. */
export function wrapActivityContext(body: string): string {
  return [
    '### Current Activity',
    '',
    body,
  ].join('\n');
}
