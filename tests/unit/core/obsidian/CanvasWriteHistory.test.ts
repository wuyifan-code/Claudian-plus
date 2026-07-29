import { applyCanvasWritePlan, type CanvasData, type CanvasWritePlan } from '../../../../src/core/obsidian/canvas';
import { CanvasWriteHistory } from '../../../../src/core/obsidian/CanvasWriteHistory';

interface FakeCanvasFile {
  extension: string;
  path: string;
  contents: string;
}

function createCanvasVault(initial: CanvasData) {
  const file: FakeCanvasFile = {
    extension: 'canvas',
    path: 'board.canvas',
    contents: JSON.stringify(initial),
  };
  const vault = {
    getFileByPath: jest.fn((path: string) => path === file.path ? file : null),
    modify: jest.fn(async (_file: FakeCanvasFile, contents: string) => { file.contents = contents; }),
    read: jest.fn(async (target: FakeCanvasFile) => target.contents),
  } as any;
  return { file, vault };
}

function addNodePlan(id: string, text: string): CanvasWritePlan {
  return {
    nodeOps: [{
      action: 'add',
      node: { id, type: 'text', x: 0, y: 0, width: 180, height: 100, text },
    }],
    edgeOps: [],
  };
}

describe('CanvasWriteHistory', () => {
  it('refuses a panel undo when a newer Canvas write has replaced its history entry', async () => {
    const initial: CanvasData = {
      nodes: [{ id: 'anchor', type: 'text', x: 0, y: 0, width: 180, height: 100, text: 'Anchor' }],
      edges: [],
    };
    const { file, vault } = createCanvasVault(initial);
    const history = new CanvasWriteHistory();
    const firstPlan = addNodePlan('first', 'First');
    const firstAfter = applyCanvasWritePlan(initial, firstPlan);
    await history.commit(vault, file.path, firstPlan, initial);

    const secondPlan = addNodePlan('second', 'Second');
    const secondAfter = applyCanvasWritePlan(firstAfter, secondPlan);
    await history.commit(vault, file.path, secondPlan, firstAfter);

    await expect(history.undo(vault, file.path, firstAfter)).rejects.toThrow(
      'refusing to undo a different write',
    );
    await expect(history.undo(vault, file.path, secondAfter)).resolves.toMatchObject({
      path: file.path,
      reverted: true,
    });
    expect(JSON.parse(file.contents).nodes).toHaveLength(2);
  });
});
