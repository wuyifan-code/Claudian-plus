import type { BlobEvent,BlobState } from './types';

export const BLOB_TRANSITIONS: Record<BlobState, Partial<Record<BlobEvent, BlobState>>> = {
  idle: {
    inputFocus: 'listening',
    error: 'error',
  },
  listening: {
    inputBlur: 'idle',
    streamStart: 'thinking',
    error: 'error',
  },
  thinking: {
    streamStart: 'writing',
    streamEnd: 'idle',
    success: 'celebrate',
    error: 'error',
  },
  writing: {
    streamStart: 'thinking',
    streamEnd: 'idle',
    success: 'celebrate',
    error: 'error',
  },
  error: {
    reset: 'idle',
  },
  celebrate: {
    reset: 'idle',
  },
};

export class BlobStateMachine {
  private _state: BlobState;

  constructor(initial: BlobState = 'idle') {
    this._state = initial;
  }

  get state(): BlobState {
    return this._state;
  }

  dispatch(event: BlobEvent): BlobState {
    // error has global priority: any state -> error
    if (event === 'error') {
      this._state = 'error';
      return this._state;
    }
    const next = BLOB_TRANSITIONS[this._state]?.[event];
    if (next) {
      this._state = next;
    }
    return this._state;
  }

  can(event: BlobEvent): boolean {
    return !!BLOB_TRANSITIONS[this._state]?.[event];
  }

  reset(): void {
    this._state = 'idle';
  }
}
