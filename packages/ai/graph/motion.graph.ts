import { END, START, StateGraph } from '@langchain/langgraph';

import { resolveMotionGraphDependencies, type MotionGraphDependencies } from './dependencies.js';
import { createChatNode } from './nodes/chat.node.js';
import { createClassifyIntentNode } from './nodes/classify-intent.node.js';
import { createGenerateNode } from './nodes/generate.node.js';
import { createLoadContextNode } from './nodes/load-context.node.js';
import { createPlanNode } from './nodes/plan.node.js';
import { createRepairNode } from './nodes/repair.node.js';
import { createReportFailureNode } from './nodes/report-failure.node.js';
import { createSaveProjectNode } from './nodes/save-project.node.js';
import { createSelectSkillsNode } from './nodes/select-skills.node.js';
import { createValidateNode } from './nodes/validate.node.js';
import { MotionGraphAnnotation, type MotionGraphState } from './state.js';

function routeIntent(state: MotionGraphState): 'chat' | 'plan' | 'loadContext' {
    if (state.intent === 'CHAT') return 'chat';
    if (state.intent === 'PLAN') return 'plan';
    return 'loadContext';
}

function routeContext(state: MotionGraphState): 'selectSkills' | typeof END {
    return state.response ? END : 'selectSkills';
}

function routeValidation(maxRepairAttempts: number) {
    return (state: MotionGraphState): 'saveProject' | 'repair' | 'reportFailure' => {
        if (state.validationErrors.length === 0) return 'saveProject';
        return state.repairAttempts >= maxRepairAttempts ? 'reportFailure' : 'repair';
    };
}

/**
 * Builds the Motify generation workflow. Every collaborator is injected so the
 * graph can run against a fake provider and an in-memory repository in tests.
 */
export function createMotionGraph(dependencies: MotionGraphDependencies) {
    const resolved = resolveMotionGraphDependencies(dependencies);

    return new StateGraph(MotionGraphAnnotation)
        .addNode('classifyIntent', createClassifyIntentNode(resolved))
        .addNode('chat', createChatNode(resolved))
        .addNode('plan', createPlanNode(resolved))
        .addNode('loadContext', createLoadContextNode(resolved))
        .addNode('selectSkills', createSelectSkillsNode(resolved))
        .addNode('generate', createGenerateNode(resolved))
        .addNode('validate', createValidateNode(resolved))
        .addNode('repair', createRepairNode(resolved))
        .addNode('saveProject', createSaveProjectNode(resolved))
        .addNode('reportFailure', createReportFailureNode(resolved))
        .addEdge(START, 'classifyIntent')
        .addConditionalEdges('classifyIntent', routeIntent, ['chat', 'plan', 'loadContext'])
        .addEdge('chat', END)
        .addEdge('plan', END)
        .addConditionalEdges('loadContext', routeContext, ['selectSkills', END])
        .addEdge('selectSkills', 'generate')
        .addEdge('generate', 'validate')
        .addConditionalEdges('validate', routeValidation(resolved.maxRepairAttempts), [
            'saveProject',
            'repair',
            'reportFailure',
        ])
        .addEdge('repair', 'validate')
        .addEdge('saveProject', END)
        .addEdge('reportFailure', END)
        .compile();
}

export type MotionGraph = ReturnType<typeof createMotionGraph>;
