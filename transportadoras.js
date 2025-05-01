const express = require("express");
const router = express.Router();
const conexao = require("./database");
const { autenticarToken } = require("./mildwaretoken");

// Transportadora aceita um pedido e registra entrega
router.post("/aceitar-entrega", autenticarToken, async (req, res) => {
    const id_transportadora = req.usuario.id_usuario; // transportadora autenticada
    const { pedidos_id, endereco, contacto_cliente, filial_retirada_id } = req.body;

    try {
        // Verificar se o pedido já está em entrega
        const [existe] = await conexao.promise().query(
            "SELECT * FROM entregas WHERE pedidos_id = ?",
            [pedidos_id]
        );

        if (existe.length > 0) {
            return res.status(400).json({ mensagem: "Este pedido já está sendo entregue." });
        }

        await conexao.promise().query(
            `INSERT INTO entregas (data_entrega, estado_entrega, pedidos_id, endereco, transportadora, contacto_cliente, transportadora_id, filial_retirada_id)
             VALUES (NOW(), 'em rota', ?, ?, ?, ?, ?, ?)`,
            [
                pedidos_id,
                endereco,
                "Transportadora", // ou buscar o nome com base no id_transportadora
                contacto_cliente,
                id_transportadora,
                filial_retirada_id,
            ]
        );

        res.json({ mensagem: "Entrega registrada com sucesso." });
    } catch (erro) {
        console.error("Erro ao registrar entrega:", erro);
        res.status(500).json({ erro: "Erro ao registrar entrega." });
    }
});

// Listar entregas da transportadora autenticada
router.get("/minhas-entregas", autenticarToken, async (req, res) => {
    const id_transportadora = req.usuario.id_usuario;

    try {
        const [entregas] = await conexao.promise().query(
            `SELECT * FROM entregas 
             WHERE transportadora_id = ?`,
            [id_transportadora]
        );

        res.json({ entregas });
    } catch (erro) {
        console.error("Erro ao buscar entregas:", erro);
        res.status(500).json({ erro: "Erro ao buscar entregas." });
    }
});

// Atualizar o status da entrega
router.put("/entrega/:id_entrega/status", autenticarToken, async (req, res) => {
    const { id_entrega } = req.params;
    const { estado_entrega } = req.body;

    const estadosValidos = ["pendente", "em rota", "aguardando retirada", "entregue"];
    if (!estadosValidos.includes(estado_entrega)) {
        return res.status(400).json({ mensagem: "Estado de entrega inválido." });
    }

    try {
        await conexao.promise().query(
            `UPDATE entregas 
             SET estado_entrega = ? 
             WHERE id_entregas = ?`,
            [estado_entrega, id_entrega]
        );

        res.json({ mensagem: "Status da entrega atualizado com sucesso." });
    } catch (erro) {
        console.error("Erro ao atualizar status da entrega:", erro);
        res.status(500).json({ erro: "Erro ao atualizar status da entrega." });
    }
});

module.exports = router;
