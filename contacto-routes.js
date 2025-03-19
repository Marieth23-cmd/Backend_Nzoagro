const express = require("express");
const router = express.Router();
const conexao = require("./database"); 

router.use(express.json());


router.post("/", (req, res) => {
    const { usuario_id, numero_telefone, email_contato } = req.body;

    
    if (!usuario_id || !numero_telefone || !email_contato) {
        return res.status(400).json({ mensagem: "Todos os campos são obrigatórios!" });
    }


    const sql = `
        INSERT INTO contactos (usuario_id, numero_telefone, email_contato)
        VALUES (?, ?, ?);
    `;

    conexao.query(sql, [usuario_id, numero_telefone, email_contato], (erro, resultados) => {
        if (erro) {
            return res.status(500).json({ erro: "Erro ao criar o contato" });
        }
        res.status(201).json({ mensagem: "Contato criado com sucesso", id: resultados.insertId });
    });
});


router.get("/:usuarioId", (req, res) => {
    const usuarioId = req.params.usuarioId;
    const sql = `
        SELECT usuario_id, numero_telefone, email_contato
        FROM contactos
        WHERE usuario_id = ?;
    `;

    conexao.query(sql, [usuarioId], (erro, resultados) => {
        if (erro) {
            return res.status(500).json({ erro: "Erro ao buscar contato" });
        }
        if (resultados.length === 0) {
            return res.status(404).json({ mensagem: "Nenhum contato encontrado para este usuário" });
        }
        res.json({ contacto: resultados[0] });
    });
});


router.put("/:usuarioId", (req, res) => {
    const usuarioId = req.params.usuarioId;
    const { numero_telefone, email_contato } = req.body;

    if (!numero_telefone || !email_contato) {
        return res.status(400).json({ mensagem: "Número de telefone e email de contato são obrigatórios!" });
    }

    const sql = `
        UPDATE contactos
        SET numero_telefone = ?, email_contato = ?
        WHERE usuario_id = ?;
    `;

    conexao.query(sql, [numero_telefone, email_contato, usuarioId], (erro, resultados) => {
        if (erro) {
            return res.status(500).json({ erro: "Erro ao atualizar o contato" });
        }
        if (resultados.affectedRows === 0) {
            return res.status(404).json({ mensagem: "Usuário não encontrado" });
        }
        res.json({ mensagem: "Contato atualizado com sucesso" });
    });
});

module.exports = router;
