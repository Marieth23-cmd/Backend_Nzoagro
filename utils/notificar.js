// utils/notificar.js

const { enviarNotificacao } = require("../socket/socketHandler");
const notificarComHistorico = require("./notificarComHistorico");

async function notificar(io, { userId, tipo, mensagem, dadosExtras = {} }) {
  
  enviarNotificacao(io, userId, { tipo, mensagem, ...dadosExtras, data: new Date().toISOString() });

  // 2) Persistir no histórico
  await notificarComHistorico(io, userId, { titulo: tipo, mensagem, tipo });
}

module.exports = notificar;
