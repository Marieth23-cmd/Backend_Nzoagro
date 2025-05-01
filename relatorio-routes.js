const PDFDocument = require("pdfkit");
const { Parser } = require("json2csv");
const express = require("express");
const router = express.Router();
const conexao = require("./database");
const { autenticarToken, autorizarUsuario } = require("./mildwaretoken");

router.use(express.json());

// Relatório do usuário (somente pedidos do usuário logado)
router.get("/usuario", autenticarToken, async (req, res) => {
    const usuarioId = req.usuario.id_usuario;
    const { dataInicio, dataFim } = req.query;

    let filtrosData = "";
    let valores = [usuarioId];

    if (dataInicio && dataFim) {
        filtrosData = " AND p.data_pedido BETWEEN ? AND ?";
        valores.push(dataInicio, dataFim);
    }

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
        WHERE p.id_usuario = ? ${filtrosData};
    `;

    try {
        const [resultados] = await conexao.promise().query(sql, valores);

        if (resultados.length === 0) {
            return res.status(404).json({ mensagem: "Nenhum relatório encontrado para este usuário" });
        }

        res.json({ relatorio: resultados });
    } catch (error) {
        res.status(500).json({ mensagem: "Erro ao gerar o relatório de compras", erro: error });
    }
});

router.get("/estatisticas", autenticarToken,async (req, res) => {
    try {
        const [estatisticas] = await conexao.promise().query(`
            SELECT 
                COUNT(DISTINCT p.id_pedido) AS total_pedidos,
                SUM(item.quantidade_comprada * item.preco) AS total_gasto,
                AVG(item.quantidade_comprada * item.preco) AS media_por_pedido
            FROM pedidos p
            JOIN itens_pedido item ON p.id_pedido = item.pedidos_id
        `);

        const [produtores] = await conexao.promise().query(`
            SELECT 
                COUNT(DISTINCT u.id_usuario) AS total_produtores
            FROM usuarios u
            WHERE u.tipo_usuario IN ('Agricultor', 'Fornecedor')
        `);

        const [mensal] = await conexao.promise().query(`
            SELECT 
                MONTH(p.data_pedido) AS mes,
                SUM(item.quantidade_comprada * item.preco) AS total_mes
            FROM pedidos p
            JOIN itens_pedido item ON p.id_pedido = item.pedidos_id
            GROUP BY MONTH(p.data_pedido)
            ORDER BY mes
        `);

        res.json({
            estatisticas: estatisticas[0],
            total_produtores: produtores[0].total_produtores,
            por_mes: mensal
        });
    } catch (error) {
        console.log(error);
        res.status(500).json({ mensagem: "Erro ao buscar estatísticas", erro: error });
    }
});

// Relatório geral com filtros de data (somente para o administrador)
router.get("/geral", autenticarToken, autorizarUsuario(["Administrador"]), async (req, res) => {
    const { dataInicio, dataFim } = req.query;

    let sql = `
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
        LEFT JOIN produtos prod ON item.id_produto = prod.id_produtos
    `;

    const params = [];

    // Adiciona cláusula WHERE se houver filtro de data
    if (dataInicio && dataFim) {
        sql += ` WHERE p.data_pedido BETWEEN ? AND ?`;
        params.push(dataInicio, dataFim);
    }

    try {
        const [resultados] = await conexao.promise().query(sql, params);

        if (resultados.length === 0) {
            return res.status(404).json({ mensagem: "Nenhum relatório encontrado neste período." });
        }

        res.json({ relatorio_geral: resultados });
    } catch (error) {
        console.log(error);
        res.status(500).json({ mensagem: "Erro ao gerar o relatório geral", erro: error });
    }
});


// Exportar Relatório como PDF
router.get("/exportar/pdf", autenticarToken, async (req, res) => {
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

        const doc = new PDFDocument();
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", "attachment;filename=relatorio.pdf");
        
        doc.pipe(res);
        doc.fontSize(12).text("Relatório de Pedidos", { align: "center" });

        // Adicionar conteúdo ao PDF
        resultados.forEach((item, index) => {
            doc.text(`Pedido #${item.Numero_Pedido}`, { align: "left" });
            doc.text(`Data: ${item.Data_Pedido}`, { align: "left" });
            doc.text(`Produto: ${item.Nome_Produto}`, { align: "left" });
            doc.text(`Quantidade: ${item.Quantidade_Total}`, { align: "left" });
            doc.text(`Preço Unitário: ${item.Preco_Unitario}`, { align: "left" });
            doc.text(`Total: ${item.Valor_Total}`, { align: "left" });
        });

        doc.end();
    } catch (error) {
        console.log(error);
        res.status(500).json({ mensagem: "Erro ao gerar PDF", erro: error });
    }
});

// Exportar Relatório como CSV
router.get("/exportar/csv", autenticarToken,async (req, res) => {
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

        const parser = new Parser();
        const csv = parser.parse(resultados);

        res.header('Content-Type', 'text/csv');
        res.attachment('relatorio.csv');
        res.send(csv);
    } catch (error) {
        console.log(error);
        res.status(500).json({ mensagem: "Erro ao gerar CSV", erro: error });
    }
});





module.exports = router;
