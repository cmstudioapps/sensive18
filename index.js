const fs = require('fs');
const path = require('path');
const os = require('os');
const tf = require('@tensorflow/tfjs-node');
const nsfwjs = require('nsfwjs');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const humanCore = require('@vladmandic/human').default || require('@vladmandic/human');

ffmpeg.setFfmpegPath(ffmpegStatic);

let nsfwModel = null;
let humanModel = null;

let currentConfig = {
    threshold: 0.8
};

async function getNsfwModel() {
    if (!nsfwModel) {
        nsfwModel = await nsfwjs.load();
    }
    return nsfwModel;
}

async function getHumanModel() {
    if (!humanModel) {
        const modelPath = 'file://' + path.join(__dirname, 'node_modules', '@vladmandic/human', 'models');
        
        humanModel = new humanCore.Human({
            backend: 'tensorflow',
            modelBasePath: modelPath,
            face: {
                enabled: true,
                detector: { return: true },
                mesh: { enabled: false }, 
                iris: { enabled: false },
                emotion: { enabled: false },
                // Habilitamos a descrição (embeddings) para distinguir rostos repetidos nos vídeos
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

function config(options = {}) {
    if (options.threshold !== undefined) currentConfig.threshold = options.threshold;
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

// Matemática de similaridade para detectar se o rosto é o mesmo
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

async function estimarIdade(input) {
    let buffer;
    try { buffer = await decodificarEntrada(input); } catch(e) { throw new Error(e.message); }

    const loadedHuman = await getHumanModel();
    let imageTensor;
    try {
        imageTensor = tf.node.decodeImage(buffer, 3);
        const result = await loadedHuman.detect(imageTensor);
        const facesDetected = result.face || [];
        
        const faces = facesDetected.map(f => ({
            age: Math.round(f.age || 0),
            gender: f.gender,
            genderScore: f.genderScore,
            box: f.box,
            // Guardamos a assinatura neural do rosto
            descriptor: f.embedding || f.descriptor 
        }));

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

/**
 * Analisa um vídeo extraindo frames para estimar idades e contar pessoas diferentes
 */
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
                // Se a similaridade for maior que 60%, consideramos ser a mesma pessoa
                const SIMILARITY_THRESHOLD = 0.6; 

                try {
                    for (const framePath of generatedFiles) {
                        if (!fs.existsSync(framePath)) continue;
                        const buffer = fs.readFileSync(framePath);
                        const analiseFrame = await estimarIdade(buffer);
                        
                        for (const face of analiseFrame.faces) {
                            allFaces.push(face);
                            
                            // Verifica se esse rosto já foi visto em outro frame
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
                            if (isNewPerson) {
                                uniquePeople.push(face);
                            }
                        }
                    }

                    // Limpa disco
                    for (const framePath of generatedFiles) if (fs.existsSync(framePath)) fs.unlinkSync(framePath);

                    // Remove os descritores pesados antes de devolver para o usuário
                    const cleanFaces = allFaces.map(f => {
                        const { descriptor, ...safeFace } = f;
                        return safeFace;
                    });

                    resolve({
                        hasFaces: cleanFaces.length > 0,
                        faceCountTotal: cleanFaces.length, // Ocorrências totais em todos os frames
                        uniquePeopleCount: uniquePeople.length, // Quantidade de pessoas diferentes estimadas
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

const analyzeImage = analisarImagem;
const analyzeVideo = analisarVideo;
const estimateAge = estimarIdade;
const estimateAgeVideo = estimarIdadeVideo;

module.exports = {
    config,
    analisarImagem,
    analyzeImage,
    analisarVideo,
    analyzeVideo,
    estimarIdade,
    estimateAge,
    estimarIdadeVideo,
    estimateAgeVideo
};
