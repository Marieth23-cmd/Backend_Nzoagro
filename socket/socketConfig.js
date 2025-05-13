// socket/socketConfig.js
let io;

function initialize(server) {
  io = require('socket.io')(server);
  return io;
}

function getIO() {
  if (!io) {
    throw new Error('Socket.IO não foi inicializado. Chame initialize() primeiro.');
  }
  return io;
}

module.exports = {
  initialize,
  getIO
};