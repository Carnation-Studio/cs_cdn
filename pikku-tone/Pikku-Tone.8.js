// PikkuTone.js
//v0.0.8
//Develop By Carnation Fjord Studio
//Made by SugiSaku8
//License: MIT

class BufferPool {
  constructor() {
      this.buffers = new Map();
      this.maxSize = 1024 * 1024; // 1MB
      this.currentSize = 0;
  }

  getOrCreate(channels, length, sampleRate) {
      const key = `${channels}-${length}-${sampleRate}`;
      if (this.buffers.has(key)) {
          const buffer = this.buffers.get(key);
          this.buffers.delete(key);
          this.currentSize -= buffer.length * channels * 2;
          this.buffers.set(key, buffer);
          this.currentSize += buffer.length * channels * 2;
          return buffer;
      }
      
      const buffer = new this.audioContext.createBuffer(
          channels,
          length,
          sampleRate
      );
      if (this.currentSize + length * channels * 2 > this.maxSize) {
          this.cleanup();
      }
      
      this.buffers.set(key, buffer);
      this.currentSize += buffer.length * channels * 2;
      return buffer;
  }

  cleanup() {
      const keys = Array.from(this.buffers.keys());
      while (this.currentSize > this.maxSize / 2 && keys.length > 0) {
          const key = keys.pop();
          const buffer = this.buffers.get(key);
          this.currentSize -= buffer.length * buffer.numberOfChannels * 2;
          this.buffers.delete(key);
      }
  }
}

class AudioQueue {
  constructor() {
      this.queue = [];
      this.processing = false;
  }

  enqueue(audioData) {
      this.queue.push(audioData);
  }

  dequeue() {
      return this.queue.shift();
  }

  isEmpty() {
      return this.queue.length === 0;
  }

  async processQueue() {
      if (this.processing) return;
      this.processing = true;
      while (!this.isEmpty()) {
          const item = this.dequeue();
          await this.saveToIndexedDB(item);
      }
      this.processing = false;
  }
}

class PikkuToneError extends Error {
  constructor(code, message, details = {}) {
      super(message);
      this.code = code;
      this.details = details;
      this.name = "PikkuToneError";
  }
}
class PikkutoneDataProcessor {
  constructor() {
    // 必要に応じて初期化
  }

  // Lyric.json (Kaldi形式のlabel相当) を解析
  parseLyricJson(lyricJson) {
    // 例: { uttidA: "(0.0 0.1 sil) (0.1 0.15 k) (0.15 0.2 a) ...", ... }
    // または、音素と時間の配列形式 { phonemes: [...], start_times: [...], end_times: [...] }
    // ここでは後者を想定 (より一般的)
    if (lyricJson.phonemes && lyricJson.start_times && lyricJson.end_times) {
        const phonemes = lyricJson.phonemes;
        const startTimes = lyricJson.start_times;
        const endTimes = lyricJson.end_times;
        if (phonemes.length !== startTimes.length || phonemes.length !== endTimes.length) {
            throw new Error("LyricJson arrays have mismatched lengths.");
        }
        return phonemes.map((p, i) => ({
            phoneme: p,
            startTime: startTimes[i],
            endTime: endTimes[i],
            duration: endTimes[i] - startTimes[i]
        }));
    }
    // 前者 (文字列形式) の場合はパーサーが必要 (省略)
    throw new Error("Unsupported LyricJson format. Expected arrays for phonemes, start_times, end_times.");
  }

  // Melody.json (score.scpで参照されるJSON) を解析
  parseMelodyJson(melodyJson) {
    // 例: { notes: [{ start_time: 0.0, end_time: 0.5, pitch: 60, duration: 0.5, ... }, ...] }
    if (melodyJson.notes) {
        return melodyJson.notes.map(note => ({
            startTime: note.start_time,
            endTime: note.end_time,
            duration: note.duration,
            pitch: note.pitch, // MIDIノート番号
            lyric: note.lyric || null, // メロディJSONに歌詞が含まれる場合
        }));
    }
    throw new Error("Unsupported MelodyJson format. Expected 'notes' array.");
  }

  // Clamusic形式を解析 (既存コードを再利用)
  parseClamusic(clmDataArray) {
    if (!Array.isArray(clmDataArray) || clmDataArray.length === 0) {
      throw new PikkuToneError(400, "Invalid Clamusic data format: Expected an array with at least one object.");
    }
    const clmData = clmDataArray[0];
    const info = clmData.info;
    const data = clmData.data;

    if (!info || !data) {
      throw new PikkuToneError(400, "Invalid Clamusic data format: Missing 'info' or 'data' keys.");
    }

    const normalizedData = {};
    for (const [trackName, trackObj] of Object.entries(data)) {
      const notes = Object.values(trackObj).map(noteObj => {
          return {
              loadtime: parseFloat(noteObj.loadtime),
              pitch: noteObj.pitch,
              volume: parseInt(noteObj.volume, 10),
              time: parseFloat(noteObj.time),
              lyric: noteObj.lyric,
          };
      });
      normalizedData[trackName] = notes;
    }

    return {
      info: info,
      data: normalizedData,
    };
  }

  // LyricとMelodyを統合 (簡略化)
  // 例: Lyricの音素とMelodyのノートを時間軸でマッピング
  // ここでは、音素数とノート数が一致していると仮定して1:1マッピング
  integrateLyricAndMelody(lyricData, melodyData) {
    if (lyricData.length !== melodyData.length) {
        console.warn(`Lyric length (${lyricData.length}) and Melody length (${melodyData.length}) do not match. Aligning by time.`);
        // 時間軸でアラインメントするロジックが必要 (非常に複雑)
        // ここでは、短い方に合わせて切り捨て
        const minLength = Math.min(lyricData.length, melodyData.length);
        lyricData = lyricData.slice(0, minLength);
        melodyData = melodyData.slice(0, minLength);
    }

    return lyricData.map((l, i) => {
        const m = melodyData[i];
        // ピッチをMIDIノート番号またはTone.jsノート名に変換 (例: 60 -> "C4")
        // 今回はMIDI番号のまま使用
        return {
            phoneme: l.phoneme,
            startTime: l.startTime,
            endTime: l.endTime,
            duration: l.duration,
            pitch: m.pitch, // MIDIノート番号
            volume: 100, // デフォルト音量
            lyric: l.phoneme, // デバッグ用
        };
    });
  }

  // 新しい歌詞 (new_lyric.txt) と統合 (簡略化)
  // newLyricText: "かきくけこ"
  // integratedData: [{ phoneme: 'a', pitch: 60, ... }, ...]
  integrateNewLyric(newLyricText, integratedData) {
    const newLyrics = newLyricText.split(''); // "かきくけこ" -> ["か", "き", "く", "け", "こ"]
    if (newLyrics.length !== integratedData.length) {
        console.warn(`New lyric length (${newLyrics.length}) and integrated data length (${integratedData.length}) do not match. Aligning by time.`);
        // 同様に切り捨てまたは補間が必要 (省略)
        const minLength = Math.min(newLyrics.length, integratedData.length);
        newLyrics.splice(minLength);
        integratedData.splice(minLength);
    }

    return integratedData.map((d, i) => ({
        ...d,
        lyric: newLyrics[i], // 新しい歌詞を適用
    }));
  }
}

// --- 既存コード (PikkuToneAPI) の拡張 ---
export default class PikkuToneAPI {
  constructor() {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      this.phonemeUrls = new Map(); // phoneme -> url (将来的に使用)
      this.pitchData = new Map();
      this.currentLyrics = [];
      this.currentNotes = []; // { phoneme, startTime, endTime, pitch, volume, lyric, ... }
      this.audioQueue = new AudioQueue();
      this.bufferPool = new BufferPool();
      this.scriptProcessor = null;
      this.audioBuffers = new Map(); // phoneme -> AudioBuffer
      this.isPlaying = false;
      this.playbackStartTime = 0;
      this.playbackConfig = {}; // speed, pitch, intonation などを格納

      this.dataProcessor = new PikkutoneDataProcessor(); // 追加

      this.initializeScriptProcessor();
  }

  // ... (initializeScriptProcessor, loadAudioBuffers, saveToAbuf, loadFromAbuf, startProcessing, stopProcessing は変更なし) ...

  // currentNotes を更新するメソッドを追加
  setCurrentNotes(notes) {
      this.currentNotes = notes;
  }

  // config を更新するメソッドを追加
  setConfig(config) {
      this.playbackConfig = config;
  }

  // onaudioprocess 内の処理を拡張 (簡略化版)
  initializeScriptProcessor() {
      try {
          const bufferSize = 2048;
          this.scriptProcessor = this.audioContext.createScriptProcessor(bufferSize, 0, 2);

          let lastProcessTime = this.audioContext.currentTime;
          let sampleIndex = 0;

          this.scriptProcessor.onaudioprocess = (event) => {
              const outputBuffer = event.outputBuffer;
              const currentTime = this.audioContext.currentTime;

              // 再生中でなければ無音出力
              if (!this.isPlaying) {
                  for (let channel = 0; channel < outputBuffer.numberOfChannels; channel++) {
                      const outputData = outputBuffer.getChannelData(channel);
                      outputData.fill(0);
                  }
                  return;
              }

              // 再生開始からの経過時間 (秒)
              const elapsedPlaybackTime = currentTime - this.playbackStartTime;

              for (let channel = 0; channel < outputBuffer.numberOfChannels; channel++) {
                  const outputData = outputBuffer.getChannelData(channel);

                  for (let i = 0; i < outputData.length; i++) {
                      // 時間を計算 (バッファサイズとサンプルレートから)
                      const timeOffset = sampleIndex / this.audioContext.sampleRate;
                      const currentSampleTime = elapsedPlaybackTime + timeOffset;

                      // currentNotes の中から、現在時刻に対応する音符を検索
                      let currentNote = null;
                      for (const note of this.currentNotes) {
                          if (currentSampleTime >= note.startTime && currentSampleTime < note.endTime) {
                              currentNote = note;
                              break;
                          }
                      }

                      let sampleValue = 0.0;
                      if (currentNote && this.audioBuffers.has(currentNote.phoneme)) {
                          const buffer = this.audioBuffers.get(currentNote.phoneme);
                          // 音源バッファからサンプルを取得 (簡略化: 線形補間なし、ループなし)
                          // 本来は、currentNote.pitch に合わせてピッチシフトや時間伸縮が必要
                          const sourceSampleIndex = Math.floor((currentSampleTime - currentNote.startTime) * buffer.sampleRate);
                          if (sourceSampleIndex >= 0 && sourceSampleIndex < buffer.length) {
                              // ピッチ変更 (簡略化: レート変更)
                              const pitchRatio = this.playbackConfig.pitch || 0;
                              const targetFreq = this.helpers.midiToFrequency(currentNote.pitch);
                              const baseFreq = this.helpers.midiToFrequency(60); // C4を基準として仮定
                              const rate = (targetFreq / baseFreq) * (1 + pitchRatio / 100); // pitchオフセットを適用
                              const adjustedIndex = sourceSampleIndex * rate;

                              const channelData = buffer.getChannelData(channel % buffer.numberOfChannels);
                              const idx = Math.floor(adjustedIndex);
                              if (idx < channelData.length) {
                                  sampleValue = channelData[idx];
                              }
                          }
                      }

                      // 音量調整
                      const volume = (currentNote ? currentNote.volume / 100 : 0.5) * this.playbackConfig.volume;
                      outputData[i] = sampleValue * volume;

                      sampleIndex++;
                  }
              }
          };

          this.scriptProcessor.connect(this.audioContext.destination);

      } catch (error) {
          console.error("ScriptProcessor初期化エラー:", error);
          throw new PikkuToneError(401, "ScriptProcessorの初期化に失敗しました", {
              originalError: error,
          });
      }
  }

  // ヘルパー関数を追加 (外部からアクセス可能にする)
  helpers = {
    midiToFrequency: (note) => {
        if (note <= 0) return 0.0;
        return 440.0 * Math.pow(2, (note - 69) / 12);
    },
  };

}
