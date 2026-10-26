import { UiStateStore } from '@/features/chat/rendering/ui/stateStore';

describe('UiStateStore.adoptScope', () => {
  it('moves values and the claim without overwriting target state', () => {
    const store = new UiStateStore();
    store.claim('old', 'conv');
    store.set('old', 'a', 1);
    store.set('old', 'b', 2);
    store.set('new', 'b', 9);
    const listener = jest.fn();
    store.subscribe(listener);

    expect(store.adoptScope('old', 'new')).toBe(1);
    expect(store.get('new', 'a')).toBe(1);
    expect(store.get('new', 'b')).toBe(9);
    expect(store.has('old', 'a')).toBe(false);
    expect(store.scopesOf('conv')).toContain('new');
    expect(store.scopesOf('conv')).not.toContain('old');
    expect(listener).toHaveBeenCalledWith('new');
  });

  it('is a no-op when source and target are the same scope', () => {
    const store = new UiStateStore();
    store.set('same', 'a', 1);

    expect(store.adoptScope('same', 'same')).toBe(0);
    expect(store.get('same', 'a')).toBe(1);
  });

  it('drops source values even when the target already has them', () => {
    const store = new UiStateStore();
    store.set('old', 'a', 1);
    store.set('new', 'a', 2);

    expect(store.adoptScope('old', 'new')).toBe(0);
    expect(store.get('new', 'a')).toBe(2);
    expect(store.has('old', 'a')).toBe(false);
  });
});
