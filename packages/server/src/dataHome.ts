import { existsSync, mkdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { dirname, posix, resolve, win32 } from 'node:path';

/**
 * Where the sales database lives. One place however the till is started: the installed app, `start.bat` and
 * `npm start` all open the same file, outside the program folder, so an update or a second way of starting
 * can never leave somebody looking at an empty till. Mirrors `dataHome` in ops/app/lib.mjs (the launcher).
 */
export function dataHome(env: NodeJS.ProcessEnv, platform: NodeJS.Platform, home: string): string {
  if (env.CACTUS_HOME) return env.CACTUS_HOME;
  if (platform === 'win32') return win32.join(env.LOCALAPPDATA || win32.join(home, 'AppData', 'Local'), 'CactusPOS');
  if (platform === 'darwin') return posix.join(home, 'Library', 'Application Support', 'CactusPOS');
  return posix.join(env.XDG_DATA_HOME || posix.join(home, '.local', 'share'), 'cactuspos');
}

export interface DbChoice {
  path: string;
  /** `CACTUS_DB` named the file, so nothing else is looked at. */
  explicit: boolean;
  /** A database from before 2026-10-10, when a hand-started till kept its data in `data/` under the folder it was started in. */
  legacy: string | null;
}

export function chooseDb(env: NodeJS.ProcessEnv, platform: NodeJS.Platform, home: string, cwd: string, exists: (path: string) => boolean = existsSync): DbChoice {
  if (env.CACTUS_DB) return { path: env.CACTUS_DB, explicit: true, legacy: null };
  const join = platform === 'win32' ? win32.join : posix.join;
  const path = join(dataHome(env, platform, home), 'data', 'cactus.sqlite');
  const legacy = resolve(cwd, 'data/cactus.sqlite');
  return { path, explicit: false, legacy: legacy !== resolve(path) && exists(legacy) ? legacy : null };
}

/** How many orders a database file holds, without changing it. Null when it cannot be read as a till database. */
export function ordersIn(file: string): number | null {
  try {
    const db = new DatabaseSync(file, { readOnly: true });
    try { return (db.prepare('SELECT COUNT(*) AS n FROM orders').get() as { n: number }).n; } finally { db.close(); }
  } catch { return null; }
}

/**
 * Settles which file to open and returns lines to show the person starting the till.
 * A hand-started till from before the move is carried over once (copied, the old file is left alone), so
 * trial sales are not lost. When both places hold a database, the standard one is used and the other is named.
 */
export function prepareDb(choice: DbChoice): string[] {
  if (choice.explicit || !choice.legacy) return [];
  if (!existsSync(choice.path)) {
    mkdirSync(dirname(choice.path), { recursive: true });
    // VACUUM INTO writes one complete file, including sales still waiting in the old file's -wal.
    const old = new DatabaseSync(choice.legacy);
    try { old.exec(`VACUUM INTO '${choice.path.replace(/'/g, "''")}'`); } finally { old.close(); }
    return [
      `Sales data from earlier runs was found in ${choice.legacy}.`,
      `It was copied to ${choice.path}, where CactusPOS now keeps its data. The old file was left as it is.`,
    ];
  }
  const stray = ordersIn(choice.legacy);
  if (!stray) return [];
  return [
    `!! A second database with ${stray} order${stray === 1 ? '' : 's'} exists at ${choice.legacy}.`,
    `   It is NOT used. CactusPOS keeps its data in ${choice.path}.`,
    '   To open the other file instead, set CACTUS_DB to its full path.',
  ];
}
