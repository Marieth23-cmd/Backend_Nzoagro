// notificar.js
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
        // Definir io como null explicitamente
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
  
  // Verificar se o usuário_id é válido antes de continuar
  if (!usuarios_id) {
    console.error("ID de usuário não fornecido para notificação");
    return { erro: "ID de usuário não fornecido", success: false };
  }

  try {
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
  } catch (error) {
    console.error("Erro ao processar notificação:", error);
    return { erro: error.message, success: false };
  }
}

module.exports = notificar;