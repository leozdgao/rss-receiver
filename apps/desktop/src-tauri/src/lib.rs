use std::{env, fs, path::PathBuf};

#[tauri::command]
fn read_runtime_port() -> Result<Option<u16>, String> {
    let Some(path) = find_port_file() else {
        return Ok(None);
    };
    let raw = fs::read_to_string(&path).map_err(|error| format!("failed to read {}: {error}", path.display()))?;
    let port = raw
        .trim()
        .parse::<u16>()
        .map_err(|error| format!("invalid runtime port in {}: {error}", path.display()))?;
    Ok(Some(port))
}

fn find_port_file() -> Option<PathBuf> {
    if let Ok(path) = env::var("SERVER_PORT_PATH") {
        let candidate = PathBuf::from(path);
        if candidate.exists() {
            return Some(candidate);
        }
    }

    let mut current = env::current_dir().ok()?;
    loop {
        let candidate = current.join("data").join("rss-receiver-server.port");
        if candidate.exists() {
            return Some(candidate);
        }
        if !current.pop() {
            return None;
        }
    }
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![read_runtime_port])
        .run(tauri::generate_context!())
        .expect("error while running RSS Receiver desktop app");
}
