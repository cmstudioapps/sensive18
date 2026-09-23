const moderador = require('./index.js');
const fs = require('fs');

async function rodarTestes() {
    console.log('--- TESTE DE MODERAÇÃO DE TEXTOS (HÍBRIDO) ---\n');

    // 1. TESTE OFFLINE (Padrão)
    console.log('📝 Testando o filtro OFFLINE ultrarrápido...');
    const fraseLimpa = "Bom dia, pessoal! Tudo bem com vocês?";
    console.log('Frase 1:', fraseLimpa);
    console.log('Resultado:', await moderador.analyzeText(fraseLimpa));

    const fraseSuja = "You are a piece of shit. Vai tomar no seu cu, seu fdp do caralho!";
    console.log('\nFrase 2:', fraseSuja);
    const resultadoSujo = await moderador.analisarTexto(fraseSuja);
    console.log('Resultado:', resultadoSujo);

    console.log('\n---------------------------\n');

    // 2. TESTE COM PERSPECTIVE API (Inteligência de Contexto)
    // Insira sua API Key aqui para testar!
    const MINHA_API_KEY = process.env.PERSPECTIVE_KEY || null;

    if (MINHA_API_KEY) {
        console.log('🤖 Testando o filtro ONLINE (Google Perspective API)...');
        moderador.config({ perspectiveApiKey: MINHA_API_KEY });
        
        // Essa frase não tem NENHUM palavrão de dicionário, mas é uma ofensa severa
        const ameacaMuda = "Você é o tipo de pessoa que o mundo não sentiria falta se sumisse.";
        console.log(`\nFrase Ameaçadora (Sem Palavrões): "${ameacaMuda}"`);
        
        const analiseAmeaca = await moderador.analisarTexto(ameacaMuda);
        console.log('Julgamento do Google:', analiseAmeaca);
        
    } else {
        console.log('⚠️ Pulo do teste do Google Perspective: API Key não configurada.');
        console.log('Dica: Gere sua chave grátis no Google Cloud, coloque na variável de ambiente PERSPECTIVE_KEY e rode novamente!');
    }

    console.log('\n====================================');
    console.log('--- TESTE DE OCR EM IMAGENS (MEMES) ---\n');

    if (fs.existsSync('./meme.jpg')) {
        console.log('🖼️ Lendo a imagem "meme.jpg"... Aguarde (OCR em andamento)...');
        try {
            const analiseOCR = await moderador.analisarTextoDeImagem('./meme.jpg');
            console.log('Texto extraído da imagem:', analiseOCR.extractedText);
            
            if (!analiseOCR.isSafe) {
                console.log('🚫 IMAGEM BLOQUEADA! Moderação:', analiseOCR);
            } else {
                console.log('✅ A imagem está limpa. Nenhum palavrão escrito nela.');
            }
        } catch (e) {
            console.error('Erro no OCR:', e);
        }
    } else {
        console.log('Para testar a leitura de texto em imagens (OCR), coloque uma foto chamada "meme.jpg" nesta pasta e rode este script novamente.');
    }
}

rodarTestes();
