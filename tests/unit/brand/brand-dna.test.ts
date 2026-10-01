import { describe, expect, it } from 'vitest';

import {
  applyBrandEdit,
  brandDnaSchema,
  emptyBrandDna,
  isBrandDnaEmpty,
  mergeBrandSuggestion,
  readBrandDna,
  readBrandProvenance,
} from '../../../packages/brand/brand-dna.js';

const now = new Date('2026-09-30T10:00:00Z');
const later = new Date('2026-10-01T10:00:00Z');

describe('Brand DNA document', () => {
  it('fills every section from an empty document', () => {
    const dna = emptyBrandDna();
    expect(dna.identity).toEqual({ name: '', websiteUrl: '', tagline: '' });
    expect(dna.visual).toEqual({ colors: [], fonts: [] });
    expect(isBrandDnaEmpty(dna)).toBe(true);
  });

  it('reads a document written before a section existed, and drops removed sections', () => {
    const dna = readBrandDna({ identity: { name: 'Acme', retired: true }, video: { aspectRatio: '9:16' } });
    expect(dna.identity.name).toBe('Acme');
    expect(dna.story.problem).toBe('');
    expect(dna).not.toHaveProperty('video');
  });

  it('keeps font files only on uploaded fonts', () => {
    const file = { assetId: '00000000-0000-4000-8000-0000000000f1', weight: 700, style: 'italic' };
    const dna = brandDnaSchema.parse({ visual: { fonts: [{ id: 'f', family: 'Acme Sans', source: 'upload', files: [file] }] } });
    expect(dna.visual.fonts[0]).toMatchObject({ role: 'body', source: 'upload', files: [file] });
    expect(brandDnaSchema.safeParse({ visual: { fonts: [{ id: 'f', family: 'Inter', files: [file] }] } }).success).toBe(false);
    expect(brandDnaSchema.safeParse({ visual: { fonts: [{ id: 'f', family: 'X', source: 'upload', files: [{ ...file, weight: 450 }] }] } }).success).toBe(false);
  });

  it('normalises URLs and hex colours and rejects bad values', () => {
    const dna = brandDnaSchema.parse({
      identity: { websiteUrl: 'acme.com' },
      visual: { colors: [{ id: 'c1', hex: '#AABBCC', role: 'primary' }] },
    });
    expect(dna.identity.websiteUrl).toBe('https://acme.com');
    expect(dna.visual.colors[0]?.hex).toBe('#aabbcc');
    expect(brandDnaSchema.safeParse({ identity: { websiteUrl: 'javascript:alert(1)' } }).success).toBe(false);
    expect(brandDnaSchema.safeParse({ visual: { colors: [{ id: 'c1', hex: 'red' }] } }).success).toBe(false);
    expect(brandDnaSchema.safeParse({ identity: { unknown: 'x' } }).success).toBe(false);
  });

  it('records changed fields as manual and forgets cleared ones', () => {
    const first = applyBrandEdit(emptyBrandDna(), {}, readBrandDna({ identity: { name: 'Acme', tagline: 'Fast' } }), now);
    expect(first.changed).toEqual(['identity.name', 'identity.tagline']);
    expect(first.provenance['identity.name']).toEqual({ source: 'manual', updatedAt: now.toISOString() });

    const second = applyBrandEdit(first.dna, first.provenance, readBrandDna({ identity: { name: 'Acme' } }), later);
    expect(second.changed).toEqual(['identity.tagline']);
    expect(second.provenance['identity.tagline']).toBeUndefined();
    expect(second.provenance['identity.name']?.updatedAt).toBe(now.toISOString());
  });

  it('lets extraction fill blanks but never overwrite what a person typed', () => {
    const manual = applyBrandEdit(emptyBrandDna(), {}, readBrandDna({ identity: { name: 'Acme' } }), now);
    const merged = mergeBrandSuggestion(manual.dna, manual.provenance, {
      'identity.name': 'ACME Inc.',
      'identity.tagline': 'Ship faster',
      'visual.colors': [{ id: 'c1', hex: '#112233', role: 'primary' }],
      'product.description': '',
    }, { source: 'site_intelligence', now: later, sourceUrl: 'https://acme.com', confidence: { 'identity.tagline': 0.8 } });

    expect(merged.dna.identity.name).toBe('Acme');
    expect(merged.dna.identity.tagline).toBe('Ship faster');
    expect(merged.applied).toEqual(['identity.tagline', 'visual.colors']);
    expect(merged.skipped).toEqual(['identity.name']);
    expect(merged.provenance['identity.tagline']).toEqual({
      source: 'site_intelligence', updatedAt: later.toISOString(), sourceUrl: 'https://acme.com', confidence: 0.8,
    });
  });

  it('refreshes automated fields and overwrites manual ones only when asked', () => {
    const auto = mergeBrandSuggestion(emptyBrandDna(), {}, { 'identity.name': 'Old' }, { source: 'site_intelligence', now });
    const refreshed = mergeBrandSuggestion(auto.dna, auto.provenance, { 'identity.name': 'New' }, { source: 'site_intelligence', now: later });
    expect(refreshed.dna.identity.name).toBe('New');

    const manual = applyBrandEdit(refreshed.dna, refreshed.provenance, readBrandDna({ identity: { name: 'Mine' } }), later);
    const forced = mergeBrandSuggestion(manual.dna, manual.provenance, { 'identity.name': 'Theirs' }, { source: 'site_intelligence', now: later, overwriteManual: true });
    expect(forced.dna.identity.name).toBe('Theirs');
  });

  it('validates suggested values against the same schema as edits', () => {
    expect(() => mergeBrandSuggestion(emptyBrandDna(), {}, { 'visual.colors': [{ id: 'c', hex: 'teal' }] }, { source: 'site_intelligence', now })).toThrow();
  });

  it('drops stored provenance it does not recognise', () => {
    expect(readBrandProvenance({ 'identity.name': { source: 'manual', updatedAt: 'x' }, 'gone.field': { source: 'manual', updatedAt: 'x' } }))
      .toEqual({ 'identity.name': { source: 'manual', updatedAt: 'x' } });
  });
});
