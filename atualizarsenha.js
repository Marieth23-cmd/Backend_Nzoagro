const conexao = require("./database");
const bcrypt = require("bcryptjs");

async function atualizarSenhas() {
    try {
        const [usuarios] = await conexao.promise().query("SELECT id_usuario, senha FROM USUARIOS");

        for (let usuario of usuarios) {
            if (usuario.senha.length !== 60) { // Verifica se a senha já está criptografada
                const hash = await bcrypt.hash(usuario.senha, 10); // Gerar novo hash

                await conexao.promise().query(
                    "UPDATE USUARIOS SET senha = ? WHERE id_usuario = ?",
                    [hash, usuario.id_usuario]
                );

                console.log(`Senha do usuário ${usuario.id_usuario} atualizada.`);
            }
        }

        console.log("Todas as senhas foram atualizadas com sucesso!");
    } catch (error) {
        console.error("Erro ao atualizar senhas:", error);
    }
}

atualizarSenhas();



