const express = require("express");
const router = express.Router();
const conexao = require("./database");
const numeroAngola=/^9\d{8}$/
const { autenticarToken, autorizarUsuario } = require("./mildwaretoken");



router.use(express.json());

router.get("/",autenticarToken, async (req, res) => {
    const id_usuario = req.usuario.id_usuario;

    
    try {
        const [pedidos] = await conexao.promise().query(`
           SELECT 
        p.id_pedido, p.estado, p.valor_total, p.data_pedido,
        i.id_produto, i.quantidade_comprada, i.preco, i.subtotal,
        u.nome AS nome_usuario, u.id_usuario AS id_usuario_cliente
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
        console.log("Erro ao buscar pedidos:", error);
        res.status(500).json({ message: "Erro ao buscar pedidos", error: error.message });
    }
});
 
router.get("/especifico", autenticarToken, async (req, res) => {
    const id_usuario = req.usuario.id_usuario;
  
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
        console.log("Erro ao buscar pedidos:", error);
        res.status(500).json({ message: "Erro ao buscar pedidos", error: error.message });
    }
});





router.post("/criar", autenticarToken, async (req, res) => {
    const id_usuario= req.usuario.id_usuario
    const { estado, valor_total, rua, bairro, pais, municipio, referencia, provincia, numero, itens } = req.body;
    const io=req.app.get("socketio")
    try {

        if (!id_usuario || id_usuario == 0) {
            return res.status(400).json({ message: "Usuário inválido" });
        }
        
        
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

       // Notificar o responsável do produto (agricultor ou fornecedor)
        // Aqui você pode buscar o id do fornecedor ou agricultor responsável pelo produto
        // (ou seja, o id_produto está relacionado a um agricultor ou fornecedor)
        const idsProdutos = itens.map(item => item.id_produto);
            const [fornecedorOuAgricultor] = await conexao.promise().query(
            `SELECT id_usuario FROM produtos WHERE id_produto IN (${idsProdutos.map(() => '?').join(',')})`,
            idsProdutos
            );

        const destinatarios = fornecedorOuAgricultor.map(item => item.id_usuario);

        destinatarios.forEach((destinatario) => {
            io.to(`usuario_${destinatario}`).emit("novo_pedido", {
                message: `Novo pedido recebido! Pedido ID: ${id_pedido}`,
                id_pedido,
                estado,
                valor_total,
                data: new Date()
            });
        });

        // Notificar o usuário que criou o pedido
        io.to(`usuario_${id_usuario}`).emit("novo_pedido", {
            message: `Seu pedido foi criado com sucesso! Pedido ID: ${id_pedido}`,
            id_pedido,
            estado,
            valor_total,
            data: new Date()
        });

        // Notificar todos os administradores
        const [admins] = await conexao.promise().query(`
            SELECT id_usuario FROM usuarios WHERE tipo_usuario = 'Administrador'
        `);

        admins.forEach((admin) => {
            io.to(`usuario_${admin.id_usuario}`).emit("novo_pedido", {
                message: `Novo pedido criado na plataforma. Pedido ID: ${id_pedido}`,
                id_pedido,
                estado,
                valor_total,
                data: new Date()
            });
        });

        
        res.status(201).json({
            message: "Pedido feito com sucesso!",
            id_pedido
        });

    } catch (error) {
        console.log("Erro ao enviar pedido:", error);
        res.status(500).json({ message: "Erro ao enviar pedido", error: error.message });
    }
});



router.delete("/:id_pedido", autenticarToken, async (req, res) => {
    const id_pedido = req.params.id_pedido;
    const id_usuario_que_excluiu = req.usuario.id_usuario;
  
    try {
      // Buscar o pedido antes de deletar para recuperar o id do destinatário
      const [pedido] = await conexao.promise().query(`
        SELECT id_usuario FROM pedidos WHERE id_pedido = ?
      `, [id_pedido]);
  
      if (!pedido || pedido.length === 0) {
        return res.status(404).json({ message: "Pedido não encontrado." });
      }
  
      const id_destinatario = pedido[0].id_usuario;

      if (id_usuario_que_excluiu !== id_destinatario && req.usuario.tipo_usuario !== 'Administrador') {
        return res.status(403).json({ message: "Você não tem permissão para excluir este pedido." });
    }
    
      // Excluir itens relacionados
      await conexao.promise().query(`
        DELETE FROM itens_pedido WHERE pedidos_id = ?
      `, [id_pedido]);
  
      await conexao.promise().query(`
        DELETE FROM endereco_pedidos WHERE id_pedido = ?
      `, [id_pedido]);
  
      // Excluir o pedido
      const [resultado] = await conexao.promise().query(`
        DELETE FROM pedidos WHERE id_pedido = ?
      `, [id_pedido]);
  
      if (resultado.affectedRows === 0) {
        return res.status(404).json({ message: "Pedido não encontrado ao tentar deletar." });
      }
  
      // Notificar o usuário que excluiu
      io.to(`usuario_${id_usuario_que_excluiu}`).emit("pedido_excluido", {
        id_pedido,
        message: "Você excluiu um pedido."
      });
  
      // Notificar o destinatário (agricultor ou fornecedor)
      io.to(`usuario_${id_destinatario}`).emit("pedido_excluido", {
        id_pedido,
        message: "Este pedido destinado a você foi excluído."
      });
  
      // Buscar todos os administradores
      const [admins] = await conexao.promise().query(`
        SELECT id_usuario FROM usuarios WHERE tipo_usuario = 'Administrador'
      `);
  
      // Notificar todos os administradores
      admins.forEach((admin) => {
        io.to(`usuario_${admin.id_usuario}`).emit("pedido_excluido", {
          id_pedido,
          message: "Este pedido foi excluído da plataforma."
        });
      });
  
      res.status(200).json({ message: "Pedido excluído com sucesso!" });
  
    } catch (error) {
      console.log("Erro ao excluir pedido:", error);
      res.status(500).json({ message: "Erro ao excluir pedido", error: error.message });
    }
  });
  


















module.exports = router;
