import { chinese } from './zh-CN.ts';

type Language = 'en' | 'zh-CN';
const preference = 'adhd-todo.language';
export let language: Language = 'en';
try {
  if (globalThis.localStorage?.getItem(preference) === 'zh-CN') language = 'zh-CN';
} catch { /* Use English when browser settings cannot be read. */ }

export function setLanguage(next: Language) {
  language = next;
  document.documentElement.lang = next;
  document.title = tr('ADHD Todo · Task board');
  try { localStorage.setItem(preference,next); } catch { /* Keep the choice for this session. */ }
}

// Format interface text before escaping it at its HTML insertion point.
export function tr(english: string, ...values: (string | number)[]): string {
  const message = language === 'zh-CN' && Object.hasOwn(chinese,english) ? chinese[english] : english;
  return values.length ? message.replace(/\{(\d+)\}/g,(match,i)=>String(values[Number(i)] ?? match)) : message;
}
