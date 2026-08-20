import { mapStreamStatusToBlobEvent, mapStreamStatusToBlobState } from '@/features/chat/services/BlobStateWiring';

describe('BlobStateWiring', () => {
  it('stream start -> thinking', () => {
    expect(mapStreamStatusToBlobState('thinking')).toBe('thinking');
    expect(mapStreamStatusToBlobEvent('thinking')).toBe('streamStart');
  });
  it('chunk -> writing', () => {
    expect(mapStreamStatusToBlobState('writing')).toBe('writing');
  });
  it('error -> bang', () => {
    expect(mapStreamStatusToBlobEvent('error')).toBe('error');
    expect(mapStreamStatusToBlobState('error')).toBe('error');
  });
  it('success -> celebrate then idle', () => {
    expect(mapStreamStatusToBlobEvent('success')).toBe('success');
    expect(mapStreamStatusToBlobState('success')).toBe('celebrate');
    expect(mapStreamStatusToBlobState('idle')).toBe('idle');
  });
});
