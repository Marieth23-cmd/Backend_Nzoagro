const express = require("express");
const router = express.Router();
const conexao = require("./database"); 

router.use(express.json());


router.post("/", async (req, res) => {
    const { id_pedido, tipo_pagamento, Total } = req.body;

    if (!id_pedido || !tipo_pagamento || !Total) {
        return res.status(400).json({ mensagem: "Todos os campos são obrigatórios" });
    }

    try {

        const itens_pedido=
        " SELECT  SUM(Item.quantidade * prod.preco) AS Total FROM Itens_pedido Item JOIN produtos prod on p.id_produto= prod.id_produtos  ";


        const sql = "INSERT INTO pagamentos (id_pedido, tipo_pagamento, valor_total) VALUES (?, ?, ?)";
        const [resultado] = await conexao.promise().query(sql, [id_pedido, tipo_pagamento, Total]);

        return res.status(201).json({ mensagem: "Pagamento efetuado com sucesso!" });
    } catch (error) {
        return res.status(500).json({ mensagem: "Erro ao fazer pagamento", erro: error.message });
    }
});





router.get("/:pedidoId", (req, res) => {
    const pedidoId = req.params.pedidoId;
    const sql = "SELECT * FROM pagamentos WHERE pedido_id = ?";
    
    conexao.query(sql, [pedidoId], (erro, resultados) => {
        if (erro) {
            return res.status(500).json({ erro: "Erro ao buscar o pagamento" });
        }
        if (resultados.length === 0) {
            return res.status(404).json({ mensagem: "Pagamento não encontrado para esse pedido" });
        }
        res.json(resultados[0]);
    });
});


router.put("/:pedidoId", (req, res) => {
    const pedidoId = req.params.pedidoId;
    const { status_pagamento } = req.body;
    const sql = "UPDATE pagamentos SET status_pagamento = ? WHERE pedido_id = ?";
    
    conexao.query(sql, [status_pagamento, pedidoId], (erro, resultado) => {
        if (erro) {
            return res.status(500).json({ erro: "Erro ao atualizar o pagamento" });
        }
        if (resultado.affectedRows === 0) {
            return res.status(404).json({ mensagem: "Pedido não encontrado para atualizar o pagamento" });
        }
        res.json({ mensagem: "Status do pagamento atualizado com sucesso" });
    });
});


router.delete("/:id", (req, res) => {
    const pagamentoId = req.params.id;
    const sql = "DELETE FROM pagamentos WHERE id = ?";
    
    conexao.query(sql, [pagamentoId], (erro, resultado) => {
        if (erro) {
            return res.status(500).json({ erro: "Erro ao cancelar o pagamento" });
        }
        if (resultado.affectedRows === 0) {
            return res.status(404).json({ mensagem: "Pagamento não encontrado para cancelar" });
        }
        res.json({ mensagem: "Pagamento cancelado com sucesso" });
    });
});

module.exports = router;
