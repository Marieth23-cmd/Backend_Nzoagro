const express = require("express");
const router = express.Router();
const conexao = require("./database"); 
const { autenticarToken } = require("./mildwaretoken");

router.use(express.json());

const formatarDataHumana = (dataHora) => {
    const agora = new Date();
    const data = new Date(dataHora);
    const diffMs = agora - data;

    const minutos = Math.floor(diffMs / (1000 * 60));
    const horas = Math.floor(diffMs / (1000 * 60 * 60));
    const dias = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (minutos < 1) return "Agora mesmo";
    if (minutos < 60) return `${minutos} minuto${minutos > 1 ? 's' : ''} atrás`;
    if (horas < 24) return `${horas} hora${horas > 1 ? 's' : ''} atrás`;

    if (dias === 1) return "Ontem";
    if (dias === 2) return "Anteontem";
    if (dias < 7) {
        return data.toLocaleDateString("pt-PT", { weekday: "long" }); 
    }
    if (dias < 14) return "Há uma semana";

    return data.toLocaleDateString("pt-PT"); 
};

router.use(express.json());

router.get("/", autenticarToken, async (req, res) => {
    const usuarioId = req.usuario.id_usuario;

    try {
        const sql = `
            SELECT id_notificacoes, titulo, mensagem, tipo, hora
            FROM notificacoes
            WHERE usuarios_id = ?
            ORDER BY hora DESC;
        `;

        const [resultados] = await conexao.promise().query(sql, [usuarioId]);

        if (resultados.length === 0) {
            return res.status(404).json({ mensagem: "Nenhuma notificação encontrada" });
        }

        const notificacoes = resultados.map(n => ({
            ...n,
            data_legivel: formatarDataHumana(n.hora),
        }));

        res.json({ notificacoes });
    } catch (erro) {
        res.status(500).json({ erro: "Erro ao buscar notificações", detalhe: erro.message });
    }
});





router.delete("/:id",autenticarToken, async (req, res) => {
    const notificacaoId = req.params.id;

    try {
        const sql = "DELETE FROM notificacoes WHERE id_notificacoes = ?";
        const [resultado] = await conexao.promise().query(sql, [notificacaoId]);

        if (resultado.affectedRows === 0) {
            return res.status(404).json({ mensagem: "Notificação não encontrada" });
        }

        res.json({ mensagem: "Notificação deletada com sucesso!" });
    } catch (erro) {
        res.status(500).json({ erro: "Erro ao deletar a notificação", detalhe: erro.message });
    }
});


router.delete("/usuario",autenticarToken, async (req, res) => {
    const usuarioId = req.usuario.id_usuario;

    try {
        const sql = "DELETE FROM notificacoes WHERE usuarios_id = ?";
        const [resultado] = await conexao.promise().query(sql, [usuarioId]);

        if (resultado.affectedRows === 0) {
            return res.status(404).json({ mensagem: "Nenhuma notificação encontrada." });
        }

        res.json({ mensagem: "Todas as notificações foram deletadas com sucesso!" });
    } catch (erro) {
        res.status(500).json({ erro: "Erro ao deletar as notificações", detalhe: erro.message });
    }
});

router.patch("/:id", autenticarToken, async (req, res) => {
    const usuarioId = req.usuario.id_usuario;
    const idNotificacao = req.params.id;

    try {
        const sql = `UPDATE notificacoes SET is_lida = 1 WHERE id_notificacoes = ? AND usuarios_id = ?`;
        const [resultado] = await conexao.promise().query(sql, [idNotificacao, usuarioId]);

        if (resultado.affectedRows === 0) {
            return res.status(404).json({ mensagem: "Notificação não encontrada" });
        }

        res.json({ mensagem: "Notificação marcada como lida" });
    } catch (erro) {
        res.status(500).json({ erro: "Erro ao atualizar notificação", detalhe: erro.message });
    }
});

router.get("/nao-lidas/quantidade", autenticarToken, async (req, res) => {
    const usuarioId = req.usuario.id_usuario;

    try {
        const sql = "SELECT COUNT(*) AS total FROM notificacoes WHERE usuarios_id = ? AND is_lida = 0";
        const [resultado] = await conexao.promise().query(sql, [usuarioId]);

        res.json({ total: resultado[0].total });
    } catch (erro) {
        res.status(500).json({ erro: "Erro ao contar notificações", detalhe: erro.message });
    }
});






module.exports = router;
