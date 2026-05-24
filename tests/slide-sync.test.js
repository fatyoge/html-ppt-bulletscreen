const { SlideSync } = require('../lib/slide-sync');

describe('SlideSync', () => {
  let sync;

  beforeEach(() => {
    sync = new SlideSync();
  });

  test('initial state is slide 0 with no speaker', () => {
    expect(sync.getCurrentSlide()).toBe(0);
    expect(sync.getSpeakerSocketId()).toBeNull();
  });

  test('sets speaker and returns true for first speaker', () => {
    const result = sync.setSpeaker('socket-1');
    expect(result).toBe(true);
    expect(sync.getSpeakerSocketId()).toBe('socket-1');
  });

  test('returns false for subsequent speakers', () => {
    sync.setSpeaker('socket-1');
    const result = sync.setSpeaker('socket-2');
    expect(result).toBe(false);
    expect(sync.getSpeakerSocketId()).toBe('socket-1');
  });

  test('updates slide only from current speaker', () => {
    sync.setSpeaker('socket-1');
    const result = sync.setSlide(2, 'socket-1');
    expect(result).toBe(true);
    expect(sync.getCurrentSlide()).toBe(2);
  });

  test('rejects slide update from non-speaker', () => {
    sync.setSpeaker('socket-1');
    const result = sync.setSlide(2, 'socket-2');
    expect(result).toBe(false);
    expect(sync.getCurrentSlide()).toBe(0);
  });

  test('removes speaker and allows new speaker', () => {
    sync.setSpeaker('socket-1');
    sync.removeSpeaker('socket-1');
    expect(sync.getSpeakerSocketId()).toBeNull();
    const result = sync.setSpeaker('socket-2');
    expect(result).toBe(true);
  });

  test('getControlState returns default values', () => {
    const state = sync.getControlState();
    expect(state).toEqual({ paused: false, speed: 1.0, density: 5 });
  });

  test('setControlState updates state', () => {
    sync.setControlState({ paused: true, speed: 2.0, density: 8 });
    const state = sync.getControlState();
    expect(state).toEqual({ paused: true, speed: 2.0, density: 8 });
  });
});
