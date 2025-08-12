import { zodToJsonSchema } from 'zod-to-json-schema';
import fs from 'node:fs';
import path from 'node:path';

import {
  EnabledTypeEnum,
  AnalyzeOptionsSchema,
  AnalyzeRequestSchema,
  CoordinatorAgentInputSchema,
  AgentPreviousSchema,
  AgentInputWithPreviousSchema,
  ReviewerCandidateSchema,
  ReviewerInputSchema,
  ReviewDecisionSchema,
  AgentResponseSchema,
} from '../src/types/schemas';
import { ErrorItemSchema } from '../src/types/error';

const outDir = path.resolve(process.cwd(), 'schemas', 'json');
fs.mkdirSync(outDir, { recursive: true });

const entries: Array<[string, any]> = [
  ['EnabledTypeEnum', EnabledTypeEnum],
  ['AnalyzeOptions', AnalyzeOptionsSchema],
  ['AnalyzeRequest', AnalyzeRequestSchema],
  ['CoordinatorAgentInput', CoordinatorAgentInputSchema],
  ['AgentPrevious', AgentPreviousSchema],
  ['AgentInputWithPrevious', AgentInputWithPreviousSchema],
  ['ReviewerCandidate', ReviewerCandidateSchema],
  ['ReviewerInput', ReviewerInputSchema],
  ['ReviewDecision', ReviewDecisionSchema],
  ['ErrorItem', ErrorItemSchema],
  ['AgentResponse', AgentResponseSchema],
];

for (const [name, schema] of entries) {
  const json = zodToJsonSchema(schema, name);
  const file = path.join(outDir, `${name}.schema.json`);
  fs.writeFileSync(file, JSON.stringify(json, null, 2), 'utf-8');
  console.log(`Generated: ${path.relative(process.cwd(), file)}`);
}
