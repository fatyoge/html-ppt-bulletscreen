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
  }

  getCurrentSlide() {
    return this._currentSlide;
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
