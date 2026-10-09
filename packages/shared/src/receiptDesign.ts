import { z } from 'zod';

const printable = (max: number) => z.string().max(max).refine((value) => [...value].every((ch) => ch === '\n' || (ch.charCodeAt(0) >= 32 && ch.charCodeAt(0) !== 127)), 'Printer control characters are not allowed');
export const ServiceMode = z.enum(['counter', 'board']);
export type ServiceMode = z.infer<typeof ServiceMode>;
export const ServiceSettings = z.object({ mode: ServiceMode });

/** Row-packed monochrome pixels, most significant bit first; safe for both SVG and ESC/POS. */
export const ReceiptLogo = z.object({
  width: z.number().int().min(8).max(256).multipleOf(8),
  height: z.number().int().min(1).max(160),
  hex: z.string().max(10240).regex(/^[0-9a-f]+$/),
}).refine((v) => v.hex.length === v.width / 8 * v.height * 2, 'Logo pixels do not match dimensions');
export type ReceiptLogo = z.infer<typeof ReceiptLogo>;

export const DocumentDesign = z.object({
  widthMm: z.union([z.literal(58), z.literal(80)]).default(80),
  align: z.enum(['left', 'center']).default('center'),
  title: printable(80).default(''),
  subtitle: printable(160).default(''),
  footer: printable(400).default(''),
  logo: ReceiptLogo.nullable().default(null),
  numberSize: z.enum(['normal', 'large']).default('large'),
  itemSize: z.enum(['normal', 'large']).default('normal'),
  separator: z.enum(['dashed', 'solid', 'space']).default('dashed'),
  showPhone: z.boolean().default(true),
  showModifiers: z.boolean().default(true),
  showNotes: z.boolean().default(true),
  // Both renderers use these same text blocks; no executable markup or printer commands.
  messages: z.array(z.object({ text: printable(240), bold: z.boolean(), align: z.enum(['left', 'center', 'right']) })).max(4).default([]),
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
