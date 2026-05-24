class SlideSync {
  constructor() {
    this._currentSlide = 0;
    this._speakerSocketId = null;
    this._controlState = {
      paused: false,
      speed: 1.0,
      density: 5
    };
  }

  getCurrentSlide() {
    return this._currentSlide;
  }

  getSpeakerSocketId() {
    return this._speakerSocketId;
  }

  setSpeaker(socketId) {
    if (this._speakerSocketId === null) {
      this._speakerSocketId = socketId;
      return true;
    }
    return false;
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
  }
}

module.exports = { SlideSync };
