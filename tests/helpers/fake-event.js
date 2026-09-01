export class FakeChromeEvent {
  #listeners = new Set();

  addListener(listener) {
    this.#listeners.add(listener);
  }

  removeListener(listener) {
    this.#listeners.delete(listener);
  }

  hasListener(listener) {
    return this.#listeners.has(listener);
  }

  hasListeners() {
    return this.#listeners.size > 0;
  }

  emit(...args) {
    return [...this.#listeners].map((listener) => listener(...args));
  }

  async emitAsync(...args) {
    return Promise.all([...this.#listeners].map((listener) => listener(...args)));
  }

  clear() {
    this.#listeners.clear();
  }

  get size() {
    return this.#listeners.size;
  }
}

export function createPortPair(name, sender = undefined) {
  const left = createPort(name, sender);
  const right = createPort(name, sender);
  left.__peer = right;
  right.__peer = left;
  return [left, right];
}

function createPort(name, sender) {
  return {
    name,
    sender,
    onMessage: new FakeChromeEvent(),
    onDisconnect: new FakeChromeEvent(),
    disconnected: false,
    sentMessages: [],
    __peer: null,
    postMessage(message) {
      if (this.disconnected) throw new Error('Attempting to use a disconnected port object');
      this.sentMessages.push(structuredClone(message));
      this.__peer?.onMessage.emit(structuredClone(message), this.__peer);
    },
    disconnect() {
      if (this.disconnected) return;
      this.disconnected = true;
      const peer = this.__peer;
      if (peer) peer.disconnected = true;
      this.onDisconnect.emit(this);
      peer?.onDisconnect.emit(peer);
    }
  };
}