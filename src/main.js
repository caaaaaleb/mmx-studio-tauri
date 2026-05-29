const invoke = window.__TAURI__?.core?.invoke;
if (!invoke) console.error('Tauri invoke not available');

const OUT_DIR = "/Users/meixintang/Desktop/mmx_outputs";

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

// Convert recorded webm blob to WAV (in-browser, no ffmpeg needed)
async function webmToWav(blob) {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const arrayBuffer = await blob.arrayBuffer();
  const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
  ctx.close();
  return audioBufferToWav(audioBuffer);
}

function audioBufferToWav(buffer) {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; // PCM
  const bitsPerSample = 16;
  const data = buffer.getChannelData(0);
  const byteRate = sampleRate * numChannels * bitsPerSample / 8;
  const blockAlign = numChannels * bitsPerSample / 8;
  const dataSize = data.length * blockAlign;
  const headerSize = 44;
  const totalSize = headerSize + dataSize;
  
  const wav = new ArrayBuffer(totalSize);
  const view = new DataView(wav);
  
  const writeStr = (offset, str) => { for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i)); };
  writeStr(0, 'RIFF');
  view.setUint32(4, totalSize - 8, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);
  
  let offset = 44;
  for (let i = 0; i < data.length; i++) {
    const sample = Math.max(-1, Math.min(1, data[i]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
    offset += 2;
  }
  return new Blob([wav], { type: 'audio/wav' });
}


// ─── Tabs ───
document.querySelectorAll(".tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById(`tab-${tab.dataset.tab}`).classList.add("active");
    if (tab.dataset.tab === "tasks") refreshTasks();
    if (tab.dataset.tab === "gallery") refreshGallery();
  });
});

// ─── Toast ───
let toastTimer;
function toast(msg, type = "info") {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.className = `toast ${type} show`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 3000);
}

// ─── Run mmx ───
async function runMmx(args, timeout = 120) {
  try {
    const result = await invoke("run_mmx", { args, timeoutSecs: timeout });
    return { ok: true, data: result };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

function parseText(raw) {
  try {
    const data = JSON.parse(raw);
    if (data?.content) {
      if (Array.isArray(data.content)) {
        return data.content.filter(b => b.type === "text").map(b => b.text).join("\n\n");
      }
      return data.content;
    }
    if (Array.isArray(data)) {
      return data.filter(b => b.type === "text").map(b => b.text).join("\n\n");
    }
    return raw;
  } catch { return raw; }
}

// ─── Text Chat ───
async function submitText() {
  const msg = document.getElementById("txt-msg").value.trim();
  const sys = document.getElementById("txt-system").value.trim();
  if (!msg) { toast('请输入消息', 'error'); return; }
  const out = document.getElementById("txt-output");
  out.innerHTML = '<div class="spinner-overlay"><div class="spinner"></div>生成中...</div>';
  const args = ["text", "chat", "--message", msg];
  if (sys) args.push("--system", sys);
  const r = await runMmx(args, 60);
  if (r.ok) {
    out.textContent = parseText(r.data);
  } else {
    out.innerHTML = `<span style="color:var(--red)">❌ ${r.error}</span>`;
  }
}
window.submitText = submitText;

// ─── Image Generation ───
// (defined below with i2i support)

// ─── img-n slider ───
document.getElementById("img-n")?.addEventListener("input", e => {
  document.getElementById("img-n-val").textContent = e.target.value;
});

function toggleImgMode() {
  const isI2I = document.querySelector('input[name="img-mode"]:checked').value === 'i2i';
  document.getElementById('img-i2i-area').style.display = isI2I ? 'block' : 'none';
  // Custom size only for t2i
  document.getElementById('img-custom-size').parentElement.parentElement.style.display = isI2I ? 'none' : '';
  if (isI2I) document.getElementById('img-size-area').style.display = 'none';
}
window.toggleImgMode = toggleImgMode;

function toggleCustomSize() {
  document.getElementById('img-size-area').style.display = 
    document.getElementById('img-custom-size').checked ? '' : 'none';
}
window.toggleCustomSize = toggleCustomSize;

// Preview source image
document.getElementById('img-source')?.addEventListener('change', function(e) {
  const file = e.target.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = ev => {
      const img = document.getElementById('img-source-preview');
      img.src = ev.target.result;
      img.style.display = 'block';
    };
    reader.readAsDataURL(file);
  }
});

// Update submitImage for i2i support
window.submitImage = async function() {
  const isI2I = document.querySelector('input[name="img-mode"]:checked')?.value === 'i2i';
  console.log('[submitImage] isI2I:', isI2I);
  
  if (isI2I) {
    const file = document.getElementById('img-source').files[0];
    if (!file) { toast('请先上传参考图片', 'error'); return; }
    const prompt = document.getElementById('img-prompt').value.trim();
    const n = parseInt(document.getElementById('img-n').value);
    const ratio = document.getElementById('img-ratio').value;
    const out = document.getElementById('img-output');
    out.innerHTML = '<div class="spinner-overlay"><div class="spinner"></div>图生图中...</div>';
    try {
      const arrayBuffer = await file.arrayBuffer();
      const base64 = arrayBufferToBase64(arrayBuffer);
      const ext = file.name.split('.').pop() || 'jpg';
      const r = await invoke('image_to_image', {
        sourceBase64: base64,
        sourceExt: ext,
        prompt: prompt || 'enhance this image',
        n: n,
        aspectRatio: ratio
      });
      const data = JSON.parse(r);
      console.log('[i2i] response:', JSON.stringify(data).substring(0, 200));
      // Handle various response formats
      const urls = data.data?.image_urls || data.data?.urls || 
                   (data.data?.url ? [data.data.url] : null) ||
                   data.image_urls || data.urls;
      if (urls && urls.length > 0) {
        out.innerHTML = urls.map(u => 
          `<img src="${u}" alt="generated" style="max-width:100%;border-radius:8px;margin-bottom:8px" />`
        ).join('');
      } else if (data.data?.url) {
        out.innerHTML = `<img src="${data.data.url}" style="max-width:100%;border-radius:8px" />`;
      } else {
        out.innerHTML = `<span style="color:var(--green)">✅ 生成成功</span><br/><span class="hint">${JSON.stringify(data).substring(0, 300)}</span>`;
      }
    } catch (e) {
      out.innerHTML = `<span style="color:var(--red)">❌ ${e}</span>`;
    }
    return;
  }
  
  // Original t2i
  const prompt = document.getElementById('img-prompt').value.trim();
  const n = document.getElementById('img-n').value;
  if (!prompt) { toast('请输入画面描述', 'error'); return; }
  const out = document.getElementById('img-output');
  out.innerHTML = '<div class="spinner-overlay"><div class="spinner"></div>生成中...</div>';
  const ts = Date.now();
  const args = ['image', 'generate', '--prompt', prompt, '--n', n];
  // Aspect ratio or custom size
  if (document.getElementById('img-custom-size').checked) {
    const w = document.getElementById('img-width').value;
    const h = document.getElementById('img-height').value;
    args.push('--width', w, '--height', h);
  } else {
    args.push('--aspect-ratio', document.getElementById('img-ratio').value);
  }
  // Prompt optimizer
  if (document.getElementById('img-prompt-opt').checked) args.push('--prompt-optimizer');
  // Seed
  const seed = document.getElementById('img-seed').value;
  if (seed) args.push('--seed', seed);
  if (parseInt(n) > 1) {
    args.push('--out-dir', `${OUT_DIR}/image_${ts}`);
  } else {
    args.push('--out', `${OUT_DIR}/image_${ts}.jpg`);
  }
  const r = await runMmx(args, 90);
  if (r.ok) {
    try {
      const data = JSON.parse(r.data);
      const files = Array.isArray(data.saved) ? data.saved : [data.saved];
      // Load as base64 for reliable display
      for (const f of files.filter(Boolean)) {
        try {
          const dataUrl = await invoke('read_file_base64', { path: f });
          out.innerHTML += `<img src="${dataUrl}" alt="generated" style="max-width:100%;border-radius:8px;margin-bottom:8px" />`;
        } catch(e) {
          out.innerHTML += `<span class="hint">⚠️ ${f} 无法加载</span>`;
        }
      }
      addTask('image', `图片: ${prompt.slice(0, 30)}...`, 'done', files[0]);
    } catch {
      out.innerHTML = '<span style="color:var(--green)">✅ 生成成功</span>';
    }
  } else {
    out.innerHTML = `<span style="color:var(--red)">❌ ${r.error}</span>`;
  }
};

// ─── Vision ───
async function submitVision() {
  const file = document.getElementById("vis-file").files[0];
  if (!file) return;
  const out = document.getElementById("vis-output");
  out.innerHTML = '<div class="spinner-overlay"><div class="spinner"></div>分析中...</div>';
  try {
    // Read file as base64, write via Rust backend to get a real path
    const arrayBuffer = await file.arrayBuffer();
    const base64 = arrayBufferToBase64(arrayBuffer);
    const ext = file.name.split('.').pop() || 'jpg';
    const tmpPath = await invoke('write_temp_file', { base64Data: base64, extension: ext });
    const r = await runMmx(["vision", tmpPath], 30);
    if (r.ok) {
      try {
        const data = JSON.parse(r.data);
        out.textContent = data.content || r.data;
      } catch { out.textContent = r.data; }
    } else {
      out.innerHTML = `<span style="color:var(--red)">❌ ${r.error}</span>`;
    }
  } catch (e) {
    out.innerHTML = `<span style="color:var(--red)">❌ ${e}</span>`;
  }
}
window.submitVision = submitVision;

// ─── Speech ───
async function submitSpeech() {
  const text = document.getElementById("sp-text").value.trim();
  const voice = document.getElementById("sp-voice").value;
  const customVoice = document.getElementById("sp-custom-voice").value.trim();
  const speed = document.getElementById("sp-speed").value;
  const volume = document.getElementById("sp-volume").value;
  const pitch = document.getElementById("sp-pitch").value;
  if (!text) { toast('请输入文本', 'error'); return; }
  const out = document.getElementById("sp-output");
  out.innerHTML = '<div class="spinner-overlay"><div class="spinner"></div>合成中...</div>';
  const ts = Date.now();
  const args = ["speech", "synthesize", "--text", text,
    "--voice", customVoice || voice,
    "--speed", speed, "--volume", volume, "--pitch", pitch,
    "--out", `${OUT_DIR}/speech_${ts}.mp3`];
  const r = await runMmx(args, 60);
  if (r.ok) {
    try {
      const data = JSON.parse(r.data);
      const path = data.saved || '';
      out.innerHTML = `<span style="color:var(--accent)">✅ 语音合成成功</span>
        <p class="hint" style="margin-top:4px">📁 ${path}</p>`;
      addTask("speech", `语音: ${text.slice(0, 30)}...`, "done", data.saved);
    } catch {
      out.innerHTML = `<span style="color:var(--green)">✅ 合成成功</span>`;
    }
  } else {
    out.innerHTML = `<span style="color:var(--red)">❌ ${r.error}</span>`;
  }
}
window.submitSpeech = submitSpeech;

// Slider displays
document.getElementById("sp-speed")?.addEventListener("input", e => {
  document.getElementById("sp-speed-val").textContent = parseFloat(e.target.value).toFixed(1);
});
document.getElementById("sp-volume")?.addEventListener("input", e => {
  document.getElementById("sp-volume-val").textContent = parseFloat(e.target.value).toFixed(1);
});
document.getElementById("sp-pitch")?.addEventListener("input", e => {
  document.getElementById("sp-pitch-val").textContent = e.target.value;
});

function toggleCloneSrc() {
  const isRec = document.querySelector('input[name="clone-src"]:checked').value === 'record';
  document.getElementById('clone-file-area').style.display = isRec ? 'none' : 'block';
  document.getElementById('clone-record-area').style.display = isRec ? 'block' : 'none';
}
window.toggleCloneSrc = toggleCloneSrc;

async function submitVoiceClone() {
  const voiceId = document.getElementById('clone-voice-id').value.trim();
  if (!voiceId) { toast('请输入语音 ID', 'error'); return; }
  if (voiceId.length < 5 || voiceId.length > 32) { toast('语音 ID 需 5-32 个字符，仅支持英文数字下划线', 'error'); return; }
  const useRec = document.querySelector('input[name="clone-src"]:checked').value === 'record';
  const out = document.getElementById('clone-output');
  out.innerHTML = '<div class="spinner-overlay"><div class="spinner"></div>克隆中...</div>';
  
  try {
    let tmpPath;
    if (useRec) {
      if (!recordedBlob) { toast('请先录音', 'error'); return; }
      const ab = await recordedBlob.arrayBuffer();
      const b64 = arrayBufferToBase64(ab);
      tmpPath = await invoke('write_temp_file', { base64Data: b64, extension: 'webm' });
      tmpPath = await invoke('convert_audio_to_mp3', { inputPath: tmpPath });
    } else {
      const file = document.getElementById('clone-file').files[0];
      if (!file) { toast('请上传音频文件', 'error'); return; }
      const ab = await file.arrayBuffer();
      const b64 = arrayBufferToBase64(ab);
      const ext = file.name.split('.').pop() || 'mp3';
      tmpPath = await invoke('write_temp_file', { base64Data: b64, extension: ext });
    }
    
    const result = await invoke('voice_clone', { audioPath: tmpPath, voiceId });
    const data = JSON.parse(result);
    // Set custom voice field
    const voiceInput = document.getElementById('sp-custom-voice');
    if (voiceInput) voiceInput.value = data.voice_id;
    out.innerHTML = `<span style="color:var(--accent)">✅ 克隆成功！</span>
      <p class="hint" style="margin-top:4px">Voice ID: <code>${data.voice_id}</code></p>
      <p class="hint">在合成语音中选择此 ID 即可使用</p>`;
  } catch (e) {
    out.innerHTML = `<span style="color:var(--red)">❌ ${e}</span>`;
  }
}
window.submitVoiceClone = submitVoiceClone;

document.getElementById("sp-speed")?.addEventListener("input", e => {
  document.getElementById("sp-speed-val").textContent = parseFloat(e.target.value).toFixed(1);
});

// ─── Music (merged: generate + cover + voice) ───

function toggleMusicMode() {
  const mode = document.querySelector('input[name="mu-mode"]:checked').value;
  document.getElementById('mu-generate-area').style.display = mode === 'generate' ? 'block' : 'none';
  document.getElementById('mu-cover-area').style.display = mode === 'cover' ? 'block' : 'none';
  document.getElementById('mu-voice-area').style.display = mode === 'voice' ? 'block' : 'none';
}
window.toggleMusicMode = toggleMusicMode;

function toggleMusicCoverSrc() {
  const isRec = document.querySelector('input[name="mu-cover-src"]:checked').value === 'record';
  document.getElementById('mu-cover-file-area').style.display = isRec ? 'none' : 'block';
  document.getElementById('mu-cover-rec-area').style.display = isRec ? 'block' : 'none';
}
window.toggleMusicCoverSrc = toggleMusicCoverSrc;

document.querySelectorAll('input[name="mu-voice-mode"]').forEach(r => {
  r.addEventListener('change', () => {
    const isCover = document.querySelector('input[name="mu-voice-mode"]:checked').value === 'cover';
    document.getElementById('mu-voice-cover-opts').style.display = isCover ? 'block' : 'none';
    document.getElementById('mu-voice-music-opts').style.display = isCover ? 'none' : 'block';
  });
});

async function submitMusicGenerate() {
  const prompt = document.getElementById('mu-prompt').value.trim();
  const lyrics = document.getElementById('mu-lyrics').value.trim();
  const vocals = document.getElementById('mu-vocals').value.trim();
  const inst = document.getElementById('mu-inst').checked;
  const aiLyrics = document.getElementById('mu-ai-lyrics').checked;
  if (!prompt) { toast('请输入画面描述', 'error'); return; }
  const out = document.getElementById('mu-output');
  out.innerHTML = '<div class="spinner-overlay"><div class="spinner"></div>生成中 (1-2分钟)...</div>';
  const ts = Date.now();
  const args = ['music', 'generate', '--prompt', prompt, '--out', `${OUT_DIR}/music_${ts}.mp3`];
  if (inst) args.push('--instrumental');
  else if (aiLyrics) args.push('--lyrics-optimizer');
  else if (lyrics) args.push('--lyrics', lyrics);
  if (vocals) args.push('--vocals', vocals);
  addTask('music', `音乐: ${prompt.slice(0, 30)}...`, 'processing');
  const r = await runMmx(args, 180);
  updateLastTask(r.ok ? 'done' : 'failed');
  if (r.ok) {
    try { const data = JSON.parse(r.data); out.innerHTML = `<span style="color:var(--accent)">✅ 生成成功</span><p class="hint" style="margin-top:4px">📁 ${data.saved}</p>`; }
    catch { out.innerHTML = '<span style="color:var(--green)">✅ 生成成功</span>'; }
  } else {
    out.innerHTML = `<span style="color:var(--red)">❌ ${r.error}</span>`;
  }
}
window.submitMusicGenerate = submitMusicGenerate;

async function submitMusicCover() {
  const style = document.getElementById('mu-cover-style').value.trim();
  if (!style) return;
  const out = document.getElementById('mu-output');
  out.innerHTML = '<div class="spinner-overlay"><div class="spinner"></div>翻唱中 (1-3分钟)...</div>';
  const ts = Date.now();
  const useRec = document.querySelector('input[name="mu-cover-src"]:checked').value === 'record';
  try {
    let tmpPath;
    if (useRec) {
      if (!recordedBlob) { toast('请先录音', 'error'); return; }
      if (recordingDuration < 6) { toast('录音需至少6秒', 'error'); return; }
      const ab = await recordedBlob.arrayBuffer();
      const b64 = arrayBufferToBase64(ab);
      tmpPath = await invoke('write_temp_file', { base64Data: b64, extension: 'webm' });
      tmpPath = await invoke('convert_audio_to_mp3', { inputPath: tmpPath });
    } else {
      const file = document.getElementById('mu-cover-file').files[0];
      if (!file) { toast('请上传音频文件', 'error'); return; }
      const ab = await file.arrayBuffer();
      const b64 = arrayBufferToBase64(ab);
      const ext = file.name.split('.').pop() || 'mp3';
      tmpPath = await invoke('write_temp_file', { base64Data: b64, extension: ext });
    }
    addTask('cover', `翻唱: ${style.slice(0, 30)}...`, 'processing');
    const r = await invoke('run_mmx', { args: ['music', 'cover', '--prompt', style, '--audio-file', tmpPath, '--out', `${OUT_DIR}/cover_${ts}.mp3`], timeoutSecs: 180 });
    updateLastTask('done');
    try { const data = JSON.parse(r); out.innerHTML = `<span style="color:var(--accent)">✅ 生成成功</span><p class="hint" style="margin-top:4px">📁 ${data.saved}</p>`; }
    catch { out.innerHTML = '<span style="color:var(--green)">✅ 翻唱成功</span>'; }
  } catch (e) { updateLastTask('failed'); out.innerHTML = `<span style="color:var(--red)">❌ ${e}</span>`; }
}
window.submitMusicCover = submitMusicCover;

async function submitMusicVoice() {
  if (!recordedBlob || recordingTarget !== 'mu-voice') { toast('请先录音', 'error'); return; }
  if (recordingDuration < 6) { toast('录音需至少6秒', 'error'); return; }
  const isCover = document.querySelector('input[name="mu-voice-mode"]:checked').value === 'cover';
  const out = document.getElementById('mu-output');
  const ts = Date.now();
  try {
    out.innerHTML = '<div class="spinner-overlay"><div class="spinner"></div>处理中...</div>';
    const ab = await recordedBlob.arrayBuffer();
    const b64 = arrayBufferToBase64(ab);
    let tmpPath = await invoke('write_temp_file', { base64Data: b64, extension: 'webm' });
    tmpPath = await invoke('convert_audio_to_mp3', { inputPath: tmpPath });
    if (isCover) {
      const style = document.getElementById('mu-voice-cover-style').value.trim();
      const r = await invoke('run_mmx', { args: ['music', 'cover', '--prompt', style, '--audio-file', tmpPath, '--out', `${OUT_DIR}/voice_cover_${ts}.mp3`], timeoutSecs: 180 });
      try { const data = JSON.parse(r); out.innerHTML = `<span style="color:var(--accent)">✅ 生成成功</span><p class="hint" style="margin-top:4px">📁 ${data.saved}</p>`; }
      catch { out.innerHTML = '<span style="color:var(--green)">✅ 翻唱成功</span>'; }
    } else {
      const desc = document.getElementById('mu-voice-desc').value.trim();
      const lyrics = document.getElementById('mu-voice-lyrics').value.trim();
      const args = ['music', 'generate', '--prompt', desc, '--out', `${OUT_DIR}/voice_music_${ts}.mp3`];
      if (lyrics) args.push('--lyrics', lyrics); else args.push('--lyrics-optimizer');
      const r = await invoke('run_mmx', { args, timeoutSecs: 180 });
      try { const data = JSON.parse(r); out.innerHTML = `<span style="color:var(--accent)">✅ 生成成功</span><p class="hint" style="margin-top:4px">📁 ${data.saved}</p>`; }
      catch { out.innerHTML = '<span style="color:var(--green)">✅ 生成成功</span>'; }
    }
  } catch (e) { out.innerHTML = `<span style="color:var(--red)">❌ ${e}</span>`; }
}
window.submitMusicVoice = submitMusicVoice;

// ─── Recording ───
let mediaRecorder = null;
let recordedChunks = [];
let recordedBlob = null;
let recordingTarget = null;
let recordingStartTime = 0;
let recordingDuration = 0;

async function toggleRecording(target) {
  recordingTarget = target;
  const prefixes = { 'mu': ['mu-rec-area', 'mu-rec-btn', 'mu-rec-status', 'mu-rec-preview'], 'mu-voice': ['mu-voice-rec-area', 'mu-voice-rec-btn', 'mu-voice-rec-status', 'mu-voice-rec-preview'], 'clone': ['clone-rec-area', 'clone-rec-btn', 'clone-rec-status', 'clone-rec-preview'] };
  const [areaId, btnId, statusId, previewId] = prefixes[target] || prefixes['mu'];
  const area = document.getElementById(areaId);
  const btn = document.getElementById(btnId);
  const status = document.getElementById(statusId);
  const preview = document.getElementById(previewId);

  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
    if (window._recTimer) clearInterval(window._recTimer);
    btn.innerHTML = svgMic(); btn.style.background = ''; btn.className = 'btn-rec';
    status.innerHTML = ''; status.className = 'hint';
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recordedChunks = [];
    mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
    mediaRecorder.ondataavailable = e => { if (e.data.size > 0) recordedChunks.push(e.data); };
    mediaRecorder.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      if (window._recTimer) clearInterval(window._recTimer);
      recordingDuration = (Date.now() - recordingStartTime) / 1000;
      recordedBlob = new Blob(recordedChunks, { type: 'audio/webm' });
      preview.src = URL.createObjectURL(recordedBlob);
      preview.style.display = 'block';
      const secs = recordingDuration.toFixed(0);
      const ok = recordingDuration >= 6;
      status.innerHTML = `<span style="color:var(--accent);font-weight:500">${secs}s</span><span class="hint" style="margin-left:6px">${ok ? '' : '(需≥6s)'}</span>`;
      status.className = ok ? 'rec-status done' : 'rec-status short';
      btn.innerHTML = svgRetry(); btn.style.background = ''; btn.className = 'btn-rec';
      if (target === 'mu-voice') {
        document.getElementById('mu-voice-submit').disabled = !ok;
        document.getElementById('mu-voice-submit').textContent = ok ? '生成' : '⚠️ 录音太短';
      }
    };
    mediaRecorder.start();
    recordingStartTime = Date.now();
    btn.innerHTML = svgStop(); btn.style.background = ''; btn.className = 'btn-rec recording';
    status.innerHTML = '<span class="rec-dot"></span> <span class="rec-timer">00:00</span>';
    status.className = 'rec-status recording';
    // Real-time timer
    window._recTimer = setInterval(() => {
      const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
      const m = String(Math.floor(elapsed / 60)).padStart(2, '0');
      const s = String(elapsed % 60).padStart(2, '0');
      const timer = status.querySelector('.rec-timer');
      if (timer) timer.textContent = `${m}:${s}`;
    }, 200);
  } catch (e) { toast('无法访问麦克风: ' + e.message, 'error'); }
}
window.toggleRecording = toggleRecording;

// SVG icons
function svgMic() { return '<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" fill="none" stroke-width="1.5" stroke-linecap="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/></svg>'; }
function svgStop() { return '<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" fill="currentColor" stroke-width="0"><rect x="6" y="6" width="12" height="12" rx="2"/></svg> 停止'; }
function svgRetry() { return '<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" fill="none" stroke-width="1.5" stroke-linecap="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg> 重录'; }

// ─── Task Queue ───
const tasks = [];
function addTask(type, label, status, outputFile) {
  tasks.unshift({ type, label, status, outputFile, time: new Date().toLocaleTimeString(), error: null });
  if (document.getElementById('tab-tasks').classList.contains('active')) refreshTasks();
}
function updateLastTask(status) {
  if (tasks.length > 0) tasks[0].status = status;
  if (document.getElementById('tab-tasks').classList.contains('active')) refreshTasks();
}
function refreshTasks() {
  const el = document.getElementById('tasks-list');
  if (!el) return;
  if (tasks.length === 0) { el.innerHTML = '<p class="hint">暂无任务</p>'; return; }
  el.innerHTML = tasks.map(t => `<div class="task-item ${t.status}"><div class="task-label">${t.status==='processing'?'🔄':t.status==='done'?'✅':'⏳'} ${t.label}</div><div class="task-meta">${t.time} · ${t.type} · ${t.status}</div>${t.error?`<div class="task-error">${t.error}</div>`:''}</div>`).join('');
}
function clearTasks() {
  const done = tasks.filter(t => t.status === 'done' || t.status === 'failed');
  done.forEach(t => tasks.splice(tasks.indexOf(t), 1));
  refreshTasks();
  toast('已清除已完成任务', 'success');
}
window.clearTasks = clearTasks;

// ─── Gallery ───
async function refreshGallery() {
  const el = document.getElementById('gallery-list');
  if (!el) return;
  el.innerHTML = '<div class="spinner-overlay"><div class="spinner"></div>加载中...</div>';
  try {
    const files = await invoke('list_output_files');
    if (!files || files.length === 0) { el.innerHTML = '<p class="hint">暂无生成结果</p>'; return; }
    
    const images = files.filter(f => f.is_image);
    const audios = files.filter(f => f.is_audio);
    
    let html = `<p class="hint">共 ${files.length} 个文件 (🖼️ ${images.length} · 🎵 ${audios.length})</p>`;
    
    if (images.length > 0) {
      html += '<h3 style="font-size:14px;font-weight:500;margin:20px 0 12px;color:var(--text)">🖼️ 图片</h3><div class="gallery">';
      for (const f of images.slice(0, 30)) {
        try {
          const dataUrl = await invoke('read_file_base64', { path: f.path });
          html += `<div><img src="${dataUrl}" /><span class="hint">${f.name} (${f.size_kb}KB)</span></div>`;
        } catch(e) {
          html += `<div><span class="hint">${f.name} — 无法加载</span></div>`;
        }
      }
      html += '</div>';
    }
    
    if (audios.length > 0) {
      html += '<h3 style="font-size:14px;font-weight:500;margin:24px 0 12px;color:var(--text)">🎵 音频</h3><div class="gallery">';
      for (const f of audios.slice(0, 30)) {
        try {
          const dataUrl = await invoke('read_file_base64', { path: f.path });
          html += `<div><audio controls src="${dataUrl}"></audio><span class="hint">${f.name} (${f.size_kb}KB)</span></div>`;
        } catch(e) {
          html += `<div><span class="hint">${f.name} — 无法加载</span></div>`;
        }
      }
      html += '</div>';
    }
    
    el.innerHTML = html;
  } catch (e) { el.innerHTML = `<p class="hint">加载失败: ${e}</p>`; }
}
window.refreshGallery = refreshGallery;

// ─── Settings ───
function toggleSettings() {
  const modal = document.getElementById('settings-modal');
  const isOpen = modal.style.display !== 'none';
  modal.style.display = isOpen ? 'none' : 'flex';
  if (!isOpen) loadSettings();
}
window.toggleSettings = toggleSettings;

async function loadSettings() {
  try {
    const cfg = await invoke('get_config');
    if (cfg) {
      document.getElementById('setting-api-key').value = cfg.api_key || '';
      document.getElementById('setting-api-host').value = cfg.api_host || 'https://api.minimaxi.com';
      document.getElementById('setting-model').value = cfg.model || 'MiniMax-M2.7';
    }
  } catch(e) { /* use defaults */ }
}

async function saveSettings() {
  const apiKey = document.getElementById('setting-api-key').value.trim();
  const apiHost = document.getElementById('setting-api-host').value.trim();
  const model = document.getElementById('setting-model').value;
  try {
    await invoke('save_config', { config: JSON.stringify({ api_key: apiKey, api_host: apiHost, model }) });
    document.getElementById('settings-msg').textContent = '✅ 已保存';
    document.getElementById('settings-msg').style.color = 'var(--accent)';
    setTimeout(toggleSettings, 800);
  } catch(e) {
    document.getElementById('settings-msg').textContent = '❌ 保存失败: ' + e;
    document.getElementById('settings-msg').style.color = '#C97070';
  }
}
window.saveSettings = saveSettings;

// ─── Version ───
(async () => {
  try { const v = await invoke('get_version'); document.getElementById('version').textContent = `mmx ${v}`; }
  catch { document.getElementById('version').textContent = 'mmx'; }
})();
