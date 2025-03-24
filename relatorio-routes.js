const express = require("express");
const router = express.Router();
const conexao = require("./database");

router.use(express.json());

// Relatório do usuário (somente pedidos do usuário logado)
router.get("/:id", async (req, res) => {
    const usuarioId = req.params.id;

    const sql = `
        SELECT 
            p.id_pedido AS Numero_Pedido, 
            p.data_pedido AS Data_Pedido,   
            p.estado AS Estado, 
            pag.status_pagamentos, 
            prod.nome AS Nome_Produto, 
            item.quantidade_comprada AS Quantidade_Total, 
            item.preco AS Preco_Unitario,
            (item.quantidade_comprada * item.preco) AS Valor_Total 
        FROM pedidos p
        LEFT JOIN pagamentos pag ON p.id_pedido = pag.id_pedido
        LEFT JOIN itens_pedido item ON p.id_pedido = item.pedidos_id  
        LEFT JOIN produtos prod ON item.id_produto = prod.id_produtos 
        WHERE p.id_usuario = ?;
    `;

    try {
        const [resultados] = await conexao.promise().query(sql, [usuarioId]);

        if (resultados.length === 0) {
            return res.status(404).json({ mensagem: "Nenhum relatório encontrado para este usuário" });
        }

        res.json({ relatorio: resultados });
    } catch (error) {
        res.status(500).json({ mensagem: "Erro ao gerar o relatório de compras", erro: error });
    }
});

// Relatório geral (somente para o administrador)
router.get("/geral", async (req, res) => {
    // Aqui você deve validar se o usuário é um administrador antes de executar a consulta
    const sql = `
        SELECT 
            p.id_pedido AS Numero_Pedido, 
            p.data_pedido AS Data_Pedido,   
            p.estado AS Estado, 
            u.nome AS Nome_Usuario,
            pag.status_pagamentos, 
            prod.nome AS Nome_Produto, 
            item.quantidade_comprada AS Quantidade_Total, 
            item.preco AS Preco_Unitario,
            (item.quantidade_comprada * item.preco) AS Valor_Total 
        FROM pedidos p
        LEFT JOIN usuarios u ON p.id_usuario = u.id_usuario
        LEFT JOIN pagamentos pag ON p.id_pedido = pag.id_pedido
        LEFT JOIN itens_pedido item ON p.id_pedido = item.pedidos_id  
        LEFT JOIN produtos prod ON item.id_produto = prod.id_produtos;
    `;

    try {
        const [resultados] = await conexao.promise().query(sql);
        
        if (resultados.length === 0) {
            return res.status(404).json({ mensagem: "Nenhum relatório encontrado" });
        }

        res.json({ relatorio_geral: resultados });
    } catch (error) {
        console.error(error);
        res.status(500).json({ mensagem: "Erro ao gerar o relatório geral", erro: error });
    }
});

module.exports = router;
