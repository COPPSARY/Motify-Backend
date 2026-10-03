import { describe, expect, it } from 'vitest';

import { readBrandDna } from '../../../packages/brand/brand-dna.js';
import type { GenerationBrand } from '../../../packages/ai/agent/dependencies.js';
import { brandAssetTokens, describeBrand } from '../../../packages/ai/prompts/brand.prompt.js';

const logoId = '00000000-0000-4000-8000-0000000000a1';
const faviconId = '00000000-0000-4000-8000-0000000000a2';
const fontId = '00000000-0000-4000-8000-0000000000f1';

const brand: GenerationBrand = {
  dna: readBrandDna({
    identity: { name: 'Acme', websiteUrl: 'https://acme.com', tagline: 'Ship faster' },
    visual: {
      colors: [{ id: 'c1', name: 'Ink', hex: '#101820', role: 'background' }, { id: 'c2', hex: '#ff5a1f', role: 'accent' }],
      fonts: [
        { id: 'f1', family: 'Acme Sans', role: 'heading', source: 'upload', files: [{ assetId: fontId, weight: 700 }] },
        { id: 'f2', family: 'Inter', role: 'body' },
      ],
    },
    product: { description: 'Invoices that chase themselves.', features: [{ id: 'x', title: 'Auto reminders' }], targetAudience: 'Freelancers' },
    story: { proof: '4,000 teams' },
    voice: { tone: ['confident', 'warm'] },
  }),
  assets: [
    { assetId: faviconId, role: 'favicon', label: null, fileName: 'favicon.png', contentType: 'image/png', width: 32, height: 32 },
    { assetId: logoId, role: 'logo', label: null, fileName: 'logo.svg', contentType: 'image/svg+xml', width: 400, height: 120 },
    { assetId: fontId, role: 'font', label: null, fileName: 'AcmeSans-Bold.woff2', contentType: 'font/woff2', width: null, height: null },
  ],
};

describe('brand prompt', () => {
  it('renders only the fields that were filled in', () => {
    const text = describeBrand(brand);
    expect(text).toContain('Brand: Acme "Ship faster" (https://acme.com)');
    expect(text).toContain('- background #101820 (Ink)');
    expect(text).toContain('- heading: "Acme Sans" (brand font file, declare it below)');
    expect(text).toContain('- body: "Inter"');
    expect(text).toContain(`@font-face { font-family: "Acme Sans"; src: url("motify-asset://${fontId}") format("woff2"); font-weight: 700; font-style: normal; font-display: block; }`);
    expect(text).toContain('Audience: Freelancers');
    expect(text).toContain('never invent statistics): 4,000 teams');
    expect(text).not.toContain('Writing style');
  });

  it('offers placeable images, logo first, and keeps the favicon out', () => {
    const text = describeBrand(brand);
    expect(text).toContain(`logo: logo.svg (image/svg+xml, 400x120); HTML source: motify-asset://${logoId}`);
    expect(text).not.toContain(faviconId);
    expect(text).not.toContain('AcmeSans-Bold.woff2');
    expect(brandAssetTokens(brand)).toEqual([`motify-asset://${logoId}`, `motify-asset://${fontId}`]);
    expect(brandAssetTokens(undefined)).toEqual([]);
  });
});
