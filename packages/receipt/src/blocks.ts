/**
 * A receipt is a list of simple blocks. Builders turn an order into blocks once; each renderer
 * (plain text, HTML, ESC/POS bytes) lays the same blocks out for its medium, so the screen
 * preview and the printed paper cannot drift apart.
 */
export type Align = 'left' | 'center' | 'right';

export type Block =
  | { t: 'text'; text: string; align?: Align; bold?: boolean; size?: 'normal' | 'large' }
  /** Left text with a right-aligned value on the same line (item ... price). */
  | { t: 'row'; left: string; right: string; bold?: boolean; size?: 'normal' | 'large' }
  /** Indented detail line under a row (options, notes). */
  | { t: 'sub'; text: string }
  | { t: 'rule' }
  | { t: 'feed'; lines: number }
  | { t: 'qr'; data: string; caption?: string }
  | { t: 'cut' }
  /** Pulse the cash drawer connected to the printer. */
  | { t: 'drawer' };

/** Characters per line: 48 for 80mm paper, 32 for 58mm (Font A). */
export type Columns = 32 | 42 | 48;
