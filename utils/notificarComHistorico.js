
const conexao = require("../database");           // já conecta com o DB
const { usuariosConectados } = require("../socket/socketHandler");

async function notificarComHistorico(io, userId, { titulo, mensagem, tipo }) {
  //  grava no banco de notificações
  const [result] = await conexao.promise().query(
    `INSERT INTO notificacoes 
       (usuarios_id, titulo, mensagem, tipo) 
     VALUES (?, ?, ?, ?)`,
    [userId, titulo, mensagem, tipo]
  );
  const id_notificacao = result.insertId;

  //  prepara o payload
  const payload = {
    id_notificacoes: id_notificacao,
    usuarios_id: userId,
    titulo,
    mensagem,
    tipo,
    hora: new Date(),
    is_lida: 0 
  };

  // 3) emite via socket se estiver online
  const socketId = usuariosConectados.get(userId);
  if (socketId) {
    io.to(socketId).emit("nova_notificacao", payload);
    console.log(`🔔 Notificação histórica enviada para ${userId}:`, payload);
  }

  return payload;
}

module.exports = notificarComHistorico;
