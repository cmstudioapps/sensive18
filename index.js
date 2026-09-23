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
const { pipeline, env } = require('@xenova/transformers');
const { WaveFile } = require('wavefile');

ffmpeg.setFfmpegPath(ffmpegStatic);

// Configurações do Transformers para Node
env.allowLocalModels = true;
env.useBrowserCache = false;

let nsfwModel = null;
let humanModel = null;
let transcriberModel = null;

let currentConfig = {
    threshold: 0.8,
    perspectiveApiKey: null,
    perspectiveThreshold: 0.75 // Nível de tolerância para a IA do Google (acima de 75% bloqueia)
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
    if (!nsfwModel) {
        nsfwModel = await nsfwjs.load();
    }
    return nsfwModel;
}

async function getHumanModel() {
    if (!humanModel) {
        const modelPath = 'file://' + path.join(__dirname, 'node_modules', '@vladmandic/human', 'models');
        
        const HumanClass = humanCore.Human || humanCore;
        humanModel = new HumanClass({
            backend: 'tensorflow',
            modelBasePath: modelPath,
            face: {
                enabled: true,
                detector: { return: true },
                mesh: { enabled: false }, 
                iris: { enabled: false },
                emotion: { enabled: false },
                description: { enabled: true }
            },
            body: { enabled: false },
            hand: { enabled: false },
            object: { enabled: false },
            gesture: { enabled: false },
            segmentation: { enabled: false }
        });
        await humanModel.load();
    }
    return humanModel;
}

async function getTranscriberModel() {
    if (!transcriberModel) {
        transcriberModel = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny');
    }
    return transcriberModel;
}

function config(options = {}) {
    if (options.threshold !== undefined) currentConfig.threshold = options.threshold;
    if (options.perspectiveApiKey !== undefined) currentConfig.perspectiveApiKey = options.perspectiveApiKey;
    if (options.perspectiveThreshold !== undefined) currentConfig.perspectiveThreshold = options.perspectiveThreshold;
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
        throw new Error('Entrada inválida: O input deve ser um caminho, um Buffer ou Base64.');
    }
    return buffer;
}

// ==========================================
// FUNÇÕES DE TEXTO E INTEGRAÇÃO GOOGLE
// ==========================================
async function avaliarNoGooglePerspective(texto) {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify({
            comment: { text: texto },
            languages: ['pt', 'en'],
            requestedAttributes: {
                TOXICITY: {},
                SEVERE_TOXICITY: {},
                INSULT: {},
                PROFANITY: {},
                THREAT: {}
            }
        });

        const req = https.request({
            hostname: 'commentanalyzer.googleapis.com',
            port: 443,
            path: `/v1alpha1/comments:analyze?key=${currentConfig.perspectiveApiKey}`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': payload.length
            }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        resolve(JSON.parse(data));
                    } catch (e) {
                        reject(new Error('Erro ao processar JSON do Perspective API.'));
                    }
                } else {
                    reject(new Error(`Erro Perspective API: Code ${res.statusCode}`));
                }
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
    
    for (const w of wordsInText) {
        if (dictionarySet.has(w.toLowerCase())) {
            badWordsFound.push(w);
        }
    }

    return {
        isSafe,
        badWordsFound: [...new Set(badWordsFound)],
        censoredText,
        source: 'offline-dictionary'
    };
}

async function analisarTexto(texto, options = {}) {
    if (typeof texto !== 'string') {
        throw new Error('A entrada para análise de texto deve ser uma String.');
    }
    
    // Se não tiver API Key ou forçar o offline, roda o dicionário ultrarrápido
    if (!currentConfig.perspectiveApiKey || options.forceOffline) {
        return analisarTextoOffline(texto);
    }
    
    // Integração Inteligente com Perspective API
    try {
        const googleRes = await avaliarNoGooglePerspective(texto);
        
        const toxicity = googleRes.attributeScores.TOXICITY.summaryScore.value;
        const severeToxicity = googleRes.attributeScores.SEVERE_TOXICITY.summaryScore.value;
        const insult = googleRes.attributeScores.INSULT.summaryScore.value;
        const profanity = googleRes.attributeScores.PROFANITY.summaryScore.value;
        const threat = googleRes.attributeScores.THREAT.summaryScore.value;
        
        const worstScore = Math.max(toxicity, severeToxicity, insult, profanity, threat);
        const isSafe = worstScore < currentConfig.perspectiveThreshold;
        
        return {
            isSafe,
            // O Google avalia o contexto e não aponta uma palavra exata
            badWordsFound: isSafe ? [] : ['[toxicidade-detectada-por-contexto]'],
            censoredText: isSafe ? texto : '[MENSAGEM RETIDA PELA MODERAÇÃO DE CONTEXTO]',
            toxicityScore: toxicity,
            threatScore: threat,
            insultScore: insult,
            profanityScore: profanity,
            source: 'perspective-api'
        };
        
    } catch (error) {
        // FALLBACK: Caiu a internet do servidor ou estourou o limite de requisições?
        // Ele ativa instantaneamente a defesa local (dicionário).
        console.warn(`Sensive18 Aviso: Google Perspective falhou (${error.message}). Realizando fallback para filtro offline...`);
        return analisarTextoOffline(texto);
    }
}

async function analisarTextoDeImagem(input) {
    let buffer;
    try { buffer = await decodificarEntrada(input); } catch(e) { throw new Error(e.message); }
    
    try {
        const { data: { text } } = await Tesseract.recognize(buffer, 'eng+por');
        const extractedText = text.trim();
        
        // Agora aguardamos a função assíncrona
        const analiseTexto = await analisarTexto(extractedText);
        
        return {
            isSafe: analiseTexto.isSafe,
            badWordsFound: analiseTexto.badWordsFound,
            extractedText: extractedText,
            censoredText: analiseTexto.censoredText,
            source: analiseTexto.source
        };
    } catch (error) {
        throw new Error(`Falha ao realizar OCR na imagem: ${error.message}`);
    }
}

function adicionarPalavraProibida(palavra) {
    if (typeof palavra === 'string') {
        leoProfanity.add(palavra.trim().toLowerCase());
    } else if (Array.isArray(palavra)) {
        leoProfanity.add(palavra.map(p => p.trim().toLowerCase()));
    }
    dictionarySet = new Set(leoProfanity.list());
}

function removerPalavraProibida(palavra) {
    if (typeof palavra === 'string') {
        leoProfanity.remove(palavra.trim().toLowerCase());
    } else if (Array.isArray(palavra)) {
        leoProfanity.remove(palavra.map(p => p.trim().toLowerCase()));
    }
    dictionarySet = new Set(leoProfanity.list());
}

// ==========================================
// FUNÇÕES DE ÁUDIO E VÍDEO (STT WHISPER)
// ==========================================
async function converterParaWav(inputPath) {
    return new Promise((resolve, reject) => {
        const tempWavPath = path.join(os.tmpdir(), `sensive18_audio_${Date.now()}.wav`);
        ffmpeg(inputPath)
            .toFormat('wav')
            .audioChannels(1)
            .audioFrequency(16000)
            .on('end', () => resolve(tempWavPath))
            .on('error', (err) => reject(new Error('Erro ao extrair áudio: ' + err.message)))
            .save(tempWavPath);
    });
}

async function analisarAudio(inputPath) {
    if (typeof inputPath !== 'string') {
        throw new Error('A entrada para análise de áudio deve ser o caminho (path) do arquivo.');
    }

    // 1. Extrai o áudio para Wav Mono 16kHz
    const wavPath = await converterParaWav(inputPath);
    
    try {
        // 2. Lê os samples do Wav
        const buffer = fs.readFileSync(wavPath);
        const wav = new WaveFile(buffer);
        
        wav.toBitDepth('32f');
        wav.toSampleRate(16000);
        let audioData = wav.getSamples();
        if (Array.isArray(audioData)) {
            audioData = audioData[0]; // Pega apenas um canal se estéreo
        }

        // 3. Inicia Whisper
        const transcriber = await getTranscriberModel();
        
        // 4. Faz inferência do áudio
        const result = await transcriber(audioData);
        const transcriptText = result.text.trim();
        
        // 5. Encaminha para o motor duplo de texto
        const analiseTexto = await analisarTexto(transcriptText);

        return {
            isSafe: analiseTexto.isSafe,
            transcription: transcriptText,
            badWordsFound: analiseTexto.badWordsFound,
            censoredText: analiseTexto.censoredText,
            source: analiseTexto.source
        };
    } catch (error) {
        throw new Error(`Falha no processamento de áudio/vídeo: ${error.message}`);
    } finally {
        if (fs.existsSync(wavPath)) {
            fs.unlinkSync(wavPath);
        }
    }
}

// ==========================================
// FUNÇÕES DE IMAGEM NSFW
// ==========================================
async function analisarImagem(input) {
    let buffer;
    try { buffer = await decodificarEntrada(input); } catch(e) { throw new Error(e.message); }

    const loadedModel = await getNsfwModel();
    let imageTensor;
    try {
        imageTensor = tf.node.decodeImage(buffer, 3);
        const predictions = await loadedModel.classify(imageTensor);
        
        const topCategory = predictions[0].className;
        const pornScore = predictions.find(p => p.className === 'Porn')?.probability || 0;
        const hentaiScore = predictions.find(p => p.className === 'Hentai')?.probability || 0;
        
        const explicitScore = pornScore + hentaiScore;
        const isSafe = explicitScore < currentConfig.threshold;
        
        return {
            isSafe,
            explicitScore: parseFloat(explicitScore.toFixed(4)),
            topCategory,
            rawPredictions: predictions
        };
    } catch (error) {
        throw new Error(`Falha durante a execução do modelo: ${error.message}`);
    } finally {
        if (imageTensor) imageTensor.dispose();
    }
}

async function analisarVideo(inputPath, options = {}) {
    if (typeof inputPath !== 'string') throw new Error('O input para vídeo deve ser o caminho do arquivo.');
    const framesToExtract = options.frames || 3;
    const tempDir = os.tmpdir();
    const tempPrefix = `sensive18_vid_${Date.now()}`;

    return new Promise((resolve, reject) => {
        let generatedFiles = [];
        const timestamps = [];
        if (framesToExtract === 1) timestamps.push('50%');
        else {
            const step = 80 / Math.max(1, framesToExtract - 1);
            for (let i = 0; i < framesToExtract; i++) timestamps.push(`${Math.round(10 + i * step)}%`);
        }

        ffmpeg(inputPath)
            .on('filenames', (filenames) => { generatedFiles = filenames.map(f => path.join(tempDir, f)); })
            .on('end', async () => {
                let worstAnalysis = null;
                let isVideoSafe = true;

                try {
                    for (const framePath of generatedFiles) {
                        if (!fs.existsSync(framePath)) continue;
                        const buffer = fs.readFileSync(framePath);
                        const analise = await analisarImagem(buffer);
                        if (!worstAnalysis || analise.explicitScore > worstAnalysis.explicitScore) worstAnalysis = analise;
                        if (!analise.isSafe) { isVideoSafe = false; break; }
                    }
                    for (const framePath of generatedFiles) if (fs.existsSync(framePath)) fs.unlinkSync(framePath);
                    if (!worstAnalysis) worstAnalysis = { isSafe: true, explicitScore: 0, topCategory: 'Neutral', rawPredictions: [] };

                    resolve({
                        isSafe: isVideoSafe,
                        explicitScore: worstAnalysis.explicitScore,
                        topCategory: worstAnalysis.topCategory,
                        rawPredictions: worstAnalysis.rawPredictions,
                        details: 'Análise baseada no frame mais explícito extraído.'
                    });
                } catch (error) {
                    for (const framePath of generatedFiles) if (fs.existsSync(framePath)) fs.unlinkSync(framePath);
                    reject(new Error(`Erro ao analisar frames do vídeo: ${error.message}`));
                }
            })
            .on('error', (err) => reject(new Error(`Falha ao extrair frames do vídeo: ${err.message}`)))
            .screenshots({ timestamps, filename: `${tempPrefix}_%02d.jpg`, folder: tempDir, size: '?x480' });
    });
}

// ==========================================
// FUNÇÕES DE ROSTO E IDADE
// ==========================================
function calculateCosineSimilarity(vecA, vecB) {
    if (!vecA || !vecB) return 0;
    let dotProduct = 0, normA = 0, normB = 0;
    for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function estimarIdade(input, options = {}) {
    let buffer;
    try { buffer = await decodificarEntrada(input); } catch(e) { throw new Error(e.message); }

    const loadedHuman = await getHumanModel();
    let imageTensor;
    try {
        imageTensor = tf.node.decodeImage(buffer, 3);
        const result = await loadedHuman.detect(imageTensor);
        const facesDetected = result.face || [];
        
        const targetAge = options.underAgeCheck; 
        
        const faces = facesDetected.map(f => {
            const rawAge = f.age || 0;
            const faceResult = {
                age: Math.round(rawAge),
                gender: f.gender,
                genderScore: f.genderScore,
                box: f.box,
                descriptor: f.embedding || f.descriptor 
            };
            
            if (targetAge !== undefined) {
                const certainty = 1 / (1 + Math.exp((rawAge - targetAge) * 0.8));
                faceResult.isUnderAge = rawAge < targetAge;
                faceResult.underAgeProbability = parseFloat(certainty.toFixed(4));
            }
            
            return faceResult;
        });

        return {
            hasFaces: faces.length > 0,
            faceCount: faces.length,
            faces: faces
        };
    } catch (error) {
        throw new Error(`Falha ao estimar a idade: ${error.message}`);
    } finally {
        if (imageTensor) imageTensor.dispose();
    }
}

async function estimarIdadeVideo(inputPath, options = {}) {
    if (typeof inputPath !== 'string') throw new Error('O input para vídeo deve ser o caminho do arquivo.');
    const framesToExtract = options.frames || 3;
    const tempDir = os.tmpdir();
    const tempPrefix = `sensive18_vidface_${Date.now()}`;

    return new Promise((resolve, reject) => {
        let generatedFiles = [];
        const timestamps = [];
        if (framesToExtract === 1) timestamps.push('50%');
        else {
            const step = 80 / Math.max(1, framesToExtract - 1);
            for (let i = 0; i < framesToExtract; i++) timestamps.push(`${Math.round(10 + i * step)}%`);
        }

        ffmpeg(inputPath)
            .on('filenames', (filenames) => { generatedFiles = filenames.map(f => path.join(tempDir, f)); })
            .on('end', async () => {
                let allFaces = [];
                let uniquePeople = [];
                const SIMILARITY_THRESHOLD = 0.6; 

                try {
                    for (const framePath of generatedFiles) {
                        if (!fs.existsSync(framePath)) continue;
                        const buffer = fs.readFileSync(framePath);
                        const analiseFrame = await estimarIdade(buffer, options);
                        
                        for (const face of analiseFrame.faces) {
                            allFaces.push(face);
                            let isNewPerson = true;
                            for (const knownPerson of uniquePeople) {
                                if (face.descriptor && knownPerson.descriptor) {
                                    const sim = calculateCosineSimilarity(face.descriptor, knownPerson.descriptor);
                                    if (sim > SIMILARITY_THRESHOLD) {
                                        isNewPerson = false;
                                        break;
                                    }
                                }
                            }
                            if (isNewPerson) uniquePeople.push(face);
                        }
                    }

                    for (const framePath of generatedFiles) if (fs.existsSync(framePath)) fs.unlinkSync(framePath);

                    const cleanFaces = allFaces.map(f => {
                        const { descriptor, ...safeFace } = f;
                        return safeFace;
                    });

                    resolve({
                        hasFaces: cleanFaces.length > 0,
                        faceCountTotal: cleanFaces.length,
                        uniquePeopleCount: uniquePeople.length,
                        faces: cleanFaces
                    });
                } catch (error) {
                    for (const framePath of generatedFiles) if (fs.existsSync(framePath)) fs.unlinkSync(framePath);
                    reject(new Error(`Erro ao analisar idades no vídeo: ${error.message}`));
                }
            })
            .on('error', (err) => reject(new Error(`Falha ao extrair frames do vídeo: ${err.message}`)))
            .screenshots({ timestamps, filename: `${tempPrefix}_%02d.jpg`, folder: tempDir, size: '?x480' });
    });
}

const analisarTextoDeVideo = analisarAudio;

const analyzeImage = analisarImagem;
const analyzeVideo = analisarVideo;
const estimateAge = estimarIdade;
const estimateAgeVideo = estimarIdadeVideo;
const analyzeText = analisarTexto;
const analyzeImageText = analisarTextoDeImagem;
const addForbiddenWord = adicionarPalavraProibida;
const removeForbiddenWord = removerPalavraProibida;
const analyzeAudioText = analisarAudio;
const analyzeVideoText = analisarTextoDeVideo;

module.exports = {
    config,
    analisarImagem, analyzeImage,
    analisarVideo, analyzeVideo,
    estimarIdade, estimateAge,
    estimarIdadeVideo, estimateAgeVideo,
    analisarTexto, analyzeText,
    analisarTextoDeImagem, analyzeImageText,
    adicionarPalavraProibida, addForbiddenWord,
    removerPalavraProibida, removeForbiddenWord,
    analisarAudio, analyzeAudioText,
    analisarTextoDeVideo, analyzeVideoText
};
