import { z } from 'zod';

/**
 * Brand DNA: what Motify knows about a workspace's brand, and the single source
 * of truth the generation graph and the editor read from.
 *
 * The document is stored as versioned JSON so fields can be added without a
 * migration. Files (logo, favicon, screenshots, font files) are not part of it:
 * they are ordinary uploaded assets linked to the brand with a role, so they
 * keep the asset pipeline's validation and access rules. A font's files are
 * referenced from the document by asset id.
 *
 * Every field has a path (`identity.name`, `visual.colors`, ...) and a recorded
 * source. Manual edits and automated extraction (Site Intelligence) write the
 * same document through different doors: `applyBrandEdit` records the user's
 * changes, `mergeBrandSuggestion` fills in what an extractor found without ever
 * overwriting what a person typed.
 */

export const BRAND_DNA_SCHEMA_VERSION = 1;

export const BRAND_COLOR_ROLES = ['primary', 'secondary', 'accent', 'background', 'surface', 'text', 'other'] as const;
export const BRAND_FONT_ROLES = ['heading', 'body', 'accent', 'mono'] as const;
/** `preset`: a typeface Motionly ships or every system has. `upload`: the brand's own files. */
export const BRAND_FONT_SOURCES = ['preset', 'upload'] as const;
export const BRAND_FONT_STYLES = ['normal', 'italic'] as const;
export const BRAND_FIELD_SOURCES = ['manual', 'site_intelligence'] as const;
export const BRAND_ASSET_ROLES = ['logo', 'favicon', 'logo_variant', 'screenshot', 'image', 'icon', 'font'] as const;
/** Roles a brand holds at most one of. Setting one replaces the previous. */
export const SINGULAR_BRAND_ASSET_ROLES: readonly BrandAssetRole[] = ['logo', 'favicon'];

export type BrandColorRole = (typeof BRAND_COLOR_ROLES)[number];
export type BrandFontRole = (typeof BRAND_FONT_ROLES)[number];
export type BrandFontSource = (typeof BRAND_FONT_SOURCES)[number];
export type BrandFieldSource = (typeof BRAND_FIELD_SOURCES)[number];
export type BrandAssetRole = (typeof BRAND_ASSET_ROLES)[number];

const text = (max: number) => z.string().trim().max(max);
const itemId = z.string().trim().min(1).max(64);

/** Accepts `acme.com` as well as a full URL, and stores it with its scheme. */
const webUrl = z.string().trim().max(500)
  .transform((value) => (value && !/^[a-z][a-z\d+.-]*:\/\//i.test(value) ? `https://${value}` : value))
  .refine((value) => value === '' || isHttpUrl(value), { message: 'Enter a valid http(s) URL.' });

const colorSchema = z.strictObject({
  id: itemId,
  name: text(40).default(''),
  hex: z.string().trim().regex(/^#[0-9a-f]{6}$/i, 'Use a six-digit hex colour such as #1a2b3c.').transform((value) => value.toLowerCase()),
  role: z.enum(BRAND_COLOR_ROLES).default('other'),
});

/** One uploaded font file: a single weight and style of the family. */
const fontFileSchema = z.strictObject({
  assetId: z.string().uuid(),
  weight: z.number().int().min(100).max(900).multipleOf(100).default(400),
  style: z.enum(BRAND_FONT_STYLES).default('normal'),
});

const fontSchema = z.strictObject({
  id: itemId,
  family: z.string().trim().min(1).max(80),
  role: z.enum(BRAND_FONT_ROLES).default('body'),
  source: z.enum(BRAND_FONT_SOURCES).default('preset'),
  files: z.array(fontFileSchema).max(18).default([]),
}).refine((font) => font.source === 'upload' || font.files.length === 0, {
  message: 'Only uploaded fonts carry files.',
});

const featureSchema = z.strictObject({
  id: itemId,
  title: z.string().trim().min(1).max(80),
  description: text(300).default(''),
});

export const brandDnaSchema = z.strictObject({
  identity: z.strictObject({
    name: text(80).default(''),
    websiteUrl: webUrl.default(''),
    tagline: text(140).default(''),
  }).prefault({}),
  visual: z.strictObject({
    colors: z.array(colorSchema).max(12).default([]),
    fonts: z.array(fontSchema).max(6).default([]),
  }).prefault({}),
  product: z.strictObject({
    description: text(2000).default(''),
    features: z.array(featureSchema).max(12).default([]),
    targetAudience: text(600).default(''),
  }).prefault({}),
  /** The argument every film makes: what hurts, what fixes it, why this brand, and the evidence. */
  story: z.strictObject({
    problem: text(1000).default(''),
    solution: text(1000).default(''),
    differentiators: text(1000).default(''),
    proof: text(1000).default(''),
  }).prefault({}),
  voice: z.strictObject({
    tone: z.array(z.string().trim().min(1).max(30)).max(8).default([]),
    writingStyle: text(1000).default(''),
  }).prefault({}),
});

export type BrandDna = z.output<typeof brandDnaSchema>;
export type BrandDnaInput = z.input<typeof brandDnaSchema>;
export type BrandFont = BrandDna['visual']['fonts'][number];

/**
 * The fields the document has today, section by section. Stored documents are
 * read through this so a field that was later removed is dropped, not rejected.
 */
const DOCUMENT_KEYS: Record<keyof BrandDna, readonly string[]> = {
  identity: ['name', 'websiteUrl', 'tagline'],
  visual: ['colors', 'fonts'],
  product: ['description', 'features', 'targetAudience'],
  story: ['problem', 'solution', 'differentiators', 'proof'],
  voice: ['tone', 'writingStyle'],
};

/**
 * The unit of provenance. Lists (colours, fonts, features, tone) are one field:
 * an extractor proposes a palette, not one swatch at a time.
 */
export const BRAND_FIELD_PATHS = [
  'identity.name',
  'identity.websiteUrl',
  'identity.tagline',
  'visual.colors',
  'visual.fonts',
  'product.description',
  'product.features',
  'product.targetAudience',
  'story.problem',
  'story.solution',
  'story.differentiators',
  'story.proof',
  'voice.tone',
  'voice.writingStyle',
] as const;

export type BrandFieldPath = (typeof BRAND_FIELD_PATHS)[number];

export interface BrandFieldProvenance {
  source: BrandFieldSource;
  updatedAt: string;
  /** Where an extractor found the value; absent for manual edits. */
  sourceUrl?: string;
  /** Extractor confidence, 0 to 1; absent for manual edits. */
  confidence?: number;
}

export type BrandProvenance = Partial<Record<BrandFieldPath, BrandFieldProvenance>>;

const provenanceEntrySchema = z.strictObject({
  source: z.enum(BRAND_FIELD_SOURCES),
  updatedAt: z.string(),
  sourceUrl: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
});

export function emptyBrandDna(): BrandDna {
  return brandDnaSchema.parse({});
}

/** Reads a stored document, filling fields added since it was written and dropping ones since removed. */
export function readBrandDna(stored: unknown): BrandDna {
  const known: Record<string, Record<string, unknown>> = {};
  if (stored && typeof stored === 'object') {
    for (const [section, keys] of Object.entries(DOCUMENT_KEYS)) {
      const value = (stored as Record<string, unknown>)[section];
      if (!value || typeof value !== 'object') continue;
      known[section] = Object.fromEntries(keys.filter((key) => key in value).map((key) => [key, (value as Record<string, unknown>)[key]]));
    }
  }
  return brandDnaSchema.parse(known);
}

/** Reads stored provenance, dropping entries for fields that no longer exist. */
export function readBrandProvenance(stored: unknown): BrandProvenance {
  const result: BrandProvenance = {};
  if (!stored || typeof stored !== 'object') return result;
  for (const path of BRAND_FIELD_PATHS) {
    const parsed = provenanceEntrySchema.safeParse((stored as Record<string, unknown>)[path]);
    if (parsed.success) result[path] = withoutUndefined(parsed.data);
  }
  return result;
}

/** Every font file the document points at. */
export function brandFontAssetIds(dna: BrandDna): string[] {
  return dna.visual.fonts.flatMap((font) => font.files.map((file) => file.assetId));
}

export function getBrandField(dna: BrandDna, path: BrandFieldPath): unknown {
  const [section, key] = path.split('.') as [keyof BrandDna, string];
  return (dna[section] as Record<string, unknown>)[key];
}

function setBrandField(dna: BrandDna, path: BrandFieldPath, value: unknown): BrandDna {
  const [section, key] = path.split('.') as [keyof BrandDna, string];
  return { ...dna, [section]: { ...dna[section], [key]: value } };
}

/** Empty means "nobody has said anything": a blank string, an empty list, no choice made. */
export function isEmptyBrandValue(value: unknown): boolean {
  if (value === null || value === undefined || value === '') return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.values(value).every(isEmptyBrandValue);
  return false;
}

export function isBrandDnaEmpty(dna: BrandDna): boolean {
  return BRAND_FIELD_PATHS.every((path) => isEmptyBrandValue(getBrandField(dna, path)));
}

/**
 * Applies a person's edit. Every field whose value changed is recorded as
 * manual, which is what later protects it from being overwritten by extraction.
 */
export function applyBrandEdit(
  current: BrandDna,
  provenance: BrandProvenance,
  next: BrandDna,
  now: Date,
): { dna: BrandDna; provenance: BrandProvenance; changed: BrandFieldPath[] } {
  const changed = BRAND_FIELD_PATHS.filter((path) => !sameValue(getBrandField(current, path), getBrandField(next, path)));
  const updatedAt = now.toISOString();
  const nextProvenance: BrandProvenance = { ...provenance };
  for (const path of changed) {
    if (isEmptyBrandValue(getBrandField(next, path))) delete nextProvenance[path];
    else nextProvenance[path] = { source: 'manual', updatedAt };
  }
  return { dna: next, provenance: nextProvenance, changed };
}

/** What an extractor proposes: any subset of fields, each with the value it found. */
export type BrandSuggestion = Partial<Record<BrandFieldPath, unknown>>;

export interface BrandSuggestionOptions {
  source: Exclude<BrandFieldSource, 'manual'>;
  now: Date;
  /** Where the values came from, e.g. the crawled page. */
  sourceUrl?: string;
  confidence?: Partial<Record<BrandFieldPath, number>>;
  /** Replace fields a person set by hand. Off by default: manual input always wins. */
  overwriteManual?: boolean;
}

/**
 * Merges automated findings into the document. A field is taken when it is
 * empty, or was itself set by automation; a field a person set is kept unless
 * the caller explicitly asks to overwrite it. Suggested values are validated
 * against the same schema as manual edits, so an extractor can never store
 * something the editor could not.
 */
export function mergeBrandSuggestion(
  current: BrandDna,
  provenance: BrandProvenance,
  suggestion: BrandSuggestion,
  options: BrandSuggestionOptions,
): { dna: BrandDna; provenance: BrandProvenance; applied: BrandFieldPath[]; skipped: BrandFieldPath[] } {
  let candidate = current;
  const applied: BrandFieldPath[] = [];
  const skipped: BrandFieldPath[] = [];
  for (const path of BRAND_FIELD_PATHS) {
    if (!(path in suggestion)) continue;
    const value = suggestion[path];
    if (isEmptyBrandValue(value)) continue;
    const manual = provenance[path]?.source === 'manual' && !isEmptyBrandValue(getBrandField(current, path));
    if (manual && !options.overwriteManual) {
      skipped.push(path);
      continue;
    }
    candidate = setBrandField(candidate, path, value);
    applied.push(path);
  }
  const dna = brandDnaSchema.parse(candidate);
  const updatedAt = options.now.toISOString();
  const nextProvenance: BrandProvenance = { ...provenance };
  for (const path of applied) {
    nextProvenance[path] = withoutUndefined({
      source: options.source,
      updatedAt,
      sourceUrl: options.sourceUrl,
      confidence: options.confidence?.[path],
    });
  }
  return { dna, provenance: nextProvenance, applied, skipped };
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname.includes('.');
  } catch {
    return false;
  }
}

function withoutUndefined<T extends object>(input: T) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as { [K in keyof T]: Exclude<T[K], undefined> };
}
