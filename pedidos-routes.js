const express = require("express");
const router = express.Router();
const conexao = require("./database");
const numeroAngola=/^9\d{8}$/

router.use(express.json());

router.get("/", async (req, res) => {
    try {
        const [pedidos] = await conexao.promise().query(`
            SELECT 
                p.id_pedido, p.estado, p.valor_total, p.data_pedido,
                i.id_produto, i.quantidade_comprada, i.preco, i.subtotal,
                u.nome AS nome_usuario
            FROM pedidos p
            LEFT JOIN itens_pedido i ON p.id_pedido = i.pedidos_id
            LEFT JOIN usuarios u ON p.id_usuario = u.id_usuario
            ORDER BY p.data_pedido DESC
        `);

        if (pedidos.length === 0) {
            return res.status(404).json({ message: "Nenhum pedido encontrado." });
        }

       
        const pedidosAgrupados = {};
        pedidos.forEach(pedido => {
            if (!pedidosAgrupados[pedido.id_pedido]) {
                pedidosAgrupados[pedido.id_pedido] = {
                    id_pedido: pedido.id_pedido,
                    estado: pedido.estado,
                    valor_total: pedido.valor_total,
                    data_pedido: pedido.data_pedido,
                    nome_usuario: pedido.nome_usuario, 
                    itens: []
                };
            }
            if (pedido.id_produto) { 
                pedidosAgrupados[pedido.id_pedido].itens.push({
                    id_produto: pedido.id_produto,
                    quantidade_comprada: pedido.quantidade_comprada,
                    preco: pedido.preco,
                    subtotal: pedido.subtotal
                });
            }
        });

        res.status(200).json(Object.values(pedidosAgrupados));

    } catch (error) {
        console.error("Erro ao buscar pedidos:", error);
        res.status(500).json({ message: "Erro ao buscar pedidos", error: error.message });
    }
});
 

router.get("/:id_usuario", async (req, res) => {
    const id_usuario = req.params.id_usuario;

    try {
        const [pedidos] = await conexao.promise().query(`
            SELECT 
                p.id_pedido, p.estado, p.valor_total, p.data_pedido
            FROM pedidos p
            WHERE p.id_usuario = ?
            ORDER BY p.data_pedido DESC
        `, [id_usuario]);

        if (pedidos.length === 0) {
            return res.status(404).json({ message: "Nenhum pedido encontrado para este usuário." });
        }

        res.status(200).json(pedidos);

    } catch (error) {
        console.error("Erro ao buscar pedidos:", error);
        res.status(500).json({ message: "Erro ao buscar pedidos", error: error.message });
    }
});





router.post("/:id", async (req, res) => {
    const id_usuario= req.params.id
    const { estado, valor_total, rua, bairro, pais, municipio, referencia, provincia, numero, itens } = req.body;

    try {
        
        if (!itens || itens.length === 0) {
            return res.status(400).json({ message: "Não há produtos no pedido. Adicione itens antes de finalizar a compra." });
        }

        
        const contactoString = String(numero);
        if (contactoString.length === 0) {
            return res.status(400).json({ message: "É necessário preencher o campo número" });
        }
        if (!numeroAngola.test(contactoString)) {
            return res.status(400).json({ message: "O contacto deve ter 9 dígitos e começar com 9" });
        }

        
        if (!rua || !bairro || !pais || !municipio || !referencia || !provincia || !numero) {
            return res.status(400).json({ message: "Deve preencher os campos de localização" });
        }

        
        const [pedidoresul] = await conexao.promise().query(`
            INSERT INTO pedidos ( id_usuario ,estado, valor_total, data_pedido) VALUES (?, ?,?, NOW())
        `, [ id_usuario ,estado, valor_total]);

        const id_pedido = pedidoresul.insertId;


        await conexao.promise().query(`
            INSERT INTO endereco_pedidos (id_pedido, rua, bairro, pais, municipio, referencia, provincia, numero) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [id_pedido, rua, bairro, pais, municipio, referencia, provincia, numero]);

        
        for (let item of itens) {
            await conexao.promise().query(`
                INSERT INTO itens_pedido (quantidade_comprada, preco, subtotal, pedidos_id, id_produto)
                VALUES (?, ?, ?, ?, ?)
            `, [item.quantidade_comprada, item.preco, item.subtotal, id_pedido, item.id_produto]);
        }

        res.status(201).json({
            message: "Pedido feito com sucesso!",
            id_pedido
        });

    } catch (error) {
        console.error("Erro ao enviar pedido:", error);
        res.status(500).json({ message: "Erro ao enviar pedido", error: error.message });
    }
});






















module.exports = router;
