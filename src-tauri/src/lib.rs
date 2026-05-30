use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
    pub id: String,
    pub task_type: String,
    pub label: String,
    pub status: String,
    pub error: Option<String>,
    pub result: Option<String>,
    pub output_file: Option<String>,
    pub output_files: Option<Vec<String>>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OutputFile {
    pub name: String,
    pub path: String,
    pub size_kb: u64,
    pub modified: String,
    pub is_image: bool,
    pub is_audio: bool,
}

fn find_ffmpeg() -> String {
    let paths = ["/usr/local/bin/ffmpeg", "/opt/homebrew/bin/ffmpeg", "/usr/bin/ffmpeg"];
    for p in &paths {
        if std::path::Path::new(p).exists() { return p.to_string(); }
    }
    // Check sidecar
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let sidecar = dir.join("ffmpeg");
            if sidecar.exists() { return sidecar.to_string_lossy().to_string(); }
        }
    }
    "ffmpeg".to_string()
}

fn find_mmx() -> Result<String, String> {
    // Priority 1: Bundled sidecar (shipped with app, guaranteed to work)
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let sidecar = dir.join("mmx");
            if sidecar.exists() { return Ok(sidecar.to_string_lossy().to_string()); }
        }
    }
    // Priority 2: System-installed mmx (fallback for dev environments)
    let paths = [
        "/usr/local/bin/mmx",
        "/opt/homebrew/bin/mmx",
        "/usr/bin/mmx",
    ];
    for p in &paths {
        if std::path::Path::new(p).exists() {
            return Ok(p.to_string());
        }
    }
    Err("mmx CLI 未安装。请运行: npm install -g mmx-cli".to_string())
}

#[tauri::command]
fn run_mmx(args: Vec<String>, timeout_secs: Option<u64>) -> Result<String, String> {
    let _timeout = timeout_secs.unwrap_or(120);
    let mmx_path = find_mmx()?;
    let mut cmd = Command::new(mmx_path);
    cmd.args(&args).arg("--output").arg("json");
    let output = cmd.output().map_err(|e| format!("执行失败: {}", e))?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        let err = String::from_utf8_lossy(&output.stderr);
        let out = String::from_utf8_lossy(&output.stdout);
        Err(format!("{}", if err.is_empty() { out } else { err }))
    }
}

#[tauri::command]
fn get_version() -> String {
    find_mmx().ok().and_then(|mmx| {
        Command::new(mmx).arg("--version").output().ok()
    }).map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
    .unwrap_or_else(|| "unknown".to_string())
}

#[tauri::command]
fn write_temp_file(base64_data: String, extension: String) -> Result<String, String> {
    let bytes = BASE64.decode(&base64_data).map_err(|e| format!("base64 解码失败: {}", e))?;
    let ext = extension.trim_start_matches('.');
    let path = format!("/tmp/mmx_upload_{}.{}", std::time::UNIX_EPOCH.elapsed().unwrap().as_millis(), ext);
    let mut file = fs::File::create(&path).map_err(|e| format!("创建文件失败: {}", e))?;
    file.write_all(&bytes).map_err(|e| format!("写入失败: {}", e))?;
    Ok(path)
}

#[tauri::command]
fn list_output_files() -> Result<Vec<OutputFile>, String> {
    let out_dir = dirs_next::home_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("/tmp"))
        .join("Desktop/mmx_outputs");
    if !out_dir.exists() {
        return Ok(vec![]);
    }
    let mut files = Vec::new();
    if let Ok(entries) = fs::read_dir(&out_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
                let meta = fs::metadata(&path).unwrap();
                let modified = meta.modified().ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_secs())
                    .unwrap_or(0);
                files.push(OutputFile {
                    name: path.file_name().unwrap().to_string_lossy().to_string(),
                    path: path.to_string_lossy().to_string(),
                    size_kb: meta.len() / 1024,
                    modified: modified.to_string(),
                    is_image: matches!(ext.as_str(), "jpg" | "jpeg" | "png" | "webp" | "gif"),
                    is_audio: matches!(ext.as_str(), "mp3" | "wav" | "flac"),
                });
            }
        }
    }
    files.sort_by(|a, b| b.modified.cmp(&a.modified));
    Ok(files)
}

fn get_config_path() -> std::path::PathBuf {
    dirs_next::home_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("/tmp"))
        .join(".mmx-studio-config.json")
}

#[tauri::command]
fn get_config() -> Result<serde_json::Value, String> {
    let path = get_config_path();
    if path.exists() {
        let content = fs::read_to_string(&path).map_err(|e| format!("{}", e))?;
        serde_json::from_str(&content).map_err(|e| format!("{}", e))
    } else {
        Ok(serde_json::json!({}))
    }
}

#[tauri::command]
fn save_config(config: String) -> Result<(), String> {
    let path = get_config_path();
    // Validate JSON
    let _: serde_json::Value = serde_json::from_str(&config).map_err(|e| format!("无效的 JSON: {}", e))?;
    fs::write(&path, &config).map_err(|e| format!("写入失败: {}", e))
}

fn get_api_key() -> Result<String, String> {
    // Try custom config first
    let cfg_path = get_config_path();
    if cfg_path.exists() {
        if let Ok(content) = fs::read_to_string(&cfg_path) {
            if let Ok(cfg) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(key) = cfg["api_key"].as_str() {
                    if !key.is_empty() { return Ok(key.to_string()); }
                }
            }
        }
    }
    // Fallback to mmx config
    let home = dirs_next::home_dir().unwrap_or_else(|| std::path::PathBuf::from("/tmp"));
    let config_path = home.join(".mmx/config.json");
    if !config_path.exists() {
        return Err("未找到 API Key，请在设置中配置或运行 mmx auth login".to_string());
    }
    let content = fs::read_to_string(&config_path).map_err(|e| format!("读取配置失败: {}", e))?;
    let config: serde_json::Value = serde_json::from_str(&content).map_err(|e| format!("解析配置失败: {}", e))?;
    config["api_key"].as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "配置中未找到 api_key".to_string())
}

#[tauri::command]
fn image_to_image(
    source_base64: String,
    source_ext: String,
    prompt: String,
    n: Option<u32>,
    aspect_ratio: Option<String>,
) -> Result<String, String> {
    let api_key = get_api_key()?;
    let n = n.unwrap_or(1);
    let ratio = aspect_ratio.unwrap_or_else(|| "1:1".to_string());

    // Build data URL for the source image
    let mime = match source_ext.as_str() {
        "png" => "image/png",
        "webp" => "image/webp",
        "gif" => "image/gif",
        _ => "image/jpeg",
    };
    let image_data_url = format!("data:{};base64,{}", mime, source_base64);

    let body = serde_json::json!({
        "model": "image-01",
        "prompt": prompt,
        "subject_reference": [{
            "type": "character",
            "image_file": image_data_url
        }],
        "n": n,
        "aspect_ratio": ratio
    });

    let response = ureq::post("https://api.minimaxi.com/v1/image_generation")
        .set("Authorization", &format!("Bearer {}", api_key))
        .set("Content-Type", "application/json")
        .timeout(std::time::Duration::from_secs(120))
        .send_json(&body)
        .map_err(|e| format!("请求失败: {}", e))?;

    let status = response.status();
    let text = response.into_string().map_err(|e| format!("读取响应失败: {}", e))?;

    if status == 200 {
        Ok(text)
    } else {
        Err(format!("HTTP {}: {}", status, text))
    }
}

#[tauri::command]
fn read_file_base64(path: String) -> Result<String, String> {
    let bytes = fs::read(&path).map_err(|e| format!("读取失败: {}", e))?;
    let ext = std::path::Path::new(&path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("jpg")
        .to_lowercase();
    let mime = match ext.as_str() {
        "png" => "image/png",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        _ => "image/jpeg",
    };
    let b64 = BASE64.encode(&bytes);
    Ok(format!("data:{};base64,{}", mime, b64))
}

#[tauri::command]
fn convert_audio_to_mp3(input_path: String) -> Result<String, String> {
    let output_path = format!("{}.mp3", input_path.trim_end_matches(".webm"));
    let status = Command::new(find_ffmpeg())
        .args(["-y", "-i", &input_path, "-codec:a", "libmp3lame", "-qscale:a", "2", &output_path])
        .output()
        .map_err(|e| format!("ffmpeg 执行失败: {}", e))?;
    if status.status.success() {
        Ok(output_path)
    } else {
        Err(String::from_utf8_lossy(&status.stderr).to_string())
    }
}

#[tauri::command]
fn voice_clone(audio_path: String, voice_id: String) -> Result<String, String> {
    let api_key = get_api_key()?;
    
    // Step 1: Upload audio file via multipart/form-data
    let file_bytes = fs::read(&audio_path).map_err(|e| format!("读取音频失败: {}", e))?;
    let filename = std::path::Path::new(&audio_path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("audio.mp3");
    
    let boundary = format!("----MiniMaxUpload{}", std::time::UNIX_EPOCH.elapsed().unwrap().as_nanos());
    let mut body = Vec::new();
    
    // purpose field
    body.extend_from_slice(format!("--{}\r\n", boundary).as_bytes());
    body.extend_from_slice(b"Content-Disposition: form-data; name=\"purpose\"\r\n\r\n");
    body.extend_from_slice(b"voice_clone\r\n");
    
    // file field
    body.extend_from_slice(format!("--{}\r\n", boundary).as_bytes());
    body.extend_from_slice(format!("Content-Disposition: form-data; name=\"file\"; filename=\"{}\"\r\n", filename).as_bytes());
    body.extend_from_slice(b"Content-Type: audio/mpeg\r\n\r\n");
    body.extend_from_slice(&file_bytes);
    body.extend_from_slice(b"\r\n");
    
    // end
    body.extend_from_slice(format!("--{}--\r\n", boundary).as_bytes());
    
    let content_type = format!("multipart/form-data; boundary={}", boundary);
    
    let resp = ureq::post("https://api.minimaxi.com/v1/files/upload")
        .set("Authorization", &format!("Bearer {}", api_key))
        .set("Content-Type", &content_type)
        .timeout(std::time::Duration::from_secs(30))
        .send_bytes(&body)
        .map_err(|e| format!("上传失败: {}", e))?;
    
    if resp.status() != 200 {
        let status = resp.status();
        let err_text = resp.into_string().unwrap_or_default();
        return Err(format!("上传失败 HTTP {}: {}", status, err_text));
    }
    
    let resp_text = resp.into_string().map_err(|e| format!("读取上传响应失败: {}", e))?;
    let upload_result: serde_json::Value = serde_json::from_str(&resp_text)
        .map_err(|e| format!("解析上传响应失败: {} — 原始: {}", e, &resp_text[..200.min(resp_text.len())]))?;
    // Check API-level error
    if let Some(code) = upload_result["base_resp"]["status_code"].as_i64() {
        if code != 0 {
            let msg = upload_result["base_resp"]["status_msg"].as_str().unwrap_or("unknown");
            return Err(format!("上传API错误 [{}]: {}", code, msg));
        }
    }
    let file_id = upload_result["file"]["file_id"].as_i64()
        .ok_or_else(|| format!("未获取到 file_id: {}", upload_result))?;
    
    // Step 2: Clone voice
    let clone_body = serde_json::json!({
        "file_id": file_id,
        "voice_id": voice_id,
    });
    
    let resp2 = ureq::post("https://api.minimaxi.com/v1/voice_clone")
        .set("Authorization", &format!("Bearer {}", api_key))
        .set("Content-Type", "application/json")
        .timeout(std::time::Duration::from_secs(30))
        .send_json(&clone_body)
        .map_err(|e| format!("克隆失败: {}", e))?;
    
    let clone_status = resp2.status();
    let clone_text = resp2.into_string().unwrap_or_default();
    if clone_status != 200 {
        return Err(format!("克隆失败 HTTP {}: {}", clone_status, clone_text));
    }
    // Check API-level error in clone response
    if let Ok(clone_result) = serde_json::from_str::<serde_json::Value>(&clone_text) {
        if let Some(code) = clone_result["base_resp"]["status_code"].as_i64() {
            if code != 0 {
                let msg = clone_result["base_resp"]["status_msg"].as_str().unwrap_or("unknown");
                return Err(format!("克隆API错误 [{}]: {}", code, msg));
            }
        }
    }
    
    Ok(format!("{{\"voice_id\":\"{}\"}}", voice_id))
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            run_mmx, get_version, write_temp_file,
            list_output_files, image_to_image,
            get_config, save_config,
            read_file_base64, convert_audio_to_mp3,
            voice_clone
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
