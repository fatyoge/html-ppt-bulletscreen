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

  test('latest speaker wins control', () => {
    sync.setSpeaker('socket-1');
    const result = sync.setSpeaker('socket-2');
    expect(result).toBe(true);
    expect(sync.getSpeakerSocketId()).toBe('socket-2');
  });

  test('re-announcing same speaker returns false', () => {
    sync.setSpeaker('socket-1');
    const result = sync.setSpeaker('socket-1');
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
    expect(state).toEqual({ paused: false, speed: 1.0, density: 5, topRatio: 0.3 });
  });

  test('setControlState updates state', () => {
    sync.setControlState({ paused: true, speed: 2.0, density: 8, topRatio: 0.5 });
    const state = sync.getControlState();
    expect(state).toEqual({ paused: true, speed: 2.0, density: 8, topRatio: 0.5 });
  });

  test('setSlideTransforms and getSlideTransforms persist transforms', () => {
    const transforms = [{ path: [1], transform: 'scale(1.5)' }];
    sync.setSlideTransforms(0, transforms);
    expect(sync.getSlideTransforms(0)).toEqual(transforms);
  });

  test('getSlideTransforms returns empty array for unknown slide', () => {
    expect(sync.getSlideTransforms(99)).toEqual([]);
  });

  test('getAllSlideTransforms returns all stored transforms', () => {
    sync.setSlideTransforms(0, [{ path: [1], transform: 'scale(1.5)' }]);
    sync.setSlideTransforms(2, [{ path: [0], opacity: '0.5' }]);
    expect(sync.getAllSlideTransforms()).toEqual({
      0: [{ path: [1], transform: 'scale(1.5)' }],
      2: [{ path: [0], opacity: '0.5' }]
    });
  });
});
