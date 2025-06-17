const express = require("express");
const router = express.Router();
const conexao = require("./database");
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const { autenticarToken, autorizarUsuario } = require("./mildwaretoken");
router.use(express.json());

// ========================================
// CONFIGURAÇÕES DINÂMICAS DA PLATAFORMA NZOAGRO
// ========================================
const CONFIGURACOES_PLATAFORMA = {
    COMISSAO_PADRAO: 0.10,        // 10% de comissão padrão
    COMISSAO_PREMIUM: 0.08,       // 8% para usuários premium
    COMISSAO_PARCEIRO: 0.05,      // 5% para parceiros especiais
    
    // Configurações de frete DINÂMICAS baseadas no peso
    FRETE_POR_PESO: {
        '10-30': { base: 10000, comissao: 1000 },
        '31-50': { base: 15000, comissao: 1500 },
        '51-70': { base: 20000, comissao: 2000 },
        '71-100': { base: 25000, comissao: 2500 },
        '101-300': { base: 35000, comissao: 3500 },
        '301-500': { base: 50000, comissao: 5000 },
        '501-1000': { base: 80000, comissao: 8000 },
        '1001-2000': { base: 120000, comissao: 12000 }
    }
};


const TIPOS_PAGAMENTO = {
    'unitel_money': { 
        nome: 'Unitel Money', 
        taxa: 0.02,           // 2% taxa
        ativo: true,
        codigo_ussd: '*409#',
        operadora: 'Unitel',
        descricao: 'Pagamento via Unitel Money'
    },
    'africell_money': { 
        nome: 'Africell Money', 
        taxa: 0.018,          // 1.8% taxa
        ativo: true,
        codigo_ussd: '*777#',
        operadora: 'Africell',
        descricao: 'Pagamento via Africell Money'
    },
    'multicaixa_express': { 
        nome: 'Multicaixa Express', 
        taxa: 0.025,          // 2.5% taxa
        ativo: true,
        codigo_ussd: null,    // Não usa USSD
        operadora: 'MulticaixaExpress',
        descricao: 'Pagamento via Multicaixa Express (ATM/App)'
    }
};

const STATUS_PAGAMENTO = {
    PENDENTE: 'pendente',
    PROCESSANDO: 'processando',
    PAGO: 'pago',
    RETIDO: 'retido',           
    LIBERADO: 'liberado',       
    CANCELADO: 'cancelado',
    REEMBOLSADO: 'reembolsado'
};

// ========================================
// FUNÇÃO: GERAR REFERÊNCIA DE PAGAMENTO
// ========================================
const gerarReferenciaPagamento = (valorTotal, metodoPagamento) => {
    // Prefixos por operagitdora (mais realista)
    const prefixos = {
        'unitel_money': 'UM',
        'africell_money': 'AM', 
        'multicaixa_express': 'MX'
    };
    
    // Gerar referência mais compacta
    const timestamp = Date.now().toString().slice(-6); // 6 dígitos
    const random = Math.floor(Math.random() * 999).toString().padStart(3, '0'); // 3 dígitos
    const prefixo = prefixos[metodoPagamento] || 'PG';
    
    const referencia = `${prefixo}${timestamp}${random}`;
    
    return {
        referencia: referencia,
        valor_total: Math.round(valorTotal),
        metodo_pagamento: metodoPagamento,
        valida_ate: new Date(Date.now() + 30 * 60 * 1000),
        status: 'ativa',
        criada_em: new Date()
    };
};

// ========================================
// FUNÇÃO: CRIAR/BUSCAR CONTA VIRTUAL DO USUÁRIO
// ========================================
const criarOuBuscarContaVirtual = async (idUsuario, tipoUsuario = 'Agricultor') => {
    try {
        // Verificar se já existe conta virtual para o usuário
        const [contaExistente] = await conexao.promise().query(`
            SELECT * FROM contas_virtuais 
            WHERE id_usuario = ? AND tipo_conta = ?
        `, [idUsuario, tipoUsuario]);
        
        if (contaExistente.length > 0) {
            return contaExistente[0];
        }
        
        // Criar nova conta virtual
        const numeroUnitel = `9${Math.floor(Math.random() * 100000000).toString().padStart(8, '0')}`;
        const numeroAfricell = `9${Math.floor(Math.random() * 100000000).toString().padStart(8, '0')}`;
        
        const [resultado] = await conexao.promise().query(`
            INSERT INTO contas_virtuais 
            (id_usuario, tipo_conta, saldo, numero_africell, numero_Unitel, operadora, data_criacao)
            VALUES (?, ?, 0.00, ?, ?, 'Unitel', NOW())
        `, [idUsuario, tipoUsuario, numeroAfricell, numeroUnitel]);
        
        return {
            id: resultado.insertId,
            id_usuario: idUsuario,
            tipo_conta: tipoUsuario,
            saldo: 0.00,
            numero_africell: numeroAfricell,
            numero_Unitel: numeroUnitel,
            operadora: 'Unitel'
        };
        
    } catch (error) {
        console.error("Erro ao criar conta virtual:", error);
        throw error;
    }
};

// ========================================
// FUNÇÃO: REGISTRAR MOVIMENTO NA CONTA VIRTUAL
// ========================================
const registrarMovimento = async (contaVirtualId, tipo, valor, descricao) => {
    try {
        await conexao.promise().query(`
            INSERT INTO movimentos_contas_virtuais 
            (conta_virtual_id, tipo, valor, descricao, data_movimentacao)
            VALUES (?, ?, ?, ?, NOW())
        `, [contaVirtualId, tipo, valor, descricao]);
        
        // Atualizar saldo da conta
        if (tipo === 'credito') {
            await conexao.promise().query(`
                UPDATE contas_virtuais 
                SET saldo = saldo + ? 
                WHERE id = ?
            `, [valor, contaVirtualId]);
        } else if (tipo === 'debito') {
            await conexao.promise().query(`
                UPDATE contas_virtuais 
                SET saldo = saldo - ? 
                WHERE id = ?
            `, [valor, contaVirtualId]);
        }
        
    } catch (error) {
        console.error("Erro ao registrar movimento:", error);
        throw error;
    }
};

// ========================================
// FUNÇÃO: CALCULAR FRETE BASEADO NO PESO
// ========================================
const calcularFrete = (peso) => {
    if (peso >= 10 && peso <= 30) return { base: 10000, comissao: 1000 };
    if (peso >= 31 && peso <= 50) return { base: 15000, comissao: 1500 };
    if (peso >= 51 && peso <= 70) return { base: 20000, comissao: 2000 };
    if (peso >= 71 && peso <= 100) return { base: 25000, comissao: 2500 };
    if (peso >= 101 && peso <= 300) return { base: 35000, comissao: 3500 };
    if (peso >= 301 && peso <= 500) return { base: 50000, comissao: 5000 };
    if (peso >= 501 && peso <= 1000) return { base: 80000, comissao: 8000 };
    if (peso >= 1001 && peso <= 2000) return { base: 120000, comissao: 12000 };
    return { base: 0, comissao: 0 };
};


  const validarCompatibilidadeOperadoras = async (tipoPagamento, idVendedor, idTransportadora = null) => {
    try {
        const operadoraPagamento = TIPOS_PAGAMENTO[tipoPagamento].operadora;
        const problemas = [];
        const avisos = [];
        
        // 1. Buscar conta virtual do vendedor
        const contaVendedor = await criarOuBuscarContaVirtual(idVendedor, 'Agricultor');
        
        // 2. Verificar se vendedor tem conta na operadora do pagamento
        let vendedorCompativel = false;
        if (operadoraPagamento === 'Unitel' && contaVendedor.numero_unitel) {
            vendedorCompativel = true;
        } else if (operadoraPagamento === 'Africell' && contaVendedor.numero_africell) {
            vendedorCompativel = true;
        } else if (operadoraPagamento === 'MulticaixaExpress') {
            // Multicaixa Express pode transferir para qualquer operadora
            vendedorCompativel = true;
            avisos.push('Multicaixa Express - transferência será convertida automaticamente');
        }
        
        if (!vendedorCompativel) {
            problemas.push({
                tipo: 'vendedor',
                operadora: operadoraPagamento,
                mensagem: `Vendedor não possui conta ${operadoraPagamento}`,
                solucao: `Cadastre uma conta ${operadoraPagamento} no perfil`
            });
        }
        
        // 3. Verificar transportadora (se fornecida)
        if (idTransportadora) {
            const contaTransportadora = await criarOuBuscarContaVirtual(idTransportadora, 'Transportadora');
            
            let transportadoraCompativel = false;
            if (operadoraPagamento === 'Unitel' && contaTransportadora.numero_unitel) {
                transportadoraCompativel = true;
            } else if (operadoraPagamento === 'Africell' && contaTransportadora.numero_africell) {
                transportadoraCompativel = true;
            } else if (operadoraPagamento === 'MulticaixaExpress') {
                transportadoraCompativel = true;
                avisos.push('Multicaixa Express - transferência para transportadora será convertida');
            }
            
            if (!transportadoraCompativel) {
                problemas.push({
                    tipo: 'transportadora',
                    operadora: operadoraPagamento,
                    mensagem: `Transportadora não possui conta ${operadoraPagamento}`,
                    solucao: `Solicite cadastro de conta ${operadoraPagamento}`
                });
            }
        }
        
        return {
            compativel: problemas.length === 0,
            problemas: problemas,
            avisos: avisos,
            operadora_pagamento: operadoraPagamento
        };
        
    } catch (error) {
        console.error("Erro na validação de operadoras:", error);
        return {
            compativel: false,
            problemas: [{ tipo: 'sistema', mensagem: 'Erro interno na validação' }],
            avisos: []
        };
    }
};

// ========================================
// FUNÇÃO: LISTAR MÉTODOS DE PAGAMENTO COMPATÍVEIS
// ========================================
const listarMetodosPagamentoCompativeis = async (idVendedor, idTransportadora = null) => {
    try {
        const contaVendedor = await criarOuBuscarContaVirtual(idVendedor, 'Agricultor');
        const contaTransportadora = idTransportadora ? 
            await criarOuBuscarContaVirtual(idTransportadora, 'Transportadora') : null;
        
        const metodosCompativeis = [];
        
        for (const [chave, metodo] of Object.entries(TIPOS_PAGAMENTO)) {
            if (!metodo.ativo) continue;
            
            let compativel = true;
            const restricoes = [];
            
            // Verificar compatibilidade do vendedor
            if (metodo.operadora === 'Unitel' && !contaVendedor.numero_unitel) {
                compativel = false;
                restricoes.push('Vendedor sem conta Unitel');
            } else if (metodo.operadora === 'Africell' && !contaVendedor.numero_africell) {
                compativel = false;
                restricoes.push('Vendedor sem conta Africell');
            }
            
            // Verificar compatibilidade da transportadora
            if (contaTransportadora) {
                if (metodo.operadora === 'Unitel' && !contaTransportadora.numero_unitel) {
                    compativel = false;
                    restricoes.push('Transportadora sem conta Unitel');
                } else if (metodo.operadora === 'Africell' && !contaTransportadora.numero_africell) {
                    compativel = false;
                    restricoes.push('Transportadora sem conta Africell');
                }
            }
            
            metodosCompativeis.push({
                chave: chave,
                nome: metodo.nome,
                taxa: `${(metodo.taxa * 100).toFixed(1)}%`,
                operadora: metodo.operadora,
                compativel: compativel,
                restricoes: restricoes,
                metodos_disponveis: metodo.metodos
            });
        }
        
        return metodosCompativeis;
        
    } catch (error) {
        console.error("Erro ao listar métodos compatíveis:", error);
        return [];
    }
};

// ========================================
// MIDDLEWARE: VALIDAR ANTES DO PROCESSAMENTO
// ========================================

const middlewareValidacaoOperadoras = async (req, res, next) => {
    try {
        const { tipo_pagamento, id_vendedor, id_transportadora } = req.body;
        
        // Validar compatibilidade
        const resultadoValidacao = await validarCompatibilidadeOperadoras(
            tipo_pagamento, 
            id_vendedor, 
            id_transportadora
        );
        
        if (!resultadoValidacao.compativel) {
            return res.status(400).json({
                sucesso: false,
                erro: 'Incompatibilidade de operadoras',
                detalhes: resultadoValidacao.problemas,
                sugestao: 'Escolha outro método de pagamento ou atualize as contas dos usuários'
            });
        }
        
        // Se há avisos, incluir na resposta mas continuar
        if (resultadoValidacao.avisos.length > 0) {
            req.avisos_operadoras = resultadoValidacao.avisos;
        }
        
        next();
        
    } catch (error) {
        console.error("Erro no middleware de validação:", error);
        return res.status(500).json({
            sucesso: false,
            erro: 'Erro interno na validação de operadoras'
        });
    }
};

// ========================================
// FUNÇÃO: SUA FUNÇÃO ORIGINAL DE DIVISÃO (SEM ALTERAÇÕES)
// ========================================
const calcularDivisaoValores = async (valorBruto, tipoPagamento, pesoTotal = 10, usuarioPremium = false) => {
    // 1. Taxa do provedor de pagamento
    const taxaProvedor = Math.round(valorBruto * TIPOS_PAGAMENTO[tipoPagamento].taxa);
    
    // 2. Cálculo do frete
    const dadosFrete = calcularFrete(pesoTotal);
    const valorFreteBase = dadosFrete.base;
    const comissaoFrete = dadosFrete.comissao;
    const valorFreteTotal = valorFreteBase + comissaoFrete;
    
    // 3. Comissão da plataforma
    let taxaComissao = CONFIGURACOES_PLATAFORMA.COMISSAO_PADRAO; // 10%
    if (usuarioPremium) {
        taxaComissao = CONFIGURACOES_PLATAFORMA.COMISSAO_PREMIUM; // 8%
    }
    
    const valorSemTaxas = valorBruto - taxaProvedor - valorFreteTotal;
    const comissaoPlataforma = Math.round(valorSemTaxas * taxaComissao);
    
    // 4. Valor líquido que o vendedor recebe
    const valorLiquidoVendedor = valorSemTaxas - comissaoPlataforma;
    
    return {
        valor_bruto: Math.round(valorBruto),
        taxa_provedor: taxaProvedor,
        valor_frete_base: valorFreteBase,
        comissao_frete: comissaoFrete,
        valor_frete_total: valorFreteTotal,
        comissao_plataforma: comissaoPlataforma,
        valor_liquido_vendedor: Math.round(valorLiquidoVendedor),
        
        divisao: {
            vendedor: Math.round(valorLiquidoVendedor),
            transportadora: valorFreteBase,
            comissao_transporte: comissaoFrete,
            plataforma: comissaoPlataforma,
            provedor_pagamento: taxaProvedor
        }
    };
};

// ========================================
// FUNÇÃO: NOVA - CALCULAR DIVISÃO COM VALIDAÇÃO DE OPERADORAS
// ========================================

const calcularDivisaoComValidacao = async (
    valorBruto, 
    tipoPagamento, 
    idVendedor,
    idTransportadora = null,
    pesoTotal = 10, 
    usuarioPremium = false
) => {
    // 1. PRIMEIRO: Validar operadoras
    const validacao = await validarCompatibilidadeOperadoras(
        tipoPagamento, 
        idVendedor, 
        idTransportadora
    );
    
    if (!validacao.compativel) {
        throw new Error(`Incompatibilidade de operadoras: ${JSON.stringify(validacao.problemas)}`);
    }
    
    // 2. SEGUNDO: Usar sua função original de cálculo
    const calculoOriginal = calcularDivisaoValores(
        valorBruto, 
        tipoPagamento, 
        pesoTotal, 
        usuarioPremium
    );
    
    // 3. TERCEIRO: Adicionar informações de validação
    return {
        ...calculoOriginal,
        validacao_operadoras: {
            operadora_pagamento: validacao.operadora_pagamento,
            compativel: true,
            avisos: validacao.avisos
        }
    };
};

// ========================================
// ROTA: GERAR REFERÊNCIA DE PAGAMENTO
// ========================================

router.post("/gerar-referencia", autenticarToken, async (req, res) => {
    // DEBUG: Ver exatamente o que está chegando
    console.log("=== DEBUG GERAR REFERÊNCIA ===");
    console.log("Body completo:", JSON.stringify(req.body, null, 2));
    console.log("Headers:", req.headers);
    console.log("Usuario logado:", req.usuario);
    
    const { tipo_pagamento, valor_total, carrinho_id } = req.body;
    const id_usuario = req.usuario.id_usuario;
    const id_vendedor = req.body.id_vendedor || id_usuario;
    
    // 1. VALIDAÇÕES BÁSICAS (obrigatórias)
    if (!id_usuario || !tipo_pagamento || !valor_total) {
        console.error("Dados obrigatórios faltando:", { id_usuario, tipo_pagamento, valor_total });
        return res.status(400).json({ 
            erro: "Dados obrigatórios: id_usuario, tipo_pagamento, valor_total",
            recebido: { id_usuario, tipo_pagamento, valor_total }
        });
    }

    // 2. VALIDAR TIPO DE PAGAMENTO
    if (!TIPOS_PAGAMENTO[tipo_pagamento]) {
        console.error("Tipo de pagamento inválido:", tipo_pagamento);
        console.error("Tipos disponíveis:", Object.keys(TIPOS_PAGAMENTO));
        return res.status(400).json({ 
            erro: "Tipo de pagamento inválido",
            tipos_disponiveis: Object.keys(TIPOS_PAGAMENTO),
            recebido: tipo_pagamento,
            tipo_da_variavel: typeof tipo_pagamento
        });
    }

    try {
        // 3. VERIFICAR SE USUÁRIO EXISTE (básico)
        const [usuario] = await conexao.promise().query(`
            SELECT id_usuario, nome, email FROM usuarios WHERE id_usuario = ?
        `, [id_usuario]);

        if (usuario.length === 0) {
            return res.status(404).json({ erro: "Usuário não encontrado" });
        }

        console.log("Usuário encontrado:", usuario[0]);

        // 4. GERAR REFERÊNCIA (SEM validação de operadoras por enquanto)
        const dadosReferencia = gerarReferenciaPagamento(valor_total, tipo_pagamento);
        
        console.log("Referência gerada:", dadosReferencia);

        // 5. SALVAR REFERÊNCIA NO BANCO
        const [resultado] = await conexao.promise().query(`
            INSERT INTO referencias_pagamento 
            (referencia, id_usuario, tipo_pagamento, valor_total, carrinho_id, status, valida_ate, criada_em)
            VALUES (?, ?, ?, ?, ?, 'ativa', ?, NOW())
        `, [
            dadosReferencia.referencia,
            id_usuario,
            tipo_pagamento,
            dadosReferencia.valor_total,
            carrinho_id,
            dadosReferencia.valida_ate
        ]);

        console.log("Referência salva no banco, ID:", resultado.insertId);

        // 6. BUSCAR DADOS DO MÉTODO DE PAGAMENTO
        const metodoPagamento = TIPOS_PAGAMENTO[tipo_pagamento];

        // 7. MONTAR INSTRUÇÕES DETALHADAS
        const instrucoes = {
            unitel_money: {
                passo1: "Digite *409# no seu telefone Unitel",
                passo2: "Selecione a opção de pagamento",
                passo3: `Insira a referência: ${dadosReferencia.referencia}`,
                passo4: `Confirme o valor: ${(dadosReferencia.valor_total / 100).toFixed(2)} Kz`
            },
            africell_money: {
                passo1: "Digite *777# no seu telefone Africell", 
                passo2: "Selecione a opção de pagamento",
                passo3: `Insira a referência: ${dadosReferencia.referencia}`,
                passo4: `Confirme o valor: ${(dadosReferencia.valor_total / 100).toFixed(2)} Kz`
            },
            multicaixa_express: {
                passo1: "Vá ao ATM Multicaixa mais próximo OU abra o App Multicaixa",
                passo2: "Selecione 'Pagamento de Serviços'",
                passo3: `Insira a referência: ${dadosReferencia.referencia}`,
                passo4: `Confirme o valor: ${(dadosReferencia.valor_total / 100).toFixed(2)} Kz`
            }
        };

        // 8. RESPOSTA DE SUCESSO
        res.json({
            sucesso: true,
            referencia: {
                codigo: dadosReferencia.referencia,
                valor: dadosReferencia.valor_total,
                valor_formatado: `${(dadosReferencia.valor_total / 100).toFixed(2)} Kz`,
                metodo_pagamento: metodoPagamento.nome,
                operadora: metodoPagamento.operadora,
                taxa: `${(metodoPagamento.taxa * 100).toFixed(1)}%`,
                valida_ate: dadosReferencia.valida_ate,
                status: 'ativa'
            },
            instrucoes: instrucoes[tipo_pagamento],
            observacoes: [
                "⚠️ Esta referência já contém TODOS os valores (produto + frete + taxas)",
                "💡 Você só precisa inserir o código da referência",
                "⏰ A referência é válida por 24 horas",
                "📱 Mantenha seu telefone por perto para confirmação"
            ],
            debug_info: {
                usuario_id: id_usuario,
                carrinho_id: carrinho_id,
                referencia_id: resultado.insertId,
                timestamp: new Date().toISOString()
            }
        });

        console.log("Resposta enviada com sucesso!");

    } catch (error) {
        console.error("Erro completo:", error);
        console.error("Stack trace:", error.stack);
        
        res.status(500).json({
            erro: "Erro interno ao gerar referência de pagamento",
            detalhe: error.message,
            codigo_erro: "REF_GEN_ERROR",
            sugestao: "Tente novamente em alguns segundos"
        });
    }
});



// router.post("/simular-pagamento", autenticarToken, async (req, res) => {
//     const { referencia } = req.body;
//     const id_usuario = req.usuario.id_usuario;

//     // Validações básicas
//     if (!referencia) {
//         return res.status(400).json({ 
//             erro: "Referência é obrigatória",
//             codigo: "REF_OBRIGATORIA"
//         });
//     }

//     try {
//         console.log(`🧪 SIMULAÇÃO - Usuário: ${id_usuario}, Ref: ${referencia}`);

//         // Buscar referência do usuário logado
//         const [refEncontrada] = await conexao.promise().query(`
//             SELECT * FROM referencias_pagamento 
//             WHERE referencia = ? AND id_usuario = ? AND status = 'ativa'
//         `, [referencia, id_usuario]);

//         if (refEncontrada.length === 0) {
//             console.log(`❌ Tentativa de uso de referência inválida/já usada: ${referencia}`);
//             return res.status(404).json({ 
//                 erro: "Referência não encontrada, inválida ou já processada",
//                 codigo: "REF_NAO_ENCONTRADA",
//                 dica: "Verifique se a referência está correta e ainda está ativa"
//             });
//         }

//         const dadosRef = refEncontrada[0];
//         console.log("📋 Dados da referência encontrada:", dadosRef);

//         // Verificar validade (30 minutos)
//         const agora = new Date();
//         const criadaEm = new Date(dadosRef.criada_em);
//         const diffMinutos = (agora - criadaEm) / (1000 * 60);
        
//         if (diffMinutos > 30) {
//             // Expirar automaticamente
//             await conexao.promise().query(`
//                 UPDATE referencias_pagamento 
//                 SET status = 'expirada' 
//                 WHERE referencia = ?
//             `, [referencia]);

//             return res.status(400).json({ 
//                 erro: "Referência expirada (máximo 30 minutos)",
//                 codigo: "REF_EXPIRADA",
//                 tempo_restante: 0,
//                 dica: "Gere uma nova referência para continuar"
//             });
//         }

//         // VERSÃO SIMPLIFICADA - Calcular divisão simples
//         const valorTotal = parseFloat(dadosRef.valor_total);
//         const taxaPercentual = 5; // 5% de taxa
//         const taxaValor = Math.round((valorTotal * taxaPercentual) / 100);
//         const valorLiquido = valorTotal - taxaValor;

//         const divisao = {
//             valor_total: valorTotal,
//             taxa_percentual: taxaPercentual,
//             taxa_valor: taxaValor,
//             valor_liquido_vendedor: valorLiquido,
//             taxa_total: taxaValor
//         };

//         console.log("💰 Divisão calculada:", divisao);

//         // VERSÃO COMPLETAMENTE CORRIGIDA - Buscar ou criar conta virtual
//         let contaVirtual;
//         let contasExistentes = []; // Declarar a variável aqui
//         try {
//             // Buscar conta existente do usuário
//             const resultadoContas = await conexao.promise().query(`
//                 SELECT * FROM contas_virtuais 
//                 WHERE id_usuario = ?
//                 ORDER BY id DESC
//                 LIMIT 1
//             `, [id_usuario]);
            
//             contasExistentes = resultadoContas[0]; // Atribuir o resultado

//             if (contasExistentes.length > 0) {
//                 contaVirtual = contasExistentes[0];
//                 console.log("💳 Conta virtual encontrada:", contaVirtual.id);
//             } else {
//                 // Criar nova conta virtual incluindo TODOS os campos NOT NULL
//                 const numeroAfricell = `9${Math.floor(Math.random() * 100000000).toString().padStart(8, '0')}`;
//                 const numeroUnitel = `9${Math.floor(Math.random() * 100000000).toString().padStart(8, '0')}`;
                
//                 // Incluir todos os campos obrigatórios (NOT NULL)
//                 const [resultadoConta] = await conexao.promise().query(`
//                     INSERT INTO contas_virtuais 
//                     (id_usuario, transportadora_id, tipo_conta, saldo, numero_africell, numero_Unitel, operadora)
//                     VALUES (?, ?, ?, ?, ?, ?, ?)
//                 `, [
//                     id_usuario,           // id_usuario (NOT NULL)
//                     1,                   // transportadora_id (NOT NULL) - usando ID 1 como padrão
//                     'Agricultor',        // tipo_conta 
//                     0.00,               // saldo (tem padrão 0.00)
//                     numeroAfricell,     // numero_africell (NOT NULL)
//                     numeroUnitel,       // numero_Unitel (NOT NULL)
//                     'Unitel'           // operadora (NOT NULL)
//                 ]);

//                 contaVirtual = {
//                     id: resultadoConta.insertId,
//                     id_usuario: id_usuario,
//                     transportadora_id: 1,
//                     tipo_conta: 'Agricultor',
//                     saldo: 0.00,
//                     numero_africell: numeroAfricell,
//                     numero_Unitel: numeroUnitel,
//                     operadora: 'Unitel'
//                 };
                
//                 console.log("💳 Nova conta virtual criada:", contaVirtual.id);
//             }
//         } catch (errorConta) {
//             console.error("❌ Erro ao buscar/criar conta virtual:", errorConta);
//             console.error("❌ Detalhes do erro:", errorConta.message);
//             console.error("❌ SQL Error Code:", errorConta.code);
//             console.error("❌ SQL Error Number:", errorConta.errno);
//             throw new Error("Erro ao processar conta virtual: " + errorConta.message);
//         }

//         // VERSÃO CORRIGIDA - Registrar movimento
//         const saldoAnterior = parseFloat(contaVirtual.saldo) || 0;
//         const novoSaldo = saldoAnterior + valorLiquido;

//         try {
//             // Tentar registrar movimento apenas se a tabela existir
//             try {
//                 // Registrar movimento na tabela correta: movimentacoes_conta_virtual
//                 await conexao.promise().query(`
//                     INSERT INTO movimentacoes_conta_virtual (conta_virtual_id, tipo, valor, descricao)
//                     VALUES (?, 'credito', ?, ?)
//                 `, [contaVirtual.id, valorLiquido, `💰 Pagamento simulado - Ref: ${referencia}`]);
                
//                 console.log("💰 Movimento registrado na tabela movimentacoes_conta_virtual");
                
//             } catch (errorMovimento) {
//                 console.log("⚠️ Erro ao registrar movimento:", errorMovimento.message);
//                 console.log("⚠️ Continuando sem registrar movimento...");
//             }

//             // Atualizar saldo da conta virtual
//             await conexao.promise().query(`
//                 UPDATE contas_virtuais 
//                 SET saldo = ?
//                 WHERE id = ?
//             `, [novoSaldo, contaVirtual.id]);

//             contaVirtual.saldo = novoSaldo;
//             console.log("💰 Saldo atualizado para:", novoSaldo);

//         } catch (errorMovimento) {
//             console.error("❌ Erro ao registrar movimento:", errorMovimento);
//             throw new Error("Erro ao registrar movimento na conta: " + errorMovimento.message);
//         }

//         // CORREÇÃO PRINCIPAL: Usar apenas campos que existem na tabela
//         const transacaoId = `SIM_${Date.now()}`;
        
//         // Primeiro, vamos verificar quais campos existem na tabela referencias_pagamento
//         try {
//             // Tentativa com campos básicos que provavelmente existem
//             await conexao.promise().query(`
//                 UPDATE referencias_pagamento 
//                 SET status = 'paga'
//                 WHERE referencia = ?
//             `, [referencia]);
            
//             console.log(`✅ Status da referência atualizado para 'paga'`);
            
//         } catch (errorUpdate) {
//             console.error("❌ Erro ao atualizar referência:", errorUpdate);
//             // Continuar mesmo se não conseguir atualizar
//         }

//         // Tentar criar um registro na tabela de pagamentos se ela existir
//         try {
//             // Verificar se conseguimos inserir na tabela pagamentos
//             // Incluir id_pedido que é obrigatório
//             const [resultadoPagamento] = await conexao.promise().query(`
//                 INSERT INTO pagamentos 
//                 (id_pedido, id_comprador, id_vendedor, tipo_pagamento, telefone_pagador, transacao_id, 
//                  referencia_pagamento, valor_bruto, valor_taxa, valor_liquido, status_pagamento)
//                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
//             `, [
//                 dadosRef.carrinho_id || 0,  // id_pedido (usando carrinho_id ou 0 como fallback)
//                 id_usuario,           // id_comprador
//                 dadosRef.id_usuario,  // id_vendedor (mesmo usuário na simulação)
//                 'unitel_money',       // tipo_pagamento
//                 contaVirtual.numero_Unitel, // telefone_pagador
//                 transacaoId,          // transacao_id
//                 referencia,           // referencia_pagamento
//                 valorTotal,           // valor_bruto
//                 taxaValor,            // valor_taxa
//                 valorLiquido,         // valor_liquido
//                 'pago'                // status_pagamento
//             ]);
            
//             console.log("💰 Pagamento registrado na tabela pagamentos, ID:", resultadoPagamento.insertId);
            
//         } catch (errorPagamento) {
//             console.log("⚠️ Erro ao registrar pagamento:", errorPagamento.message);
//             console.log("⚠️ Continuando sem registrar na tabela pagamentos...");
//         }

//         console.log(`✅ SIMULAÇÃO CONCLUÍDA - Ref: ${referencia}, Valor: ${dadosRef.valor_total}`);

//         // RESPOSTA COMPLETA COM TODOS OS DADOS NECESSÁRIOS
//         res.json({
//             sucesso: true,
//             MODO: "🧪 SIMULAÇÃO",
//             timestamp: new Date().toISOString(),
//             pagamento: {
//                 referencia: referencia,
//                 valor_original: valorTotal,
//                 valor_pago: valorTotal,
//                 valor_recebido: valorLiquido,
//                 taxa_aplicada: taxaValor,
//                 conta_virtual: {
//                     id: contaVirtual.id,
//                     transportadora_id: contaVirtual.transportadora_id,
//                     tipo_conta: contaVirtual.tipo_conta,
//                     numero_africell: contaVirtual.numero_africell,
//                     numero_unitel: contaVirtual.numero_Unitel,
//                     operadora: contaVirtual.operadora,
//                     saldo_anterior: saldoAnterior,
//                     saldo_atual: parseFloat(contaVirtual.saldo)
//                 },
//                 divisao_valores: divisao,
//                 status: 'pago',
//                 transacao_id: transacaoId,
//                 processado_em: new Date().toISOString(),
//                 // DADOS COMPLETOS PARA SIMULAÇÃO
//                 dados_simulacao: {
//                     metodo_pagamento: 'unitel_money',
//                     telefone_simulado: contaVirtual.numero_Unitel,
//                     operadora_usada: contaVirtual.operadora,
//                     tipo_transacao: 'pagamento_simulado',
//                     tempo_processamento: '2.3s',
//                     codigo_confirmacao: `CONF_${Math.random().toString(36).substr(2, 8).toUpperCase()}`,
//                     hash_transacao: `HASH_${Date.now()}_${Math.random().toString(36).substr(2, 12)}`
//                 }
//             },
//             mensagem: "💰 Pagamento simulado com sucesso! Valores creditados automaticamente.",
//             proximos_passos: [
//                 "Consulte seu saldo atualizado",
//                 "Verifique o extrato de movimentos", 
//                 "A referência agora está marcada como 'paga'",
//                 "Use os dados da conta virtual para próximas transações"
//             ],
//             // INFORMAÇÕES TÉCNICAS PARA DEBUG
//             debug_info: {
//                 referencia_dados: {
//                     id_referencia: dadosRef.id,
//                     criada_em: dadosRef.criada_em,
//                     tempo_restante_minutos: Math.max(0, 30 - Math.floor(diffMinutos)),
//                     valor_original: dadosRef.valor_total
//                 },
//                 conta_virtual_dados: {
//                     conta_criada_agora: contasExistentes.length === 0,
//                     saldo_antes: saldoAnterior,
//                     saldo_depois: parseFloat(contaVirtual.saldo),
//                     credito_aplicado: valorLiquido
//                 },
//                 calculo_taxas: {
//                     valor_bruto: valorTotal,
//                     percentual_taxa: taxaPercentual,
//                     valor_taxa: taxaValor,
//                     valor_liquido: valorLiquido
//                 }
//             }
//         });

//     } catch (error) {
//         console.error("❌ ERRO DETALHADO ao simular pagamento:", error);
//         console.error("❌ Stack trace:", error.stack);
        
//         res.status(500).json({
//             erro: "Erro interno ao simular pagamento",
//             codigo: "ERRO_SIMULACAO",
//             detalhe: process.env.NODE_ENV === 'development' ? error.message : 'Erro interno do servidor',
//             timestamp: new Date().toISOString(),
//             debug_info: process.env.NODE_ENV === 'development' ? {
//                 error_message: error.message,
//                 error_stack: error.stack
//             } : undefined
//         });
//     }
// });



router.post("/simular-pagamento", autenticarToken, async (req, res) => {
    const { referencia, metodo_pagamento } = req.body; // Adicionar metodo_pagamento no body
    const id_usuario = req.usuario.id_usuario;

    // Validações básicas
    if (!referencia) {
        return res.status(400).json({ 
            erro: "Referência é obrigatória",
            codigo: "REF_OBRIGATORIA"
        });
    }

    if (metodo_pagamento.length === 0) {
        return res.status(400).json({ 
            erro: "Método de pagamento é obrigatório",
            codigo: "METODO_OBRIGATORIO"
        });
    }

    try {
        console.log(`🧪 SIMULAÇÃO - Usuário: ${id_usuario}, Ref: ${referencia}, Método: ${metodo_pagamento}`);

        // ✅ NOVA VALIDAÇÃO: Verificar compatibilidade da referência com método de pagamento
        const validarMetodoPagamento = (referencia, metodoPagamento) => {
            const mapeamentoPrefixos = {
                'UM': 'unitel_money',      // Prefixo UM só aceita unitel_money
                'AM': 'africell_money',    // Prefixo AM só aceita africell_money  
                'MX': 'multicaixa_express' // Prefixo MX só aceita multicaixa_express
            };

            // Extrair prefixo da referência (primeiros 2 caracteres)
            const prefixoRef = referencia.substring(0, 2).toUpperCase();
            
            // Verificar se o prefixo existe no mapeamento
            if (!mapeamentoPrefixos[prefixoRef]) {
                return {
                    valido: false,
                    erro: "Prefixo da referência não reconhecido",
                    codigo: "PREFIXO_INVALIDO",
                    prefixo_encontrado: prefixoRef,
                    prefixos_validos: Object.keys(mapeamentoPrefixos)
                };
            }

            // Verificar se o método corresponde ao prefixo
            const metodoEsperado = mapeamentoPrefixos[prefixoRef];
            if (metodoPagamento !== metodoEsperado) {
                return {
                    valido: false,
                    erro: "Método de pagamento incompatível com a referência",
                    codigo: "METODO_INCOMPATIVEL",
                    prefixo_referencia: prefixoRef,
                    metodo_esperado: metodoEsperado,
                    metodo_recebido: metodoPagamento,
                    dica: `Esta referência (${prefixoRef}) só pode ser paga via ${metodoEsperado}`
                };
            }

            return {
                valido: true,
                prefixo: prefixoRef,
                metodo_confirmado: metodoEsperado
            };
        };

        // Executar validação
        const validacao = validarMetodoPagamento(referencia, metodo_pagamento);
        
        if (!validacao.valido) {
            console.log(`❌ Método incompatível - Ref: ${referencia}, Método: ${metodo_pagamento}`);
            return res.status(400).json({
                erro: validacao.erro,
                codigo: validacao.codigo,
                detalhes: {
                    referencia: referencia,
                    prefixo_extraido: validacao.prefixo_encontrado || referencia.substring(0, 2),
                    metodo_tentado: metodo_pagamento,
                    metodo_esperado: validacao.metodo_esperado,
                    prefixos_validos: validacao.prefixos_validos
                },
                dica: validacao.dica || "Verifique se está usando o método correto para esta referência",
                exemplos: {
                    "UM123456789": "unitel_money",
                    "AM123456789": "africell_money", 
                    "MX123456789": "multicaixa_express"
                }
            });
        }

        console.log(`✅ Validação aprovada - Prefixo: ${validacao.prefixo}, Método: ${validacao.metodo_confirmado}`);

        // 1. VALIDAÇÃO DUPLICADA: Verificar se já existe pagamento para esta referência
        const [pagamentoExistente] = await conexao.promise().query(`
            SELECT id, status_pagamento, referencia_pagamento 
            FROM pagamentos 
            WHERE referencia_pagamento = ? AND status_pagamento IN ('pago', 'processando')
        `, [referencia]);

        if (pagamentoExistente.length > 0) {
            console.log(`❌ Tentativa de pagamento duplicado para referência: ${referencia}`);
            return res.status(400).json({ 
                erro: "Esta referência já foi paga anteriormente",
                codigo: "PAGAMENTO_DUPLICADO",
                dica: "Não é possível processar o mesmo pagamento duas vezes",
                pagamento_existente: {
                    id: pagamentoExistente[0].id,
                    status: pagamentoExistente[0].status_pagamento,
                    referencia: pagamentoExistente[0].referencia_pagamento
                }
            });
        }

        // Buscar referência do usuário logado
        const [refEncontrada] = await conexao.promise().query(`
            SELECT * FROM referencias_pagamento 
            WHERE referencia = ? AND id_usuario = ? AND status = 'ativa'
        `, [referencia, id_usuario]);

        if (refEncontrada.length === 0) {
            console.log(`❌ Tentativa de uso de referência inválida/já usada: ${referencia}`);
            return res.status(404).json({ 
                erro: "Referência não encontrada, inválida ou já processada",
                codigo: "REF_NAO_ENCONTRADA",
                dica: "Verifique se a referência está correta e ainda está ativa"
            });
        }

        const dadosRef = refEncontrada[0];
        console.log("📋 Dados da referência encontrada:", dadosRef);

        // ✅ VALIDAÇÃO ADICIONAL: Verificar se o método da referência bate com o solicitado
        if (dadosRef.tipo_pagamento !== metodo_pagamento) {
            console.log(`❌ Método da referência (${dadosRef.tipo_pagamento}) diferente do solicitado (${metodo_pagamento})`);
            return res.status(400).json({
                erro: "Método de pagamento não corresponde ao da referência original",
                codigo: "METODO_REF_INCOMPATIVEL",
                detalhes: {
                    metodo_referencia: dadosRef.tipo_pagamento,
                    metodo_solicitado: metodo_pagamento,
                    referencia: referencia
                },
                dica: `Esta referência foi gerada para ${dadosRef.tipo_pagamento}, use o método correto`
            });
        }

        // Verificar validade (30 minutos)
        const agora = new Date();
        const criadaEm = new Date(dadosRef.criada_em);
        const diffMinutos = (agora - criadaEm) / (1000 * 60);
        
        if (diffMinutos > 30) {
            // Expirar automaticamente
            await conexao.promise().query(`
                UPDATE referencias_pagamento 
                SET status = 'expirada' 
                WHERE referencia = ?
            `, [referencia]);

            return res.status(400).json({ 
                erro: "Referência expirada (máximo 30 minutos)",
                codigo: "REF_EXPIRADA",
                tempo_restante: 0,
                dica: "Gere uma nova referência para continuar"
            });
        }

        // 2. BUSCAR DADOS REAIS DO USUÁRIO
        const [dadosUsuario] = await conexao.promise().query(`
            SELECT id_usuario, nome, email, telefone, tipo_usuario 
            FROM usuarios 
            WHERE id_usuario = ?
        `, [id_usuario]);

        if (dadosUsuario.length === 0) {
            return res.status(404).json({ 
                erro: "Usuário não encontrado",
                codigo: "USUARIO_NAO_ENCONTRADO"
            });
        }

        const usuario = dadosUsuario[0];
        console.log("👤 Dados do usuário:", usuario);

        // 3. BUSCAR NÚMERO DO PEDIDO PARA PAGAMENTO (CORREÇÃO AQUI!)
        let numeroParaPagamento = null;
        
        if (dadosRef.carrinho_id) {
            const [enderecoPedido] = await conexao.promise().query(`
                SELECT numero 
                FROM endereco_pedidos 
                WHERE id_pedido = ?
                LIMIT 1
            `, [dadosRef.carrinho_id]);
            
            if (enderecoPedido.length > 0) {
                numeroParaPagamento = enderecoPedido[0].numero;
                console.log("📱 Número encontrado no endereço do pedido:", numeroParaPagamento);
            }
        }

        // Fallback: se não encontrar no endereço do pedido, usar o telefone do usuário
        if (!numeroParaPagamento) {
            numeroParaPagamento = usuario.telefone;
            console.log("📱 Usando telefone do usuário como fallback:", numeroParaPagamento);
        }

        // Se ainda não tiver número, gerar um simulado
        if (!numeroParaPagamento) {
            numeroParaPagamento = `9${Math.floor(Math.random() * 100000000).toString().padStart(8, '0')}`;
            console.log("📱 Número simulado gerado:", numeroParaPagamento);
        }

        // Calcular divisão de valores
        const valorTotal = parseFloat(dadosRef.valor_total);
        const taxaPercentual = 5; // 5% de taxa
        const taxaValor = Math.round((valorTotal * taxaPercentual) / 100);
        const valorLiquido = valorTotal - taxaValor;

        const divisao = {
            valor_total: valorTotal,
            taxa_percentual: taxaPercentual,
            taxa_valor: taxaValor,
            valor_liquido_vendedor: valorLiquido,
            taxa_total: taxaValor
        };

        console.log("💰 Divisão calculada:", divisao);

        // 4. BUSCAR OU CRIAR CONTA VIRTUAL COM DADOS REAIS
        let contaVirtual;
        let contasExistentes = [];

        try {
            // Buscar conta existente do usuário
            const resultadoContas = await conexao.promise().query(`
                SELECT * FROM contas_virtuais 
                WHERE id_usuario = ?
                ORDER BY id DESC
                LIMIT 1
            `, [id_usuario]);
            
            contasExistentes = resultadoContas[0];

            if (contasExistentes.length > 0) {
                contaVirtual = contasExistentes[0];
                console.log("💳 Conta virtual encontrada:", contaVirtual.id);
            } else {
                // Criar nova conta virtual com dados reais do usuário
                const numeroAfricell = numeroParaPagamento || `9${Math.floor(Math.random() * 100000000).toString().padStart(8, '0')}`;
                const numeroUnitel = numeroParaPagamento || `9${Math.floor(Math.random() * 100000000).toString().padStart(8, '0')}`;
                
                // ✅ CORREÇÃO: Determinar operadora baseada no método de pagamento validado
                let operadoraPagamento;
                switch(metodo_pagamento) {
                    case 'africell_money':
                        operadoraPagamento = 'Africell';
                        break;
                    case 'unitel_money':
                        operadoraPagamento = 'Unitel';
                        break;
                    case 'multicaixa_express':
                        operadoraPagamento = 'Multicaixa';
                        break;
                    default:
                        operadoraPagamento = 'Unitel'; // fallback
                }
                
                const [resultadoConta] = await conexao.promise().query(`
                    INSERT INTO contas_virtuais 
                    (id_usuario, transportadora_id, tipo_conta, saldo, numero_africell, numero_Unitel, operadora)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                `, [
                    id_usuario,
                    1, // transportadora_id padrão
                    usuario.tipo_usuario || 'Comprador',
                    0.00,
                    numeroAfricell,
                    numeroUnitel,
                    operadoraPagamento
                ]);

                contaVirtual = {
                    id: resultadoConta.insertId,
                    id_usuario: id_usuario,
                    transportadora_id: 1,
                    tipo_conta: usuario.tipo_usuario || 'Comprador',
                    saldo: 0.00,
                    numero_africell: numeroAfricell,
                    numero_Unitel: numeroUnitel,
                    operadora: operadoraPagamento
                };
                
                console.log("💳 Nova conta virtual criada:", contaVirtual.id);
            }
        } catch (errorConta) {
            console.error("❌ Erro ao buscar/criar conta virtual:", errorConta);
            throw new Error("Erro ao processar conta virtual: " + errorConta.message);
        }

        // Registrar movimento e atualizar saldo
        const saldoAnterior = parseFloat(contaVirtual.saldo) || 0;
        const novoSaldo = saldoAnterior + valorLiquido;

        try {
            // Registrar movimento
            await conexao.promise().query(`
                INSERT INTO movimentacoes_conta_virtual (conta_virtual_id, tipo, valor, descricao)
                VALUES (?, 'credito', ?, ?)
            `, [contaVirtual.id, valorLiquido, `💰 Pagamento ${metodo_pagamento} - Ref: ${referencia}`]);
            
            console.log("💰 Movimento registrado na tabela movimentacoes_conta_virtual");

            // Atualizar saldo
            await conexao.promise().query(`
                UPDATE contas_virtuais 
                SET saldo = ?
                WHERE id = ?
            `, [novoSaldo, contaVirtual.id]);

            contaVirtual.saldo = novoSaldo;
            console.log("💰 Saldo atualizado para:", novoSaldo);

        } catch (errorMovimento) {
            console.error("❌ Erro ao registrar movimento:", errorMovimento);
            throw new Error("Erro ao registrar movimento na conta: " + errorMovimento.message);
        }

        // 5. ATUALIZAR STATUS DA REFERÊNCIA
        await conexao.promise().query(`
            UPDATE referencias_pagamento 
            SET status = 'paga', data_pagamento = CURRENT_TIMESTAMP
            WHERE referencia = ?
        `, [referencia]);
        
        console.log(`✅ Status da referência atualizado para 'paga'`);

        // 6. REGISTRAR PAGAMENTO COM DADOS REAIS
        const transacaoId = `SIM_${Date.now()}`;
        
        // Usar o número encontrado no endereço do pedido
        const telefonePagador = numeroParaPagamento;

        try {
            const [resultadoPagamento] = await conexao.promise().query(`
                INSERT INTO pagamentos 
                (id_pedido, id_comprador, id_vendedor, tipo_pagamento, telefone_pagador, transacao_id, 
                 referencia_pagamento, valor_bruto, valor_taxa, valor_liquido, status_pagamento)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                dadosRef.carrinho_id,     // id_pedido
                id_usuario,               // id_comprador
                dadosRef.id_usuario,      // id_vendedor (pode ser diferente em cenário real)
                metodo_pagamento,         // ✅ usar método validado
                telefonePagador,          // número do endereço do pedido
                transacaoId,              // transacao_id
                referencia,               // referencia_pagamento
                valorTotal,               // valor_bruto
                taxaValor,                // valor_taxa
                valorLiquido,             // valor_liquido
                'pago'                    // status_pagamento
            ]);
            
            console.log("💰 Pagamento registrado na tabela pagamentos, ID:", resultadoPagamento.insertId);
            
        } catch (errorPagamento) {
            console.log("⚠️ Erro ao registrar pagamento:", errorPagamento.message);
            throw new Error("Erro ao registrar pagamento: " + errorPagamento.message);
        }

        console.log(`✅ SIMULAÇÃO CONCLUÍDA - Ref: ${referencia}, Valor: ${dadosRef.valor_total}, Método: ${metodo_pagamento}`);

        // RESPOSTA COMPLETA
        res.json({
            sucesso: true,
            MODO: "🧪 SIMULAÇÃO",
            timestamp: new Date().toISOString(),
            pagamento: {
                referencia: referencia,
                valor_original: valorTotal,
                valor_pago: valorTotal,
                valor_recebido: valorLiquido,
                taxa_aplicada: taxaValor,
                metodo_pagamento: metodo_pagamento, // ✅ incluir método usado
                prefixo_referencia: validacao.prefixo, // ✅ mostrar prefixo validado
                usuario_pagador: {
                    id: usuario.id_usuario,
                    nome: usuario.nome,
                    telefone: usuario.telefone,
                    numero_pagamento: numeroParaPagamento,
                    tipo: usuario.tipo_usuario
                },
                conta_virtual: {
                    id: contaVirtual.id,
                    transportadora_id: contaVirtual.transportadora_id,
                    tipo_conta: contaVirtual.tipo_conta,
                    numero_africell: contaVirtual.numero_africell,
                    numero_unitel: contaVirtual.numero_Unitel,
                    operadora: contaVirtual.operadora,
                    saldo_anterior: saldoAnterior,
                    saldo_atual: parseFloat(contaVirtual.saldo)
                },
                divisao_valores: divisao,
                status: 'pago',
                transacao_id: transacaoId,
                processado_em: new Date().toISOString(),
                dados_simulacao: {
                    metodo_pagamento: metodo_pagamento,
                    prefixo_validado: validacao.prefixo,
                    telefone_simulado: telefonePagador,
                    operadora_usada: contaVirtual.operadora,
                    tipo_transacao: 'pagamento_simulado',
                    tempo_processamento: '2.3s',
                    codigo_confirmacao: `CONF_${Math.random().toString(36).substr(2, 8).toUpperCase()}`,
                    hash_transacao: `HASH_${Date.now()}_${Math.random().toString(36).substr(2, 12)}`
                }
            },
            mensagem: `💰 Pagamento simulado com sucesso via ${metodo_pagamento}! Valores creditados automaticamente.`,
            proximos_passos: [
                "Consulte seu saldo atualizado",
                "Verifique o extrato de movimentos", 
                "A referência agora está marcada como 'paga'",
                "Use os dados da conta virtual para próximas transações"
            ],
            debug_info: {
                validacao_metodo: {
                    prefixo_referencia: validacao.prefixo,
                    metodo_confirmado: validacao.metodo_confirmado,
                    validacao_aprovada: true
                },
                referencia_dados: {
                    id_referencia: dadosRef.id,
                    criada_em: dadosRef.criada_em,
                    tempo_restante_minutos: Math.max(0, 30 - Math.floor(diffMinutos)),
                    valor_original: dadosRef.valor_total,
                    tipo_pagamento_original: dadosRef.tipo_pagamento
                },
                usuario_dados: {
                    nome: usuario.nome,
                    telefone_usuario: usuario.telefone,
                    numero_usado_pagamento: numeroParaPagamento,
                    operadora_escolhida: contaVirtual.operadora
                },
                conta_virtual_dados: {
                    conta_criada_agora: contasExistentes.length === 0,
                    saldo_antes: saldoAnterior,
                    saldo_depois: parseFloat(contaVirtual.saldo),
                    credito_aplicado: valorLiquido
                },
                calculo_taxas: {
                    valor_bruto: valorTotal,
                    percentual_taxa: taxaPercentual,
                    valor_taxa: taxaValor,
                    valor_liquido: valorLiquido
                }
            }
        });

    } catch (error) {
        console.error("❌ ERRO DETALHADO ao simular pagamento:", error);
        console.error("❌ Stack trace:", error.stack);
        
        res.status(500).json({
            erro: "Erro interno ao simular pagamento",
            codigo: "ERRO_SIMULACAO",
            detalhe: process.env.NODE_ENV === 'development' ? error.message : 'Erro interno do servidor',
            timestamp: new Date().toISOString(),
            debug_info: process.env.NODE_ENV === 'development' ? {
                error_message: error.message,
                error_stack: error.stack
            } : undefined
        });
    }
});




// ========================================
// ROTA: CONFIRMAR ENTREGA E DISTRIBUIR VALORES
// ========================================
router.post("/confirmar-entrega/:transacao_id", autenticarToken, async (req, res) => {
    const { transacao_id } = req.params;
    const { confirmado_por, metodo_confirmacao = 'manual', id_transportadora } = req.body;

    if (!confirmado_por) {
        return res.status(400).json({ mensagem: "Campo 'confirmado_por' é obrigatório" });
    }

    try {
        // 1. BUSCAR PAGAMENTO E ENTREGA
        const [pagamento] = await conexao.promise().query(`
                    SELECT p.*, 
            u_comprador.nome as nome_comprador,
            u_vendedor.nome as nome_vendedor, 
            u_vendedor.tipo_usuario as tipo_vendedor,
            e.id_entregas,
            e.estado_entrega,
            e.transportadora,
            e.transportadora_id as entrega_transportadora_id
        FROM pagamentos p
        JOIN usuarios u_comprador ON p.id_comprador = u_comprador.id_usuario
        JOIN usuarios u_vendedor ON p.id_vendedor = u_vendedor.id_usuario
        LEFT JOIN entregas e ON p.id_pedido = e.pedidos_id
        LIMIT 1
        `, [transacao_id]);

        if (pagamento.length === 0) {
            return res.status(404).json({ mensagem: "Transação não encontrada" });
        }

        const pag = pagamento[0];

        // 2. VALIDAR STATUS DO PAGAMENTO
        if (pag.status_pagamento !== STATUS_PAGAMENTO.RETIDO) {
            return res.status(400).json({ 
                mensagem: "❌ Pagamento deve estar RETIDO para ser liberado",
                status_atual: pag.status_pagamento,
                explicacao: "Apenas pagamentos retidos na conta NzoAgro podem ser distribuídos"
            });
        }

        // 3. VALIDAR ENTREGA (se existir)
        if (pag.id_entregas) {
            if (pag.estado_entrega === 'entregue') {
                return res.status(400).json({
                    mensagem: "❌ Entrega já foi confirmada anteriormente",
                    estado_atual: pag.estado_entrega
                });
            }
            
            if (!['aguardando retirada', 'em rota'].includes(pag.estado_entrega)) {
                return res.status(400).json({
                    mensagem: "❌ Entrega deve estar 'em rota' ou 'aguardando retirada' para ser confirmada",
                    estado_atual: pag.estado_entrega
                });
            }
        }

        // 4. VERIFICAR PERMISSÕES
        const [usuario_confirmador] = await conexao.promise().query(
            "SELECT nome, tipo_usuario FROM usuarios WHERE id_usuario = ?",
            [confirmado_por]
        );

        if (usuario_confirmador.length === 0) {
            return res.status(400).json({ mensagem: "Usuário confirmador não encontrado" });
        }

        const { nome: nome_confirmador, tipo_usuario: tipo_confirmador } = usuario_confirmador[0];

        const podeConfirmar = (
            confirmado_por == pag.id_comprador || 
            tipo_confirmador === 'Administrador' ||
            tipo_confirmador === 'Moderador' ||
            (id_transportadora && confirmado_por == id_transportadora)
        );

        if (!podeConfirmar) {
            return res.status(403).json({ 
                mensagem: "❌ Permissão negada",
                explicacao: "Apenas o comprador, transportadora, administradores ou moderadores podem confirmar a entrega"
            });
        }

        // 5. USAR TRANSPORTADORA DA ENTREGA OU PARÂMETRO
        const transportadora_final = id_transportadora || pag.entrega_transportadora_id;

        // 6. DISTRIBUIR OS VALORES AUTOMATICAMENTE
        const distribuicoesRealizadas = [];
        
        // Vendedor
        distribuicoesRealizadas.push({
            destinatario: pag.nome_vendedor,
            tipo: 'Vendedor',
            valor: pag.valor_liquido, 
            descricao: 'Pagamento pela venda (transferido da conta NzoAgro)',
            metodo_transferencia: 'Transferência via Unitel Money/Africell Money'
        });

        // Transportadora (se especificada)
        if (transportadora_final && pag.valor_frete_base > 0) {
    const [transportadora] = await conexao.promise().query(
        "SELECT nome FROM transportadoras WHERE id = ?", 
        [transportadora_final]
    );

            if (transportadora.length > 0) {
                distribuicoesRealizadas.push({
                    destinatario: transportadora[0].nome,
                    tipo: 'Transportadora',
                    valor: pag.valor_frete_base,
                    descricao: 'Pagamento do frete (transferido da conta NzoAgro)',
                    metodo_transferencia: 'Transferência via Unitel Money/Africell Money'
                });
            }
        }

        // Comissões da plataforma
        distribuicoesRealizadas.push({
            destinatario: 'NzoAgro Platform Ltd',
            tipo: 'Plataforma',
            valor: pag.valor_comissao,
            descricao: 'Comissão da plataforma (permanece na conta NzoAgro)',
            metodo_transferencia: 'Retenção na conta centralizada'
        });

        if (pag.valor_comissao_frete > 0) {
            distribuicoesRealizadas.push({
                destinatario: 'NzoAgro Platform Ltd',
                tipo: 'Comissão Transporte',
                valor: pag.valor_comissao_frete,
                descricao: 'Comissão sobre frete (permanece na conta NzoAgro)',
                metodo_transferencia: 'Retenção na conta centralizada'
            });
        }

        // 7. INICIAR TRANSAÇÃO
        await conexao.promise().beginTransaction();

        try {
            // Atualizar pagamento
            await conexao.promise().query(`
                UPDATE pagamentos 
                SET status_pagamento = ?, data_liberacao = NOW(), 
                    confirmado_por = ?, metodo_confirmacao = ?,
                    observacoes_liberacao = ?
                WHERE transacao_id = ?
            `, [
                STATUS_PAGAMENTO.LIBERADO, 
                confirmado_por, 
                metodo_confirmacao, 
                `Entrega confirmada. Valores distribuídos automaticamente via conta centralizada NzoAgro.`,
                transacao_id
            ]);

            // Atualizar entrega (se existir)
            if (pag.id_entregas) {
                await conexao.promise().query(`
                    UPDATE entregas 
                    SET estado_entrega = 'entregue', 
                        data_entrega = NOW()
                    WHERE id_entregas = ?
                `, [pag.id_entregas]);
            }

            // Registrar histórico de distribuições
            const historicoPromises = distribuicoesRealizadas.map(async (dist) => {
                return conexao.promise().query(`
                    INSERT INTO historico_distribuicoes 
                    (transacao_id, destinatario, tipo_destinatario, valor, descricao, 
                     metodo_transferencia, data_distribuicao, status_distribuicao)
                    VALUES (?, ?, ?, ?, ?, ?, NOW(), 'concluida')
                `, [
                    transacao_id, dist.destinatario, dist.tipo, 
                    dist.valor, dist.descricao, dist.metodo_transferencia
                ]);
            });

            await Promise.all(historicoPromises);

            // Confirmar transação
            await conexao.promise().commit();

            console.log(`🎉 DISTRIBUIÇÃO AUTOMÁTICA CONCLUÍDA para transação ${transacao_id}:`);
            distribuicoesRealizadas.forEach(dist => {
                console.log(`   • ${dist.destinatario} (${dist.tipo}): ${dist.valor} AKZ`);
            });

            return res.json({
                mensagem: "🎉 Entrega confirmada! Divisão automática de valores concluída com sucesso!",
                confirmacao: {
                    transacao_id,
                    confirmado_por: `${nome_confirmador} (${tipo_confirmador})`,
                    data_liberacao: new Date().toISOString(),
                    metodo: metodo_confirmacao,
                    total_distribuido: distribuicoesRealizadas.reduce((sum, dist) => sum + dist.valor, 0),
                    entrega_atualizada: pag.id_entregas ? "✅ Estado alterado para 'entregue'" : "ℹ️ Sem registro de entrega"
                },
                participantes_beneficiados: {
                    comprador: `${pag.nome_comprador} - Produto entregue com sucesso`,
                    vendedor: `${pag.nome_vendedor} - Recebeu ${pag.valor_liquido} AKZ`,
                    transportadora: transportadora_final ? `Recebeu ${pag.valor_frete_base} AKZ` : 'Não especificada',
                    plataforma: `NzoAgro reteve ${pag.valor_comissao + (pag.valor_comissao_frete || 0)} AKZ em comissões`
                },
                distribuicoes_realizadas: distribuicoesRealizadas,
                entrega_info: pag.id_entregas ? {
                    id_entrega: pag.id_entregas,
                    estado_anterior: pag.estado_entrega,
                    estado_atual: 'entregue',
                    transportadora: pag.transportadora,
                    data_confirmacao: new Date().toISOString()
                } : null,
                resumo_financeiro: {
                    valor_original_pago: pag.valor_bruto,
                    valor_distribuido_vendedor: pag.valor_liquido,
                    valor_distribuido_frete: pag.valor_frete_base || 0,
                    comissao_plataforma_total: pag.valor_comissao + (pag.valor_comissao_frete || 0),
                    taxa_provedor_deduzida: pag.valor_taxa,
                    peso_processado: `${pag.peso_total || 0}kg`,
                    tipo_usuario: pag.usuario_premium ? 'Premium' : 'Padrão'
                }
            });

        } catch (error) {
            // Reverter transação em caso de erro
            await conexao.promise().rollback();
            throw error;
        }

    } catch (error) {
        console.error("❌ Erro ao confirmar entrega e distribuir valores:", error);
        return res.status(500).json({ 
            mensagem: "Erro ao confirmar entrega e processar distribuição automática", 
            erro: error.message,
            transacao_id: transacao_id,
            sugestao: "Verifique os logs do sistema e tente novamente"
        });
    }
});



router.post("/solicitar-reembolso/:transacao_id", autenticarToken, async (req, res) => {
    const { transacao_id } = req.params;
    const id_usuario_solicitante = req.usuario.id_usuario; // JWT token
    const { motivo_reembolso, tipo_reembolso = 'total' } = req.body;

    if (!motivo_reembolso) {
        return res.status(400).json({ 
            mensagem: "Campo 'motivo_reembolso' é obrigatório",
            exemplos: [
                "Produto não entregue no prazo",
                "Produto com defeito/avariado",
                "Entrega no endereço errado",
                "Desistência da compra"
            ]
        });
    }

    try {
        // 1. 🔍 BUSCAR INFORMAÇÕES COMPLETAS DA TRANSAÇÃO
        const [pagamento] = await conexao.promise().query(`
            SELECT p.*, 
                u_comprador.nome as nome_comprador,
                u_comprador.telefone as telefone_comprador,
                u_vendedor.nome as nome_vendedor,
                e.id_entregas,
                e.estado_entrega,
                e.data_criacao as data_criacao_entrega,
                e.prazo_entrega_dias,
                DATEDIFF(NOW(), e.data_criacao) as dias_desde_pedido,
                DATEDIFF(NOW(), p.data_pagamento) as dias_desde_pagamento
            FROM pagamentos p
            JOIN usuarios u_comprador ON p.id_comprador = u_comprador.id_usuario
            JOIN usuarios u_vendedor ON p.id_vendedor = u_vendedor.id_usuario
            LEFT JOIN entregas e ON p.id_pedido = e.pedidos_id
            WHERE p.transacao_id = ? AND p.id_comprador = ?
        `, [transacao_id, id_usuario_solicitante]);

        if (pagamento.length === 0) {
            return res.status(404).json({ 
                mensagem: "❌ Transação não encontrada ou você não tem permissão",
                explicacao: "Apenas o comprador pode solicitar reembolso de suas próprias compras"
            });
        }

        const pag = pagamento[0];

        // 2. 🚫 VALIDAÇÕES CRÍTICAS DE SEGURANÇA
        
        // 2.1 Verificar se o dinheiro ainda está na conta virtual
        if (pag.status_pagamento !== 'retido') {
            const mensagensStatus = {
                'pendente': 'Pagamento ainda não foi processado',
                'processando': 'Pagamento em processamento, aguarde',
                'pago': 'Pagamento processado mas ainda não retido na conta virtual',
                'liberado': '❌ IMPOSSÍVEL REEMBOLSAR: Dinheiro já foi distribuído para vendedor/transportadora',
                'cancelado': 'Pagamento já foi cancelado',
                'reembolsado': 'Transação já foi reembolsada anteriormente'
            };

            return res.status(400).json({
                mensagem: `❌ Reembolso não permitido - Status: ${pag.status_pagamento}`,
                explicacao: mensagensStatus[pag.status_pagamento],
                status_atual: pag.status_pagamento,
                quando_pode_reembolsar: "Apenas quando o status for 'retido' (dinheiro na conta virtual NzoAgro)",
                protecao_sistema: pag.status_pagamento === 'liberado' ? 
                    "🛡️ Sistema impede reembolso após distribuição para evitar fraudes" : 
                    "⏳ Aguarde o processamento do pagamento"
            });
        }

        // 2.2 Verificar se já existe solicitação de reembolso pendente
        const [reembolsoExistente] = await conexao.promise().query(`
            SELECT * FROM solicitacoes_reembolso 
            WHERE transacao_id = ? AND status_solicitacao IN ('pendente', 'em_analise')
        `, [transacao_id]);

        if (reembolsoExistente.length > 0) {
            return res.status(400).json({
                mensagem: "❌ Já existe uma solicitação de reembolso em andamento",
                solicitacao_existente: {
                    id: reembolsoExistente[0].id,
                    status: reembolsoExistente[0].status_solicitacao,
                    data_solicitacao: reembolsoExistente[0].data_solicitacao,
                    motivo: reembolsoExistente[0].motivo_reembolso
                }
            });
        }

        // 3. ⏰ VERIFICAR PRAZO DE ENTREGA (LÓGICA DE NEGÓCIO)
        const prazo_padrao = 5; // dias
        const prazo_entrega = pag.prazo_entrega_dias || prazo_padrao;
        const dias_passados = pag.dias_desde_pagamento || 0;
        const prazo_vencido = dias_passados > prazo_entrega;

        // 4. 💰 CALCULAR VALORES DO REEMBOLSO
        let valor_reembolso = 0;
        let taxa_reembolso = 0;
        let valor_liquido_reembolso = 0;

        if (tipo_reembolso === 'total') {
            valor_reembolso = pag.valor_bruto;
            // Taxa de reembolso baseada no motivo e prazo
            if (prazo_vencido) {
                taxa_reembolso = 0; // Sem taxa se prazo venceu
            } else {
                taxa_reembolso = pag.valor_bruto * 0.05; // 5% de taxa para desistência
            }
            valor_liquido_reembolso = valor_reembolso - taxa_reembolso;
        }

        // 5. 📝 REGISTRAR SOLICITAÇÃO DE REEMBOLSO
        await conexao.promise().beginTransaction();

        try {
            // Inserir solicitação
            const [resultado] = await conexao.promise().query(`
                INSERT INTO solicitacoes_reembolso 
                (transacao_id, id_comprador, motivo_reembolso, tipo_reembolso,
                 valor_solicitado, taxa_reembolso, valor_liquido_reembolso,
                 prazo_vencido, dias_atraso, status_solicitacao, data_solicitacao)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendente', NOW())
            `, [
                transacao_id, id_usuario_solicitante, motivo_reembolso, tipo_reembolso,
                valor_reembolso, taxa_reembolso, valor_liquido_reembolso,
                prazo_vencido, Math.max(0, dias_passados - prazo_entrega), 
            ]);

            const id_solicitacao = resultado.insertId;

            // Atualizar status do pagamento para "em_reembolso"
            await conexao.promise().query(`
                UPDATE pagamentos 
                SET status_pagamento = 'processando',
                    motivo_reembolso = ?,
                    data_atualizacao = NOW()
                WHERE transacao_id = ?
            `, [motivo_reembolso, transacao_id]);

            // Registrar log de auditoria
            await conexao.promise().query(`
                INSERT INTO logs_reembolso 
                (id_solicitacao, transacao_id, acao, detalhes, usuario_id, ip_origem, data_acao)
                VALUES (?, ?, 'solicitacao_criada', ?, ?, ?, NOW())
            `, [
                id_solicitacao, transacao_id, 
                `Solicitação de reembolso criada. Motivo: ${motivo_reembolso}`,
                id_usuario_solicitante, req.ip || req.connection.remoteAddress
            ]);

            await conexao.promise().commit();

            // 6. 📨 NOTIFICAR PARTES INTERESSADAS (simulado)
            console.log(`📧 NOTIFICAÇÕES DE REEMBOLSO:`);
            console.log(`   → Comprador: ${pag.nome_comprador} - Solicitação registrada`);
            console.log(`   → Vendedor: ${pag.nome_vendedor} - Cliente solicitou reembolso`);
            console.log(`   → Admin: Nova solicitação de reembolso para análise`);

            return res.json({
                mensagem: "✅ Solicitação de reembolso registrada com sucesso!",
                
                solicitacao: {
                    id: id_solicitacao,
                    transacao_id,
                    status: 'pendente',
                    data_solicitacao: new Date().toISOString(),
                    prazo_analise: "24-48 horas úteis"
                },

                valores: {
                    valor_original: pag.valor_bruto,
                    valor_solicitado: valor_reembolso,
                    taxa_reembolso: taxa_reembolso,
                    valor_liquido_reembolso: valor_liquido_reembolso,
                    explicacao_taxa: prazo_vencido ? 
                        "Sem taxa - prazo de entrega vencido" : 
                        "Taxa de 5% para desistência antes do prazo"
                },

                motivo: {
                    informado: motivo_reembolso,
                    prazo_original: `${prazo_entrega} dias`,
                    dias_passados: dias_passados,
                    prazo_vencido: prazo_vencido,
                    situacao: prazo_vencido ? 
                        "⚠️ Prazo de entrega vencido - reembolso sem taxa" :
                        "ℹ️ Dentro do prazo - taxa de cancelamento aplicável"
                },

                proximos_passos: [
                    "📋 Sua solicitação será analisada pela equipe",
                    "🔍 Verificaremos com o vendedor/transportadora",
                    "💰 Processaremos o reembolso se aprovado",
                    "📱 Você receberá notificações sobre o andamento"
                ],

                importante: {
                    seguranca: "🛡️ Reembolso só é possível porque o dinheiro ainda estava na conta virtual",
                    protecao: "Após confirmação de entrega, não há possibilidade de reembolso",
                    contato: "Para urgências: suporte@nzoagro.com"
                }
            });

        } catch (error) {
            await conexao.promise().rollback();
            throw error;
        }

    } catch (error) {
        console.error("❌ Erro ao processar solicitação de reembolso:", error);
        return res.status(500).json({
            mensagem: "Erro ao processar solicitação de reembolso",
            erro: error.message,
            codigo_suporte: `REF_${transacao_id}_${Date.now()}`
        });
    }
});

// 📋 ROTA: Listar Solicitações de Reembolso do Usuário
router.get("/meus-reembolsos", autenticarToken, async (req, res) => {
    const id_usuario = req.usuario.id_usuario;

    try {
        const [reembolsos] = await conexao.promise().query(`
            SELECT 
                sr.*,
                p.valor_bruto,
                p.status_pagamento,
                u_vendedor.nome as nome_vendedor,
                e.estado_entrega,
                e.prazo_entrega_dias
            FROM solicitacoes_reembolso sr
            JOIN pagamentos p ON sr.transacao_id = p.transacao_id
            JOIN usuarios u_vendedor ON p.id_vendedor = u_vendedor.id_usuario
            LEFT JOIN entregas e ON p.id_pedido = e.pedidos_id
            WHERE sr.id_comprador = ?
            ORDER BY sr.data_solicitacao DESC
        `, [id_usuario]);

        return res.json({
            total_solicitacoes: reembolsos.length,
            solicitacoes: reembolsos.map(r => ({
                id: r.id,
                transacao_id: r.transacao_id,
                vendedor: r.nome_vendedor,
                valor_solicitado: r.valor_solicitado,
                valor_liquido: r.valor_liquido_reembolso,
                motivo: r.motivo_reembolso,
                status: r.status_solicitacao,
                data_solicitacao: r.data_solicitacao,
                prazo_vencido: r.prazo_vencido,
                dias_atraso: r.dias_atraso || 0
            }))
        });

    } catch (error) {
        return res.status(500).json({
            erro: "Falha ao buscar solicitações",
            detalhes: error.message
        });
    }
});

// 👨‍💼 ROTA: Processar Reembolso (Admin/Moderador)
router.post("/processar-reembolso/:id_solicitacao", autenticarToken, async (req, res) => {
    const { id_solicitacao } = req.params;
    const id_admin = req.usuario.id_usuario;
    const { acao, observacoes_admin } = req.body; // acao: 'aprovar' | 'rejeitar'

    // Verificar se é admin/moderador
    const [admin] = await conexao.promise().query(
        "SELECT tipo_usuario FROM usuarios WHERE id_usuario = ?", [id_admin]
    );

    if (admin.length === 0 || !['Administrador', 'Moderador'].includes(admin[0].tipo_usuario)) {
        return res.status(403).json({
            mensagem: "❌ Acesso negado",
            explicacao: "Apenas administradores e moderadores podem processar reembolsos"
        });
    }

    if (!['aprovar', 'rejeitar'].includes(acao)) {
        return res.status(400).json({
            mensagem: "Ação inválida",
            acoes_validas: ['aprovar', 'rejeitar']
        });
    }

    try {
        // Buscar solicitação
        const [solicitacao] = await conexao.promise().query(`
            SELECT sr.*, p.* 
            FROM solicitacoes_reembolso sr
            JOIN pagamentos p ON sr.transacao_id = p.transacao_id
            WHERE sr.id = ? AND sr.status_solicitacao = 'pendente'
        `, [id_solicitacao]);

        if (solicitacao.length === 0) {
            return res.status(404).json({
                mensagem: "Solicitação não encontrada ou já processada"
            });
        }

        const sol = solicitacao[0];

        await conexao.promise().beginTransaction();

        try {
            if (acao === 'aprovar') {
                // Gerar ID único para o reembolso
                const reembolso_id = `REF_${sol.transacao_id}_${Date.now()}`;

                // Atualizar pagamento
                await conexao.promise().query(`
                    UPDATE pagamentos 
                    SET status_pagamento = 'reembolsado',
                        valor_reembolsado = ?,
                        motivo_reembolso = ?,
                        reembolso_id = ?,
                        data_reembolso = NOW(),
                        autorizado_por = ?
                    WHERE transacao_id = ?
                `, [
                    sol.valor_liquido_reembolso, sol.motivo_reembolso, 
                    reembolso_id, id_admin, sol.transacao_id
                ]);

                // Atualizar solicitação
                await conexao.promise().query(`
                    UPDATE solicitacoes_reembolso 
                    SET status_solicitacao = 'aprovada',
                        data_processamento = NOW(),
                        processado_por = ?,
                        observacoes_admin = ?,
                        reembolso_id = ?
                    WHERE id = ?
                `, [id_admin, observacoes_admin, reembolso_id, id_solicitacao]);

                var mensagem_resposta = "✅ Reembolso aprovado e processado com sucesso!";
                var status_final = 'aprovada';

            } else {
                // Rejeitar - retornar pagamento ao status retido
                await conexao.promise().query(`
                    UPDATE pagamentos 
                    SET status_pagamento = 'retido'
                    WHERE transacao_id = ?
                `, [sol.transacao_id]);

                await conexao.promise().query(`
                    UPDATE solicitacoes_reembolso 
                    SET status_solicitacao = 'rejeitada',
                        data_processamento = NOW(),
                        processado_por = ?,
                        observacoes_admin = ?
                    WHERE id = ?
                `, [id_admin, observacoes_admin, id_solicitacao]);

                var mensagem_resposta = "❌ Solicitação de reembolso rejeitada";
                var status_final = 'rejeitada';
            }

            // Log de auditoria
            await conexao.promise().query(`
                INSERT INTO logs_reembolso 
                (id_solicitacao, transacao_id, acao, detalhes, usuario_id, ip_origem, data_acao)
                VALUES (?, ?, ?, ?, ?, ?, NOW())
            `, [
                id_solicitacao, sol.transacao_id, 
                `reembolso_${acao}do`, 
                `${acao === 'aprovar' ? 'Aprovado' : 'Rejeitado'} por admin. ${observacoes_admin || ''}`,
                id_admin, req.ip
            ]);

            await conexao.promise().commit();

            return res.json({
                mensagem: mensagem_resposta,
                solicitacao: {
                    id: id_solicitacao,
                    transacao_id: sol.transacao_id,
                    status_final: status_final,
                    valor_processado: acao === 'aprovar' ? sol.valor_liquido_reembolso : 0,
                    processado_por: admin[0].tipo_usuario,
                    data_processamento: new Date().toISOString()
                }
            });

        } catch (error) {
            await conexao.promise().rollback();
            throw error;
        }

    } catch (error) {
        console.error("❌ Erro ao processar reembolso:", error);
        return res.status(500).json({
            erro: "Falha ao processar reembolso",
            detalhes: error.message
        });
    }
});

router.get("/dashboard-reembolsos", autenticarToken, async (req, res) => {
    const id_usuario = req.usuario.id_usuario;

    // Verificar se é admin
    const [admin] = await conexao.promise().query(
        "SELECT tipo_usuario FROM usuarios WHERE id_usuario = ?", [id_usuario]
    );

    if (admin.length === 0 || !['Administrador', 'Moderador'].includes(admin[0].tipo_usuario)) {
        return res.status(403).json({ mensagem: "❌ Acesso restrito a administradores" });
    }

    try {
        // Estatísticas gerais
        const [stats] = await conexao.promise().query(`
            SELECT 
                COUNT(*) as total_solicitacoes,
                COUNT(CASE WHEN status_solicitacao = 'pendente' THEN 1 END) as pendentes,
                COUNT(CASE WHEN status_solicitacao = 'aprovada' THEN 1 END) as aprovadas,
                COUNT(CASE WHEN status_solicitacao = 'rejeitada' THEN 1 END) as rejeitadas,
                SUM(CASE WHEN status_solicitacao = 'aprovada' THEN valor_liquido_reembolso ELSE 0 END) as total_reembolsado,
                SUM(CASE WHEN status_solicitacao = 'pendente' THEN valor_liquido_reembolso ELSE 0 END) as valor_pendente
            FROM solicitacoes_reembolso
            WHERE data_solicitacao >= DATE_SUB(NOW(), INTERVAL 30 DAY)
        `);

        // Solicitações pendentes
        const [pendentes] = await conexao.promise().query(`
            SELECT 
                sr.*,
                u_comprador.nome as nome_comprador,
                u_vendedor.nome as nome_vendedor,
                p.valor_bruto,
                DATEDIFF(NOW(), sr.data_solicitacao) as dias_pendente
            FROM solicitacoes_reembolso sr
            JOIN pagamentos p ON sr.transacao_id = p.transacao_id
            JOIN usuarios u_comprador ON sr.id_comprador = u_comprador.id_usuario
            JOIN usuarios u_vendedor ON p.id_vendedor = u_vendedor.id_usuario
            WHERE sr.status_solicitacao = 'pendente'
            ORDER BY sr.data_solicitacao ASC
        `);

        return res.json({
            estatisticas: stats[0],
            solicitacoes_pendentes: pendentes,
            alertas: {
                critico: pendentes.filter(p => p.dias_pendente > 3).length,
                atencao: pendentes.filter(p => p.dias_pendente > 1 && p.dias_pendente <= 3).length
            }
        });

    } catch (error) {
        return res.status(500).json({
            erro: "Falha ao carregar dashboard",
            detalhes: error.message
        });
    }
});


// ========================================
// ROTA: RELATÓRIO FINANCEIRO DETALHADO DA PLATAFORMA
// ========================================
router.get("/relatorio-financeiro",autenticarToken ,autorizarUsuario(["Administrador"]), async (req, res) => {
    const { data_inicio, data_fim, tipo_relatorio = 'geral' } = req.query;
    
    try {
        let condicaoData = "";
        let params = [];
        
        if (data_inicio && data_fim) {
            condicaoData = "WHERE DATE(data_pagamento) BETWEEN ? AND ?";
            params = [data_inicio, data_fim];
        }

        // Buscar dados principais
        const [relatorio] = await conexao.promise().query(`
            SELECT 
                COUNT(*) as total_transacoes,
                SUM(valor_bruto) as receita_bruta_total,
                SUM(valor_liquido_vendedor) as pago_aos_vendedores,
                SUM(valor_frete_base) as pago_transportadoras,
                SUM(valor_comissao) as receita_comissao_vendas,
                SUM(valor_comissao_frete) as receita_comissao_frete,
                SUM(valor_taxa) as taxas_provedores_deduzidas,
                
                COUNT(CASE WHEN status_pagamento = 'liberado' THEN 1 END) as transacoes_concluidas,
                COUNT(CASE WHEN status_pagamento = 'retido' THEN 1 END) as transacoes_retidas,
                COUNT(CASE WHEN status_pagamento = 'cancelado' THEN 1 END) as transacoes_canceladas,
                COUNT(CASE WHEN status_pagamento = 'reembolsado' THEN 1 END) as transacoes_reembolsadas,
                
                AVG(valor_bruto) as ticket_medio,
                AVG(valor_comissao + valor_comissao_frete) as comissao_media_total,
                SUM(peso_total) as peso_total_processado,
                COUNT(CASE WHEN usuario_premium = 1 THEN 1 END) as usuarios_premium
            FROM pagamentos
            ${condicaoData}
        `, params);

        // Distribuição por tipo de pagamento
        const [distribuicaoPorTipo] = await conexao.promise().query(`
            SELECT 
                tipo_pagamento,
                COUNT(*) as quantidade,
                SUM(valor_bruto) as volume_total,
                SUM(valor_comissao + valor_comissao_frete) as receita_comissao_total,
                AVG(valor_bruto) as ticket_medio_tipo
            FROM pagamentos
            ${condicaoData}
            GROUP BY tipo_pagamento
            ORDER BY volume_total DESC
        `, params);

        // Top vendedores por volume
        const [topVendedores] = await conexao.promise().query(`
            SELECT 
                u.nome as vendedor,
                u.tipo_usuario,
                COUNT(p.id) as total_vendas,
                SUM(p.valor_liquido_vendedor) as total_recebido,
                SUM(p.valor_comissao) as comissao_gerada,
                AVG(p.valor_bruto) as ticket_medio
            FROM pagamentos p
            JOIN usuarios u ON p.id_vendedor = u.id_usuario
            ${condicaoData}
            GROUP BY p.id_vendedor, u.nome, u.tipo_usuario
            ORDER BY total_recebido DESC
            LIMIT 10
        `, params);

        const dados = relatorio[0];
        const receitaTotalPlataforma = (dados.receita_comissao_vendas || 0) + (dados.receita_comissao_frete || 0);
        const receitaLiquida = receitaTotalPlataforma - (dados.taxas_provedores_deduzidas || 0);

        return res.json({
            periodo_analise: {
                inicio: data_inicio || "Desde o início",
                fim: data_fim || "Até agora",
                tipo_relatorio: tipo_relatorio
            },
            resumo_executivo: {
                total_transacoes: dados.total_transacoes,
                receita_bruta_movimentada: Math.round(dados.receita_bruta_total || 0),
                receita_plataforma_bruta: Math.round(receitaTotalPlataforma),
                receita_plataforma_liquida: Math.round(receitaLiquida),
                peso_total_processado: `${Math.round((dados.peso_total_processado || 0) * 100) / 100}kg`,
                ticket_medio: Math.round(dados.ticket_medio || 0),
                percentual_usuarios_premium: `${((dados.usuarios_premium / dados.total_transacoes) * 100).toFixed(1)}%`
            },
            status_transacoes: {
                concluidas: dados.transacoes_concluidas,
                aguardando_entrega: dados.transacoes_retidas,
                canceladas: dados.transacoes_canceladas,
                reembolsadas: dados.transacoes_reembolsadas,
                taxa_sucesso: `${((dados.transacoes_concluidas / dados.total_transacoes) * 100).toFixed(2)}%`
            },
            distribuicao_financeira: {
                vendedores_receberam: Math.round(dados.pago_aos_vendedores || 0),
                transportadoras_receberam: Math.round(dados.pago_transportadoras || 0),
                comissao_vendas_nzoagro: Math.round(dados.receita_comissao_vendas || 0),
                comissao_frete_nzoagro: Math.round(dados.receita_comissao_frete || 0),
                taxas_provedores: Math.round(dados.taxas_provedores_deduzidas || 0)
            },
            provedores_pagamento: distribuicaoPorTipo.map(tipo => ({
                provedor: TIPOS_PAGAMENTO[tipo.tipo_pagamento]?.nome || tipo.tipo_pagamento,
                transacoes: tipo.quantidade,
                volume_total: Math.round(tipo.volume_total),
                receita_comissao: Math.round(tipo.receita_comissao_total),
                ticket_medio: Math.round(tipo.ticket_medio_tipo),
                participacao_mercado: `${((tipo.volume_total / dados.receita_bruta_total) * 100).toFixed(1)}%`
            })),
            top_vendedores: topVendedores.map(vendedor => ({
                nome: vendedor.vendedor,
                tipo: vendedor.tipo_usuario,
                vendas_realizadas: vendedor.total_vendas,
                valor_recebido: Math.round(vendedor.total_recebido),
                comissao_gerada_nzoagro: Math.round(vendedor.comissao_gerada),
                ticket_medio: Math.round(vendedor.ticket_medio)
            })),
            conta_plataforma_consolidada: {
                ...CONFIGURACOES_PLATAFORMA.CONTA_PLATAFORMA,
                saldo_comissoes_acumulado: Math.round(receitaLiquida),
                volume_processado_periodo: Math.round(dados.receita_bruta_total || 0),
                ultima_atualizacao: new Date().toISOString()
            },
            metricas_operacionais: {
                comissao_media_por_transacao: Math.round(dados.comissao_media_total || 0),
                volume_medio_diario: dados.total_transacoes > 0 ? 
                    Math.round((dados.receita_bruta_total || 0) / dados.total_transacoes) : 0,
                eficiencia_cobranca: `${((receitaTotalPlataforma / (dados.receita_bruta_total || 1)) * 100).toFixed(2)}%`,
                peso_medio_por_pedido: dados.total_transacoes > 0 ? 
                    `${((dados.peso_total_processado || 0) / dados.total_transacoes).toFixed(2)}kg` : '0kg'
            },
            configuracoes_aplicadas: {
                comissao_padrao: `${(CONFIGURACOES_PLATAFORMA.COMISSAO_PADRAO * 100)}%`,
                comissao_premium: `${(CONFIGURACOES_PLATAFORMA.COMISSAO_PREMIUM * 100)}%`,
                frete_dinamico: "Baseado no peso (10kg-2000kg)",
                tipos_pagamento_ativos: Object.keys(TIPOS_PAGAMENTO).filter(key => TIPOS_PAGAMENTO[key].ativo).length
            }
        });
    } catch (error) {
        console.error("❌ Erro ao gerar relatório financeiro:", error);
        return res.status(500).json({ 
            mensagem: "Erro ao gerar relatório financeiro detalhado", 
            erro: error.message,
            sugestao: "Verifique os parâmetros de data e tente novamente"
        });
    }
});

module.exports = router;

module.exports.middlewareValidacaoOperadoras = middlewareValidacaoOperadoras ;
module.exports.gerarReferenciaPagamento = gerarReferenciaPagamento;
module.exports.listarMetodosPagamentoCompativeis = listarMetodosPagamentoCompativeis;
module.exports.calcularDivisaoComValidacao = calcularDivisaoComValidacao;
module.exports.calcularDivisaoValores = calcularDivisaoValores;