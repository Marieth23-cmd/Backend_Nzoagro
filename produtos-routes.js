const express = require("express");
const router = express.Router();
const conexao = require("./database"); 

router.use(express.json());


router.post("/:id_usuario/produtos", async (req, res) => {
    try {
       // console.log("Dados recebidos no body:", req.body); 

        const { nome, descricao, preco, quantidade, foto_produto, categoria } = req.body;
        const { id_usuario } = req.params;

        if (!nome || !id_usuario || !categoria ||!quantidade || !preco) {
            return res.status(400).json({ erro: "Os campos nome, id_usuario e categoria são obrigatórios." });
        }

        
        const sql = "INSERT INTO produtos (id_usuario, nome, descricao, preco, foto_produto, categoria) VALUES (?, ?, ?, ?, ?, ?)";
        
        const [resultado] = await conexao.promise().query(sql, [
            id_usuario, nome, descricao, preco, foto_produto, categoria
        ]);

        const produtoid = resultado.insertId;
        const quantidadeProduto = quantidade ?? 0; 
         const tipo_movimento= quantidadeProduto> 0 ? "Entrada":"Saída";

       
        await conexao.promise().query(
            "INSERT INTO estoque (produto_id, data_entrada, quantidade, tipo_movimento ) VALUES (?, NOW(), ? ,? )", 
            [produtoid, quantidadeProduto,tipo_movimento]
        );

        await conexao.promise().query( "UPDATE estoque SET status = IF(quantidade > 0, 'Disponível', 'Esgotado') WHERE produto_id = ?", 
            [produtoid]
        );

        res.status(201).json({ mensagem: "Produto criado com sucesso!", ID: produtoid });

    } catch (erro) {
        console.error("Erro ao criar o produto:", erro);
        res.status(500).json({ erro: "Erro ao criar o produto", detalhe: erro.message });
    }
});


    



router.get("/", async (req, res) => {
   
    const sql = `  SELECT * FROM produtos `;
    try {
        
        const [resultados] = await conexao.promise().query(sql);
        res.json(resultados);
    } catch (erro) {
        res.status(500).json({ erro: "Erro ao buscar os produtos", detalhe: erro.message });
    }
});


router.get("/:id", async (req, res) => {
    const produtoId = req.params.id;
    const sql = "SELECT * FROM produtos WHERE id_produtos = ?";

    try {
        const [resultado] = await conexao.promise().query(sql, [produtoId]);

        if (resultado.length === 0) {
            return res.status(404).json({ mensagem: "Produto não encontrado" });
        }

        res.json(resultado[0]);

    } catch (erro) {
        res.status(500).json({ erro: "Erro ao buscar o produto", detalhes: erro.message });
    }
});


router.put("/:id", async (req, res) => {
    const produtoId = req.params.id;
    const { nome, descricao, preco, quantidade, categoria } = req.body;

    try {
    
        const [produtoExistente] = await conexao.promise().query("SELECT * FROM produtos WHERE id_produtos = ?", [produtoId]
        );

        if (produtoExistente.length === 0) {
            return res.status(404).json({ mensagem: "Produto não encontrado" });
        }

        const sql = `
            UPDATE produtos 
            SET nome = ?, descricao = ?, preco = ?,  categoria = ? 
            WHERE id_produtos = ?
        `;
        await conexao.promise().query( "UPDATE estoque SET status = IF(quantidade > 0, 'Disponível', 'Esgotado') WHERE produto_id = ?", 
            [produtoid]
        );


        
        const [resultado] = await conexao.promise().query(sql, [
            nome, descricao, preco,  categoria, produtoId
        ]);
        const produtoid = resultado.insertId;
            const quantidadeProduto = quantidade ?? 0;
                    "update estoque set quantidade=?" ,[produtoid ,quantidadeProduto];

        if (resultado.affectedRows === 0) {
            return res.status(400).json({ mensagem: "Nenhuma alteração realizada" });
        }

        res.json({ mensagem: "Produto atualizado com sucesso!" });

    } catch (erro) {
        res.status(500).json({ erro: "Erro ao atualizar o produto", detalhes: erro.message });
    }
});

router.delete("/:id", async (req, res) => {
    const produtoId = req.params.id;
    const sql = "DELETE FROM produtos WHERE id_produtos = ?";

    try {
        const [resultado] = await conexao.promise().query(sql, [produtoId]);

        if (resultado.affectedRows === 0) {
            return res.status(404).json({ mensagem: "Produto não encontrado" });
        }

        res.json({ mensagem: "Produto deletado com sucesso!" });
    } catch (erro) {
        res.status(500).json({ erro: "Erro ao deletar o produto", detalhe: erro.message });
    }
});


module.exports = router;
