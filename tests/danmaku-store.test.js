const { DanmakuStore } = require('../lib/danmaku-store');

describe('DanmakuStore', () => {
  let store;

  beforeEach(() => {
    store = new DanmakuStore();
  });

  test('adds danmaku to pending queue when moderator exists', () => {
    store.setModeratorCount(1);
    const id = store.addDanmaku('hello', '#ff0000', 'socket-1');
    expect(store.pendingQueue).toHaveLength(1);
    expect(store.pendingQueue[0].text).toBe('hello');
    expect(store.pendingQueue[0].id).toBe(id);
  });

  test('auto-approves danmaku when no moderator', () => {
    store.setModeratorCount(0);
    const id = store.addDanmaku('hello', '#ff0000', 'socket-1');
    expect(store.pendingQueue).toHaveLength(0);
    expect(store.approvedQueue).toHaveLength(1);
    expect(store.approvedQueue[0].text).toBe('hello');
  });

  test('approve moves danmaku from pending to approved', () => {
    store.setModeratorCount(1);
    const id = store.addDanmaku('hello', '#ff0000', 'socket-1');
    const approved = store.approve(id);
    expect(approved).not.toBeNull();
    expect(approved.text).toBe('hello');
    expect(store.pendingQueue).toHaveLength(0);
    expect(store.approvedQueue).toHaveLength(1);
  });

  test('block removes danmaku from pending and returns it', () => {
    store.setModeratorCount(1);
    const id = store.addDanmaku('hello', '#ff0000', 'socket-1');
    const blocked = store.block(id);
    expect(blocked).not.toBeNull();
    expect(blocked.text).toBe('hello');
    expect(store.pendingQueue).toHaveLength(0);
    expect(store.approvedQueue).toHaveLength(0);
  });

  test('auto-approves pending when moderator disconnects', () => {
    store.setModeratorCount(1);
    store.addDanmaku('hello', '#ff0000', 'socket-1');
    store.addDanmaku('world', '#00ff00', 'socket-2');
    store.setModeratorCount(0);
    expect(store.pendingQueue).toHaveLength(0);
    expect(store.approvedQueue).toHaveLength(2);
  });

  test('approved queue has max 500 items (circular)', () => {
    store.setModeratorCount(0);
    for (let i = 0; i < 550; i++) {
      store.addDanmaku(`msg${i}`, '#fff', `socket-${i}`);
    }
    expect(store.approvedQueue).toHaveLength(500);
    expect(store.approvedQueue[0].text).toBe('msg50');
  });

  test('getPending returns copy of pending queue', () => {
    store.setModeratorCount(1);
    store.addDanmaku('hello', '#ff0000', 'socket-1');
    const pending = store.getPending();
    expect(pending).toHaveLength(1);
    pending.pop();
    expect(store.pendingQueue).toHaveLength(1);
  });
});
