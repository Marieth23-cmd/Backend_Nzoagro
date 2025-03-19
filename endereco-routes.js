const express = require("express");
const router = express.Router();
const conexao = require("./database"); 

router.use(express.json());
router.post("/", (req, res) => {
    const { usuarioId, rua, cidade, estado, cep, pais } = req.body;

    const sql = `
        INSERT INTO enderecos (usuario_id, rua, cidade, estado, cep, pais)
        VALUES (?, ?, ?, ?, ?, ?);
    `;

    conexao.query(sql, [usuarioId, rua, cidade, estado, cep, pais], (erro, resultado) => {
        if (erro) {
            return res.status(500).json({ erro: "Erro ao cadastrar endereço" });
        }
        res.status(201).json({ mensagem: "Endereço cadastrado com sucesso", id: resultado.insertId });
    });
});

router.put("/:usuarioId", (req, res) => {
    const usuarioId = req.params.usuarioId;
    const { rua, cidade, estado, cep, pais } = req.body;

    const sql = `
        UPDATE enderecos
        SET rua = ?, cidade = ?, estado = ?, cep = ?, pais = ?
        WHERE usuario_id = ?;
    `;

    conexao.query(sql, [rua, cidade, estado, cep, pais, usuarioId], (erro, resultado) => {
        if (erro) {
            return res.status(500).json({ erro: "Erro ao atualizar endereço" });
        }
        if (resultado.affectedRows === 0) {
            return res.status(404).json({ mensagem: "Endereço não encontrado para esse usuário" });
        }
        res.json({ mensagem: "Endereço atualizado com sucesso" });
    });
});




module.exports = router;
