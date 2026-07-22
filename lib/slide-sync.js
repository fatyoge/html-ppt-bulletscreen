class SlideSync {
  constructor() {
    this._currentSlide = 0;
    this._speakerSocketId = null;
    this._controlState = {
      paused: false,
      speed: 1.0,
      density: 5,
      topRatio: 0.3
    };
    this._slideTransforms = new Map();
    // 导航同步权威状态：演讲者在多页面/滚动式站点上的当前页面与 section。
    // 用于个人主页等 scroll-snap 分屏场景（非 .slide 幻灯片）。
    this._navState = { path: '/', sectionIdx: 0 };
  }

  getCurrentSlide() {
    return this._currentSlide;
  }

  getNavState() {
    return { ...this._navState };
  }

  getSpeakerSocketId() {
    return this._speakerSocketId;
  }

  setSpeaker(socketId) {
    // Latest speaker wins so reconnects and new speaker tabs can recover control.
    const hadControl = this._speakerSocketId === socketId;
    this._speakerSocketId = socketId;
    return !hadControl;
  }

  removeSpeaker(socketId) {
    if (this._speakerSocketId === socketId) {
      this._speakerSocketId = null;
    }
  }

  setSlide(idx, socketId) {
    if (socketId !== this._speakerSocketId) {
      return false;
    }
    this._currentSlide = idx;
    return true;
  }

  /**
   * 更新导航权威状态（当前页面路径 + section 索引）。
   * 与 setSlide 一样要求调用方是已注册的演讲者 socket。
   * 偏更新：path 仅在为字符串时更新；sectionIdx 仅在为整数时更新，其它值（缺失/
   * undefined/非整数）一律保持原值不变。客户端确保只在拿到整数时才携带 sectionIdx。
   */
  setNavState(state, socketId) {
    if (socketId !== this._speakerSocketId) {
      return false;
    }
    if (typeof state.path === 'string') {
      this._navState.path = state.path;
    }
    if (Number.isInteger(state.sectionIdx)) {
      this._navState.sectionIdx = state.sectionIdx;
    }
    return true;
  }

  getControlState() {
    return { ...this._controlState };
  }

  setControlState(state) {
    if (state.paused !== undefined) this._controlState.paused = state.paused;
    if (state.speed !== undefined) this._controlState.speed = state.speed;
    if (state.density !== undefined) this._controlState.density = state.density;
    if (state.topRatio !== undefined) this._controlState.topRatio = state.topRatio;
  }

  setSlideTransforms(idx, transforms) {
    this._slideTransforms.set(idx, transforms);
  }

  getSlideTransforms(idx) {
    return this._slideTransforms.get(idx) || [];
  }

  getAllSlideTransforms() {
    const result = {};
    this._slideTransforms.forEach((transforms, idx) => {
      result[idx] = transforms;
    });
    return result;
  }
}

module.exports = { SlideSync };
