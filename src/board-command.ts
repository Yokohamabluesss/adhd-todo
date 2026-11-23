import * as game from './rules.ts';
import type { Board, Library, ResetScope } from './rules.ts';

export type BoardCommand =
  | { kind: 'start' | 'finish' | 'shuffle' }
  | { kind: 'complete' | 'recordDraw' | 'discard'; index: number }
  | { kind: 'reset'; scope: ResetScope; day: string }
  | { kind: 'place'; library: Library; from: number; to: number }
  | { kind: 'move'; from: number; to: number }
  | { kind: 'return'; index: number; destination?: {library: Library; slot?: number} };

export function applyCommand(board: Board, command: BoardCommand) {
  switch (command.kind) {
    case 'start': return game.start(board);
    case 'finish': return game.finish(board);
    case 'shuffle': return game.shuffle(board);
    case 'complete': return game.complete(board,command.index);
    case 'recordDraw': return game.recordDraw(board,command.index);
    case 'discard': return game.deletePlacedTask(board,command.index);
    case 'reset': {
      const now = new Date();
      game.check(command.scope !== 'today' || game.roundDay(now,board.dayStart) === command.day,
        'A new board day has begun. Open Reset again to review the date.');
      return game.resetBoard(board,command.scope,now);
    }
    case 'place': return game.place(board,command.library,command.from,command.to);
    case 'move': return game.move(board,command.from,command.to);
    case 'return': return game.removeFromBoard(board,command.index,command.destination);
  }
}
