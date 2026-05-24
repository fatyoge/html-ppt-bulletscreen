class DanmakuStore {
  constructor() {
    this.pendingQueue = [];
    this.approvedQueue = [];
    this.moderatorCount = 0;
    this.MAX_HISTORY = 500;
    this._idCounter = 0;
  }

  _generateId() {
    return `dm-${Date.now()}-${++this._idCounter}`;
  }

  setModeratorCount(count) {
    const hadModerator = this.moderatorCount > 0;
    this.moderatorCount = count;
    if (hadModerator && count === 0) {
      this._autoApproveAllPending();
    }
  }

  _autoApproveAllPending() {
    while (this.pendingQueue.length > 0) {
      const dm = this.pendingQueue.shift();
      this._addToApproved(dm);
    }
  }

  _addToApproved(dm) {
    this.approvedQueue.push(dm);
    if (this.approvedQueue.length > this.MAX_HISTORY) {
      this.approvedQueue.shift();
    }
  }

  addDanmaku(text, color, senderId) {
    const danmaku = {
      id: this._generateId(),
      text,
      color,
      senderId,
      timestamp: Date.now()
    };

    if (this.moderatorCount > 0) {
      this.pendingQueue.push(danmaku);
    } else {
      this._addToApproved(danmaku);
    }

    return danmaku.id;
  }

  approve(id) {
    const idx = this.pendingQueue.findIndex(d => d.id === id);
    if (idx === -1) return null;
    const dm = this.pendingQueue.splice(idx, 1)[0];
    this._addToApproved(dm);
    return dm;
  }

  block(id) {
    const idx = this.pendingQueue.findIndex(d => d.id === id);
    if (idx === -1) return null;
    return this.pendingQueue.splice(idx, 1)[0];
  }

  getPending() {
    return [...this.pendingQueue];
  }

  getApprovedHistory() {
    return [...this.approvedQueue];
  }
}

module.exports = { DanmakuStore };
