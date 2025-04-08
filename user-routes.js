const express = require ("express");
const router = express.Router();
const conexao = require("./database"); 
const { autenticarToken } = require("./mildwaretoken");
const senhaValida=/^[a-zA-Z0-9!@#$%^&*]{6,12}$/
const numeroAngola=/^9\d{8}$/
 const bcrypt= require("bcryptjs")
 const multer=require("multer")
 const path=require("path")
 const fs = require("fs");


router.use(express.json());

// Certifica que a pasta "uploads" existe
const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}


router.get("/", async (req, res) => {
    try {
        const [usuarios] = await conexao.promise().query(
         
                `SELECT
        user.nome AS Nome, 
        user.senha AS Senha,
        user.descricao AS Descrição,
        COALESCE( user.foto , "Sem Foto") AS Fotografia,
        user.status AS Status,
        user.tipo_usuario AS Tipo_de_Usuário,
        user.email AS Email,
        user.data_exclusao AS Data_de_Exclusão,
        COALESCE(contacto.contacto, 'Sem contacto') AS Contacto,
            endereco.rua AS Rua,
            endereco.provincia AS Provincia,
            endereco.bairro AS Bairro,
            endereco.municipio AS Municipio,
            endereco.pais AS Pais

      
    FROM usuarios user
    LEFT JOIN contacto ON user.id_usuario = contacto.id_usuario
    LEFT JOIN endereco ON user.id_usuario= endereco.id_usuario  WHERE user.status="ativo" `
    

        ); 
        usuarios.forEach(usuario => {
        if(usuarios.tipo_usuario==="Comprador"){ 
            delete usuario.rua
            delete usuario.provincia
            delete usuario.bairro
            delete usuario.pais
            delete usuario.municipio


        }
    })

        usuarios.forEach(usuario => {
         Object.keys(usuario).forEach(key => {
            if (usuario[key] === null) {
                delete usuario[key];
            }
        });
    });
       
                res.json({ message: "Lista de usuários activos", usuarios: usuarios });
    } catch (error) {
        res.status(500).json({ message: "Erro ao buscar usuários", error });
    }
});

router.get("/me",autenticarToken, async (req, res) => {
    const userid = req.params.id;
    try {
        const sql =  `SELECT
        user.nome AS Nome, 
        user.senha AS Senha,
        user.descricao AS Descrição,
        COALESCE( user.foto , "Sem Foto") AS Fotografia,
        user.status AS Status,
        user.tipo_usuario AS Tipo_de_Usuário,
        user.email AS Email,
        user.data_exclusao AS Data_de_Exclusão,
        COALESCE(contacto.contacto, 'Sem contacto') AS Contacto,
        endereco.rua AS Rua,
            endereco.provincia AS Provincia,
            endereco.bairro AS Bairro,
            endereco.municipio AS Municipio,
            endereco.pais AS Pais
       

    FROM usuarios user
    LEFT JOIN contacto ON user.id_usuario = contacto.id_usuario
    LEFT JOIN endereco ON user.id_usuario= endereco.id_usuario WHERE user.id_usuario = ? AND user.status="ativo"  `
    
  ;


        const [usuarios] = await conexao.promise().query(sql, [userid]); 
        if (usuarios.length === 0) {
            return res.status(404).json({ message: `Usuário com ID ${userid} não encontrado` });
        }
         
        let usuario=usuarios[0]
        if (usuario.tipo_usuario.trim().toLowerCase() === "comprador") { 
            delete usuario.rua
            delete usuario.provincia
            delete usuario.bairro
            delete usuario.pais
            delete usuario.municipio


        }
       Object.keys(usuario).forEach(key => {
            if (usuario[key] === null) {
               delete usuario[key];
           }
        });

        res.json({ message: `Detalhes do usuário com ID ${userid}`, usuario: usuario});
    } catch (error) {
        res.status(500).json({ message: "Erro ao buscar o usuário", error });
    }
});



router.post("/", upload("foto"), async (req, res) => {
    const { nome, email, senha, descricao, data_criacao, 
         tipo_usuario, contacto, rua, provincia, bairro, municipio, pais } = req.body;
         const foto = req.file ? `/uploads/${req.file.filename}` : undefined;

        console.log("entrou na função")
        console.log("Dados enviados" , req.body)
    try {
        if (!nome || !senha || !tipo_usuario || !contacto || !email) {
            return res.status(401).json({
                message: "Os campos Nome, Email, Senha, Contacto e Tipo de Usuário são obrigatórios"
            });
        }

        if (!senhaValida.test(senha)) {
            return res.status(400).json({ message: "A senha só pode ter no mínimo 6 e no máximo 12 caracteres" });
        }

        const contactoString = String(contacto);
        if (!numeroAngola.test(contactoString)) {
            return res.status(400).json({ message: "O contacto deve ter 9 dígitos e começar com 9" });
        }

        if (
            tipo_usuario.trim().toLowerCase() !== "Fornecedor" && 
            tipo_usuario.trim().toLowerCase() !== "Agricultor" && 
            (rua !== undefined || provincia !== undefined || bairro !== undefined || municipio !== undefined || pais !== undefined)
        ) {
            return res.status(400).json({ message: "Apenas Fornecedores e Agricultores podem adicionar endereço padrão" });
        }

        const [usuariosExistentes] = await conexao.promise().query(
            "SELECT id_usuario FROM usuarios WHERE email = ?",
            [email]
        );

        if (usuariosExistentes.length > 0) {
            return res.status(409).json({ message: "Este e-mail já está cadastrado. Tente outro." });
        }

        const salt = await bcrypt.genSalt(10); // Gera um salt para a senha
        const senhaCriptografada = await bcrypt.hash(senha, salt); // Criptografa a senha

        // Inserir no banco de dados
        const [resultado] = await conexao.promise().query(
            "INSERT INTO USUARIOS (nome, email, senha, tipo_usuario ,foto,descricao , data_criacao) VALUES (?, ?, ?, ?,?,? , NOW())",
            [nome, email, senhaCriptografada, tipo_usuario, foto, descricao , data_criacao]
        );

        const idUsuario = resultado.insertId;

        await conexao.promise().query(
            "INSERT INTO contacto (id_usuario, contacto) VALUES (?, ?)", 
            [idUsuario, contacto]
        );

        if (tipo_usuario === "Fornecedor" || tipo_usuario === "Agricultor") {
            await conexao.promise().query(
                "INSERT INTO endereco (id_usuario, rua, bairro, provincia, pais, municipio) VALUES (?, ?, ?, ?, ?, ?)", 
                [idUsuario, rua, bairro, provincia, pais, municipio]
            );
        }

    
        res.status(201).json({
            message: "Conta criada com sucesso!",
            usuario: { id: idUsuario, nome: nome.trim(), email: email.trim(), tipo_usuario }
        });

    } catch (error) {
        console.log("Erro ao criar conta:", error);
        res.status(500).json({ message: "Erro ao criar conta", error });
    }
});



const storage=multer.diskStorage({
    destination:(req , file , cb)=>{
        cb(null ,uploadDir)
    },
    filename:(req ,file,ceb)=>{
        cb(null , Date.now() + path.extname(file.originalname))
    }
})
const upload=multer({storage})

router.put("/perfil",autenticarToken, upload.single("foto"), async (req, res) => {
    const userId = req.params.id;
    const { 
        nome, email, senha, descricao,  tipo_usuario, 
        contacto, rua, provincia, bairro, municipio, pais 
    } = req.body;
    const foto=req.file? `/uploads/${req.file.filename}`:undefined // caminho da foto


    try {
        
        const [userResult] = await conexao.promise().query(
            "SELECT tipo_usuario FROM usuarios WHERE id_usuario = ?", [userId]
        );

        if (userResult.length === 0) {
            return res.status(404).json({ message: `Usuário com ID ${userId} não encontrado` });
        }

        let senhaAtualizada = senha;
        if (senha) {
            if (!senhaValida.test(senha)) {
                return res.status(400).json({ message: "Senha inválida" });
            }
            const salt = await bcrypt.genSalt(10);
            senhaAtualizada = await bcrypt.hash(senha, salt);
        }
        const userTipo = userResult[0].tipo_usuario; 

        
        const [result] = await conexao.promise().query(
            "UPDATE usuarios SET nome=?, email=?, senha=?, descricao=?, foto=?, tipo_usuario=? WHERE id_usuario=?",
            [nome, email, senha, descricao, foto, tipo_usuario, userId]
        );

        
        if (contacto) {
            await conexao.promise().query(
                "UPDATE contacto SET contacto=? WHERE id_contacto=?",
                [contacto, userId]
            );
        }

        
        if ((userTipo === "Agricultor" || userTipo === "Fornecedor") && (rua || provincia || bairro || municipio || pais)) {
            await conexao.promise().query(
                "UPDATE endereco SET rua=?, provincia=?, bairro=?, municipio=?, pais=? WHERE id_endereco=?",
                [rua, provincia, bairro, municipio, pais, userId]
            );
        } else if (rua || provincia || bairro || municipio || pais) {
            return res.status(403).json({ message: "Apenas Agricultores e Fornecedores podem atualizar o endereço." });
        }

        res.json({ message: `Usuário com ID ${userId} atualizado com sucesso!` });

    } catch (error) {
        res.status(500).json({ message: "Erro ao atualizar usuário", error });
    }
});



router.delete("/:id", autenticarToken, async (req, res) => {
    const userid = req.params.id;

    try {
        const [result] = await conexao.promise().query( 
            "UPDATE usuarios SET status = 'desativado', data_exclusao = NOW() WHERE id_usuario = ?", 
          [userid]
        );

        if (result.affectedRows > 0) {
            res.json({ message: `Usuário com ID ${userid} foi excluido com sucesso.` });
        } else {
            res.status(404).json({ message: `Usuário com ID ${userid} não encontrado.` });
        }
    } catch (error) {
        res.status(500).json({ message: "Erro ao desativar usuário", error });
    }
});


module.exports = router;
