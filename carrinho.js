const express = require("express");
const router = express.Router();
const conexao = require("./database");
const { autenticarToken } = require("./mildwaretoken");

// 1️⃣ Adicionar produto ao carrinho
router.post("/adicionar", autenticarToken, async (req, res) => {
    const { id_usuario, id_produto, quantidade } = req.body;

    try {
        // Verificar se o carrinho já existe para o usuário
        let [carrinho] = await conexao.promise().query(
            "SELECT id_carrinho FROM carrinho WHERE id_usuario = ?",
            [id_usuario]
        );

        let id_carrinho;
        if (carrinho.length === 0) {
            // Criar um novo carrinho para o usuário
            const [novoCarrinho] = await conexao.promise().query(
                "INSERT INTO carrinho (id_usuario) VALUES (?)",
                [id_usuario]
            );
            id_carrinho = novoCarrinho.insertId;
        } else {
            id_carrinho = carrinho[0].id_carrinho;
        }

        // Verificar se o produto já está no carrinho
        const [produtoExiste] = await conexao.promise().query(
            "SELECT * FROM carrinho_itens WHERE id_carrinho = ? AND id_produto = ?",
            [id_carrinho, id_produto]
        );

        if (produtoExiste.length > 0) {
            // Se o produto já estiver no carrinho, atualizar a quantidade
            await conexao.promise().query(
                "UPDATE carrinho_itens SET quantidade = quantidade + ? WHERE id_carrinho = ? AND id_produto = ?",
                [quantidade, id_carrinho, id_produto]
            );
        } else {
            // Se não, adicionar o produto ao carrinho
            await conexao.promise().query(
                "INSERT INTO carrinho_itens (id_carrinho, id_produto, quantidade) VALUES (?, ?, ?)",
                [id_carrinho, id_produto, quantidade]
            );
        }

        res.json({ mensagem: "Produto adicionado ao carrinho." });
    } catch (erro) {
        console.error("Erro ao adicionar produto ao carrinho:", erro);
        res.status(500).json({ erro: "Erro ao adicionar produto ao carrinho." });
    }
});

// 2️⃣ Listar os produtos do carrinho de um usuário
router.get("/:id_usuario", autenticarToken, async (req, res) => {
    const { id_usuario } = req.params;

    try {
        const [carrinho] = await conexao.promise().query(
            "SELECT id_carrinho FROM carrinho WHERE id_usuario = ?",
            [id_usuario]
        );

        if (carrinho.length === 0) {
            return res.json({ mensagem: "Carrinho vazio.", produtos: [] });
        }

        const id_carrinho = carrinho[0].id_carrinho;

        const [produtos] = await conexao.promise().query(
            `SELECT p.id, p.nome, p.preco, p.imagem, ci.quantidade 
             FROM carrinho_itens ci 
             JOIN produtos p ON ci.id_produto = p.id 
             WHERE ci.id_carrinho = ?`,
            [id_carrinho]
        );

        res.json({ produtos });
    } catch (erro) {
        console.error("Erro ao buscar produtos do carrinho:", erro);
        res.status(500).json({ erro: "Erro ao buscar produtos do carrinho." });
    }
});

// 3️⃣ Remover um produto específico do carrinho
router.delete("/remover/:id_usuario/:id_produto", autenticarToken, async (req, res) => {
    const { id_usuario, id_produto } = req.params;

    try {
        const [carrinho] = await conexao.promise().query(
            "SELECT id_carrinho FROM carrinho WHERE id_usuario = ?",
            [id_usuario]
        );

        if (carrinho.length === 0) {
            return res.status(404).json({ mensagem: "Carrinho não encontrado." });
        }

        const id_carrinho = carrinho[0].id_carrinho;

        const [produto] = await conexao.promise().query(
            "SELECT * FROM carrinho_itens WHERE id_carrinho = ? AND id_produto = ?",
            [id_carrinho, id_produto]
        );

        if (produto.length === 0) {
            return res.status(404).json({ mensagem: "Produto não encontrado no carrinho." });
        }

        await conexao.promise().query(
            "DELETE FROM carrinho_itens WHERE id_carrinho = ? AND id_produto = ?",
            [id_carrinho, id_produto]
        );

        res.json({ mensagem: "Produto removido do carrinho." });
    } catch (erro) {
        console.error("Erro ao remover produto do carrinho:", erro);
        res.status(500).json({ erro: "Erro ao remover produto do carrinho." });
    }
});

// 4️⃣ Esvaziar o carrinho
router.delete("/esvaziar/:id_usuario", autenticarToken, async (req, res) => {
    const { id_usuario } = req.params;

    try {
        const [carrinho] = await conexao.promise().query(
            "SELECT id_carrinho FROM carrinho WHERE id_usuario = ?",
            [id_usuario]
        );

        if (carrinho.length === 0) {
            return res.json({ mensagem: "Carrinho já está vazio." });
        }

        const id_carrinho = carrinho[0].id_carrinho;

        await conexao.promise().query(
            "DELETE FROM carrinho_itens WHERE id_carrinho = ?",
            [id_carrinho]
        );

        res.json({ mensagem: "Carrinho esvaziado com sucesso." });
    } catch (erro) {
        console.error("Erro ao esvaziar o carrinho:", erro);
        res.status(500).json({ erro: "Erro ao esvaziar o carrinho." });
    }
});

// 5️⃣ Atualizar a quantidade de um produto no carrinho
router.put("/atualizar/:id_usuario/:id_produto", autenticarToken, async (req, res) => {
    const { id_usuario, id_produto } = req.params;
    const { quantidade } = req.body;

    if (quantidade < 1) {
        return res.status(400).json({ mensagem: "A quantidade deve ser maior que zero." });
    }

    try {
        const [carrinho] = await conexao.promise().query(
            "SELECT id_carrinho FROM carrinho WHERE id_usuario = ?",
            [id_usuario]
        );

        if (carrinho.length === 0) {
            return res.status(404).json({ mensagem: "Carrinho não encontrado." });
        }

        const id_carrinho = carrinho[0].id_carrinho;

        const [produto] = await conexao.promise().query(
            "SELECT * FROM carrinho_itens WHERE id_carrinho = ? AND id_produto = ?",
            [id_carrinho, id_produto]
        );

        if (produto.length === 0) {
            return res.status(404).json({ mensagem: "Produto não encontrado no carrinho." });
        }

        await conexao.promise().query(
            "UPDATE carrinho_itens SET quantidade = ? WHERE id_carrinho = ? AND id_produto = ?",
            [quantidade, id_carrinho, id_produto]
        );

        res.json({ mensagem: "Quantidade atualizada com sucesso." });
    } catch (erro) {
        console.error("Erro ao atualizar quantidade:", erro);
        res.status(500).json({ erro: "Erro ao atualizar quantidade." });
    }
});

module.exports = router;
