/**
 * Хранилище подключённых WebSocket клиентов и функции для работы с ними.
 * Клиенты добавляются через addClient() из sync-ws.js при connect/close.
 */

// Хранилище: Map<WebSocket, { id, connectedAt }> — обычный Map, т.к. WeakMap не поддерживает итерацию
const clients = new Map();
let nextId = 0;

/**
 * Добавить клиента в хранилище (вызывается из sync-ws.js).
 */
export function addClient(ws, info) {
  const id = ++nextId;
  clients.set(ws, { id, ...info });
  return id;
}

/**
 * Удалить клиента из хранилища (вызывается из sync-ws.js).
 */
export function removeClient(ws) {
  clients.delete(ws);
}

/**
 * Отправить сообщение всем подключённым клиентам.
 */
export function broadcast(message, excludeWs = null) {
  const payload = JSON.stringify(message);
  // WebSocket.OPEN === 1 (numeric constant), не зависим от глобального WebSocket
  for (const [ws] of clients) {
    if (ws === excludeWs || ws.readyState !== 1) continue;
    try {
      ws.send(payload);
    } catch (_) {
      // отключившийся сокет — игнорируем
    }
  }
}

/**
 * Получить количество подключённых клиентов.
 */
export function getClientCount() {
  return clients.size;
}
