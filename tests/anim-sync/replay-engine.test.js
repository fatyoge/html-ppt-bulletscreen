/**
 * @jest-environment jsdom
 */

const AnimationReplayEngine = require('../../public/anim-sync/replay-engine');

describe('AnimationReplayEngine', () => {
  let mockSocket;
  let engine;

  beforeEach(() => {
    mockSocket = {
      on: jest.fn()
    };
    engine = new AnimationReplayEngine(mockSocket);
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    console.warn.mockRestore();
    document.body.innerHTML = '';
    delete window.gsap;
    delete window.anime;
    delete window.BS_DECLARATIVE_HANDLERS;
    delete window.BS_AnimSync;
  });

  test('constructor registers bs:anim:trigger listener on socket', () => {
    expect(mockSocket.on).toHaveBeenCalledTimes(1);
    expect(mockSocket.on).toHaveBeenCalledWith('bs:anim:trigger', expect.any(Function));
  });

  test('class-add replay: removes then adds classes (with reflow)', () => {
    document.body.innerHTML = '<div id="test" class="foo bar"></div>';
    const el = document.querySelector('#test');
    jest.spyOn(el.classList, 'remove');
    jest.spyOn(el.classList, 'add');

    engine.handleMessage({
      id: 'msg-1',
      triggerType: 'class-add',
      selector: '#test',
      payload: { classNames: ['active', 'highlight'] }
    });

    expect(el.classList.remove).toHaveBeenCalledWith('active', 'highlight');
    expect(el.classList.add).toHaveBeenCalledWith('active', 'highlight');
  });

  test('waapi replay: calls el.animate(keyframes, options)', () => {
    document.body.innerHTML = '<div id="test"></div>';
    const el = document.querySelector('#test');
    const mockAnimate = jest.fn();
    el.animate = mockAnimate;

    const keyframes = [{ opacity: 0 }, { opacity: 1 }];
    const options = { duration: 500 };

    engine.handleMessage({
      id: 'msg-2',
      triggerType: 'waapi',
      selector: '#test',
      payload: { keyframes, options }
    });

    expect(mockAnimate).toHaveBeenCalledTimes(1);
    expect(mockAnimate).toHaveBeenCalledWith(keyframes, options);
  });

  test('class-remove replay: removes classes', () => {
    document.body.innerHTML = '<div id="test" class="foo bar active"></div>';
    const el = document.querySelector('#test');
    jest.spyOn(el.classList, 'remove');

    engine.handleMessage({
      id: 'msg-3',
      triggerType: 'class-remove',
      selector: '#test',
      payload: { classNames: ['active'] }
    });

    expect(el.classList.remove).toHaveBeenCalledWith('active');
  });

  test('class-toggle replay: toggles class with force', () => {
    document.body.innerHTML = '<div id="test" class="foo"></div>';
    const el = document.querySelector('#test');
    jest.spyOn(el.classList, 'toggle');

    engine.handleMessage({
      id: 'msg-4',
      triggerType: 'class-toggle',
      selector: '#test',
      payload: { className: 'active', force: true }
    });

    expect(el.classList.toggle).toHaveBeenCalledWith('active', true);
  });

  test('style-change replay: calls style.setProperty', () => {
    document.body.innerHTML = '<div id="test"></div>';
    const el = document.querySelector('#test');
    jest.spyOn(el.style, 'setProperty');

    engine.handleMessage({
      id: 'msg-5',
      triggerType: 'style-change',
      selector: '#test',
      payload: { property: 'background-color', value: 'red' }
    });

    expect(el.style.setProperty).toHaveBeenCalledWith('background-color', 'red');
  });

  test('missing element: logs warning but does not throw', () => {
    expect(() => {
      engine.handleMessage({
        id: 'msg-6',
        triggerType: 'class-add',
        selector: '#nonexistent',
        payload: { classNames: ['active'] }
      });
    }).not.toThrow();

    expect(console.warn).toHaveBeenCalledWith(
      '[BS-Anim] Element not found for selector: #nonexistent'
    );
  });

  test('duplicate message ID: ignored (deduplication)', () => {
    document.body.innerHTML = '<div id="test"></div>';
    const el = document.querySelector('#test');
    jest.spyOn(el.classList, 'add');

    engine.handleMessage({
      id: 'dup-id',
      triggerType: 'class-add',
      selector: '#test',
      payload: { classNames: ['active'] }
    });

    engine.handleMessage({
      id: 'dup-id',
      triggerType: 'class-add',
      selector: '#test',
      payload: { classNames: ['active'] }
    });

    expect(el.classList.add).toHaveBeenCalledTimes(1);
  });

  test('invalid triggerType: logs warning', () => {
    document.body.innerHTML = '<div id="test"></div>';

    engine.handleMessage({
      id: 'msg-7',
      triggerType: 'nonexistent-type',
      selector: '#test',
      payload: {}
    });

    expect(console.warn).toHaveBeenCalledWith(
      '[BS-Anim] Unknown triggerType: nonexistent-type'
    );
  });

  test('GSAP replay when GSAP not available: logs warning, does not throw', () => {
    document.body.innerHTML = '<div id="test"></div>';
    delete window.gsap;

    expect(() => {
      engine.handleMessage({
        id: 'msg-8',
        triggerType: 'gsap',
        selector: '#test',
        payload: { method: 'to', config: { duration: 1, x: 100 } }
      });
    }).not.toThrow();

    expect(console.warn).toHaveBeenCalledWith(
      '[BS-Anim] GSAP not available for gsap trigger'
    );
  });

  test('anime replay when anime.js is available: calls anime with targets', () => {
    document.body.innerHTML = '<div id="test"></div>';
    const mockAnime = jest.fn();
    window.anime = mockAnime;

    engine.handleMessage({
      id: 'msg-9',
      triggerType: 'anime',
      selector: '#test',
      payload: { animeConfig: { duration: 500, opacity: [0, 1] } }
    });

    expect(mockAnime).toHaveBeenCalledTimes(1);
    const callArg = mockAnime.mock.calls[0][0];
    expect(callArg.targets).toBe(document.querySelector('#test'));
    expect(callArg.duration).toBe(500);
    expect(callArg.opacity).toEqual([0, 1]);
  });

  test('declarative replay with registered handler: calls handler', () => {
    document.body.innerHTML = '<div id="test"></div>';
    const mockHandler = jest.fn();
    window.BS_DECLARATIVE_HANDLERS = { myAnim: mockHandler };

    engine.handleMessage({
      id: 'msg-10',
      triggerType: 'declarative',
      selector: '#test',
      payload: { animName: 'myAnim', extra: 'data' }
    });

    expect(mockHandler).toHaveBeenCalledTimes(1);
    expect(mockHandler).toHaveBeenCalledWith(
      document.querySelector('#test'),
      expect.objectContaining({ animName: 'myAnim', extra: 'data' })
    );
  });

  test('declarative replay without handler falls back to class-add', () => {
    document.body.innerHTML = '<div id="test" class="foo"></div>';
    const el = document.querySelector('#test');
    jest.spyOn(el.classList, 'remove');
    jest.spyOn(el.classList, 'add');

    engine.handleMessage({
      id: 'msg-11',
      triggerType: 'declarative',
      selector: '#test',
      payload: { animName: 'unknownAnim', classNames: ['active'] }
    });

    expect(el.classList.remove).toHaveBeenCalledWith('active');
    expect(el.classList.add).toHaveBeenCalledWith('active');
  });

  test('declarative replay with action=remove falls back to class-remove', () => {
    document.body.innerHTML = '<div id="test" class="foo active"></div>';
    const el = document.querySelector('#test');
    jest.spyOn(el.classList, 'remove');
    jest.spyOn(el.classList, 'add');

    engine.handleMessage({
      id: 'msg-12',
      triggerType: 'declarative',
      selector: '#test',
      payload: { animName: 'unknownAnim', classNames: ['active'], action: 'remove' }
    });

    expect(el.classList.remove).toHaveBeenCalledWith('active');
    expect(el.classList.add).not.toHaveBeenCalled();
  });

  test('invalid message (missing id): logs warning', () => {
    engine.handleMessage({
      triggerType: 'class-add',
      selector: '#test',
      payload: {}
    });

    expect(console.warn).toHaveBeenCalledWith(
      '[BS-Anim] Invalid message: missing id or triggerType'
    );
  });

  test('invalid message (missing triggerType): logs warning', () => {
    engine.handleMessage({
      id: 'msg-13',
      selector: '#test',
      payload: {}
    });

    expect(console.warn).toHaveBeenCalledWith(
      '[BS-Anim] Invalid message: missing id or triggerType'
    );
  });

  test('lottie replay finds registered animation and calls action', () => {
    document.body.innerHTML = '<div id="lottie-container"></div>';
    const el = document.querySelector('#lottie-container');
    const mockPlay = jest.fn();
    const mockAnimation = { play: mockPlay };
    window.BS_AnimSync = {
      lottieAnimations: [
        { container: el, animation: mockAnimation }
      ]
    };

    engine.handleMessage({
      id: 'msg-14',
      triggerType: 'lottie',
      selector: '#lottie-container',
      payload: { action: 'play', args: undefined }
    });

    expect(mockPlay).toHaveBeenCalledTimes(1);
  });

  test('lottie replay warns when animation not found', () => {
    document.body.innerHTML = '<div id="lottie-container"></div>';
    window.BS_AnimSync = { lottieAnimations: [] };

    engine.handleMessage({
      id: 'msg-15',
      triggerType: 'lottie',
      selector: '#lottie-container',
      payload: { action: 'play' }
    });

    expect(console.warn).toHaveBeenCalledWith(
      '[BS-Anim] Lottie animation not found or action not available'
    );
  });
});
