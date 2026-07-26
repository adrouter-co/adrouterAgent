import type { ParentPort } from 'electron';
import {
  type RuntimeEvent,
  RuntimePortMessageSchema,
  RuntimeRequestSchema,
} from '../shared/runtime-protocol';
import { now } from '../shared/security';
import { DesktopAgentSession } from './agent-session';

let session: DesktopAgentSession | undefined;
const emit = (event: RuntimeEvent): void => {
  parentPort.postMessage({ kind: 'event', event });
};

const crash = (error: unknown): void => {
  emit({
    type: 'runtime.crash',
    turnId: null,
    timestamp: now(),
    payload: { error: error instanceof Error ? error.message : String(error) },
  });
};

const handleRequest = async (raw: unknown): Promise<void> => {
  const request = RuntimeRequestSchema.parse(raw);
  switch (request.type) {
    case 'start':
      if (session) {
        throw new Error('The utility process already owns an active run.');
      }
      session = new DesktopAgentSession(request, emit);
      void session.run().catch(crash);
      return;
    case 'steer':
      session?.steer(request.input);
      return;
    case 'queue-follow-up':
      session?.queueFollowUp(request.input);
      return;
    case 'stop':
      session?.stop();
      return;
    case 'approval':
      if (!session?.resolveApproval(request.approvalId, request.decision)) {
        throw new Error('Approval request is no longer pending.');
      }
      return;
  }
};

const parentPort = process.parentPort as ParentPort;
parentPort.on('message', (event) => {
  const parsed = RuntimePortMessageSchema.safeParse(event.data);
  if (!parsed.success || parsed.data.kind !== 'request') return;
  void handleRequest(parsed.data.request).catch(crash);
});
parentPort.postMessage({ kind: 'ready' });

process.on('uncaughtException', crash);
process.on('unhandledRejection', crash);
