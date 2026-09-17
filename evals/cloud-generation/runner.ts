import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateMotifySource } from '../../packages/generation-tools/source-policy.js';
import { STARTER_SOURCE_FILES } from '../../packages/motify-runtime/starter.js';
import type { ProjectSourceFiles, ProjectSourcePath } from '../../src/services/project.service.js';

interface EvalCase {
  id: string;
  kind: 'valid' | 'append';
  file?: ProjectSourcePath;
  content?: string;
  expectedValid?: boolean;
  expectedCode?: string;
}

const directory = path.dirname(fileURLToPath(import.meta.url));
const cases = JSON.parse(await readFile(path.join(directory, 'cases.json'), 'utf8')) as EvalCase[];
const results = cases.map((testCase) => {
  const files: ProjectSourceFiles = { ...STARTER_SOURCE_FILES };
  if (testCase.kind === 'append' && testCase.file && testCase.content) files[testCase.file] = `${files[testCase.file]}\n${testCase.content}`;
  const report = validateMotifySource(files);
  const passed = testCase.expectedValid === true
    ? report.valid
    : !report.valid && Boolean(testCase.expectedCode && report.diagnostics.some((diagnostic) => diagnostic.code === testCase.expectedCode));
  return { id: testCase.id, passed, valid: report.valid, diagnosticCodes: report.diagnostics.map((diagnostic) => diagnostic.code) };
});
const summary = { version: 1, passed: results.filter((result) => result.passed).length, total: results.length, results };
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
if (summary.passed !== summary.total) process.exitCode = 1;
