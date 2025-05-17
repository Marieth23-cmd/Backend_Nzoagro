const express = require("express");
const router = express.Router();
const conexao = require("./database");
const notificar = require("./utils/notificar");
const upload = require("./upload");
const cloudinaryUtils = require("./utils/cloudinary");
const { autenticarToken, autorizarUsuario } = require("./mildwaretoken");

router.use(express.json());

router.post("/produtos",autenticarToken,autorizarUsuario(["Agricultor", "Fornecedor"]),
  upload.single("foto_produto"), // Agora deve funcionar corretamente
  async (req, res) => {
    try {
      const {
        nome,
        descricao,
        preco,
        categoria,
        provincia,
        quantidade,
        Unidade, 
        peso_kg,
      } = req.body;

      const id_usuario = req.usuario.id_usuario;

      // Verificar campos obrigatórios
      if (!nome || !id_usuario || !categoria || !quantidade || !preco  ||!peso_kg) {
        return res
          .status(400)
          .json({ erro: "Os campos obrigatórios não foram preenchidos." });
      }

      // Upload da imagem para o Cloudinary
      let fotoUrl = "";
      if (req.file) {
        try {
          console.log("Iniciando upload de imagem para o Cloudinary...");
          const resultado = await cloudinaryUtils.uploadToCloudinary(req.file.buffer);
          fotoUrl = resultado.secure_url;
          
          console.log("Upload de imagem bem-sucedido:", fotoUrl);
        } catch (uploadError) {
          console.log("Erro ao fazer upload da imagem:", uploadError);
          return res
            .status(500)
            .json({ erro: "Erro ao fazer upload da imagem." });
        }
      } else {
        console.log("Nenhuma imagem fornecida no upload");
      }

      // Salvar no banco
      const sql =
        "INSERT INTO produtos (id_usuario, nome, descricao, preco, foto_produto, categoria, provincia, DATA_CRIACAO , peso_kg) VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), ?)";

      const [resultadoSQL] = await conexao
        .promise()
        .query(sql, [
          id_usuario,
          nome,
          descricao,
          preco,
          fotoUrl,
          categoria,
          provincia, 
          peso_kg
        ]);

      const produtoid = resultadoSQL.insertId;
      const quantidadeProduto = quantidade ?? 0;
      const tipo_movimento =
        quantidadeProduto > 0 ? "Entrada" : "Saída";

      await conexao
        .promise()
        .query(
          "INSERT INTO estoque (produto_id, data_entrada, quantidade, tipo_movimento, Unidade) VALUES (?, NOW(), ?, ?, ?)",
          [produtoid, quantidadeProduto, tipo_movimento, Unidade]
        );

      await conexao
        .promise()
        .query(
          "UPDATE estoque SET status = IF(quantidade > 0, 'Disponível', 'Esgotado') WHERE produto_id = ?",
          [produtoid]
        );

      try {
        await notificar(
          req.usuario.id_usuario,
          `Produto '${nome}' foi cadastrado com sucesso.`
        );
      } catch (notifyError) {
        console.error("Erro ao enviar notificação:", notifyError);
        // Continua mesmo se a notificação falhar
      }

      res.status(201).json({
        mensagem: "Produto criado com sucesso!",
        produto: {
          id: produtoid,
          nome,
          descricao,
          preco,
          foto_produto: fotoUrl,
          categoria,
          provincia,
          DATA_CRIACAO: new Date(),
          peso_kg,
        }
      });
    } catch (error) {
      console.log("Erro ao cadastrar produto:", error);
      res
        .status(500)
        .json({ erro: "Erro ao criar o produto", detalhe: error.message });
    }
  }
);


router.get("/" ,async (req, res) => {
   
    const sql = `SELECT 
    p.id_produtos, 
    p.nome, 
    p.foto_produto, 
    p.preco,
    p.destaque,
    e.quantidade,
    e.Unidade 
  FROM produtos p
  LEFT JOIN estoque e ON p.id_produtos = e.produto_id
  `
    try {
        console.log("entrou na função get")
        console.log("Dados recebidos no body:", req.body);
        const [resultados] = await conexao.promise().query(sql);
        res.json(resultados);
    } catch (error) {
        res.status(500).json({ erro: "Erro ao buscar os produtos", detalhe: error.message });
    }
});

  
// Rota para buscar produtos por ID


router.get("/produto/:id", async (req, res) => {
    const produtoId = req.params.id;

    try {
        
        const [produto] = await conexao.promise().query("SELECT * FROM produtos WHERE id_produtos = ?", [produtoId]);

        if (produto.length === 0) {
            return res.status(404).json({ mensagem: "Produto não encontrado" });
        }
        const [estoque] = await conexao.promise().query("SELECT quantidade, Unidade FROM estoque WHERE produto_id = ?", [produtoId]);

        
        const dadosCompletos = {
            id: produto[0].id_produtos,
            nome: produto[0].nome,
            provincia: produto[0].provincia,
            foto_produto: produto[0].foto_produto,
            preco: produto[0].preco, 
            unidade: estoque[0]?.Unidade || null,
            quantidade:estoque[0]?.quantidade
          };
          
        res.json(dadosCompletos);
    } catch (error) {
        res.status(500).json({ erro: "Erro ao buscar o produto", detalhes: error.message });
    }
});
router.put(
  "/atualizar/:id",
  autenticarToken,
  autorizarUsuario(["Agricultor", "Fornecedor"]),
  upload.single("foto_produto"), // Middleware de upload
  async (req, res) => {
    const produtoId = req.params.id;
    const {
      nome,
      descricao,
      preco,
      quantidade,
      categoria,
      Unidade,
      peso_kg,
    } = req.body;

    try {
      const [produtoExistente] = await conexao
        .promise()
        .query("SELECT * FROM produtos WHERE id_produtos = ?", [produtoId]);

      if (produtoExistente.length === 0) {
        return res.status(404).json({ mensagem: "Produto não encontrado" });
      }

      let novaFotoURL = produtoExistente[0].foto_produto;

      // ✅ Verifica se foi enviada nova imagem no corpo da requisição
      if (req.file) {
        try {
          console.log("Iniciando upload da nova imagem...");
          const resultado = await cloudinaryUtils.uploadToCloudinary(req.file.buffer);
          novaFotoURL = resultado.secure_url;
          console.log("Imagem atualizada com sucesso:", novaFotoURL);
        } catch (uploadError) {
          console.error("Erro ao fazer upload da imagem:", uploadError);
          return res.status(500).json({ erro: "Erro ao atualizar a imagem." });
        }
      }

      const sql = `
        UPDATE produtos 
        SET nome = ?, descricao = ?, preco = ?, categoria = ?, foto_produto = ?, peso_kg = ?
        WHERE id_produtos = ?
      `;

      const [resultado] = await conexao.promise().query(sql, [
        nome,
        descricao,
        preco,
        categoria,
        novaFotoURL,
        peso_kg,
        produtoId,
      ]);

      await conexao.promise().query(
        "UPDATE estoque SET quantidade = ?, Unidade = ? WHERE produto_id = ?",
        [quantidade, Unidade, produtoId]
      );

      await conexao.promise().query(
        "UPDATE estoque SET status = IF(quantidade > 0, 'Disponível', 'Esgotado') WHERE produto_id = ?",
        [produtoId]
      );

      if (resultado.affectedRows === 0) {
        return res.status(400).json({ mensagem: "Nenhuma alteração realizada" });
      }

      await notificar(req.usuario.id_usuario, `Produto '${nome}' foi atualizado.`);

      res.status(201).json({ mensagem: "Produto atualizado com sucesso!" });

    } catch (error) {
      console.error("Erro ao atualizar produto:", error);
      await notificar(req.usuario.id_usuario, `Erro ao atualizar produto.`);
      res.status(500).json({ erro: "Erro ao atualizar o produto", detalhes: error.message });
    }
  }
);
router.delete("/:id", autenticarToken, autorizarUsuario(["Agricultor", "Fornecedor"]) ,async (req, res) => {
    const produtoId = req.params.id;
    const sql = "DELETE FROM produtos WHERE id_produtos = ?";

    try {
        const [resultado] = await conexao.promise().query(sql, [produtoId]);

        if (resultado.affectedRows === 0) {
            return res.status(404).json({ mensagem: "Produto não encontrado" });
        }
        await notificar(req.usuario.id_usuario, "Um produto foi deletado.");

        res.json({ mensagem: "Produto deletado com sucesso!" });
    } catch (error) {
        res.status(500).json({ erro: "Erro ao deletar o produto", detalhe: error.message });
    }
});



router.patch('/:id/destaque', autenticarToken, async (req, res) => {
  const { id } = req.params;

  try {
    // Verifica se o produto existe
    const [produtos] = await conexao.query('SELECT * FROM produtos WHERE id_produtos = ?', [id]);
    const produto = produtos[0];

    if (!produto) {
      return res.status(404).json({ error: "Produto não encontrado!" });
    }

    // Verifica se o usuário logado é o dono do produto
    if (produto.id_usuario !== req.usuario.id_usuario) {
      return res.status(403).json({ error: "Você não tem permissão para destacar este produto." });
    }

    // Verifica se o pagamento está confirmado
    const [pagamentos] = await conexao.query(
      'SELECT * FROM pagamentos WHERE id_usuario = ? AND id_produto = ? AND status = ?',
      [req.usuario.id_usuario, id, 'pago']
    );

    if (pagamentos.length === 0) {
      return res.status(400).json({ error: "Pagamento não confirmado para este produto." });
    }

    // Atualiza o produto como destaque
    await conexao.query('UPDATE produtos SET destaque = ? WHERE id_produtos = ?', [true, id]);

    await notificar(req.usuario.id_usuario, `Produto com ID ${id} foi patrocinado com sucesso.`);

    return res.status(200).json({ message: "Produto destacado com sucesso!" });

  } catch (error) {
    console.log("Erro ao destacar o produto:", error);
    return res.status(500).json({ error: "Erro interno ao destacar o produto." });
  }
});
  
  router.get("/categoria/:categoria", async (req, res) => {
    try {
      const { categoria } = req.params;
      const { provincia, precoMin, precoMax } = req.query;
      console.log("entrou na função get por categoria");
      console.log("Categoria recebida:", categoria);
      console.log("Filtros recebidos:", req.query);
  
      let sql = `
        SELECT 
          p.id_produtos, 
          p.nome, 
          p.foto_produto, 
          p.preco, 
          p.provincia,
          e.quantidade, 
          e.Unidade,
          u.nome AS nome_vendedor
        FROM produtos p
        LEFT JOIN estoque e ON p.id_produtos = e.produto_id
        LEFT JOIN usuarios u ON p.id_usuario = u.id_usuario
        WHERE p.categoria = ?`;
  
      const params = [categoria];
  
      if (provincia) {
        sql += " AND p.provincia = ?";
        params.push(provincia);
      }
  
      if (precoMin) {
        sql += " AND p.preco >= ?";
        params.push(precoMin);
      }
  
      if (precoMax) {
        sql += " AND p.preco <= ?";
        params.push(precoMax);
      }
  
      console.log("SQL final:", sql);
      console.log("Parâmetros:", params);
  
      const [rows] = await conexao.promise().query(sql, params);
      res.status(200).json(rows);
    } catch (error) {
      console.log("Erro ao buscar produtos por categoria:", error);
      res.status(500).json({ erro: "Erro interno ao buscar produtos" });
    }
  });
  

 
  router.get("/produtos/meus-produtos", autenticarToken, async (req, res) => {
  const id_usuario = req.usuario.id_usuario;

  const sql = `
    SELECT 
      p.id_produtos, 
      p.nome, 
      p.descricao,
      p.foto_produto, 
      p.preco,
      p.categoria,
      p.provincia,
      p.DATA_CRIACAO,
      e.quantidade,
      e.Unidade,
      e.status
    FROM produtos p
    LEFT JOIN estoque e ON p.id_produtos = e.produto_id
    WHERE p.id_usuario = ?
    ORDER BY p.DATA_CRIACAO DESC
  `;

  try {
    const [produtos] = await conexao.promise().query(sql, [id_usuario]);

    res.status(200).json(produtos);
  } catch (error) {
    console.log("Erro ao buscar produtos do usuário:", error);
    res.status(500).json({ erro: "Erro ao buscar os seus produtos", detalhe: error.message });
  }
});

  


// Rota existente para destacar um produto
router.post('/:id/destaque', autenticarToken, async (req, res) => {
  const { id } = req.params;
  const { pacote } = req.body;  // Pacote: 3, 5, 7 ou 30 (dias)
  
  // Validar pacote
  if (!pacote || ![3, 5, 7, 30].includes(Number(pacote))) {
    return res.status(400).json({ error: "Pacote inválido. Escolha entre 3, 5, 7 ou 30 dias." });
  }
  
  try {
    // Verifica se o produto existe
    const [produtos] = await conexao.query('SELECT * FROM produtos WHERE id_produtos = ?', [id]);
    const produto = produtos[0];
    
    if (!produto) {
      return res.status(404).json({ error: "Produto não encontrado!" });
    }
    
    // Verifica se o usuário logado é o dono do produto
    if (produto.id_usuario !== req.usuario.id_usuario) {
      return res.status(403).json({ error: "Você não tem permissão para destacar este produto." });
    }
    
    // Calcula valores com base no pacote
    const valorPacotes = {
      3: 6000,
      5: 8000,
      7: 10000,
      30: 20000
    };
    
    const valor = valorPacotes[pacote];
    
    // Registrar pagamento pendente (simplificado - em um sistema real você usaria um gateway de pagamento)
    const [resultado] = await conexao.query(
      'INSERT INTO pagamentos (id_usuario, id_produto, valor, status, tipo) VALUES (?, ?, ?, ?, ?)',
      [req.usuario.id_usuario, id, valor, 'pendente', 'destaque']
    );
    
    const idPagamento = resultado.insertId;
    
    // Aqui você pode adicionar lógica para integrar com uma API de pagamento
    
    return res.status(200).json({ 
      message: "Pedido de destaque criado com sucesso!",
      idPagamento,
      valor
    });
  } catch (error) {
    console.log("Erro ao criar pedido de destaque:", error);
    return res.status(500).json({ error: "Erro interno ao processar pedido de destaque." });
  }
});

// Rota para confirmar pagamento (apenas para testes/simulação)
router.post('/pagamentos/:id/confirmar', autenticarToken, async (req, res) => {
  const { id } = req.params;
  
  try {
    // Busca o pagamento
    const [pagamentos] = await conexao.query('SELECT * FROM pagamentos WHERE id = ? AND id_usuario = ?', 
      [id, req.usuario.id_usuario]);
      
    if (pagamentos.length === 0) {
      return res.status(404).json({ error: "Pagamento não encontrado." });
    }
    
    const pagamento = pagamentos[0];
    
    // Atualiza o status do pagamento
    await conexao.query('UPDATE pagamentos SET status = ? WHERE id = ?', ['pago', id]);
    
    // Define a duração com base no tipo de pacote
    let diasDestaque;
    if (pagamento.valor === 6000) diasDestaque = 3;
    else if (pagamento.valor === 8000) diasDestaque = 5;
    else if (pagamento.valor === 10000) diasDestaque = 7;
    else if (pagamento.valor === 20000) diasDestaque = 30;
    else diasDestaque = 3; // valor padrão
    
    // Calcula a data de término do destaque
    const dataAtual = new Date();
    const dataFim = new Date(dataAtual);
    dataFim.setDate(dataFim.getDate() + diasDestaque);
    
    // Atualiza o produto como destaque com data de expiração
    await conexao.query(
      'UPDATE produtos SET destaque = ?, data_inicio_destaque = ?, data_fim_destaque = ? WHERE id_produtos = ?', 
      [true, dataAtual, dataFim, pagamento.id_produto]
    );
    
    await notificar(req.usuario.id_usuario, `Produto com ID ${pagamento.id_produto} foi patrocinado com sucesso por ${diasDestaque} dias.`);
    
    return res.status(200).json({ 
      message: `Pagamento confirmado e produto destacado por ${diasDestaque} dias!` 
    });
  } catch (error) {
    console.log("Erro ao confirmar pagamento:", error);
    return res.status(500).json({ error: "Erro interno ao confirmar pagamento." });
  }
});

// Rota para listar produtos em destaque (ativos)
router.get('/destaque', async (req, res) => {
  try {
    const dataAtual = new Date();
    
    // Buscar produtos em destaque que ainda não expiraram
    const [produtos] = await conexao.query(
      `SELECT p.* FROM produtos p 
       WHERE p.destaque = true 
       AND p.data_fim_destaque >= ?
       ORDER BY p.data_inicio_destaque DESC`,
      [dataAtual]
    );
    
    // Atualizar produtos com destaque expirado
    await conexao.query(
      `UPDATE produtos SET destaque = false 
       WHERE destaque = true AND data_fim_destaque < ?`,
      [dataAtual]
    );
    
    return res.status(200).json(produtos);
  } catch (error) {
    console.log("Erro ao buscar produtos em destaque:", error);
    return res.status(500).json({ error: "Erro interno ao buscar produtos em destaque." });
  }
});

// Rota para verificar status de destaque de um produto
router.get('/:id/status-destaque', autenticarToken, async (req, res) => {
  const { id } = req.params;
  
  try {
    const [produtos] = await conexao.query(
      `SELECT destaque, data_inicio_destaque, data_fim_destaque 
       FROM produtos WHERE id_produtos = ? AND id_usuario = ?`,
      [id, req.usuario.id_usuario]
    );
    
    if (produtos.length === 0) {
      return res.status(404).json({ error: "Produto não encontrado ou você não tem permissão." });
    }
    
    const produto = produtos[0];
    const dataAtual = new Date();
    const estaAtivo = produto.destaque && new Date(produto.data_fim_destaque) >= dataAtual;
    
    return res.status(200).json({
      destaque: produto.destaque,
      estaAtivo,
      dataInicio: produto.data_inicio_destaque,
      dataFim: produto.data_fim_destaque,
      diasRestantes: estaAtivo ? 
        Math.ceil((new Date(produto.data_fim_destaque) - dataAtual) / (1000 * 60 * 60 * 24)) : 0
    });
  } catch (error) {
    console.log("Erro ao verificar status de destaque:", error);
    return res.status(500).json({ error: "Erro interno ao verificar status de destaque." });
  }
});
  

module.exports = router;
