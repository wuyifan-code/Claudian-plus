import type { BlobEvent } from '@/shared/blob/types';

export type AgentStreamStatus = 'idle' | 'thinking' | 'writing' | 'error' | 'success';

export function mapStreamStatusToBlobEvent(status: AgentStreamStatus): BlobEvent | null {
  switch (status) {
    case 'thinking':
      return 'streamStart';
    case 'writing':
      return 'streamStart';
    case 'error':
      return 'error';
    case 'success':
      return 'success';
    case 'idle':
      return 'reset';
    default:
      return null;
  }
}

export function mapStreamStatusToBlobState(status: AgentStreamStatus): string {
  switch (status) {
    case 'thinking':
      return 'thinking';
    case 'writing':
      return 'writing';
    case 'error':
      return 'error';
    case 'success':
      return 'celebrate';
    case 'idle':
    default:
      return 'idle';
  }
}
