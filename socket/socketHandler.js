const usuariosConectados = new Map();

function socketHandler(io) {
    io.on("connection", (socket) => {
        console.log("Novo usuário conectado:", socket.id);

        // Salvar ID do usuário conectado
        socket.on("autenticar", (userId) => {
            usuariosConectados.set(userId, socket.id);
            console.log(`Usuário ${userId} autenticado no socket ${socket.id}`);
        });

        socket.on("disconnect", () => {
            for (const [userId, sockId] of usuariosConectados.entries()) {
                if (sockId === socket.id) {
                    usuariosConectados.delete(userId);
                    console.log(`Usuário ${userId} desconectado`);
                    break;
                }
            }
        });
    });
}

// Função para enviar notificações
function enviarNotificacao(io, userId, notificacao) {
    const socketId = usuariosConectados.get(userId);
    if (socketId) {
        io.to(socketId).emit("nova_notificacao", notificacao);
        console.log(`🔔 Notificação enviada para ${userId}:`, notificacao);
    } else {
        console.log(`⚠️ Usuário ${userId} não está online`);
    }
}

module.exports = {
    socketHandler,
    enviarNotificacao
};
