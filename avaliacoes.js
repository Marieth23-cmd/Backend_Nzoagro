const express = require("express");
const conexao = require("./database");
const { autenticarToken } = require("./mildwaretoken");

const router = express.Router();

router.use(express.json());


router.post("/", autenticarToken, async (req, res) => {
    const { id_produtos, nota } = req.body;
    const id_usuario = req.usuario.id_usuario; 

    if (!id_produtos || !nota) {
        return res.status(400).json({ erro: "Produto e nota são obrigatórios." });
    }

    try {
        
        const [existente] = await conexao.promise().query(
            "SELECT * FROM avaliacoes WHERE id_produtos = ? AND id_usuario = ?",
            [id_produtos, id_usuario]
        );

        if (existente.length > 0) {
         
            await conexao.promise().query(
                "UPDATE avaliacoes SET nota = ? WHERE id_produtos = ? AND id_usuario = ?",
                [nota, id_produtos, id_usuario]
            );
            return res.json({ mensagem: "Avaliação atualizada com sucesso." });
        }

        
        const sql = "INSERT INTO avaliacoes (id_produtos, id_usuario, nota) VALUES (?, ?, ?)";
        await conexao.promise().query(sql, [id_produtos, id_usuario, nota]);
        res.status(201).json({ mensagem: "Avaliação registrada com sucesso." });
    } catch (erro) {
        res.status(500).json({ erro: "Erro ao registrar avaliação", detalhe: erro.message });
    }
});



router.get("/:id_produtos", async (req, res) => {
    const { id_produtos } = req.params;
  
    const sql = "SELECT * FROM avaliacoes WHERE id_produtos = ?";
  
    try {
      const [avaliacoes] = await conexao.promise().query(sql, [id_produtos]);
  
      if (avaliacoes.length === 0) {
        return res.status(404).json({ mensagem: "Sem avaliações para este produto." });
      }
  
      res.json(avaliacoes);
    } catch (erro) {
      res.status(500).json({ erro: "Erro ao buscar avaliações", detalhe: erro.message });
    }
  });
  
  router.get("/media/:id_produtos", async (req, res) => {
  const { id_produtos } = req.params;

  const sql = `
    SELECT 
      id_produtos,
      COUNT(*) as total,
      ROUND(AVG(nota), 2) as media_estrelas
    FROM avaliacoes
    WHERE id_produtos = ?
    GROUP BY id_produtos
  `;

  try {
    const [resultado] = await conexao.promise().query(sql, [id_produtos]);
    res.json(resultado[0] || { media_estrelas: null, total: 0 });
  } catch (erro) {
    res.status(500).json({ erro: "Erro ao calcular média", detalhe: erro.message });
  }
});
  module.exports = router;
  