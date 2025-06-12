const PDFDocument = require("pdfkit");
const { Parser } = require("json2csv");
const express = require("express");
const router = express.Router();
const conexao = require("./database");
const { autenticarToken, autorizarUsuario } = require("./mildwaretoken");

router.use(express.json());

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
            pag.status_pagamento, 
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


// Relatório de vendas para fornecedores/agricultores (suas próprias vendas)
router.get("/vendas/fornecedor", autenticarToken, autorizarUsuario(["Agricultor", "Fornecedor"]), async (req, res) => {
    const { dataInicial, dataFinal } = req.query;
    const fornecedorId = req.usuario.id_usuario;

    let sql = `
        SELECT 
            p.id_pedido AS Numero_Pedido,
            p.data_pedido AS Data_Pedido,
            p.estado AS Estado,
            u.nome AS Nome_Comprador,
            u.email AS Email_Comprador,
            pag.status_pagamentos AS Status_Pagamento,
            prod.nome AS Nome_Produto,
            prod.categoria AS Categoria_Produto,
            item.quantidade_comprada AS Quantidade_Vendida,
            item.preco AS Preco_Unitario,
            (item.quantidade_comprada * item.preco) AS Valor_Total
        FROM pedidos p
        JOIN itens_pedido item ON p.id_pedido = item.pedidos_id
        JOIN produtos prod ON item.id_produto = prod.id_produtos
        LEFT JOIN usuarios u ON p.id_usuario = u.id_usuario
        LEFT JOIN pagamentos pag ON p.id_pedido = pag.id_pedido
        WHERE prod.id_usuario = ?
    `;

    const params = [fornecedorId];

    if (dataInicial && dataFinal) {
        sql += ` AND p.data_pedido BETWEEN ? AND ?`;
        params.push(dataInicial, dataFinal);
    }

    sql += ` ORDER BY p.data_pedido DESC`;

    try {
        const [resultados] = await conexao.promise().query(sql, params);

        if (resultados.length === 0) {
            return res.status(404).json({ mensagem: "Nenhuma venda encontrada neste período." });
        }

        res.json({ relatorio_vendas_fornecedor: resultados });
    } catch (error) {
        console.log(error);
        res.status(500).json({ mensagem: "Erro ao gerar o relatório de vendas do fornecedor", erro: error });
    }
});

// Relatório de compras para compradores
router.get("/compras/comprador", autenticarToken, async (req, res) => {
    const { dataInicial, dataFinal } = req.query;
    const compradorId = req.usuario.id_usuario;

    let sql = `
        SELECT 
            p.id_pedido AS Numero_Pedido,
            p.data_pedido AS Data_Pedido,
            p.estado AS Estado,
            pag.status_pagamento AS Status_Pagamento,
            prod.nome AS Nome_Produto,
            prod.categoria AS Categoria_Produto,
            item.quantidade_comprada AS Quantidade_Comprada,
            item.preco AS Preco_Unitario,
            (item.quantidade_comprada * item.preco) AS Valor_Total,
            vendedor.nome AS Nome_Vendedor,
            vendedor.email AS Email_Vendedor
        FROM pedidos p
        JOIN itens_pedido item ON p.id_pedido = item.pedidos_id
        JOIN produtos prod ON item.id_produto = prod.id_produtos
        LEFT JOIN usuarios vendedor ON prod.id_usuario = vendedor.id_usuario
        LEFT JOIN pagamentos pag ON p.id_pedido = pag.id_pedido
        WHERE p.id_usuario = ?
    `;

    const params = [compradorId];

    if (dataInicial && dataFinal) {
        sql += ` AND p.data_pedido BETWEEN ? AND ?`;
        params.push(dataInicial, dataFinal);
    }

    sql += ` ORDER BY p.data_pedido DESC`;

    try {
        const [resultados] = await conexao.promise().query(sql, params);

        if (resultados.length === 0) {
            return res.status(404).json({ mensagem: "Nenhuma compra encontrada neste período." });
        }

        res.json({ relatorio_compras_comprador: resultados });
    } catch (error) {
        console.log(error);
        res.status(500).json({ mensagem: "Erro ao gerar o relatório de compras do comprador", erro: error });
    }
});

// Estatísticas para fornecedores (suas próprias vendas)
router.get("/estatisticas/vendas/fornecedor", autenticarToken, autorizarUsuario(["Agricultor", "Fornecedor"]), async (req, res) => {
    const fornecedorId = req.usuario.id_usuario;

    try {
        // Estatísticas gerais das vendas do fornecedor
        const [estatisticasGerais] = await conexao.promise().query(`
            SELECT 
                COUNT(DISTINCT p.id_pedido) AS total_pedidos_vendas,
                SUM(item.quantidade_comprada * item.preco) AS receita_total,
                AVG(item.quantidade_comprada * item.preco) AS ticket_medio,
                SUM(item.quantidade_comprada) AS total_itens_vendidos
            FROM pedidos p
            JOIN itens_pedido item ON p.id_pedido = item.pedidos_id
            JOIN produtos prod ON item.id_produto = prod.id_produtos
            WHERE prod.id_usuario = ? AND p.estado IN ('Concluído', 'Entregue')
        `, [fornecedorId]);

        // Produtos mais vendidos do fornecedor
        const [produtosMaisVendidos] = await conexao.promise().query(`
            SELECT 
                prod.nome AS produto,
                SUM(item.quantidade_comprada) AS total_vendido,
                SUM(item.quantidade_comprada * item.preco) AS receita_produto
            FROM pedidos p
            JOIN itens_pedido item ON p.id_pedido = item.pedidos_id
            JOIN produtos prod ON item.id_produto = prod.id_produtos
            WHERE prod.id_usuario = ? AND p.estado IN ('Concluído', 'Entregue')
            GROUP BY prod.id_produtos, prod.nome
            ORDER BY total_vendido DESC
            LIMIT 5
        `, [fornecedorId]);

        // Vendas mensais do fornecedor
        const [vendasMensais] = await conexao.promise().query(`
            SELECT 
                MONTH(p.data_pedido) AS mes,
                YEAR(p.data_pedido) AS ano,
                COUNT(DISTINCT p.id_pedido) AS pedidos_mes,
                SUM(item.quantidade_comprada * item.preco) AS receita_mes
            FROM pedidos p
            JOIN itens_pedido item ON p.id_pedido = item.pedidos_id
            JOIN produtos prod ON item.id_produto = prod.id_produtos
            WHERE prod.id_usuario = ? AND p.estado IN ('Concluído', 'Entregue')
            AND YEAR(p.data_pedido) = YEAR(CURDATE())
            GROUP BY YEAR(p.data_pedido), MONTH(p.data_pedido)
            ORDER BY ano DESC, mes DESC
        `, [fornecedorId]);

        res.json({
            estatisticas_gerais: estatisticasGerais[0],
            produtos_mais_vendidos: produtosMaisVendidos,
            vendas_mensais: vendasMensais
        });
    } catch (error) {
        console.log(error);
        res.status(500).json({ mensagem: "Erro ao buscar estatísticas de vendas do fornecedor", erro: error });
    }
});

// Estatísticas para compradores (suas próprias compras)
router.get("/estatisticas/compras/comprador", autenticarToken, async (req, res) => {
    const compradorId = req.usuario.id_usuario;

    try {
        // Estatísticas gerais das compras do comprador
        const [estatisticasGerais] = await conexao.promise().query(`
            SELECT 
                COUNT(DISTINCT p.id_pedido) AS total_pedidos_compras,
                SUM(item.quantidade_comprada * item.preco) AS gasto_total,
                AVG(item.quantidade_comprada * item.preco) AS gasto_medio_por_pedido,
                SUM(item.quantidade_comprada) AS total_itens_comprados
            FROM pedidos p
            JOIN itens_pedido item ON p.id_pedido = item.pedidos_id
            WHERE p.id_usuario = ?
        `, [compradorId]);

        // Produtos mais comprados pelo comprador
        const [produtosMaisComprados] = await conexao.promise().query(`
            SELECT 
                prod.nome AS produto,
                SUM(item.quantidade_comprada) AS total_comprado,
                SUM(item.quantidade_comprada * item.preco) AS gasto_produto
            FROM pedidos p
            JOIN itens_pedido item ON p.id_pedido = item.pedidos_id
            JOIN produtos prod ON item.id_produto = prod.id_produtos
            WHERE p.id_usuario = ?
            GROUP BY prod.id_produtos, prod.nome
            ORDER BY total_comprado DESC
            LIMIT 5
        `, [compradorId]);

        // Compras mensais do comprador
        const [comprasMensais] = await conexao.promise().query(`
            SELECT 
                MONTH(p.data_pedido) AS mes,
                YEAR(p.data_pedido) AS ano,
                COUNT(DISTINCT p.id_pedido) AS pedidos_mes,
                SUM(item.quantidade_comprada * item.preco) AS gasto_mes
            FROM pedidos p
            JOIN itens_pedido item ON p.id_pedido = item.pedidos_id
            WHERE p.id_usuario = ? AND YEAR(p.data_pedido) = YEAR(CURDATE())
            GROUP BY YEAR(p.data_pedido), MONTH(p.data_pedido)
            ORDER BY ano DESC, mes DESC
        `, [compradorId]);

        // Fornecedores mais comprados
        const [fornecedoresFavoritos] = await conexao.promise().query(`
            SELECT 
                vendedor.nome AS fornecedor,
                COUNT(DISTINCT p.id_pedido) AS pedidos_fornecedor,
                SUM(item.quantidade_comprada * item.preco) AS gasto_fornecedor
            FROM pedidos p
            JOIN itens_pedido item ON p.id_pedido = item.pedidos_id
            JOIN produtos prod ON item.id_produto = prod.id_produtos
            JOIN usuarios vendedor ON prod.id_usuario = vendedor.id_usuario
            WHERE p.id_usuario = ?
            GROUP BY vendedor.id_usuario, vendedor.nome
            ORDER BY gasto_fornecedor DESC
            LIMIT 5
        `, [compradorId]);

        res.json({
            estatisticas_gerais: estatisticasGerais[0],
            produtos_mais_comprados: produtosMaisComprados,
            compras_mensais: comprasMensais,
            fornecedores_favoritos: fornecedoresFavoritos
        });
    } catch (error) {
        console.log(error);
        res.status(500).json({ mensagem: "Erro ao buscar estatísticas de compras do comprador", erro: error });
    }
});

// Relatório de vendas geral (somente para admin)
router.get("/vendas", autenticarToken, autorizarUsuario(["Administrador"]), async (req, res) => {
    const { dataInicial, dataFinal } = req.query;

    let sql = `
        SELECT 
            p.id_pedido AS Numero_Pedido,
            p.data_pedido AS Data_Pedido,
            p.estado AS Estado,
            u.nome AS Nome_Usuario,
            u.email AS Email_Usuario,
            pag.status_pagamento AS Status_Pagamento,
            prod.nome AS Nome_Produto,
            prod.categoria AS Categoria_Produto,
            item.quantidade_comprada AS Quantidade_Vendida,
            item.preco AS Preco_Unitario,
            (item.quantidade_comprada * item.preco) AS Valor_Total,
            vendedor.nome AS Nome_Vendedor
        FROM pedidos p
        LEFT JOIN usuarios u ON p.id_usuario = u.id_usuario
        LEFT JOIN pagamentos pag ON p.id_pedido = pag.id_pedido
        LEFT JOIN itens_pedido item ON p.id_pedido = item.pedidos_id
        LEFT JOIN produtos prod ON item.id_produto = prod.id_produtos
        LEFT JOIN usuarios vendedor ON prod.id_usuario = vendedor.id_usuario
    `;

    const params = [];

    // Adiciona filtro de data se fornecido
    if (dataInicial && dataFinal) {
        sql += ` WHERE p.data_pedido BETWEEN ? AND ?`;
        params.push(dataInicial, dataFinal);
    }

    sql += ` ORDER BY p.data_pedido DESC`;

    try {
        const [resultados] = await conexao.promise().query(sql, params);

        if (resultados.length === 0) {
            return res.status(404).json({ mensagem: "Nenhum relatório de vendas encontrado neste período." });
        }

        res.json({ relatorio_vendas: resultados });
    } catch (error) {
        console.log(error);
        res.status(500).json({ mensagem: "Erro ao gerar o relatório de vendas", erro: error });
    }
});

// Estatísticas de vendas (somente para admin)
router.get("/estatisticas/vendas", autenticarToken, autorizarUsuario(["Administrador"]), async (req, res) => {
    try {
        // Estatísticas gerais de vendas
        const [estatisticasGerais] = await conexao.promise().query(`
            SELECT 
                COUNT(DISTINCT p.id_pedido) AS total_pedidos_vendas,
                SUM(item.quantidade_comprada * item.preco) AS receita_total,
                AVG(item.quantidade_comprada * item.preco) AS ticket_medio,
                SUM(item.quantidade_comprada) AS total_itens_vendidos
            FROM pedidos p
            JOIN itens_pedido item ON p.id_pedido = item.pedidos_id
            WHERE p.estado IN ('Concluído', 'Entregue')
        `);

        // Vendas por categoria
        const [vendasPorCategoria] = await conexao.promise().query(`
            SELECT 
                prod.categoria,
                COUNT(DISTINCT p.id_pedido) AS pedidos_categoria,
                SUM(item.quantidade_comprada * item.preco) AS receita_categoria,
                SUM(item.quantidade_comprada) AS itens_vendidos_categoria
            FROM pedidos p
            JOIN itens_pedido item ON p.id_pedido = item.pedidos_id
            JOIN produtos prod ON item.id_produto = prod.id_produtos
            WHERE p.estado IN ('Concluído', 'Entregue')
            GROUP BY prod.categoria
            ORDER BY receita_categoria DESC
        `);

        // Vendas mensais do ano atual
        const [vendasMensais] = await conexao.promise().query(`
            SELECT 
                MONTH(p.data_pedido) AS mes,
                YEAR(p.data_pedido) AS ano,
                COUNT(DISTINCT p.id_pedido) AS pedidos_mes,
                SUM(item.quantidade_comprada * item.preco) AS receita_mes
            FROM pedidos p
            JOIN itens_pedido item ON p.id_pedido = item.pedidos_id
            WHERE p.estado IN ('Concluído', 'Entregue') 
            AND YEAR(p.data_pedido) = YEAR(CURDATE())
            GROUP BY YEAR(p.data_pedido), MONTH(p.data_pedido)
            ORDER BY ano DESC, mes DESC
        `);

        // Top 5 produtos mais vendidos
        const [topProdutos] = await conexao.promise().query(`
            SELECT 
                prod.nome AS produto,
                SUM(item.quantidade_comprada) AS total_vendido,
                SUM(item.quantidade_comprada * item.preco) AS receita_produto
            FROM pedidos p
            JOIN itens_pedido item ON p.id_pedido = item.pedidos_id
            JOIN produtos prod ON item.id_produto = prod.id_produtos
            WHERE p.estado IN ('Concluído', 'Entregue')
            GROUP BY prod.id_produtos, prod.nome
            ORDER BY total_vendido DESC
            LIMIT 5
        `);

        // Top 5 vendedores
        const [topVendedores] = await conexao.promise().query(`
            SELECT 
                vendedor.nome AS vendedor,
                COUNT(DISTINCT p.id_pedido) AS pedidos_vendedor,
                SUM(item.quantidade_comprada * item.preco) AS receita_vendedor
            FROM pedidos p
            JOIN itens_pedido item ON p.id_pedido = item.pedidos_id
            JOIN produtos prod ON item.id_produto = prod.id_produtos
            JOIN usuarios vendedor ON prod.id_usuario = vendedor.id_usuario
            WHERE p.estado IN ('Concluído', 'Entregue')
            GROUP BY vendedor.id_usuario, vendedor.nome
            ORDER BY receita_vendedor DESC
            LIMIT 5
        `);

        res.json({
            estatisticas_gerais: estatisticasGerais[0],
            vendas_por_categoria: vendasPorCategoria,
            vendas_mensais: vendasMensais,
            top_produtos: topProdutos,
            top_vendedores: topVendedores
        });
    } catch (error) {
        console.log(error);
        res.status(500).json({ mensagem: "Erro ao buscar estatísticas de vendas", erro: error });
    }
});

// Exportar relatório de vendas do fornecedor como PDF
router.get("/exportar/vendas/fornecedor/pdf", autenticarToken, autorizarUsuario(["Agricultor", "Fornecedor"]), async (req, res) => {
    const fornecedorId = req.usuario.id_usuario;
    
    const sql = `
        SELECT 
            p.id_pedido AS Numero_Pedido,
            p.data_pedido AS Data_Pedido,
            p.estado AS Estado,
            u.nome AS Nome_Comprador,
            prod.nome AS Nome_Produto,
            item.quantidade_comprada AS Quantidade_Vendida,
            item.preco AS Preco_Unitario,
            (item.quantidade_comprada * item.preco) AS Valor_Total
        FROM pedidos p
        JOIN itens_pedido item ON p.id_pedido = item.pedidos_id
        JOIN produtos prod ON item.id_produto = prod.id_produtos
        LEFT JOIN usuarios u ON p.id_usuario = u.id_usuario
        WHERE prod.id_usuario = ?
        ORDER BY p.data_pedido DESC
    `;

    try {
        const [resultados] = await conexao.promise().query(sql, [fornecedorId]);

        if (resultados.length === 0) {
            return res.status(404).json({ mensagem: "Nenhuma venda encontrada" });
        }

        const doc = new PDFDocument();
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", "attachment;filename=minhas_vendas.pdf");
        
        doc.pipe(res);
        doc.fontSize(18).text("Relatório de Minhas Vendas", { align: "center" });
        doc.moveDown();
        doc.fontSize(12).text(`Gerado em: ${new Date().toLocaleDateString('pt-BR')}`, { align: "center" });
        doc.moveDown(2);

        let yPosition = 150;
        doc.fontSize(10);

        resultados.forEach((item) => {
            if (yPosition > 700) {
                doc.addPage();
                yPosition = 50;
            }

            doc.text(`Pedido: ${item.Numero_Pedido}`, 50, yPosition);
            doc.text(`Data: ${new Date(item.Data_Pedido).toLocaleDateString('pt-BR')}`, 150, yPosition);
            doc.text(`Comprador: ${item.Nome_Comprador}`, 300, yPosition);
            
            yPosition += 15;
            
            doc.text(`Produto: ${item.Nome_Produto}`, 50, yPosition);
            doc.text(`Qtd: ${item.Quantidade_Vendida}`, 300, yPosition);
            doc.text(`Preço: kz(s) ${parseFloat(item.Preco_Unitario).toFixed(2)}`, 350, yPosition);
            doc.text(`Total: kz(s) ${parseFloat(item.Valor_Total).toFixed(2)}`, 450, yPosition);

            yPosition += 20;
            doc.moveTo(50, yPosition).lineTo(550, yPosition).stroke();
            yPosition += 10;
        });

        doc.end();
    } catch (error) {
        console.log(error);
        res.status(500).json({ mensagem: "Erro ao gerar PDF de vendas do fornecedor", erro: error });
    }
});

// Exportar relatório de vendas do fornecedor como CSV
router.get("/exportar/vendas/fornecedor/csv", autenticarToken, autorizarUsuario(["Agricultor", "Fornecedor"]), async (req, res) => {
    const fornecedorId = req.usuario.id_usuario;
    
    const sql = `
        SELECT 
            p.id_pedido AS Numero_Pedido,
            p.data_pedido AS Data_Pedido,
            p.estado AS Estado,
            u.nome AS Nome_Comprador,
            u.email AS Email_Comprador,
            prod.nome AS Nome_Produto,
            prod.categoria AS Categoria_Produto,
            item.quantidade_comprada AS Quantidade_Vendida,
            item.preco AS Preco_Unitario,
            (item.quantidade_comprada * item.preco) AS Valor_Total
        FROM pedidos p
        JOIN itens_pedido item ON p.id_pedido = item.pedidos_id
        JOIN produtos prod ON item.id_produto = prod.id_produtos
        LEFT JOIN usuarios u ON p.id_usuario = u.id_usuario
        WHERE prod.id_usuario = ?
        ORDER BY p.data_pedido DESC
    `;

    try {
        const [resultados] = await conexao.promise().query(sql, [fornecedorId]);

        if (resultados.length === 0) {
            return res.status(404).json({ mensagem: "Nenhuma venda encontrada" });
        }

        const parser = new Parser();
        const csv = parser.parse(resultados);

        res.header('Content-Type', 'text/csv');
        res.attachment('minhas_vendas.csv');
        res.send(csv);
    } catch (error) {
        console.log(error);
        res.status(500).json({ mensagem: "Erro ao gerar CSV de vendas do fornecedor", erro: error });
    }
});

// Exportar relatório de compras do comprador como PDF
router.get("/exportar/compras/comprador/pdf", autenticarToken, async (req, res) => {
    const compradorId = req.usuario.id_usuario;
    
    const sql = `
        SELECT 
            p.id_pedido AS Numero_Pedido,
            p.data_pedido AS Data_Pedido,
            p.estado AS Estado,
            prod.nome AS Nome_Produto,
            item.quantidade_comprada AS Quantidade_Comprada,
            item.preco AS Preco_Unitario,
            (item.quantidade_comprada * item.preco) AS Valor_Total,
            vendedor.nome AS Nome_Vendedor
        FROM pedidos p
        JOIN itens_pedido item ON p.id_pedido = item.pedidos_id
        JOIN produtos prod ON item.id_produto = prod.id_produtos
        LEFT JOIN usuarios vendedor ON prod.id_usuario = vendedor.id_usuario
        WHERE p.id_usuario = ?
        ORDER BY p.data_pedido DESC
    `;

    try {
        const [resultados] = await conexao.promise().query(sql, [compradorId]);

        if (resultados.length === 0) {
            return res.status(404).json({ mensagem: "Nenhuma compra encontrada" });
        }

        const doc = new PDFDocument();
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", "attachment;filename=minhas_compras.pdf");
        
        doc.pipe(res);
        doc.fontSize(18).text("Relatório de Minhas Compras", { align: "center" });
        doc.moveDown();
        doc.fontSize(12).text(`Gerado em: ${new Date().toLocaleDateString('pt-BR')}`, { align: "center" });
        doc.moveDown(2);

        let yPosition = 150;
        doc.fontSize(10);

        resultados.forEach((item) => {
            if (yPosition > 700) {
                doc.addPage();
                yPosition = 50;
            }

            doc.text(`Pedido: ${item.Numero_Pedido}`, 50, yPosition);
            doc.text(`Data: ${new Date(item.Data_Pedido).toLocaleDateString('pt-BR')}`, 150, yPosition);
            doc.text(`Vendedor: ${item.Nome_Vendedor}`, 300, yPosition);
            
            yPosition += 15;
            
            doc.text(`Produto: ${item.Nome_Produto}`, 50, yPosition);
            doc.text(`Qtd: ${item.Quantidade_Comprada}`, 300, yPosition);
            doc.text(`Preço: kz(s) ${parseFloat(item.Preco_Unitario).toFixed(2)}`, 350, yPosition);
            doc.text(`Total: kz(s) ${parseFloat(item.Valor_Total).toFixed(2)}`, 450, yPosition);

            yPosition += 20;
            doc.moveTo(50, yPosition).lineTo(550, yPosition).stroke();
            yPosition += 10;
        });

        doc.end();
    } catch (error) {
        console.log(error);
        res.status(500).json({ mensagem: "Erro ao gerar PDF de compras do comprador", erro: error });
    }
});

// Exportar relatório de compras do comprador como CSV
router.get("/exportar/compras/comprador/csv", autenticarToken, async (req, res) => {
    const compradorId = req.usuario.id_usuario;
    
    const sql = `
        SELECT 
            p.id_pedido AS Numero_Pedido,
            p.data_pedido AS Data_Pedido,
            p.estado AS Estado,
            prod.nome AS Nome_Produto,
            prod.categoria AS Categoria_Produto,
            item.quantidade_comprada AS Quantidade_Comprada,
            item.preco AS Preco_Unitario,
            (item.quantidade_comprada * item.preco) AS Valor_Total,
            vendedor.nome AS Nome_Vendedor,
            vendedor.email AS Email_Vendedor
        FROM pedidos p
        JOIN itens_pedido item ON p.id_pedido = item.pedidos_id
        JOIN produtos prod ON item.id_produto = prod.id_produtos
        LEFT JOIN usuarios vendedor ON prod.id_usuario = vendedor.id_usuario
        WHERE p.id_usuario = ?
        ORDER BY p.data_pedido DESC
    `;

    try {
        const [resultados] = await conexao.promise().query(sql, [compradorId]);

        if (resultados.length === 0) {
            return res.status(404).json({ mensagem: "Nenhuma compra encontrada" });
        }

        const parser = new Parser();
        const csv = parser.parse(resultados);

        res.header('Content-Type', 'text/csv');
        res.attachment('minhas_compras.csv');
        res.send(csv);
    } catch (error) {
        console.log(error);
        res.status(500).json({ mensagem: "Erro ao gerar CSV de compras do comprador", erro: error });
    }
});

// Exportar Relatório de Vendas como PDF
router.get("/exportar/vendas/pdf", autenticarToken, autorizarUsuario(["Administrador"]), async (req, res) => {
    const sql = `
        SELECT 
            p.id_pedido AS Numero_Pedido,
            p.data_pedido AS Data_Pedido,
            p.estado AS Estado,
            u.nome AS Nome_Usuario,
            pag.status_pagamentos AS Status_Pagamento,
            prod.nome AS Nome_Produto,
            item.quantidade_comprada AS Quantidade_Vendida,
            item.preco AS Preco_Unitario,
            (item.quantidade_comprada * item.preco) AS Valor_Total,
            vendedor.nome AS Nome_Vendedor
        FROM pedidos p
        LEFT JOIN usuarios u ON p.id_usuario = u.id_usuario
        LEFT JOIN pagamentos pag ON p.id_pedido = pag.id_pedido
        LEFT JOIN itens_pedido item ON p.id_pedido = item.pedidos_id
        LEFT JOIN produtos prod ON item.id_produto = prod.id_produtos
        LEFT JOIN usuarios vendedor ON prod.id_usuario = vendedor.id_usuario
        ORDER BY p.data_pedido DESC;
    `;

    try {
        const [resultados] = await conexao.promise().query(sql);

        if (resultados.length === 0) {
            return res.status(404).json({ mensagem: "Nenhum relatório de vendas encontrado" });
        }

        const doc = new PDFDocument();
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", "attachment;filename=relatorio_vendas.pdf");
        
        doc.pipe(res);
        
        // Título do relatório
        doc.fontSize(18).text("Relatório de Vendas", { align: "center" });
        doc.moveDown();
        doc.fontSize(12).text(`Gerado em: ${new Date().toLocaleDateString('pt-BR')}`, { align: "center" });
        doc.moveDown(2);

        // Cabeçalho da tabela
        doc.fontSize(10);
        let yPosition = 150;

        // Adicionar dados
        resultados.forEach((item, index) => {
            if (yPosition > 700) { // Nova página se necessário
                doc.addPage();
                yPosition = 50;
            }

            doc.text(`Pedido: ${item.Numero_Pedido}`, 50, yPosition);
            doc.text(`Data: ${new Date(item.Data_Pedido).toLocaleDateString('pt-BR')}`, 150, yPosition);
            doc.text(`Cliente: ${item.Nome_Usuario}`, 250, yPosition);
            doc.text(`Vendedor: ${item.Nome_Vendedor || 'N/A'}`, 400, yPosition);
            
            yPosition += 15;
            
            doc.text(`Produto: ${item.Nome_Produto}`, 50, yPosition);
            doc.text(`Qtd: ${item.Quantidade_Vendida}`, 300, yPosition);
            doc.text(`Preço: kz(s) ${parseFloat(item.Preco_Unitario).toFixed(2)}`, 350, yPosition);
            doc.text(`Total: kz(s) ${parseFloat(item.Valor_Total).toFixed(2)}`, 450, yPosition);

            yPosition += 20;
            doc.moveTo(50, yPosition).lineTo(550, yPosition).stroke(); // Linha separadora
            yPosition += 10;
        });

        doc.end();
    } catch (error) {
        console.log(error);
        res.status(500).json({ mensagem: "Erro ao gerar PDF de vendas", erro: error });
    }
});

// Exportar Relatório de Vendas como CSV
router.get("/exportar/vendas/csv", autenticarToken, autorizarUsuario(["Administrador"]), async (req, res) => {
    const sql = `
        SELECT 
            p.id_pedido AS Numero_Pedido,
            p.data_pedido AS Data_Pedido,
            p.estado AS Estado,
            u.nome AS Nome_Usuario,
            u.email AS Email_Usuario,
            pag.status_pagamentos AS Status_Pagamento,
            prod.nome AS Nome_Produto,
            prod.categoria AS Categoria_Produto,
            item.quantidade_comprada AS Quantidade_Vendida,
            item.preco AS Preco_Unitario,
            (item.quantidade_comprada * item.preco) AS Valor_Total,
            vendedor.nome AS Nome_Vendedor
        FROM pedidos p
        LEFT JOIN usuarios u ON p.id_usuario = u.id_usuario
        LEFT JOIN pagamentos pag ON p.id_pedido = pag.id_pedido
        LEFT JOIN itens_pedido item ON p.id_pedido = item.pedidos_id
        LEFT JOIN produtos prod ON item.id_produto = prod.id_produtos
        LEFT JOIN usuarios vendedor ON prod.id_usuario = vendedor.id_usuario
        ORDER BY p.data_pedido DESC;
    `;

    try {
        const [resultados] = await conexao.promise().query(sql);

        if (resultados.length === 0) {
            return res.status(404).json({ mensagem: "Nenhum relatório de vendas encontrado" });
        }

        const parser = new Parser();
        const csv = parser.parse(resultados);

        res.header('Content-Type', 'text/csv');
        res.attachment('relatorio_vendas.csv');
        res.send(csv);
    } catch (error) {
        console.log(error);
        res.status(500).json({ mensagem: "Erro ao gerar CSV de vendas", erro: error });
    }
});

// Atualizar status do pedido (para o endpoint que você tem no frontend)
// Você pode adicionar isso em um arquivo separado de pedidos se preferir
router.put("/pedidos/:pedidoId/status", autenticarToken, autorizarUsuario(["Administrador", "Agricultor", "Fornecedor"]), async (req, res) => {
    const { pedidoId } = req.params;
    const { status } = req.body;
    const usuarioId = req.usuario.id_usuario;
    const tipoUsuario = req.usuario.tipo_usuario;

    // Validar status permitidos
    const statusPermitidos = ['Pendente', 'Confirmado', 'Preparando', 'Enviado', 'Entregue', 'Cancelado', 'Concluído'];
    
    if (!statusPermitidos.includes(status)) {
        return res.status(400).json({ mensagem: "Status inválido" });
    }

    try {
        // Verificar se o pedido existe
        const [pedidoExistente] = await conexao.promise().query(
            "SELECT id_pedido, id_usuario, estado FROM pedidos WHERE id_pedido = ?",
            [pedidoId]
        );

        if (pedidoExistente.length === 0) {
            return res.status(404).json({ mensagem: "Pedido não encontrado" });
        }

        // Se não for admin, verificar se o usuário tem permissão para alterar o pedido
        if (tipoUsuario !== 'Administrador') {
            // Verificar se o usuário é o vendedor de algum produto do pedido
            const [produtosVendedor] = await conexao.promise().query(`
                SELECT COUNT(*) as count 
                FROM itens_pedido ip 
                JOIN produtos p ON ip.id_produto = p.id_produtos 
                WHERE ip.pedidos_id = ? AND p.id_usuario = ?
            `, [pedidoId, usuarioId]);

            if (produtosVendedor[0].count === 0) {
                return res.status(403).json({ mensagem: "Você não tem permissão para alterar este pedido" });
            }
        }

        // Atualizar o status do pedido
        const [resultado] = await conexao.promise().query(
            "UPDATE pedidos SET estado = ?, data_atualizacao = NOW() WHERE id_pedido = ?",
            [status, pedidoId]
        );

        if (resultado.affectedRows === 0) {
            return res.status(500).json({ mensagem: "Erro ao atualizar status do pedido" });
        }

        // Buscar o pedido atualizado para retornar
        const [pedidoAtualizado] = await conexao.promise().query(
            "SELECT id_pedido, estado, data_pedido, data_atualizacao FROM pedidos WHERE id_pedido = ?",
            [pedidoId]
        );

        res.json({ 
            mensagem: "Status do pedido atualizado com sucesso",
            pedido: pedidoAtualizado[0]
        });
    } catch (error) {
        console.log(error);
        res.status(500).json({ mensagem: "Erro ao atualizar status do pedido", erro: error });
    }
});

module.exports = router;
