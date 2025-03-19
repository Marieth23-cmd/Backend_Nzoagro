const express = require("express");
const router = express.Router();
const conexao = require("./database"); 

router.use(express.json());


router.get("/:usuarioId", async (req, res) => {
    const usuarioId = req.params.usuarioId;

    try {
        const sql = `
            SELECT id_notificacoes, titulo, mensagem, tipo, status_notificacao, data_notificacao, hora
            FROM notificacoes
            WHERE usuarios_id = ?
            ORDER BY hora DESC;
        `;

        const [resultados] = await conexao.promise().query(sql, [usuarioId]);

        if (resultados.length === 0) {
            return res.status(404).json({ mensagem: "Nenhuma notificação encontrada" });
        }

        res.json({ notificacoes: resultados });
    } catch (erro) {
        res.status(500).json({ erro: "Erro ao buscar notificações", detalhe: erro.message });
    }
});

router.delete("/:id", async (req, res) => {
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


router.delete("/usuario/:usuarioId", async (req, res) => {
    const usuarioId = req.params.usuarioId;

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




module.exports = router;
