const express = require("express");
const router = express.Router();
const conexao = require("./database");
const { v4: uuidv4 } = require('uuid');

router.use(express.json());

// ========================================
// CONFIGURAÇÕES DINÂMICAS DA PLATAFORMA NZOAGRO
// ========================================
const CONFIGURACOES_PLATAFORMA = {
    // Comissões da plataforma (%) - VALORES DINÂMICOS
    COMISSAO_PADRAO: 0.10,        // 10% de comissão padrão (conforme solicitado)
    COMISSAO_PREMIUM: 0.08,       // 8% para usuários premium
    COMISSAO_PARCEIRO: 0.05,      // 5% para parceiros especiais
    
    // Configurações de frete DINÂMICAS baseadas no peso
    FRETE_POR_PESO: {
        // Peso em kg: { base: valor_frete, comissao: comissao_frete }
        '10-30': { base: 10000, comissao: 1000 },
        '31-50': { base: 15000, comissao: 1500 },
        '51-70': { base: 20000, comissao: 2000 },
        '71-100': { base: 25000, comissao: 2500 },
        '101-300': { base: 35000, comissao: 3500 },
        '301-500': { base: 50000, comissao: 5000 },
        '501-1000': { base: 80000, comissao: 8000 },
        '1001-2000': { base: 120000, comissao: 12000 }
    },
    
    // Conta da plataforma (VIRTUAL - será criada fisicamente quando integrar APIs)
    CONTA_PLATAFORMA: {
        titular: 'NzoAgro Platform Ltd',
        numero_conta: 'NZOAGRO_MASTER_001',
        banco: 'Conta Virtual Centralizada',
        tipo: 'VIRTUAL', // Indica que é uma conta lógica por enquanto
        status: 'ATIVA',
        criada_em: new Date().toISOString(),
        observacao: 'Conta virtual para controle interno. Será criada fisicamente na integração com APIs de pagamento.'
    }
};

// TIPOS DE PAGAMENTO DINÂMICOS - Apenas Unitel Money e Africell Money
const TIPOS_PAGAMENTO = {
    'unitel_money': { 
        nome: 'Unitel Money', 
        taxa: 0.02,           // 2% taxa dinâmica
        ativo: true,
        codigo_ussd: '*405#',
        descricao: 'Pagamento via Unitel Money'
    },
    'africell_money': { 
        nome: 'Africell Money', 
        taxa: 0.018,          // 1.8% taxa dinâmica
        ativo: true,
        codigo_ussd: '*144#',
        descricao: 'Pagamento via Africell Money'
    }
};

const STATUS_PAGAMENTO = {
    PENDENTE: 'pendente',
    PROCESSANDO: 'processando',
    PAGO: 'pago',
    RETIDO: 'retido',           // 💰 Dinheiro na conta da plataforma
    LIBERADO: 'liberado',       // ✅ Distribuído para vendedor
    CANCELADO: 'cancelado',
    REEMBOLSADO: 'reembolsado',
    CONTESTADO: 'contestado'
};

// ========================================
// FUNÇÃO: BUSCAR CONFIGURAÇÕES DINÂMICAS DO BD
// ========================================
const buscarConfiguracoesDinamicas = async () => {
    try {
        const [config] = await conexao.promise().query(`
            SELECT * FROM configuracoes_plataforma 
            WHERE ativo = 1 
            ORDER BY data_atualizacao DESC 
            LIMIT 1
        `);
        
        if (config.length > 0) {
            // Atualizar configurações com valores do banco
            CONFIGURACOES_PLATAFORMA.COMISSAO_PADRAO = config[0].comissao_padrao || 0.10;
            CONFIGURACOES_PLATAFORMA.COMISSAO_PREMIUM = config[0].comissao_premium || 0.08;
            
            // Atualizar frete por peso se houver no banco
            if (config[0].frete_config) {
                const freteConfig = JSON.parse(config[0].frete_config);
                CONFIGURACOES_PLATAFORMA.FRETE_POR_PESO = { ...CONFIGURACOES_PLATAFORMA.FRETE_POR_PESO, ...freteConfig };
            }
        }
        return CONFIGURACOES_PLATAFORMA;
    } catch (error) {
        console.log("Usando configurações padrão:", error.message);
        return CONFIGURACOES_PLATAFORMA;
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

// ========================================
// FUNÇÃO: CALCULAR DIVISÃO AUTOMÁTICA COM VALORES DINÂMICOS
// ========================================
const calcularDivisaoValores = async (valorBruto, tipoPagamento, pesoTotal = 10, usuarioPremium = false) => {
    // Buscar configurações atualizadas
    const config = await buscarConfiguracoesDinamicas();
    
    // 1. Taxa do provedor de pagamento (dinâmica)
    const taxaProvedor = valorBruto * TIPOS_PAGAMENTO[tipoPagamento].taxa;
    
    // 2. Cálculo do frete DINÂMICO baseado no peso
    const dadosFrete = calcularFrete(pesoTotal);
    const valorFreteBase = dadosFrete.base;
    const comissaoFrete = dadosFrete.comissao;
    const valorFreteTotal = valorFreteBase + comissaoFrete;
    
    // 3. Comissão da plataforma DINÂMICA (10% conforme solicitado)
    let taxaComissao = config.COMISSAO_PADRAO; // 10%
    
    if (usuarioPremium) {
        taxaComissao = config.COMISSAO_PREMIUM; // 8%
    }
    
    const valorSemTaxas = valorBruto - taxaProvedor - valorFreteTotal;
    const comissaoPlataforma = valorSemTaxas * taxaComissao;
    
    // 4. Valor líquido que o vendedor recebe
    const valorLiquidoVendedor = valorSemTaxas - comissaoPlataforma;
    
    return {
        valor_bruto: Math.round(valorBruto),
        taxa_provedor: Math.round(taxaProvedor),
        valor_frete_base: Math.round(valorFreteBase),
        comissao_frete: Math.round(comissaoFrete),
        valor_frete_total: Math.round(valorFreteTotal),
        comissao_plataforma: Math.round(comissaoPlataforma),
        valor_liquido_vendedor: Math.round(valorLiquidoVendedor),
        
        // Resumo da divisão
        divisao: {
            vendedor: Math.round(valorLiquidoVendedor),
            transportadora: Math.round(valorFreteBase),
            comissao_transporte: Math.round(comissaoFrete),
            plataforma: Math.round(comissaoPlataforma),
            provedor_pagamento: Math.round(taxaProvedor)
        },
        
        // Detalhes dos cálculos
        detalhes_calculo: {
            taxa_comissao_aplicada: `${(taxaComissao * 100).toFixed(1)}%`,
            taxa_provedor_aplicada: `${(TIPOS_PAGAMENTO[tipoPagamento].taxa * 100).toFixed(1)}%`,
            peso_total: pesoTotal,
            faixa_peso: obterFaixaPeso(pesoTotal)
        }
    };
};

// Função auxiliar para obter faixa de peso
const obterFaixaPeso = (peso) => {
    if (peso >= 10 && peso <= 30) return '10-30kg';
    if (peso >= 31 && peso <= 50) return '31-50kg';
    if (peso >= 51 && peso <= 70) return '51-70kg';
    if (peso >= 71 && peso <= 100) return '71-100kg';
    if (peso >= 101 && peso <= 300) return '101-300kg';
    if (peso >= 301 && peso <= 500) return '301-500kg';
    if (peso >= 501 && peso <= 1000) return '501-1000kg';
    if (peso >= 1001 && peso <= 2000) return '1001-2000kg';
    return 'Fora da faixa';
};

// ========================================
// ROTA: CALCULAR PREÇO DO CARRINHO (USANDO SUA LÓGICA)
// ========================================
router.post("/calcular-preco", async (req, res) => {
    const { 
        id_usuario, 
        usuario_premium = false,
        tipo_pagamento = 'unitel_money'
    } = req.body;

    if (!id_usuario) {
        return res.status(400).json({ erro: "ID do usuário é obrigatório." });
    }

    try {
        // Buscar todos os itens do carrinho do usuário com dados do produto original
        const [itensCarrinho] = await conexao.promise().query(`
            SELECT 
                ci.quantidade as quantidade_desejada,
                ci.peso as peso_carrinho,
                ci.preco as preco_carrinho,
                ci.unidade as Unidade,
                p.id_produtos,
                p.nome,
                e.quantidade as quantidade_cadastrada,
                p.peso_kg as peso_cadastrado,
                p.preco as preco_cadastrado
            FROM carrinho_itens ci
            JOIN carrinho c ON ci.id_carrinho = c.id_carrinho
            JOIN estoque e ON ci.id_produto = e.produto_id
            JOIN produtos p ON ci.id_produto = p.id_produtos
            WHERE c.id_usuario = ?
        `, [id_usuario]);

        if (itensCarrinho.length === 0) {
            return res.status(404).json({ erro: "Carrinho vazio." });
        }

        // Calcular totais com proporção correta (USANDO SUA LÓGICA)
        let subtotalProdutos = 0;
        let pesoTotal = 0;

        const itensCalculados = itensCarrinho.map(item => {
            // Calcular proporção baseada na quantidade desejada vs cadastrada
            const proporcao = item.quantidade_desejada / item.quantidade_cadastrada;
            
            // Calcular preço e peso proporcionais
            const preco_final = item.preco_cadastrado * proporcao;
            const peso_final = item.peso_cadastrado * proporcao;
            
            // Calcular subtotal do produto
            const subtotal_produto = preco_final;
            
            // Adicionar aos totais
            subtotalProdutos += subtotal_produto;
            pesoTotal += peso_final;
            
            return {
                id_produtos: item.id_produtos,
                nome: item.nome,
                quantidade_desejada: item.quantidade_desejada,
                quantidade_cadastrada: item.quantidade_cadastrada,
                preco_cadastrado: item.preco_cadastrado,
                peso_cadastrado: item.peso_cadastrado,
                Unidade: item.Unidade,
                proporcao: Math.round(proporcao * 100) / 100,
                preco_final: Math.round(preco_final),
                peso_final: Math.round(peso_final * 100) / 100,
                subtotal_produto: Math.round(subtotal_produto)
            };
        });

        // Calcular frete baseado no peso total (SUA LÓGICA)
        const frete = calcularFrete(pesoTotal);
        const totalFinal = subtotalProdutos + frete.base + frete.comissao;

        // CALCULAR DIVISÃO AUTOMÁTICA DOS VALORES
        const calculoDivisao = await calcularDivisaoValores(
            totalFinal,
            tipo_pagamento,
            pesoTotal,
            usuario_premium
        );

        console.log("Cálculo do carrinho com divisão automática:", {
            itensCalculados,
            subtotalProdutos: Math.round(subtotalProdutos),
            pesoTotal: Math.round(pesoTotal * 100) / 100,
            frete: frete,
            totalFinal: Math.round(totalFinal),
            divisao_valores: calculoDivisao
        });

        res.json({
            itens: itensCalculados,
            resumo: {
                subtotalProdutos: Math.round(subtotalProdutos),
                pesoTotal: Math.round(pesoTotal * 100) / 100,
                frete: frete.base,
                comissao_frete: frete.comissao,
                totalFinal: Math.round(totalFinal)
            },
            divisao_pagamento: {
                valor_total_a_pagar: calculoDivisao.valor_bruto,
                distribuicao: {
                    vendedor: {
                        valor: calculoDivisao.valor_liquido_vendedor,
                        descricao: "Valor líquido pela venda (após comissões de 10%)"
                    },
                    transportadora: {
                        valor: calculoDivisao.valor_frete_base,
                        descricao: `Frete base para ${pesoTotal}kg`
                    },
                    comissao_transporte: {
                        valor: calculoDivisao.comissao_frete,
                        descricao: "Comissão do transporte"
                    },
                    plataforma: {
                        valor: calculoDivisao.comissao_plataforma,
                        descricao: `Comissão NzoAgro (${calculoDivisao.detalhes_calculo.taxa_comissao_aplicada})`
                    },
                    provedor_pagamento: {
                        valor: calculoDivisao.taxa_provedor,
                        descricao: `Taxa ${TIPOS_PAGAMENTO[tipo_pagamento].nome} (${calculoDivisao.detalhes_calculo.taxa_provedor_aplicada})`
                    }
                }
            },
            opcoes_pagamento: Object.keys(TIPOS_PAGAMENTO).filter(key => TIPOS_PAGAMENTO[key].ativo),
            conta_plataforma: {
                ...CONFIGURACOES_PLATAFORMA.CONTA_PLATAFORMA,
                observacao: "Todo pagamento passa primeiro pela conta centralizada da NzoAgro (conta virtual por enquanto)"
            }
        });

    } catch (error) {
        console.log("Erro ao calcular o preço:", error);
        res.status(500).json({
            erro: "Erro ao calcular o preço do carrinho",
            detalhe: error.message
        });
    }
});

// ========================================
// ROTA: CRIAR PAGAMENTO COM DIVISÃO AUTOMÁTICA
// ========================================
router.post("/criar-pagamento", async (req, res) => {
    const { 
        id_pedido, 
        tipo_pagamento, 
        telefone_pagador, 
        id_comprador,
        peso_total = 10,
        usuario_premium = false
    } = req.body;

    if (!id_pedido || !tipo_pagamento || !telefone_pagador || !id_comprador) {
        return res.status(400).json({ 
            mensagem: "Campos obrigatórios: id_pedido, tipo_pagamento, telefone_pagador, id_comprador" 
        });
    }

    if (!TIPOS_PAGAMENTO[tipo_pagamento] || !TIPOS_PAGAMENTO[tipo_pagamento].ativo) {
        return res.status(400).json({ 
            mensagem: "Tipo de pagamento inválido ou inativo",
            tipos_disponiveis: Object.keys(TIPOS_PAGAMENTO).filter(key => TIPOS_PAGAMENTO[key].ativo)
        });
    }

    try {
        // Buscar dados do pedido
        const pedidoQuery = `
            SELECT 
                SUM(item.quantidade * prod.preco) AS total,
                ped.id_usuario as id_vendedor,
                u_vendedor.nome as nome_vendedor,
                u_vendedor.tipo_usuario as tipo_vendedor,
                u_comprador.nome as nome_comprador,
                u_comprador.tipo_usuario as tipo_comprador,
                ped.endereco_entrega
            FROM itens_pedido item 
            JOIN produtos prod ON item.id_produto = prod.id_produto 
            JOIN pedidos ped ON item.id_pedido = ped.id_pedido
            JOIN usuarios u_vendedor ON ped.id_usuario = u_vendedor.id_usuario
            JOIN usuarios u_comprador ON ? = u_comprador.id_usuario
            WHERE item.id_pedido = ?
            GROUP BY ped.id_usuario, u_vendedor.nome, u_vendedor.tipo_usuario, 
                     u_comprador.nome, u_comprador.tipo_usuario, ped.endereco_entrega
        `;

        const [resultado] = await conexao.promise().query(pedidoQuery, [id_comprador, id_pedido]);
        
        if (resultado.length === 0) {
            return res.status(400).json({ mensagem: "Pedido não encontrado ou sem itens válidos." });
        }

        const { 
            total, id_vendedor, nome_vendedor, tipo_vendedor,
            nome_comprador, tipo_comprador, endereco_entrega 
        } = resultado[0];

        // CALCULAR DIVISÃO AUTOMÁTICA DOS VALORES
        const calculoDivisao = await calcularDivisaoValores(
            parseFloat(total),
            tipo_pagamento,
            peso_total,
            usuario_premium
        );

        // Gerar IDs únicos
        const transacao_id = `NZOAGRO_${Date.now()}_${uuidv4().substring(0, 8).toUpperCase()}`;
        const referencia_pagamento = `REF_${Date.now()}`;

        // Inserir pagamento com divisão detalhada
        const sql = `
            INSERT INTO pagamentos 
            (id_pedido, tipo_pagamento, valor_bruto, valor_taxa, valor_frete_base, 
             valor_comissao_frete, valor_comissao, valor_liquido, status_pagamento, 
             transacao_id, referencia_pagamento, telefone_pagador, id_comprador, 
             id_vendedor, data_pagamento, peso_total, usuario_premium) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?)
        `;

        const [insertResult] = await conexao.promise().query(sql, [
            id_pedido, tipo_pagamento, calculoDivisao.valor_bruto, 
            calculoDivisao.taxa_provedor, calculoDivisao.valor_frete_base,
            calculoDivisao.comissao_frete, calculoDivisao.comissao_plataforma, 
            calculoDivisao.valor_liquido_vendedor, STATUS_PAGAMENTO.PROCESSANDO, 
            transacao_id, referencia_pagamento, telefone_pagador, 
            id_comprador, id_vendedor, peso_total, usuario_premium
        ]);

        // SIMULAÇÃO: Pagamento processado automaticamente
        setTimeout(async () => {
            try {
                const pagamentoAprovado = Math.random() > 0.05; // 95% de aprovação
                
                if (pagamentoAprovado) {
                    // Pagamento aprovado → RETIDO na conta da plataforma
                    await conexao.promise().query(
                        `UPDATE pagamentos 
                         SET status_pagamento = ?, data_confirmacao = NOW() 
                         WHERE id = ?`,
                        [STATUS_PAGAMENTO.RETIDO, insertResult.insertId]
                    );
                    
                    console.log(`✅ Pagamento ${transacao_id} aprovado e RETIDO na conta da plataforma NzoAgro`);
                    console.log(`💰 Divisão: Vendedor=${calculoDivisao.valor_liquido_vendedor} AKZ, Frete=${calculoDivisao.valor_frete_base} AKZ, Comissão=${calculoDivisao.comissao_plataforma} AKZ`);
                } else {
                    await conexao.promise().query(
                        `UPDATE pagamentos 
                         SET status_pagamento = ?, motivo_cancelamento = ? 
                         WHERE id = ?`,
                        [STATUS_PAGAMENTO.CANCELADO, 'Falha na validação do provedor', insertResult.insertId]
                    );
                    console.log(`❌ Pagamento ${transacao_id} CANCELADO`);
                }
            } catch (error) {
                console.error("Erro na simulação:", error);
            }
        }, 2000);

        return res.status(201).json({
            mensagem: "💰 Pagamento criado com sucesso! Divisão automática ativada.",
            transacao: {
                id: transacao_id,
                referencia: referencia_pagamento,
                status: STATUS_PAGAMENTO.PROCESSANDO,
                data_criacao: new Date().toISOString()
            },
            participantes: {
                comprador: `${nome_comprador} (${tipo_comprador})`,
                vendedor: `${nome_vendedor} (${tipo_vendedor})`,
                endereco_entrega: endereco_entrega
            },
            divisao_valores: {
                valor_total_pago: calculoDivisao.valor_bruto,
                distribuicao_automatica: {
                    vendedor: {
                        nome: nome_vendedor,
                        valor: calculoDivisao.valor_liquido_vendedor,
                        descricao: "Receberá após confirmação da entrega"
                    },
                    transportadora: {
                        valor: calculoDivisao.valor_frete_base,
                        descricao: `Frete base para ${peso_total}kg`
                    },
                    comissao_transporte: {
                        valor: calculoDivisao.comissao_frete,
                        descricao: "Comissão do transporte"
                    },
                    plataforma_nzoagro: {
                        valor: calculoDivisao.comissao_plataforma,
                        descricao: `Comissão (${calculoDivisao.detalhes_calculo.taxa_comissao_aplicada})`
                    },
                    provedor: {
                        nome: TIPOS_PAGAMENTO[tipo_pagamento].nome,
                        valor: calculoDivisao.taxa_provedor,
                        descricao: `Taxa do provedor (${calculoDivisao.detalhes_calculo.taxa_provedor_aplicada})`
                    }
                }
            },
            conta_centralizada_nzoagro: {
                ...CONFIGURACOES_PLATAFORMA.CONTA_PLATAFORMA,
                status_atual: "💰 Aguardando confirmação do pagamento",
                proximos_passos: [
                    "1. Pagamento será confirmado pelo " + TIPOS_PAGAMENTO[tipo_pagamento].nome,
                    "2. Valor fica RETIDO na conta centralizada NzoAgro (virtual)",
                    "3. Após entrega confirmada, valores são distribuídos automaticamente",
                    "4. Notificações enviadas para todas as partes"
                ]
            },
            instrucoes_pagamento: {
                provedor: TIPOS_PAGAMENTO[tipo_pagamento].nome,
                referencia: referencia_pagamento,
                codigo_ussd: TIPOS_PAGAMENTO[tipo_pagamento].codigo_ussd || null,
                valor_total: calculoDivisao.valor_bruto,
                instrucoes: `
📱 INSTRUÇÕES DE PAGAMENTO:
${TIPOS_PAGAMENTO[tipo_pagamento].codigo_ussd ? `1. Disque ${TIPOS_PAGAMENTO[tipo_pagamento].codigo_ussd} no seu telemóvel` : '1. Abra o app ' + TIPOS_PAGAMENTO[tipo_pagamento].nome}
2. Use a referência: ${referencia_pagamento}
3. Confirme o pagamento de ${calculoDivisao.valor_bruto} AKZ
4. Aguarde confirmação automática (±2 segundos)

💡 O seu dinheiro ficará seguro na conta NzoAgro até a entrega ser confirmada!
                `
            }
        });
    } catch (error) {
        return res.status(500).json({ 
            mensagem: "Erro ao processar pagamento", 
            erro: error.message 
        });
    }
});

// ========================================
// ROTA: CONFIRMAR ENTREGA E DISTRIBUIR VALORES
// ========================================
router.post("/confirmar-entrega/:transacao_id", async (req, res) => {
    const { transacao_id } = req.params;
    const { confirmado_por, metodo_confirmacao = 'manual', id_transportadora } = req.body;

    if (!confirmado_por) {
        return res.status(400).json({ mensagem: "Campo 'confirmado_por' é obrigatório" });
    }

    try {
        const [pagamento] = await conexao.promise().query(`
            SELECT p.*, 
                   u_comprador.nome as nome_comprador,
                   u_vendedor.nome as nome_vendedor, 
                   u_vendedor.tipo_usuario as tipo_vendedor
            FROM pagamentos p
            JOIN usuarios u_comprador ON p.id_comprador = u_comprador.id_usuario
            JOIN usuarios u_vendedor ON p.id_vendedor = u_vendedor.id_usuario
            WHERE p.transacao_id = ?
        `, [transacao_id]);

        if (pagamento.length === 0) {
            return res.status(404).json({ mensagem: "Transação não encontrada" });
        }

        const pag = pagamento[0];

        if (pag.status_pagamento !== STATUS_PAGAMENTO.RETIDO) {
            return res.status(400).json({ 
                mensagem: "❌ Pagamento deve estar RETIDO para ser liberado",
                status_atual: pag.status_pagamento,
                explicacao: "Apenas pagamentos retidos na conta NzoAgro podem ser distribuídos"
            });
        }

        // Verificar permissões
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
            tipo_confirmador === 'Moderador'
        );

        if (!podeConfirmar) {
            return res.status(403).json({ 
                mensagem: "❌ Permissão negada",
                explicacao: "Apenas o comprador, administradores ou moderadores podem confirmar a entrega"
            });
        }

        // DISTRIBUIR OS VALORES AUTOMATICAMENTE DA CONTA NZOAGRO
        const distribuicoesRealizadas = [];
        
        // 1. Transferir para o vendedor
        distribuicoesRealizadas.push({
            destinatario: pag.nome_vendedor,
            tipo: 'Vendedor',
            valor: pag.valor_liquido,
            descricao: 'Pagamento pela venda (transferido da conta NzoAgro)',
            metodo_transferencia: 'Transferência via Unitel Money/Africell Money'
        });

        // 2. Transferir para transportadora (se especificada)
        if (id_transportadora && pag.valor_frete_base > 0) {
            const [transportadora] = await conexao.promise().query(
                "SELECT nome FROM usuarios WHERE id_usuario = ? AND tipo_usuario = 'Transportadora'",
                [id_transportadora]
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

// 3. Comissão fica com a NzoAgro (já está na conta)
        distribuicoesRealizadas.push({
            destinatario: 'NzoAgro Platform Ltd',
            tipo: 'Plataforma',
            valor: pag.valor_comissao,
            descricao: 'Comissão da plataforma (permanece na conta NzoAgro)',
            metodo_transferencia: 'Retenção na conta centralizada'
        });

        // 4. Comissão do frete fica com a NzoAgro
        if (pag.valor_comissao_frete > 0) {
            distribuicoesRealizadas.push({
                destinatario: 'NzoAgro Platform Ltd',
                tipo: 'Comissão Transporte',
                valor: pag.valor_comissao_frete,
                descricao: 'Comissão sobre frete (permanece na conta NzoAgro)',
                metodo_transferencia: 'Retenção na conta centralizada'
            });
        }

        // Atualizar status para LIBERADO
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

        // REGISTRAR HISTÓRICO DE DISTRIBUIÇÃO
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
                total_distribuido: distribuicoesRealizadas.reduce((sum, dist) => sum + dist.valor, 0)
            },
            participantes_beneficiados: {
                comprador: `${pag.nome_comprador} - Produto entregue com sucesso`,
                vendedor: `${pag.nome_vendedor} - Recebeu ${pag.valor_liquido_vendedor} AKZ`,
                transportadora: id_transportadora ? `Recebeu ${pag.valor_frete_base} AKZ` : 'Não especificada',
                plataforma: `NzoAgro reteve ${pag.valor_comissao + pag.valor_comissao_frete} AKZ em comissões`
            },
            distribuicoes_realizadas: distribuicoesRealizadas,
            resumo_financeiro: {
                valor_original_pago: pag.valor_bruto,
                valor_distribuido_vendedor: pag.valor_liquido_vendedor,
                valor_distribuido_frete: pag.valor_frete_base,
                comissao_plataforma_total: pag.valor_comissao + pag.valor_comissao_frete,
                taxa_provedor_deduzida: pag.valor_taxa,
                conta_origem: CONFIGURACOES_PLATAFORMA.CONTA_PLATAFORMA.titular,
                peso_processado: `${pag.peso_total}kg`,
                tipo_usuario: pag.usuario_premium ? 'Premium' : 'Padrão'
            },
            conta_centralizada_pos_distribuicao: {
                ...CONFIGURACOES_PLATAFORMA.CONTA_PLATAFORMA,
                status_atual: "✅ Distribuição automática concluída",
                saldo_comissoes: pag.valor_comissao + pag.valor_comissao_frete,
                proxima_acao: "Aguardando próximas transações"
            },
            notificacoes_enviadas: [
                `📱 ${pag.nome_comprador}: Entrega confirmada com sucesso`,
                `💰 ${pag.nome_vendedor}: Pagamento de ${pag.valor_liquido_vendedor} AKZ transferido`,
                `🚚 Transportadora: Frete de ${pag.valor_frete_base} AKZ transferido`,
                `📊 NzoAgro: Comissões de ${pag.valor_comissao + pag.valor_comissao_frete} AKZ registradas`
            ],
            proximos_passos: [
                "✅ Transação finalizada com sucesso",
                "📊 Dados registrados no histórico de distribuições",
                "💼 Comissões contabilizadas para a plataforma",
                "🔄 Sistema pronto para próximas transações",
                "📈 Métricas atualizadas no painel administrativo"
            ]
        });
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

// ========================================
// ROTA: RELATÓRIO FINANCEIRO DETALHADO DA PLATAFORMA
// ========================================
router.get("/relatorio-financeiro", async (req, res) => {
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