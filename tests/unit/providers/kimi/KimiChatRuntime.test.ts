import type { AcpRequestPermissionRequest } from '@/providers/acp';
import { KimiChatRuntime } from '@/providers/kimi/runtime/KimiChatRuntime';

function createMockPlugin(settings: Record<string, unknown> = {}): any {
  return {
    settings: {
      permissionMode: 'normal',
      ...settings,
    },
    manifest: { version: '0.0.0-test' },
  };
}

function createPermissionRequest(
  options: AcpRequestPermissionRequest['options'] = [
    { kind: 'allow_once', name: 'Allow once', optionId: 'allow-now' },
    { kind: 'allow_always', name: 'Always allow', optionId: 'allow-always' },
    { kind: 'reject_once', name: 'Deny', optionId: 'deny-now' },
  ],
): AcpRequestPermissionRequest {
  return {
    options,
    sessionId: 'session-1',
    toolCall: {
      kind: 'other',
      rawInput: { command: 'ls' },
      title: 'Shell',
      toolCallId: 'tool-1',
    },
  };
}

describe('KimiChatRuntime', () => {
  it('auto-approves with allow-once in YOLO mode without invoking the approval callback', async () => {
    const runtime = new KimiChatRuntime(createMockPlugin({ permissionMode: 'yolo' }));
    const approvalCallback = jest.fn();
    runtime.setApprovalCallback(approvalCallback);

    await expect((runtime as any).handlePermissionRequest(createPermissionRequest())).resolves.toEqual({
      outcome: {
        optionId: 'allow-now',
        outcome: 'selected',
      },
    });
    expect(approvalCallback).not.toHaveBeenCalled();
  });

  it('falls back to allow-always when YOLO has no allow-once option', async () => {
    const runtime = new KimiChatRuntime(createMockPlugin({ permissionMode: 'yolo' }));

    await expect((runtime as any).handlePermissionRequest(createPermissionRequest([
      { kind: 'allow_always', name: 'Always allow', optionId: 'allow-always' },
      { kind: 'reject_once', name: 'Deny', optionId: 'deny-now' },
    ]))).resolves.toEqual({
      outcome: {
        optionId: 'allow-always',
        outcome: 'selected',
      },
    });
  });

  it('keeps the approval callback flow in Safe mode', async () => {
    const runtime = new KimiChatRuntime(createMockPlugin());
    const approvalCallback = jest.fn().mockResolvedValue('allow');
    runtime.setApprovalCallback(approvalCallback);

    await expect((runtime as any).handlePermissionRequest(createPermissionRequest())).resolves.toEqual({
      outcome: {
        optionId: 'allow-now',
        outcome: 'selected',
      },
    });
    expect(approvalCallback).toHaveBeenCalledTimes(1);
  });
});
