// socketConfig.js - Versão corrigida
let io;

function initialize(server) {
  if (!server) {
    throw new Error('Server não foi fornecido ao inicializar Socket.IO');
  }
  io = require('socket.io')(server);
  console.log('Socket.IO inicializado com sucesso');
  return io;
}

function getIO() {
  if (!io) {
    console.warn('Socket.IO não foi inicializado. As notificações em tempo real não funcionarão.');
    return null; // Retorna null em vez de lançar erro
  }
  return io;
}

module.exports = {
  initialize,
  getIO
};