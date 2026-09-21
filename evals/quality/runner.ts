/**
 * Scores the cloud generation path against a fixed prompt set.
 *
 * Credentialed and opt-in: it spends real tokens, so it is never part of
 * `npm test`. It runs the same nodes the graph runs - intent, skills,
 * reference, brief, generate, validate, repair - without the database, then
 * scores each film with the same scorer the unit tests calibrate against the
 * reference films.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { MAX_REPAIR_ATTEMPTS } from '../../packages/ai/graph/dependencies.js';
import { BRIEF_LIMITS, BRIEF_SYSTEM_PROMPT, buildBriefPrompt } from '../../packages/ai/prompts/brief.prompt.js';
import { buildIntentPrompt, INTENT_LIMITS, INTENT_SYSTEM_PROMPT } from '../../packages/ai/prompts/router.prompt.js';
import { buildMotionSystemPrompt, buildMotionUserPrompt, GENERATION_LIMITS } from '../../packages/ai/prompts/motion.prompt.js';
import {
    buildReferenceSelectionPrompt,
    REFERENCE_SELECTION_LIMITS,
    REFERENCE_SELECTION_SYSTEM_PROMPT,
} from '../../packages/ai/prompts/reference.prompt.js';
import { buildRepairSystemPrompt, buildRepairUserPrompt, REPAIR_LIMITS } from '../../packages/ai/prompts/repair.prompt.js';
import { buildSkillSelectionPrompt, SKILL_SELECTION_LIMITS, SKILL_SELECTION_SYSTEM_PROMPT } from '../../packages/ai/prompts/skill-selection.prompt.js';
import { GeminiMotionModelProvider } from '../../packages/ai/providers/gemini.provider.js';
import { motionBriefSchema, type MotionBrief } from '../../packages/ai/schemas/brief.schema.js';
import { intentSchema } from '../../packages/ai/schemas/intent.schema.js';
import { referenceSelectionSchema } from '../../packages/ai/schemas/reference-selection.schema.js';
import { skillSelectionSchema } from '../../packages/ai/schemas/skill-selection.schema.js';
import { validateMotifyGeneration } from '../../packages/ai/validation/generation-validator.js';
import { scoreGeneration } from './score.js';
import { loadReference, loadReferenceIndex, type LoadedReference } from '../../packages/motify-references/loader.js';
import { loadSkillBundle } from '../../packages/motify-skills/loader.js';
import { REQUIRED_GENERATION_SKILL_IDS, routeSkills } from '../../packages/motify-skills/router.js';

const { prompts: PROMPTS } = JSON.parse(
    readFileSync(path.resolve(import.meta.dirname, 'prompts.json'), 'utf8'),
) as { prompts: { slug: string; message: string }[] };

const OUT = path.resolve(import.meta.dirname, process.env.RUN_LABEL ?? 'reports');
const model = process.env.AI_MODEL!;
const provider = new GeminiMotionModelProvider({ apiKey: process.env.GEMINI_API_KEY! });
const bundle = await loadSkillBundle();
const summary: Record<string, unknown>[] = [];

for (const { slug, message } of PROMPTS) {
    const dir = path.join(OUT, slug);
    mkdirSync(dir, { recursive: true });
    const started = Date.now();
    const row: Record<string, unknown> = { slug, message };

    try {
        const { intent } = await provider.structured({
            model, systemInstructions: INTENT_SYSTEM_PROMPT, prompt: buildIntentPrompt(message),
            schemaName: 'motify_intent', schema: intentSchema, limits: INTENT_LIMITS,
        });
        row.intent = intent;
        if (intent !== 'CREATE') {
            summary.push(row);
            writeFileSync(path.join(dir, 'result.json'), JSON.stringify(row, null, 2));
            continue;
        }

        let selected;
        try {
            const selection = await provider.structured({
                model, systemInstructions: SKILL_SELECTION_SYSTEM_PROMPT, prompt: buildSkillSelectionPrompt(message),
                schemaName: 'motify_skill_selection', schema: skillSelectionSchema, limits: SKILL_SELECTION_LIMITS,
            });
            selected = routeSkills(bundle, selection.skillIds);
        } catch {
            selected = routeSkills(bundle, REQUIRED_GENERATION_SKILL_IDS);
        }
        row.skills = selected.map((s) => s.id);

        let reference: LoadedReference | undefined;
        try {
            const index = await loadReferenceIndex();
            const picked = await provider.structured({
                model, systemInstructions: REFERENCE_SELECTION_SYSTEM_PROMPT,
                prompt: buildReferenceSelectionPrompt(message, index),
                schemaName: 'motify_reference_selection', schema: referenceSelectionSchema,
                limits: REFERENCE_SELECTION_LIMITS,
            });
            reference = picked.referenceId.trim() ? await loadReference(picked.referenceId.trim()) : undefined;
            row.reference = reference?.id ?? 'none';
        } catch (error: any) {
            row.referenceFailed = String(error?.message).slice(0, 120);
        }

        let brief: MotionBrief | undefined;
        try {
            brief = await provider.structured({
                model, systemInstructions: BRIEF_SYSTEM_PROMPT, prompt: buildBriefPrompt(message),
                schemaName: 'motify_brief', schema: motionBriefSchema, limits: BRIEF_LIMITS,
            });
            row.beats = brief.beats.map((beat) => beat.label);
        } catch (error: any) {
            row.briefFailed = String(error?.message).slice(0, 120);
        }

        const systemInstructions = buildMotionSystemPrompt(selected);
        row.systemPromptChars = systemInstructions.length;

        let { generation, usage } = await provider.generate({
            model, systemInstructions,
            prompt: buildMotionUserPrompt({ intent, message, recentMessages: [], brief, reference }),
            limits: GENERATION_LIMITS,
        });
        row.usage = usage;

        let report = validateMotifyGeneration(generation);
        row.firstPassErrors = report.errors.map((error) => error.code);
        row.firstPassWarnings = report.warnings.map((warning) => warning.code);

        let repairs = 0;
        while (
            repairs < MAX_REPAIR_ATTEMPTS
            && (report.errors.length > 0 || (report.warnings.length > 0 && repairs === 0))
        ) {
            const repaired = await provider.generate({
                model, systemInstructions: buildRepairSystemPrompt(selected),
                prompt: buildRepairUserPrompt({
                    intent, message, candidate: generation,
                    errors: [...report.errors, ...report.warnings],
                }),
                limits: REPAIR_LIMITS,
            });
            generation = repaired.generation;
            report = validateMotifyGeneration(generation);
            repairs += 1;
        }

        row.repairs = repairs;
        row.valid = report.errors.length === 0;
        row.finalErrors = report.errors.map((error) => error.code);
        row.finalWarnings = report.warnings.map((warning) => warning.code);
        row.sceneLabels = generation.scenes.map((scene) => scene.label);
        const score = scoreGeneration(generation);
        row.score = score.total;
        row.bands = score.bands.map((band) => band.id + '=' + band.score.toFixed(2) + ' (' + band.detail + ')');
        row.htmlBytes = generation.compositionHtml.length;
        row.timelineBytes = generation.timelineJs.length;

        writeFileSync(path.join(dir, 'composition.html'), generation.compositionHtml);
        writeFileSync(path.join(dir, 'timeline.js'), generation.timelineJs);
        writeFileSync(path.join(dir, 'generation.json'), JSON.stringify(generation, null, 2));
    } catch (error: any) {
        row.error = String(error?.message).slice(0, 160);
    }

    row.seconds = Number(((Date.now() - started) / 1000).toFixed(1));
    writeFileSync(path.join(dir, 'result.json'), JSON.stringify(row, null, 2));
    summary.push(row);
    console.log(
        slug + ': ' + (row.error
            ? row.error
            : (row.valid ? 'valid' : 'INVALID') + ' | ref=' + row.reference
                + ' | score ' + row.score + ' | html ' + row.htmlBytes + 'B | repairs ' + row.repairs
                + ' | warn ' + JSON.stringify(row.finalWarnings) + ' | ' + row.seconds + 's'),
    );
}

writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify({ model, generatedAt: new Date().toISOString(), runs: summary }, null, 2));
console.log('\nartifacts: ' + OUT);
