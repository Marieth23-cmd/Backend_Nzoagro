const express = require("express");
const router = express.Router();
const conexao = require("./database"); 
router.use(express.json());



router.get("/", async (req, res) => {
    try {
        const [resultados] = await conexao.promise().query("SELECT * FROM transportadoras");
        
        if (resultados.length === 0) {
            return res.status(404).json({ mensagem: "Nenhuma transportadora encontrada" });
        }
        
        res.json({ transportadoras: resultados });
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: "Erro ao listar transportadoras" });
    }
});


router.get("/:id", async (req, res) => {
    const transportadoraId = req.params.id;

    try {
        const [resultados] = await conexao.promise().query(
            "SELECT * FROM transportadoras WHERE id = ?",
            [transportadoraId]
        );

        if (resultados.length === 0) {
            return res.status(404).json({ mensagem: "Transportadora não encontrada" });
        }

        res.json({ transportadora: resultados[0] });
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: "Erro ao buscar transportadora" });
    }
});

module.exports = router;
