// // // utils/notificar.js

// // const { enviarNotificacao } = require("../socket/socketHandler");
// // const notificarComHistorico = require("./notificarComHistorico");

// // async function notificar(io, { userId, tipo, mensagem, dadosExtras = {} }) {
  
// //   enviarNotificacao(io, userId, { tipo, mensagem, ...dadosExtras, data: new Date().toISOString() });

// //   // 2) Persistir no histórico
// //   await notificarComHistorico(io, userId, { titulo: tipo, mensagem, tipo });
// // }

// // module.exports = notificar;

// // utils/notificar.js - versão super simplificada

// const notificarComHistorico = require("./notificarComHistorico");

// async function notificar(usuarios_id, mensagem, tipo = "info") {
//   // Chama diretamente notificarComHistorico sem precisar do io
//   return await notificarComHistorico(null, usuarios_id, { 
//     titulo: tipo, 
//     mensagem, 
//     tipo 
//   });
// }

// module.exports = notificar;

// utils/notificar.js - versão completa com Socket.IO
const { enviarNotificacao } = require("../socket/socketHandler");
const notificarComHistorico = require("./notificarComHistorico");

// Tentativa de importar o socket.io config
let socketIO = null;
try {
  socketIO = require('../socket/socketConfig');
} catch (e) {
  console.log("Socket.IO config não encontrado, notificações em tempo real podem não funcionar");
}

/**
 * Função para enviar notificações com suporte a múltiplos formatos de chamada
 * @param {Object|String} ioOuUsuarioId - Objeto io do Socket.IO ou ID do usuário
 * @param {Object|String} optionsOuMensagem - Objeto de opções ou mensagem direta
 * @param {String} [tipoOpcional] - Tipo da notificação (quando usando formato simples)
 * @returns {Promise<Object>} - Retorna o resultado da notificação
 */
async function notificar(ioOuUsuarioId, optionsOuMensagem, tipoOpcional = "info") {
  let io, usuarios_id, mensagem, tipo, dadosExtras = {};
  
  // Verifica se está sendo chamado no formato antigo (ID e mensagem diretos)
  if (typeof ioOuUsuarioId !== 'object' || !ioOuUsuarioId || typeof ioOuUsuarioId.emit !== 'function') {
    // Formato antigo: notificar(id_usuario, mensagem, [tipo])
    usuarios_id = ioOuUsuarioId;
    mensagem = optionsOuMensagem;
    tipo = tipoOpcional;
    
    // Tenta obter o objeto io de forma global
    if (socketIO) {
      try {
        io = socketIO.getIO();
      } catch (e) {
        console.log("Não foi possível obter io, notificações em tempo real desativadas");
        io = null;
      }
    }
  } else {
    // Formato novo: notificar(io, { userId, tipo, mensagem, dadosExtras })
    io = ioOuUsuarioId;
    const options = optionsOuMensagem;
    
    usuarios_id = options.userId; // Importante: isso é mapeado para usuarios_id na função notificarComHistorico
    mensagem = options.mensagem;
    tipo = options.tipo || "info";
    dadosExtras = options.dadosExtras || {};
  }
  
  // Envia notificação em tempo real via Socket.IO se disponível
  if (io && usuarios_id) {
    try {
      enviarNotificacao(io, usuarios_id, { 
        tipo, 
        mensagem, 
        ...dadosExtras, 
        data: new Date().toISOString() 
      });
    } catch (e) {
      console.error("Erro ao enviar notificação em tempo real:", e);
      // Continua para salvar no histórico mesmo se falhar o envio em tempo real
    }
  }
  
  // Salva a notificação no histórico, independentemente do Socket.IO
  return await notificarComHistorico(io, usuarios_id, { 
    titulo: tipo, 
    mensagem, 
    tipo 
  });
}

module.exports = notificar;