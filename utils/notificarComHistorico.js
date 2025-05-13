// notificarComHistorico.js
const conexao = require("../database");
const { usuariosConectados } = require("../socket/socketHandler");

async function notificarComHistorico(io, userId, { titulo, mensagem, tipo }) {
  try {
    // 1. Grava no banco de notificações
    const [result] = await conexao.promise().query(
      `INSERT INTO notificacoes
        (usuarios_id, titulo, mensagem, tipo)
      VALUES (?, ?, ?, ?)`,
      [userId, titulo, mensagem, tipo]
    );
    const id_notificacao = result.insertId;

    // 2. Prepara o payload
    const payload = {
      id_notificacoes: id_notificacao,
      usuarios_id: userId,
      titulo,
      mensagem,
      tipo,
      hora: new Date(),
      is_lida: 0
    };

    // 3. Emite via socket se estiver online e se io estiver definido
    if (io && typeof io === 'object') {
      const socketId = usuariosConectados.get(userId);
      if (socketId) {
        io.to(socketId).emit("nova_notificacao", payload);
        console.log(`🔔 Notificação histórica enviada para ${userId}:`, payload);
      }
    } else {
      console.log(`Notificação registrada para ${userId}, mas io não está disponível para envio em tempo real`);
    }

    return payload;
  } catch (error) {
    console.log("Erro em notificarComHistorico:", error);
    // Ainda retorna um objeto básico mesmo em caso de erro
    return {
      usuarios_id: userId,
      titulo,
      mensagem,
      tipo,
      hora: new Date(),
      erro: error.message
    };
  }
}

module.exports = notificarComHistorico;