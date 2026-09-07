/**
 * The approved action set (FR-031, FR-040 to FR-048, Rule 12).
 *
 * A closed registry. An action name that is not here is rejected before validation even runs, so a
 * model that invents `TransferFunds` fails at the first gate rather than the last (threat T-15).
 */

import { ACTION_TYPES, type ActionType } from '../common/types.js';

export interface ActionDefinition {
  readonly actionType: ActionType;
  readonly description: string;
  readonly brdReference: string;
  /** Touches the mailbox in a way that is visible outside the system. */
  readonly hasExternalEffect: boolean;
  /** Cannot be undone once performed. */
  readonly destructive: boolean;
  readonly requiredParameters: readonly string[];
}

const DEFINITIONS: readonly ActionDefinition[] = [
  {
    actionType: 'SendResponse',
    description: 'Send a templated reply to the original sender.',
    brdReference: 'BRD 1.7 / Phase 4',
    hasExternalEffect: true,
    destructive: false,
    requiredParameters: ['templateId', 'subject', 'body', 'toRecipients'],
  },
  {
    actionType: 'ForwardEmail',
    description: 'Forward the message to a configured routing address.',
    brdReference: 'BRD 1.8 / Phase 4',
    hasExternalEffect: true,
    destructive: false,
    requiredParameters: ['toRecipients'],
  },
  {
    actionType: 'MoveEmail',
    description: 'Move the message into a configured Outlook folder.',
    brdReference: 'BRD 1.9 / Phase 4',
    hasExternalEffect: false,
    destructive: false,
    requiredParameters: ['destinationFolder'],
  },
  {
    actionType: 'MarkAsRead',
    description: 'Set the message read flag.',
    brdReference: 'BRD 1.10 / Phase 4',
    hasExternalEffect: false,
    destructive: false,
    requiredParameters: [],
  },
  {
    actionType: 'DeleteEmail',
    description: 'Delete the message. Soft delete by default; permanent deletion requires explicit configuration.',
    brdReference: 'BRD 6 Scenario 8 / Phase 4',
    hasExternalEffect: false,
    destructive: true,
    requiredParameters: [],
  },
  {
    actionType: 'RouteToChangeRequest',
    description: 'Direct the requester into the formal PEP Passport change-request process.',
    brdReference: 'BRD 6 Scenarios 3, 5, 6, 9, 12 / Phase 4',
    hasExternalEffect: true,
    destructive: false,
    requiredParameters: [],
  },
  {
    actionType: 'RouteToProgramOwner',
    description: 'Route the message to the FIT, FLO or Schoox owner resolved from configuration.',
    brdReference: 'BRD 6 / Phase 4',
    hasExternalEffect: true,
    destructive: false,
    requiredParameters: ['toRecipients'],
  },
  {
    actionType: 'EscalateToHumanReview',
    description: 'Place the item in the human review queue. No mailbox side effect.',
    brdReference: 'BRD 10 / Phase 4',
    hasExternalEffect: false,
    destructive: false,
    requiredParameters: [],
  },
  {
    actionType: 'GenerateReport',
    description: 'Produce the weekly report.',
    brdReference: 'BRD 19 / Phase 4',
    hasExternalEffect: false,
    destructive: false,
    requiredParameters: [],
  },
];

const BY_TYPE = new Map<ActionType, ActionDefinition>(DEFINITIONS.map((d) => [d.actionType, d]));

export function isApprovedAction(name: unknown): name is ActionType {
  return typeof name === 'string' && BY_TYPE.has(name as ActionType);
}

export function getActionDefinition(actionType: ActionType): ActionDefinition | undefined {
  return BY_TYPE.get(actionType);
}

export function listActions(): readonly ActionDefinition[] {
  return DEFINITIONS;
}

/** Every approved action has a definition, and there are no definitions without an approved action. */
export function registryIsComplete(): boolean {
  return ACTION_TYPES.every((a) => BY_TYPE.has(a)) && DEFINITIONS.length === ACTION_TYPES.length;
}

export function missingParameters(actionType: ActionType, parameters: Record<string, unknown>): readonly string[] {
  const definition = BY_TYPE.get(actionType);
  if (!definition) return ['<unknown action>'];
  return definition.requiredParameters.filter((p) => {
    const value = parameters[p];
    if (value === undefined || value === null) return true;
    if (Array.isArray(value)) return value.length === 0;
    if (typeof value === 'string') return value.length === 0;
    return false;
  });
}
