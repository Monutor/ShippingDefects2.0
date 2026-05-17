/**
 * WebSocket /ws/sync handler.
 */

import { query } from '../db/index.js';
import { addClient, removeClient, broadcast, getClientCount } from './broadcast.js';

export function initWebSocket(app) {
  app.get('/ws/sync', { websocket: true }, async (socket, req) => {
    // C2 fix: НЕ читаем токен из URL — он придёт через handshake message после соединения
    let token = null
    let authenticated = false
    let clientId = null

    socket.on('message', async (data) => {
      try {
        const msg = JSON.parse(data.toString())

        if (msg.type === 'auth' && !authenticated) {
          // Первая аутентификация
          token = msg.token
          let decoded
          try {
            decoded = await app.jwt.verify(token)
            app.log.info('JWT verified for ' + decoded.employeeId)
          } catch (err) {
            app.log.warn(`JWT verify failed: ${err.message}`)
            socket.send(JSON.stringify({ type: 'auth_result', success: false, message: 'Invalid token' }))
            socket.close(4003, 'Invalid token')
            return
          }

          authenticated = true
          clientId = addClient(socket, { connectedAt: new Date(), employeeId: decoded.employeeId })

          socket.send(JSON.stringify({ type: 'auth_result', success: true, clientId }))
          app.log.info(`WebSocket client #${clientId} connected (${getClientCount()} total)`)

          return  // Ждём init_request от клиента
        }

        if (msg.type === 'init_request' && authenticated) {
          // Инициация загрузки начальных данных (maintenance mode)
          query("SELECT * FROM app_settings WHERE key = 'maintenance_mode' LIMIT 1")
            .then(settings => {
              socket.send(JSON.stringify({
                type: 'init',
                maintenanceMode: settings.length > 0 ? settings[0].value === 'true' : false,
              }))
            })
            .catch(() => {
              socket.send(JSON.stringify({ type: 'init', maintenanceMode: false }))
            })
          return
        }

        // Все остальные сообщения — только после аутентификации
        if (!authenticated) return

        switch (msg.type) {
          case 'ping':
            socket.send(JSON.stringify({ type: 'pong' }))
            break
          case 'subscribe':
            app.log.debug(`Client #${clientId} subscribing to box ${msg.boxId}`)
            socket.__subscribedBoxes = socket.__subscribedBoxes || new Set()
            if (msg.boxId) socket.__subscribedBoxes.add(msg.boxId)
            break
        }
      } catch (err) {
        app.log.warn('WS message parse error: ' + err.message)
      }
    })

    // Если клиент не авторизовался в течение 10 секунд — закрываем соединение
    const authTimeout = setTimeout(() => {
      if (!authenticated) {
        removeClient(socket)
        socket.close(4002, 'Auth timeout')
      }
    }, 10000)

    socket.on('close', () => {
      clearTimeout(authTimeout)
      removeClient(socket)
      if (socket.__subscribedBoxes) socket.__subscribedBoxes.clear()
      app.log.info(`WebSocket client #${clientId} disconnected (${getClientCount()} total)`)
    })

    socket.on('error', (err) => {
      clearTimeout(authTimeout)
      app.log.error('WS error: ' + err.message)
    })
  })
}
