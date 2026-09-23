const moderador = require('./index.js');
const fs = require('fs');

async function testarTudo() {
    console.log('==================================================');
    console.log('🧪 INICIANDO BATERIA DE TESTES GERAIS - SENSIVE18');
    console.log('==================================================\n');

    // 1. TESTE DE IMAGEM NSFW
    console.log('▶️ TESTE 1: Moderação de Nudez em Imagens (NSFW)');
    try {
        const dummyBase64 = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
        const resImg = await moderador.analyzeImage(dummyBase64);
        console.log('   Resultado Imagem:', resImg);
    } catch (e) {
        console.log('   Erro Imagem:', e.message);
    }

    // 2. TESTE DE IDADE
    console.log('\n▶️ TESTE 2: Estimativa de Idade (Face API)');
    try {
        const fakeBase64 = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
        const resIdade = await moderador.estimateAge(fakeBase64, { underAgeCheck: 18 });
        console.log('   Resultado Idade:', resIdade);
    } catch (e) {
        console.log('   Erro Idade:', e.message);
    }

    // 3. TESTE DE TEXTO (OFFLINE / DICIONÁRIO)
    console.log('\n▶️ TESTE 3: Moderação de Texto (Dicionário Local - Mais de 2800 palavras)');
    try {
        const fraseLimpa = "Que dia maravilhoso!";
        const fraseSuja = "Vai tomar no cu, seu otário!";
        
        const resLimpo = await moderador.analyzeText(fraseLimpa, { forceOffline: true });
        const resSujo = await moderador.analyzeText(fraseSuja, { forceOffline: true });
        
        console.log(`   Frase Limpa ("${fraseLimpa}") -> Seguro?`, resLimpo.isSafe);
        console.log(`   Frase Suja ("${fraseSuja}") -> Seguro?`, resSujo.isSafe);
        console.log(`   Censurado para o Chat: "${resSujo.censoredText}"`);
    } catch (e) {
        console.log('   Erro Texto Offline:', e.message);
    }

    // 4. TESTE DE TEXTO (IA LOCAL - TRADUÇÃO + TOXICITY OFFLINE)
    console.log('\n▶️ TESTE 4: Inteligência de Contexto (PIPELINE 100% OFFLINE)');
    console.log('   [⚙️] Ativando "useLocalToxicity: true" com limpeza de RAM (Garbage Collection)...');
    try {
        moderador.config({ useLocalToxicity: true, keepModelsInMemory: false });
        
        // Frase que o dicionário não pega, mas é uma ameaça:
        const fraseAmeacadoraLocal = "Vou te pegar na saída e acabar com a sua raça!";
        console.log(`   Avaliando (Baixando/Usando modelos na RAM e destruindo em seguida): "${fraseAmeacadoraLocal}"`);
        
        const resLocalIA = await moderador.analyzeText(fraseAmeacadoraLocal);
        console.log(`   Seguro?`, resLocalIA.isSafe);
        console.log(`   Detalhes do Pipeline:`, resLocalIA.badWordsFound);
        console.log(`   (Memória RAM liberada com sucesso).`);
    } catch (e) {
        console.log('   Erro Local IA Pipeline:', e.message);
    }

    // 5. TESTE DE ÁUDIO/VÍDEO STT E OCR
    console.log('\n▶️ TESTE 5: Mídias Físicas Reais (Whisper STT, OCR e Vídeos)');
    
    if (fs.existsSync('./audio_teste.mp3')) {
        console.log('\n   [+] Áudio "audio_teste.mp3" encontrado! Baixando Whisper local e Transcrevendo... (Pode demorar um pouco na primeira vez)');
        try {
            const resAudio = await moderador.analyzeAudioText('./audio_teste.mp3');
            console.log('   🗣️ Transcrição do Áudio:', resAudio.transcription);
            console.log('   ✅ Áudio Limpo?', resAudio.isSafe);
        } catch (e) {
            console.log('   Erro Áudio STT:', e.message);
        }
    } else {
        console.log('   -> Para testar transcrição de voz (Speech-to-Text Offline), coloque um "audio_teste.mp3" ou vídeo na pasta.');
    }

    if (fs.existsSync('./meme.jpg')) {
        console.log('\n   [+] Imagem "meme.jpg" encontrada! Rodando OCR...');
        const resOcr = await moderador.analyzeImageText('./meme.jpg');
        console.log('   Texto extraído:', resOcr.extractedText);
    } else {
        console.log('   -> Para testar OCR, coloque um "meme.jpg" na pasta.');
    }

    if (fs.existsSync('./video_teste.mp4')) {
        console.log('\n   [+] Vídeo "video_teste.mp4" encontrado! Rodando varredura (aguarde)...');
        const resVidNsfw = await moderador.analyzeVideo('./video_teste.mp4', { frames: 3 });
        console.log('   NSFW Resultado Vídeo:', resVidNsfw.isSafe);
    }

    console.log('\n==================================================');
    console.log('✅ BATERIA DE TESTES FINALIZADA!');
    console.log('==================================================');
}

testarTudo();
