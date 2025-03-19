const express = require("express");
const router = express.Router();
const conexao = require("./database"); 
const { deprecationHandler } = require("moment/moment");

router.use(express.json());





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


router.get("/", async (req, res) => {
    const sql = `
SELECT 
            p.id_pedido AS Numero_Pedido, 
            p.data_pedido AS Data_Pedido,   
            p.estado AS Estado, 
            pag.status_pagamentos, 
            prod.nome AS Nome_Produto, 
            item.quantidade_comprada AS Quantidade_Total, 
            (item.quantidade_comprada * item.preco) AS Valor_Total 
        FROM pedidos p
        LEFT JOIN pagamentos pag ON p.id_pedido = pag.id_pedido
        LEFT JOIN itens_pedido item ON p.id_pedido = item.pedidos_id  
        LEFT JOIN produtos prod ON item.id_produto = prod.id_produtos 
        ;
    `;
    try {
        const [resultados] = await conexao.promise().query(sql);
        
        console.log(resultados);  
        if (resultados.length === 0) {
            return res.status(404).json({ mensagem: "Nenhum pedido encontrado" });
        }

        res.json({ relatorio: resultados });
    } catch (error) {
        console.error(error); 
        res.status(500).json({ mensagem: "Erro ao gerar o relatório geral de pedidos", erro: error });
    }
});


module.exports = router;


















module.exports = router;
