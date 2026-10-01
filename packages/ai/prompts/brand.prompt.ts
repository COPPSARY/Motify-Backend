import type { BrandDna, BrandFont } from '../../brand/brand-dna.js';
import type { GenerationBrand, GenerationBrandAsset } from '../graph/dependencies.js';

/**
 * Turns Brand DNA into prompt text. Only fields someone filled in are
 * rendered, so a half-finished brand costs a few lines, not a template of blanks.
 *
 * The brand is a default, not an override: the user's request for this film
 * wins where the two disagree ("make it bright pink" beats a navy palette).
 */

const PLACEABLE_LIMIT = 8;

const FONT_FORMATS: Record<string, string> = {
    'font/woff2': 'woff2',
    'font/woff': 'woff',
    'font/ttf': 'truetype',
    'font/otf': 'opentype',
};

export function brandAssetToken(assetId: string): string {
    return `motify-asset://${assetId}`;
}

/** Tokens the model may use without being required to: placeable images and the brand's font files. */
export function brandAssetTokens(brand: GenerationBrand | undefined): string[] {
    if (!brand) return [];
    return [
        ...placeableAssets(brand).map((asset) => brandAssetToken(asset.assetId)),
        ...brand.dna.visual.fonts.flatMap((font) => font.files.map((file) => brandAssetToken(file.assetId))),
    ];
}

/** Full brand context for the generation and repair prompts. */
export function describeBrand(brand: GenerationBrand): string {
    const { dna } = brand;
    const lines = [
        'BRAND DNA (the workspace brand: the source of truth for identity, copy and look)',
        'Use it as the default for every choice below. Where the user request for this film says otherwise, follow the request.',
        ...identityLines(dna),
        ...productLines(dna),
        ...storyLines(dna),
        ...voiceLines(dna),
    ];

    if (dna.visual.colors.length > 0) {
        lines.push(
            'Palette (build the film from these; do not invent a different palette):',
            ...dna.visual.colors.map((color) => `- ${color.role} ${color.hex}${color.name ? ` (${color.name})` : ''}`),
        );
    }
    lines.push(...fontLines(brand));

    const placeable = placeableAssets(brand);
    if (placeable.length > 0) {
        lines.push(
            'Brand images you may place (optional; use one only where it serves the shot, e.g. a logo on the closing frame or a screenshot inside a device):',
            ...placeable.map(describeAsset),
            'Never stretch, recolour or crop a logo; keep its aspect ratio. Do not use any other motify-asset:// token.',
        );
    }
    return lines.join('\n');
}

/**
 * The compact version the brief sees. The brief decides structure and picks
 * ground and accent colours, so it needs the story and palette, not asset tokens.
 */
export function describeBrandForBrief(brand: GenerationBrand): string {
    const { dna } = brand;
    const lines = [
        'Brand this film is for (derive beats from it where the request is silent; the request wins on conflict):',
        ...identityLines(dna),
        ...productLines(dna),
        ...storyLines(dna),
        ...voiceLines(dna),
    ];
    if (dna.visual.colors.length > 0) {
        lines.push(`Brand palette: ${dna.visual.colors.map((color) => `${color.role} ${color.hex}`).join(', ')}. Choose ground and accent from it.`);
    }
    return lines.join('\n');
}

function identityLines(dna: BrandDna): string[] {
    const { name, tagline, websiteUrl } = dna.identity;
    if (!name && !tagline && !websiteUrl) return [];
    const parts = [name || 'Unnamed brand', tagline ? `"${tagline}"` : '', websiteUrl ? `(${websiteUrl})` : ''].filter(Boolean);
    return [`Brand: ${parts.join(' ')}`];
}

function productLines(dna: BrandDna): string[] {
    const lines: string[] = [];
    if (dna.product.description) lines.push(`Product: ${dna.product.description}`);
    if (dna.product.features.length > 0) {
        lines.push('Key features:', ...dna.product.features.map((feature) => `- ${feature.title}${feature.description ? `: ${feature.description}` : ''}`));
    }
    if (dna.product.targetAudience) lines.push(`Audience: ${dna.product.targetAudience}`);
    return lines;
}

function storyLines(dna: BrandDna): string[] {
    const { problem, solution, differentiators, proof } = dna.story;
    return [
        problem ? `Problem it solves: ${problem}` : '',
        solution ? `How it solves it: ${solution}` : '',
        differentiators ? `Why this brand: ${differentiators}` : '',
        proof ? `Proof (quote only these claims and numbers; never invent statistics): ${proof}` : '',
    ].filter(Boolean);
}

function voiceLines(dna: BrandDna): string[] {
    const lines: string[] = [];
    if (dna.voice.tone.length > 0) lines.push(`Tone: ${dna.voice.tone.join(', ')}`);
    if (dna.voice.writingStyle) lines.push(`Writing style for on-screen copy: ${dna.voice.writingStyle}`);
    return lines;
}

/**
 * Preset typefaces are already available to the page, so naming them is
 * enough. Uploaded ones exist only as asset files: the composition must
 * declare each file with @font-face before it can use the family.
 */
function fontLines(brand: GenerationBrand): string[] {
    const fonts = brand.dna.visual.fonts;
    if (fonts.length === 0) return [];
    const contentTypes = new Map(brand.assets.map((asset) => [asset.assetId, asset.contentType]));
    const lines = ['Typefaces (use these for all type; add a close system fallback after each):'];
    for (const font of fonts) lines.push(`- ${font.role}: "${font.family}"${font.source === 'upload' ? ' (brand font file, declare it below)' : ''}`);
    const uploaded = fonts.filter((font) => font.source === 'upload' && font.files.length > 0);
    if (uploaded.length > 0) {
        lines.push(
            'Declare every brand font file exactly like this inside the composition <style> before using it, and load no other remote fonts:',
            ...uploaded.flatMap((font) => fontFaces(font, contentTypes)),
        );
    }
    return lines;
}

function fontFaces(font: BrandFont, contentTypes: Map<string, string>): string[] {
    return font.files.map((file) => {
        const format = FONT_FORMATS[contentTypes.get(file.assetId) ?? ''];
        const source = `url("${brandAssetToken(file.assetId)}")${format ? ` format("${format}")` : ''}`;
        return `@font-face { font-family: "${font.family}"; src: ${source}; font-weight: ${file.weight}; font-style: ${file.style}; font-display: block; }`;
    });
}

function placeableAssets(brand: GenerationBrand | undefined): GenerationBrandAsset[] {
    if (!brand) return [];
    // A favicon is too small to put on a 1080p canvas, and a font is not a picture.
    return brand.assets
        .filter((asset) => asset.role !== 'favicon' && asset.role !== 'font')
        .sort((left, right) => ROLE_ORDER.indexOf(left.role) - ROLE_ORDER.indexOf(right.role))
        .slice(0, PLACEABLE_LIMIT);
}

const ROLE_ORDER: GenerationBrandAsset['role'][] = ['logo', 'logo_variant', 'icon', 'screenshot', 'image'];

function describeAsset(asset: GenerationBrandAsset): string {
    const size = asset.width && asset.height ? `, ${asset.width}x${asset.height}` : '';
    const label = asset.label ? ` "${asset.label}"` : '';
    return `- ${asset.role.replace('_', ' ')}${label}: ${asset.fileName} (${asset.contentType}${size}); HTML source: ${brandAssetToken(asset.assetId)}`;
}
