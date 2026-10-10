import { z } from 'zod';

const printable = (max: number) => z.string().max(max).refine((value) => [...value].every((ch) => ch === '\n' || (ch.charCodeAt(0) >= 32 && ch.charCodeAt(0) !== 127)), 'Printer control characters are not allowed');
export const ServiceMode = z.enum(['counter', 'board']);
export type ServiceMode = z.infer<typeof ServiceMode>;
export const ServiceSettings = z.object({ mode: ServiceMode });

/** Dots across the widest paper: 80 mm rolls print 72 mm at 8 dots per mm. 58 mm rolls print 384. */
export const MAX_IMAGE_WIDTH = 576;

const bitmap = (maxHeight: number) => z.object({
  width: z.number().int().min(8).max(MAX_IMAGE_WIDTH).multipleOf(8),
  height: z.number().int().min(1).max(maxHeight),
  hex: z.string().max(MAX_IMAGE_WIDTH / 8 * maxHeight * 2).regex(/^[0-9a-f]+$/),
}).refine((v) => v.hex.length === v.width / 8 * v.height * 2, 'Logo pixels do not match dimensions');

/** Row-packed monochrome pixels, most significant bit first; safe for both SVG and ESC/POS. Used for the logo and the closing picture. */
export const ReceiptLogo = bitmap(400);
export type ReceiptLogo = z.infer<typeof ReceiptLogo>;

/**
 * How a line of printer text looks. Every thermal printer has these built in, so they print crisp and fast:
 * `small` is the printer's narrow font, `tall` and `wide` double one direction, `large` both, `huge` is three times.
 */
export const TextSize = z.enum(['small', 'normal', 'tall', 'wide', 'large', 'huge']);
export type TextSize = z.infer<typeof TextSize>;
export const TextStyle = z.object({
  size: TextSize.default('normal'), bold: z.boolean().default(false),
  underline: z.boolean().default(false), inverse: z.boolean().default(false),
});
export type TextStyle = z.infer<typeof TextStyle>;

/**
 * Lettering: one line drawn by the editor in a font of the device it runs on, and stored as a picture.
 * A receipt printer has no fonts of that kind, but it prints pictures, so the paper shows exactly what the
 * editor showed, on any printer and whatever device prints it. `text`, `font`, `size` and `bold` are kept
 * so the editor can draw it again (another paper width, a changed word).
 */
export const Lettering = z.object({
  text: printable(80), font: printable(80), size: z.enum(['s', 'm', 'l', 'xl']).default('m'), bold: z.boolean().default(false),
  image: bitmap(240),
});
export type Lettering = z.infer<typeof Lettering>;

export const DesignMessage = z.object({
  text: printable(240), bold: z.boolean(), align: z.enum(['left', 'center', 'right']),
  size: TextSize.optional(), underline: z.boolean().optional(), inverse: z.boolean().optional(),
  /** Above the items (under the header) or below the totals. Absent means below, as before this existed. */
  position: z.enum(['top', 'bottom']).optional(),
  /** Set: the message is printed as this picture instead of printer text. */
  art: Lettering.nullable().optional(),
});
export type DesignMessage = z.infer<typeof DesignMessage>;

export const DocumentDesign = z.object({
  widthMm: z.union([z.literal(58), z.literal(80)]).default(80),
  align: z.enum(['left', 'center']).default('center'),
  title: printable(80).default(''),
  subtitle: printable(160).default(''),
  footer: printable(400).default(''),
  logo: ReceiptLogo.nullable().default(null),
  numberSize: z.enum(['normal', 'large', 'huge']).default('large'),
  itemSize: z.enum(['normal', 'large']).default('normal'),
  separator: z.enum(['dashed', 'solid', 'space', 'double', 'dotted', 'stars', 'wave']).default('dashed'),
  showPhone: z.boolean().default(true),
  showModifiers: z.boolean().default(true),
  showNotes: z.boolean().default(true),
  // Both renderers use these same text blocks; no executable markup or printer commands.
  messages: z.array(DesignMessage).max(6).default([]),
  /**
   * Looks added on 2026-10-10. Each is optional and absent means "as it always printed" (business name large
   * and bold on a receipt, bold on a kitchen ticket; title bold; the rest plain), so designs saved before
   * then, and the receipts made with them, come out unchanged.
   */
  nameStyle: TextStyle.optional(),
  /** The business name as lettering. It replaces the printed name only while it still spells that name. */
  nameArt: Lettering.nullable().default(null),
  titleStyle: TextStyle.optional(),
  subtitleStyle: TextStyle.optional(),
  footerStyle: TextStyle.optional(),
  /** A picture at the very end, under the footer. */
  closing: ReceiptLogo.nullable().default(null),
});
export type DocumentDesign = z.infer<typeof DocumentDesign>;
export const ReceiptTemplate = z.object({ receipt: DocumentDesign, kitchen: DocumentDesign });
export type ReceiptTemplate = z.infer<typeof ReceiptTemplate>;
export const DEFAULT_RECEIPT_TEMPLATE: ReceiptTemplate = {
  receipt: DocumentDesign.parse({}),
  kitchen: DocumentDesign.parse({ itemSize: 'large', showPhone: false }),
};
export const TemplateVersion = z.object({
  version: z.number().int().nonnegative(), template: ReceiptTemplate,
  createdAt: z.string(), createdBy: z.string(),
});
export type TemplateVersion = z.infer<typeof TemplateVersion>;
export const TemplateState = z.object({ current: TemplateVersion, history: z.array(TemplateVersion.omit({ template: true })) });
export type TemplateState = z.infer<typeof TemplateState>;
export const SaveTemplateBody = z.object({ baseVersion: z.number().int().nonnegative(), template: ReceiptTemplate });
export const RestoreTemplateBody = z.object({ baseVersion: z.number().int().nonnegative(), version: z.number().int().nonnegative() });
export const PreviewTemplateBody = z.object({ template: ReceiptTemplate, kind: z.enum(['receipt', 'kitchen']) });
