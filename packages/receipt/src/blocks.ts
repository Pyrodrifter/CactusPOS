/**
 * A receipt is a list of simple blocks. Builders turn an order into blocks once; each renderer
 * (plain text, HTML, ESC/POS bytes) lays the same blocks out for its medium, so the screen
 * preview and the printed paper cannot drift apart.
 */
export type Align = 'left' | 'center' | 'right';

/**
 * Sizes every ESC/POS printer has built in. `small` is the narrow font (a third more characters per line),
 * `tall` and `wide` double one direction, `large` doubles both and `huge` triples both.
 */
export type TextSize = 'small' | 'normal' | 'tall' | 'wide' | 'large' | 'huge';
export interface Look { bold?: boolean; size?: TextSize; underline?: boolean; inverse?: boolean }
export type RuleStyle = 'dashed' | 'solid' | 'space' | 'double' | 'dotted' | 'stars' | 'wave';

export type Block =
  /** A picture: the logo, or lettering. `alt` is what it says, for text logs and screen readers. */
  | { t: 'raster'; image: import('@cactus/shared').ReceiptLogo; align?: Align; alt?: string }
  | ({ t: 'text'; text: string; align?: Align } & Look)
  /** Left text with a right-aligned value on the same line (item ... price). */
  | { t: 'row'; left: string; right: string; bold?: boolean; size?: TextSize }
  /** Indented detail line under a row (options, notes). */
  | { t: 'sub'; text: string }
  | { t: 'rule'; style?: RuleStyle }
  | { t: 'feed'; lines: number }
  /** A QR code, printed as a picture. `scale` is printer dots per square of the code (default 6: about 3 cm for a web address). */
  | { t: 'qr'; data: string; caption?: string; scale?: number }
  | { t: 'cut' }
  /** Pulse the cash drawer connected to the printer. */
  | { t: 'drawer' };

/** Characters per line: 48 for 80mm paper, 32 for 58mm (Font A). */
export type Columns = 32 | 42 | 48;
