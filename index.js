const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const tf = require('@tensorflow/tfjs-node');
const nsfwjs = require('nsfwjs');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const humanCore = require('@vladmandic/human').default || require('@vladmandic/human');
const leoProfanity = require('leo-profanity');
const Tesseract = require('tesseract.js');
const { WaveFile } = require('wavefile');

ffmpeg.setFfmpegPath(ffmpegStatic);

let transformersCore = null;
function getTransformers() {
    if (!transformersCore) {
        try {
            transformersCore = require('@xenova/transformers');
            transformersCore.env.allowLocalModels = true;
            transformersCore.env.useBrowserCache = false;
        } catch (error) {
            console.error('\n[Sensive18] Falha crítica de ambiente: O motor de Inteligência Artificial Local ("@xenova/transformers") não pôde ser inicializado porque uma de suas dependências nativas (geralmente o "sharp") falhou ao instalar (ex: bloqueio de rede).\n\n--> COMO RESOLVER: Rode o comando abaixo no terminal do seu projeto:\n    npm install --platform=linux --arch=x64 sharp --legacy-peer-deps\n\nAviso: O sistema continuará funcionando no modo offline (Dicionários) sem interrupções.\n');
            throw new Error('Dependência nativa do motor Xenova/Sharp ausente ou corrompida.');
        }
    }
    return transformersCore;
}

let nsfwModel = null;
let humanModel = null;
let transcriberModel = null;
let cachedToxicityModel = null;
let cachedTranslationModel = null;

let currentConfig = {
    threshold: 0.8,
    perspectiveApiKey: null,
    perspectiveThreshold: 0.75,
    useLocalToxicity: false,
    keepModelsInMemory: false
};

// ==========================================
// CARREGAMENTO DE DICIONÁRIOS (TEXTO OFFLINE)
// ==========================================
let dictionarySet = new Set();
try {
    const enText = fs.readFileSync(path.join(__dirname, 'dict_en_massive.json'), 'utf8');
    const ptText = fs.readFileSync(path.join(__dirname, 'dict_pt.txt'), 'utf8');
    
    const enWords = JSON.parse(enText);
    const ptWords = ptText.split('\n').map(w => w.trim().toLowerCase()).filter(w => w.length > 0);
    
    const badWords = [...new Set([...enWords, ...ptWords])];
    
    leoProfanity.clearList();
    leoProfanity.add(badWords);
    dictionarySet = new Set(leoProfanity.list());
} catch (e) {
    console.error('Sensive18: Aviso - Erro ao carregar dicionários massivos de palavrões:', e.message);
}

// ==========================================
// INICIALIZAÇÃO E CONFIGURAÇÃO
// ==========================================
async function getNsfwModel() {
    if (!nsfwModel) nsfwModel = await nsfwjs.load();
    return nsfwModel;
}

async function getHumanModel() {
    if (!humanModel) {
        const modelPath = 'file://' + path.join(__dirname, 'node_modules', '@vladmandic/human', 'models');
        const HumanClass = humanCore.Human || humanCore;
        humanModel = new HumanClass({
            backend: 'tensorflow', modelBasePath: modelPath,
            face: { enabled: true, detector: { return: true }, mesh: { enabled: false }, iris: { enabled: false }, emotion: { enabled: false }, description: { enabled: true } },
            body: { enabled: false }, hand: { enabled: false }, object: { enabled: false }, gesture: { enabled: false }, segmentation: { enabled: false }
        });
        await humanModel.load();
    }
    return humanModel;
}

async function getTranscriberModel() {
    const { pipeline } = getTransformers();
    if (!transcriberModel) transcriberModel = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny');
    return transcriberModel;
}

function config(options = {}) {
    if (options.threshold !== undefined) currentConfig.threshold = options.threshold;
    if (options.perspectiveApiKey !== undefined) currentConfig.perspectiveApiKey = options.perspectiveApiKey;
    if (options.perspectiveThreshold !== undefined) currentConfig.perspectiveThreshold = options.perspectiveThreshold;
    if (options.useLocalToxicity !== undefined) currentConfig.useLocalToxicity = options.useLocalToxicity;
    if (options.keepModelsInMemory !== undefined) currentConfig.keepModelsInMemory = options.keepModelsInMemory;
}

async function decodificarEntrada(input) {
    let buffer;
    if (typeof input === 'string') {
        if (input.startsWith('data:image')) {
            const base64 = input.replace(/^data:image\/\w+;base64,/, '');
            buffer = Buffer.from(base64, 'base64');
        } else {
            buffer = fs.readFileSync(input);
        }
    } else if (Buffer.isBuffer(input)) {
        buffer = input;
    } else {
        throw new Error('Entrada inválida.');
    }
    return buffer;
}

// ==========================================
// FUNÇÕES DE TEXTO E PIPELINE LOCAL
// ==========================================
async function runLocalToxicityPipeline(texto) {
    let tModel = null;
    let trModel = null;
    let pipeline;
    try {
        pipeline = getTransformers().pipeline;
    } catch(e) {
        throw e; // O erro já foi impresso no getTransformers()
    }
    
    let toxicityCore;
    try {
        toxicityCore = require('@tensorflow-models/toxicity');
    } catch(e) {
        console.error('\n[Sensive18] O módulo de Toxicidade Offline não foi encontrado.\n--> COMO RESOLVER: Instale-o com o comando:\n    npm install @tensorflow-models/toxicity --save --legacy-peer-deps\n');
        throw new Error('Motor Toxicity ausente.');
    }
    
    try {
        if (currentConfig.keepModelsInMemory) {
            if (!cachedToxicityModel) cachedToxicityModel = await toxicityCore.load(currentConfig.perspectiveThreshold);
            if (!cachedTranslationModel) cachedTranslationModel = await pipeline('translation', 'Xenova/opus-mt-roa-en');
            tModel = cachedToxicityModel;
            trModel = cachedTranslationModel;
        } else {
            // Lazy load - não cacheia na variável global
            tModel = await toxicityCore.load(currentConfig.perspectiveThreshold);
            trModel = await pipeline('translation', 'Xenova/opus-mt-roa-en');
        }

        const transRes = await trModel(texto);
        const textoEn = transRes[0].translation_text;

        const predictions = await tModel.classify([textoEn]);
        
        let isToxic = false;
        let reasons = [];
        for (const p of predictions) {
            if (p.results[0].match === true) {
                isToxic = true;
                reasons.push(p.label);
            }
        }
        
        return { isSafe: !isToxic, reasons, translation: textoEn };
    } finally {
        // Limpa a RAM instantaneamente se o usuário não pediu para manter
        if (!currentConfig.keepModelsInMemory) {
            if (trModel && trModel.dispose) trModel.dispose();
            tModel = null;
            trModel = null;
        }
    }
}

async function avaliarNoGooglePerspective(texto) {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify({ comment: { text: texto }, languages: ['pt', 'en'], requestedAttributes: { TOXICITY: {}, SEVERE_TOXICITY: {}, INSULT: {}, PROFANITY: {}, THREAT: {} }});
        const req = https.request({ hostname: 'commentanalyzer.googleapis.com', port: 443, path: `/v1alpha1/comments:analyze?key=${currentConfig.perspectiveApiKey}`, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': payload.length } }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try { resolve(JSON.parse(data)); } catch (e) { reject(new Error('Parse error.')); }
                } else { reject(new Error(`Code ${res.statusCode}`)); }
            });
        });
        req.on('error', (e) => reject(e));
        req.write(payload);
        req.end();
    });
}

function analisarTextoOffline(texto) {
    const isSafe = !leoProfanity.check(texto);
    const censoredText = leoProfanity.clean(texto);
    const wordsInText = texto.split(/\b/);
    const badWordsFound = [];
    for (const w of wordsInText) if (dictionarySet.has(w.toLowerCase())) badWordsFound.push(w);

    return { isSafe, badWordsFound: [...new Set(badWordsFound)], censoredText, source: 'offline-dictionary' };
}

async function analisarTexto(texto, options = {}) {
    if (typeof texto !== 'string') throw new Error('A entrada para análise de texto deve ser uma String.');
    
    // Nível 1: API do Google (Extrema Leveza e Rapidez)
    if (currentConfig.perspectiveApiKey && !options.forceOffline) {
        try {
            const googleRes = await avaliarNoGooglePerspective(texto);
            const toxicity = googleRes.attributeScores.TOXICITY.summaryScore.value;
            const severeToxicity = googleRes.attributeScores.SEVERE_TOXICITY.summaryScore.value;
            const threat = googleRes.attributeScores.THREAT.summaryScore.value;
            const worstScore = Math.max(toxicity, severeToxicity, threat);
            const isSafe = worstScore < currentConfig.perspectiveThreshold;
            
            return {
                isSafe,
                badWordsFound: isSafe ? [] : ['[toxicidade-detectada-por-contexto]'],
                censoredText: isSafe ? texto : '[MENSAGEM RETIDA PELA MODERAÇÃO DE CONTEXTO]',
                source: 'perspective-api'
            };
        } catch (error) {
            console.warn(`Sensive18 Aviso: Google Perspective falhou. Fallback acionado.`);
        }
    }
    
    // Nível 2: Pipeline Tradução -> Toxicity Local (Robusto, sem internet)
    if (currentConfig.useLocalToxicity) {
        try {
            const pipelineRes = await runLocalToxicityPipeline(texto);
            if (!pipelineRes.isSafe) {
                return {
                    isSafe: false,
                    badWordsFound: ['[toxicidade-detectada-localmente: ' + pipelineRes.reasons.join(', ') + ']'],
                    censoredText: '[MENSAGEM RETIDA PELA MODERAÇÃO LOCAL DE CONTEXTO]',
                    source: 'offline-toxicity-pipeline'
                };
            }
            // Se o pipeline local considerou seguro, ainda validamos com o dicionário por garantia (Nível 3)
        } catch (error) {
            console.warn(`Sensive18 Aviso: Falha no Pipeline Offline de Tradução/Toxicity (${error.message}). Fallback final acionado.`);
        }
    }
    
    // Nível 3: Fallback Final (Dicionário regex ultrarrápido offline)
    return analisarTextoOffline(texto);
}

// ... [restante do código (analisarTextoDeImagem, analisarAudio, imagens, video, etc) inalterado]

async function analisarTextoDeImagem(input) {
    let buffer; try { buffer = await decodificarEntrada(input); } catch(e) { throw new Error(e.message); }
    try {
        const { data: { text } } = await Tesseract.recognize(buffer, 'eng+por');
        const analiseTexto = await analisarTexto(text.trim());
        return { isSafe: analiseTexto.isSafe, badWordsFound: analiseTexto.badWordsFound, extractedText: text.trim(), censoredText: analiseTexto.censoredText, source: analiseTexto.source };
    } catch (error) { throw new Error(`Falha no OCR: ${error.message}`); }
}

function adicionarPalavraProibida(palavra) {
    if (typeof palavra === 'string') leoProfanity.add(palavra.trim().toLowerCase());
    else if (Array.isArray(palavra)) leoProfanity.add(palavra.map(p => p.trim().toLowerCase()));
    dictionarySet = new Set(leoProfanity.list());
}

function removerPalavraProibida(palavra) {
    if (typeof palavra === 'string') leoProfanity.remove(palavra.trim().toLowerCase());
    else if (Array.isArray(palavra)) leoProfanity.remove(palavra.map(p => p.trim().toLowerCase()));
    dictionarySet = new Set(leoProfanity.list());
}

async function converterParaWav(inputPath) {
    return new Promise((resolve, reject) => {
        const tempWavPath = path.join(os.tmpdir(), `sensive18_audio_${Date.now()}.wav`);
        ffmpeg(inputPath).toFormat('wav').audioChannels(1).audioFrequency(16000)
            .on('end', () => resolve(tempWavPath))
            .on('error', (err) => reject(new Error('Erro FFmpeg: ' + err.message))).save(tempWavPath);
    });
}

async function analisarAudio(inputPath) {
    if (typeof inputPath !== 'string') throw new Error('Entrada deve ser path do arquivo.');
    const wavPath = await converterParaWav(inputPath);
    try {
        const buffer = fs.readFileSync(wavPath);
        const wav = new WaveFile(buffer);
        wav.toBitDepth('32f'); wav.toSampleRate(16000);
        let audioData = wav.getSamples(); if (Array.isArray(audioData)) audioData = audioData[0];
        const transcriber = await getTranscriberModel();
        const result = await transcriber(audioData);
        const analiseTexto = await analisarTexto(result.text.trim());
        return { isSafe: analiseTexto.isSafe, transcription: result.text.trim(), badWordsFound: analiseTexto.badWordsFound, censoredText: analiseTexto.censoredText, source: analiseTexto.source };
    } finally {
        if (fs.existsSync(wavPath)) fs.unlinkSync(wavPath);
    }
}

async function analisarImagem(input) {
    let buffer; try { buffer = await decodificarEntrada(input); } catch(e) { throw new Error(e.message); }
    const loadedModel = await getNsfwModel();
    let imageTensor;
    try {
        imageTensor = tf.node.decodeImage(buffer, 3);
        const predictions = await loadedModel.classify(imageTensor);
        const topCategory = predictions[0].className;
        const explicitScore = (predictions.find(p => p.className === 'Porn')?.probability || 0) + (predictions.find(p => p.className === 'Hentai')?.probability || 0);
        return { isSafe: explicitScore < currentConfig.threshold, explicitScore: parseFloat(explicitScore.toFixed(4)), topCategory, rawPredictions: predictions };
    } finally {
        if (imageTensor) imageTensor.dispose();
    }
}

async function analisarVideo(inputPath, options = {}) {
    if (typeof inputPath !== 'string') throw new Error('Input deve ser caminho local.');
    const framesToExtract = options.frames || 3;
    const tempDir = os.tmpdir(); const tempPrefix = `sensive18_vid_${Date.now()}`;

    return new Promise((resolve, reject) => {
        let generatedFiles = [];
        const timestamps = [];
        if (framesToExtract === 1) timestamps.push('50%');
        else { const step = 80 / Math.max(1, framesToExtract - 1); for (let i = 0; i < framesToExtract; i++) timestamps.push(`${Math.round(10 + i * step)}%`); }

        ffmpeg(inputPath).on('filenames', (f) => { generatedFiles = f.map(x => path.join(tempDir, x)); }).on('end', async () => {
            let worstAnalysis = null; let isVideoSafe = true;
            try {
                for (const framePath of generatedFiles) {
                    if (!fs.existsSync(framePath)) continue;
                    const analise = await analisarImagem(fs.readFileSync(framePath));
                    if (!worstAnalysis || analise.explicitScore > worstAnalysis.explicitScore) worstAnalysis = analise;
                    if (!analise.isSafe) { isVideoSafe = false; break; }
                }
                for (const framePath of generatedFiles) if (fs.existsSync(framePath)) fs.unlinkSync(framePath);
                if (!worstAnalysis) worstAnalysis = { isSafe: true, explicitScore: 0, topCategory: 'Neutral', rawPredictions: [] };
                resolve({ isSafe: isVideoSafe, explicitScore: worstAnalysis.explicitScore, topCategory: worstAnalysis.topCategory, rawPredictions: worstAnalysis.rawPredictions, details: 'Pior frame detectado.' });
            } catch (error) {
                for (const framePath of generatedFiles) if (fs.existsSync(framePath)) fs.unlinkSync(framePath);
                reject(new Error(`Erro video: ${error.message}`));
            }
        }).on('error', (err) => reject(new Error(`Erro ffmpeg: ${err.message}`))).screenshots({ timestamps, filename: `${tempPrefix}_%02d.jpg`, folder: tempDir, size: '?x480' });
    });
}

function calculateCosineSimilarity(vecA, vecB) {
    if (!vecA || !vecB) return 0;
    let dotProduct = 0, normA = 0, normB = 0;
    for (let i = 0; i < vecA.length; i++) { dotProduct += vecA[i] * vecB[i]; normA += vecA[i] * vecA[i]; normB += vecB[i] * vecB[i]; }
    if (normA === 0 || normB === 0) return 0; return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function estimarIdade(input, options = {}) {
    let buffer; try { buffer = await decodificarEntrada(input); } catch(e) { throw new Error(e.message); }
    const loadedHuman = await getHumanModel();
    let imageTensor;
    try {
        imageTensor = tf.node.decodeImage(buffer, 3);
        const result = await loadedHuman.detect(imageTensor);
        const faces = (result.face || []).map(f => {
            const rawAge = f.age || 0;
            const faceResult = { age: Math.round(rawAge), gender: f.gender, genderScore: f.genderScore, box: f.box, descriptor: f.embedding || f.descriptor };
            if (options.underAgeCheck !== undefined) {
                faceResult.isUnderAge = rawAge < options.underAgeCheck;
                faceResult.underAgeProbability = parseFloat((1 / (1 + Math.exp((rawAge - options.underAgeCheck) * 0.8))).toFixed(4));
            }
            return faceResult;
        });
        return { hasFaces: faces.length > 0, faceCount: faces.length, faces };
    } finally { if (imageTensor) imageTensor.dispose(); }
}

async function estimarIdadeVideo(inputPath, options = {}) {
    if (typeof inputPath !== 'string') throw new Error('Path inválido.');
    const framesToExtract = options.frames || 3;
    const tempDir = os.tmpdir(); const tempPrefix = `sensive18_vidface_${Date.now()}`;
    return new Promise((resolve, reject) => {
        let generatedFiles = [];
        const timestamps = [];
        if (framesToExtract === 1) timestamps.push('50%');
        else { const step = 80 / Math.max(1, framesToExtract - 1); for (let i = 0; i < framesToExtract; i++) timestamps.push(`${Math.round(10 + i * step)}%`); }

        ffmpeg(inputPath).on('filenames', (f) => { generatedFiles = f.map(x => path.join(tempDir, x)); }).on('end', async () => {
            let allFaces = []; let uniquePeople = [];
            try {
                for (const framePath of generatedFiles) {
                    if (!fs.existsSync(framePath)) continue;
                    const analiseFrame = await estimarIdade(fs.readFileSync(framePath), options);
                    for (const face of analiseFrame.faces) {
                        allFaces.push(face);
                        let isNewPerson = true;
                        for (const kp of uniquePeople) {
                            if (face.descriptor && kp.descriptor && calculateCosineSimilarity(face.descriptor, kp.descriptor) > 0.6) { isNewPerson = false; break; }
                        }
                        if (isNewPerson) uniquePeople.push(face);
                    }
                }
                for (const framePath of generatedFiles) if (fs.existsSync(framePath)) fs.unlinkSync(framePath);
                const cleanFaces = allFaces.map(f => { const { descriptor, ...safeFace } = f; return safeFace; });
                resolve({ hasFaces: cleanFaces.length > 0, faceCountTotal: cleanFaces.length, uniquePeopleCount: uniquePeople.length, faces: cleanFaces });
            } catch (error) {
                for (const framePath of generatedFiles) if (fs.existsSync(framePath)) fs.unlinkSync(framePath);
                reject(new Error(`Erro video: ${error.message}`));
            }
        }).on('error', (err) => reject(new Error(`Erro ffmpeg: ${err.message}`))).screenshots({ timestamps, filename: `${tempPrefix}_%02d.jpg`, folder: tempDir, size: '?x480' });
    });
}

let clipModel = null;
async function getClipModel() {
    if (!clipModel) {
        const { pipeline } = getTransformers();
        clipModel = await pipeline('zero-shot-image-classification', 'Xenova/clip-vit-base-patch32');
    }
    return clipModel;
}

/**
 * Analisa a natureza visual de uma imagem.
 * @param {string|Buffer} entrada - Base64, caminho local ou Buffer.
 * @returns {Promise<Object>} Resultado da classificação.
 */
async function verifyComposeImage(entrada) {
    try {
        const buffer = await decodificarEntrada(entrada);
        const model = await getClipModel();
        const labels = ["real photo", "drawing or illustration", "anime or manga", "digital art", "3D render", "AI-generated image"];
        
        const rawResults = await model(buffer, labels);
        
        // Mapeia os rótulos do CLIP para chaves camelCase mais limpas
        const keyMap = {
            "real photo": "realPhoto",
            "drawing or illustration": "drawingOrIllustration",
            "anime or manga": "animeOrManga",
            "digital art": "digitalArt",
            "3D render": "threeDRender",
            "AI-generated image": "aiGeneratedImage"
        };

        const results = {};
        rawResults.forEach(r => {
            const mappedKey = keyMap[r.label] || r.label;
            results[mappedKey] = parseFloat(r.score.toFixed(4));
        });

        // Determina o tipo principal com base na maior pontuação
        const sortedEntries = Object.entries(results).sort((a, b) => b[1] - a[1]);
        const [topType, topScore] = sortedEntries[0];

        return {
            success: true,
            type: topType,
            confidence: topScore,
            results: results,
            description: `A imagem foi classificada como ${topType} com ${(topScore * 100).toFixed(2)}% de similaridade.`
        };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

/**
 * Alternativa em português para análise visual.
 * @param {string|Buffer} entrada - Base64, caminho local ou Buffer.
 * @returns {Promise<Object>} Resultado da classificação.
 */
async function verificarImagem(entrada) {
    return await verifyComposeImage(entrada);
}
const analyzeImage = analisarImagem; const analyzeVideo = analisarVideo; const estimateAge = estimarIdade; const estimateAgeVideo = estimarIdadeVideo;
const analyzeText = analisarTexto; const analyzeImageText = analisarTextoDeImagem; const addForbiddenWord = adicionarPalavraProibida;
const removeForbiddenWord = removerPalavraProibida; const analyzeAudioText = analisarAudio; const analyzeVideoText = analisarTextoDeVideo;

module.exports = {
    config, analisarImagem, analyzeImage, analisarVideo, analyzeVideo,
    estimarIdade, estimateAge, estimarIdadeVideo, estimateAgeVideo,
    analisarTexto, analyzeText, analisarTextoDeImagem, analyzeImageText,
    adicionarPalavraProibida, addForbiddenWord, removerPalavraProibida, removeForbiddenWord,
    analisarAudio, analyzeAudioText, analisarTextoDeVideo, analyzeVideoText,
    verifyComposeImage, verificarImagem
};
