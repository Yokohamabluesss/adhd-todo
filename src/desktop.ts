import type { Workspace } from './rules.ts';
import type { BoardCommand } from './board-command.ts';

// Only the Windows launcher serves the page with a session token.
const token = document.querySelector<HTMLMetaElement>('meta[name="desktop-session"]')?.content;
export const desktop = Boolean(token);
export interface DesktopSnapshot { revision: number; state: Workspace | null }

async function request<T>(route: string, payload?: object): Promise<T> {
  const response = await fetch('/api/' + route,{
    method: payload ? 'POST' : 'GET',
    headers: {'Content-Type':'application/json','X-Desktop-Session':token!},
    body: payload ? JSON.stringify(payload) : undefined,
    cache: 'no-store',
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Could not save on this device.');
  return result as T;
}
export const readDesktop = () => request<DesktopSnapshot>('state');
export const writeDesktop = (state: Workspace,revision: number) =>
  request<DesktopSnapshot>('save',{state,revision});
export const commandDesktop = (board: string,revision: number,action: BoardCommand) =>
  request<DesktopSnapshot>('action',{board,revision,action});
export const pickDesktop = (board: string,revision: number) =>
  request<number>('pick',{board,revision});
