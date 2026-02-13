import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../services/BotProcessManager', () => ({
  isRunning: vi.fn(),
  notifyBotReload: vi.fn(),
}));

vi.mock('./display', () => ({
  showInfo: vi.fn(),
  showSuccess: vi.fn(),
  showWarning: vi.fn(),
}));

import { isRunning, notifyBotReload } from '../services/BotProcessManager';
import { showInfo, showSuccess, showWarning } from './display';
import { notifyBotOfConfigChange } from './reloadNotify';

describe('notifyBotOfConfigChange', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should show info message when bot is not running', async () => {
    vi.mocked(isRunning).mockReturnValue(false);

    await notifyBotOfConfigChange();

    expect(showInfo).toHaveBeenCalledWith('Changes saved. Start the bot to apply.');
    expect(notifyBotReload).not.toHaveBeenCalled();
  });

  it('should show warning when bot is running but API is unreachable', async () => {
    vi.mocked(isRunning).mockReturnValue(true);
    vi.mocked(notifyBotReload).mockResolvedValue(null);

    await notifyBotOfConfigChange();

    expect(showWarning).toHaveBeenCalledWith(
      'Bot is running but reload API is unreachable. Restart the bot to apply changes.'
    );
  });

  it('should show success with counts on successful reload', async () => {
    vi.mocked(isRunning).mockReturnValue(true);
    vi.mocked(notifyBotReload).mockResolvedValue({
      success: true,
      added: ['coll-a'],
      removed: ['coll-b'],
      modified: ['coll-c', 'coll-d'],
    });

    await notifyBotOfConfigChange();

    expect(showSuccess).toHaveBeenCalledWith('Bot reloaded: 1 added, 1 removed, 2 updated');
  });

  it('should show info when reload succeeds with no changes', async () => {
    vi.mocked(isRunning).mockReturnValue(true);
    vi.mocked(notifyBotReload).mockResolvedValue({
      success: true,
      added: [],
      removed: [],
      modified: [],
    });

    await notifyBotOfConfigChange();

    expect(showInfo).toHaveBeenCalledWith('Bot reloaded — no changes detected.');
  });

  it('should show warning with errors when reload is rejected', async () => {
    vi.mocked(isRunning).mockReturnValue(true);
    vi.mocked(notifyBotReload).mockResolvedValue({
      success: false,
      errors: ['collection-x: missing walletGroup assignment'],
    });

    await notifyBotOfConfigChange();

    expect(showWarning).toHaveBeenCalledWith('Bot rejected reload:');
  });

  it('should show success with partial counts', async () => {
    vi.mocked(isRunning).mockReturnValue(true);
    vi.mocked(notifyBotReload).mockResolvedValue({
      success: true,
      added: ['new-one'],
      removed: [],
      modified: [],
    });

    await notifyBotOfConfigChange();

    expect(showSuccess).toHaveBeenCalledWith('Bot reloaded: 1 added');
  });
});
