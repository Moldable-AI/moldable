use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use notify_debouncer_mini::{new_debouncer, DebouncedEventKind};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandChild;

// Store running app processes and their output
struct AppProcess {
    child: Child,
    output_lines: Vec<String>,
    /// The actual port the app is running on (may differ from configured port)
    actual_port: Option<u16>,
}

struct AppStateInner {
    processes: HashMap<String, AppProcess>,
    // Store last error/output for apps that have stopped
    last_errors: HashMap<String, Vec<String>>,
}

// Wrap in Arc so it can be shared across threads
struct AppState(Arc<Mutex<AppStateInner>>);

#[derive(serde::Serialize)]
struct AppStatus {
    running: bool,
    pid: Option<u32>,
    exit_code: Option<i32>,
    recent_output: Vec<String>,
    /// The actual port the app is running on (may differ from configured port)
    actual_port: Option<u16>,
}

fn command_basename(command: &str) -> String {
    std::path::Path::new(command)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(command)
        .to_lowercase()
}

fn is_package_manager_command(command: &str) -> bool {
    matches!(
        command_basename(command).as_str(),
        "pnpm" | "npm" | "yarn" | "bun"
    )
}

fn upsert_flag_value(args: &mut Vec<String>, flags: &[&str], value: String) {
    for (i, arg) in args.iter().enumerate() {
        if flags.iter().any(|f| *f == arg) {
            if i + 1 < args.len() {
                args[i + 1] = value;
                return;
            }
        }
    }

    // Prefer the first flag for insertion
    let flag = flags.first().unwrap_or(&"-p");
    args.push((*flag).to_string());
    args.push(value);
}

fn with_script_args_forwarded(
    command: &str,
    args: Vec<String>,
    port: Option<u16>,
) -> Vec<String> {
    // We want to inject `-p <port>` such that it reaches the *app*, not the package manager.
    // For pnpm/npm/yarn/bun, that means putting app args after `--`.
    if port.is_none() {
        return args;
    }

    let port_str = port.unwrap().to_string();

    if is_package_manager_command(command) {
        if let Some(sep_idx) = args.iter().position(|a| a == "--") {
            let mut base = args[..=sep_idx].to_vec(); // include `--`
            let mut script_args = args[sep_idx + 1..].to_vec();
            upsert_flag_value(&mut script_args, &["-p", "--port"], port_str);
            base.extend(script_args);
            return base;
        }

        let mut out = args;
        out.push("--".to_string());
        out.push("-p".to_string());
        out.push(port_str);
        return out;
    }

    let mut out = args;
    upsert_flag_value(&mut out, &["-p", "--port"], port_str);
    out
}

fn start_app_internal(
    app_id: String,
    working_dir: String,
    command: String,
    args: Vec<String>,
    port: Option<u16>,
    state: &AppState,
) -> Result<AppStatus, String> {
    // Validate working directory exists
    let working_path = std::path::Path::new(&working_dir);
    if !working_path.exists() {
        return Err(format!(
            "App directory does not exist: {}. The app may need to be reinstalled.",
            working_dir
        ));
    }
    if !working_path.is_dir() {
        return Err(format!(
            "App path is not a directory: {}",
            working_dir
        ));
    }
    
    // Check for package.json (most apps need this)
    let package_json = working_path.join("package.json");
    if !package_json.exists() {
        return Err(format!(
            "No package.json found in app directory: {}. The app may be incomplete or corrupted.",
            working_dir
        ));
    }
    
    let mut app_state = state.0.lock().map_err(|e| e.to_string())?;

    // Check if already running
    if let Some(app_proc) = app_state.processes.get_mut(&app_id) {
        match app_proc.child.try_wait() {
            Ok(None) => {
                // Still running
                return Ok(AppStatus {
                    running: true,
                    pid: Some(app_proc.child.id()),
                    exit_code: None,
                    recent_output: app_proc.output_lines.clone(),
                    actual_port: app_proc.actual_port,
                });
            }
            Ok(Some(_status)) => {
                // Process ended, capture final state
                let output = app_proc.output_lines.clone();
                app_state.last_errors.insert(app_id.clone(), output);
                app_state.processes.remove(&app_id);
                // Fall through to start a new one
            }
            Err(_) => {
                app_state.processes.remove(&app_id);
            }
        }
    }

    // Clear any previous errors
    app_state.last_errors.remove(&app_id);

    // Ensure port flag reaches the underlying app when using pnpm/npm/yarn/bun
    let args = with_script_args_forwarded(&command, args, port);

    // Build PATH with common locations for node/pnpm
    let mut path_additions = vec![
        "/opt/homebrew/bin".to_string(),
        "/usr/local/bin".to_string(),
        "/usr/bin".to_string(),
        "/bin".to_string(),
        "/home/linuxbrew/.linuxbrew/bin".to_string(),
    ];

    // Find node and add its directory to PATH
    if let Some(node_dir) = find_node_path() {
        path_additions.insert(0, node_dir);
    }

    let current_path = std::env::var("PATH").unwrap_or_default();
    let new_path = format!("{}:{}", path_additions.join(":"), current_path);

    // Read merged env vars (shared + workspace-specific) and pass through to app processes
    let env_vars = get_merged_env_vars();

    // Get MOLDABLE_HOME path and workspace-aware data dir
    let home = std::env::var("HOME").unwrap_or_default();
    let moldable_home = format!("{}/.moldable", home);
    let active_workspace = get_workspaces_config_internal()
        .map(|c| c.active_workspace)
        .unwrap_or_else(|_| "personal".to_string());
    let app_data_dir = format!(
        "{}/workspaces/{}/apps/{}/data",
        moldable_home, active_workspace, app_id
    );
    
    // Ensure app data directory exists
    let _ = std::fs::create_dir_all(&app_data_dir);

    // Start the process with piped stderr/stdout
    let mut cmd = Command::new(&command);
    cmd.args(&args)
        .current_dir(&working_dir)
        .env("PATH", &new_path)
        // Moldable-provided runtime vars
        .env("MOLDABLE_APP_ID", &app_id)
        .env("MOLDABLE_HOST", "127.0.0.1")
        .env("MOLDABLE_HOME", &moldable_home)
        .env("MOLDABLE_APP_DATA_DIR", &app_data_dir);

    if let Some(p) = port {
        let p_str = p.to_string();
        cmd.env("MOLDABLE_PORT", &p_str).env("PORT", &p_str);
    }

    for (k, v) in env_vars {
        cmd.env(k, v);
    }

    let mut child = cmd
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start app: {}", e))?;

    let pid = child.id();

    // Capture stderr/stdout in background threads
    let stderr = child.stderr.take();
    let stdout = child.stdout.take();

    // Clone the Arc for the threads
    let state_arc = Arc::clone(&state.0);
    let state_arc2 = Arc::clone(&state.0);
    let app_id_for_stderr = app_id.clone();
    let app_id_for_stdout = app_id.clone();

    if let Some(stderr) = stderr {
        thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines().map_while(Result::ok) {
                if let Ok(mut state) = state_arc.lock() {
                    if let Some(proc) = state.processes.get_mut(&app_id_for_stderr) {
                        // Keep last 100 lines
                        if proc.output_lines.len() >= 100 {
                            proc.output_lines.remove(0);
                        }
                        proc.output_lines.push(format!("[stderr] {}", line));
                    }
                }
            }
        });
    }

    if let Some(stdout) = stdout {
        thread::spawn(move || {
            let reader = BufReader::new(stdout);
            // Regex to detect port from Next.js/Vite output like "localhost:3001" or "http://localhost:3001"
            let port_regex = regex::Regex::new(r"localhost:(\d+)").ok();

            for line in reader.lines().map_while(Result::ok) {
                if let Ok(mut state) = state_arc2.lock() {
                    if let Some(proc) = state.processes.get_mut(&app_id_for_stdout) {
                        // Keep last 100 lines
                        if proc.output_lines.len() >= 100 {
                            proc.output_lines.remove(0);
                        }

                        // Try to detect port from output (e.g., "ready on http://localhost:3001")
                        if proc.actual_port.is_none() {
                            if let Some(ref re) = port_regex {
                                if let Some(caps) = re.captures(&line) {
                                    if let Some(port_str) = caps.get(1) {
                                        if let Ok(detected_port) =
                                            port_str.as_str().parse::<u16>()
                                        {
                                            proc.actual_port = Some(detected_port);
                                        }
                                    }
                                }
                            }
                        }

                        proc.output_lines.push(line);
                    }
                }
            }
        });
    }

    app_state.processes.insert(
        app_id,
        AppProcess {
            child,
            output_lines: Vec::new(),
            actual_port: port,
        },
    );

    Ok(AppStatus {
        running: true,
        pid: Some(pid),
        exit_code: None,
        recent_output: Vec::new(),
        actual_port: port,
    })
}

#[tauri::command]
fn start_app(
    app_id: String,
    working_dir: String,
    command: String,
    args: Vec<String>,
    port: Option<u16>,
    state: State<AppState>,
) -> Result<AppStatus, String> {
    start_app_internal(app_id, working_dir, command, args, port, state.inner())
}

/// Kill a process and all its children recursively
fn kill_process_tree(pid: u32) {
    // First, find and kill all child processes
    // Use pgrep to find children, then kill them recursively
    if let Ok(output) = std::process::Command::new("pgrep")
        .args(["-P", &pid.to_string()])
        .output()
    {
        if output.status.success() {
            let children = String::from_utf8_lossy(&output.stdout);
            for child_pid in children.lines() {
                if let Ok(cpid) = child_pid.trim().parse::<u32>() {
                    // Recursively kill children first
                    kill_process_tree(cpid);
                }
            }
        }
    }

    // Now kill this process
    let _ = std::process::Command::new("kill")
        .args(["-9", &pid.to_string()])
        .output();
}

#[tauri::command]
fn stop_app(app_id: String, state: State<AppState>) -> Result<AppStatus, String> {
    let mut app_state = state.0.lock().map_err(|e| e.to_string())?;

    if let Some(mut app_proc) = app_state.processes.remove(&app_id) {
        // Save output before killing
        app_state
            .last_errors
            .insert(app_id.clone(), app_proc.output_lines.clone());

        let pid = app_proc.child.id();
        
        // Kill the entire process tree (pnpm + its child processes like next-server)
        kill_process_tree(pid);
        
        // Wait for the main process to clean up
        let _ = app_proc.child.wait();
    }

    Ok(AppStatus {
        running: false,
        pid: None,
        exit_code: None,
        recent_output: Vec::new(),
        actual_port: None,
    })
}

#[tauri::command]
fn get_app_status(app_id: String, state: State<AppState>) -> Result<AppStatus, String> {
    let mut app_state = state.0.lock().map_err(|e| e.to_string())?;

    if let Some(app_proc) = app_state.processes.get_mut(&app_id) {
        match app_proc.child.try_wait() {
            Ok(None) => {
                // Still running
                return Ok(AppStatus {
                    running: true,
                    pid: Some(app_proc.child.id()),
                    exit_code: None,
                    recent_output: app_proc.output_lines.clone(),
                    actual_port: app_proc.actual_port,
                });
            }
            Ok(Some(status)) => {
                // Process ended
                let exit_code = status.code();
                let output = app_proc.output_lines.clone();
                app_state.last_errors.insert(app_id.clone(), output.clone());
                app_state.processes.remove(&app_id);

                return Ok(AppStatus {
                    running: false,
                    pid: None,
                    exit_code,
                    recent_output: output,
                    actual_port: None,
                });
            }
            Err(_) => {
                app_state.processes.remove(&app_id);
            }
        }
    }

    // Check for stored errors from previous run
    let last_output = app_state
        .last_errors
        .get(&app_id)
        .cloned()
        .unwrap_or_default();

    Ok(AppStatus {
        running: false,
        pid: None,
        exit_code: None,
        recent_output: last_output,
        actual_port: None,
    })
}

#[tauri::command]
fn get_app_logs(app_id: String, state: State<AppState>) -> Result<Vec<String>, String> {
    let app_state = state.0.lock().map_err(|e| e.to_string())?;

    // First check running process
    if let Some(app_proc) = app_state.processes.get(&app_id) {
        return Ok(app_proc.output_lines.clone());
    }

    // Then check stored errors
    Ok(app_state
        .last_errors
        .get(&app_id)
        .cloned()
        .unwrap_or_default())
}

#[tauri::command]
async fn check_port(port: u16) -> bool {
    use tokio::net::TcpStream;
    use tokio::time::{timeout, Duration};

    let addr = format!("127.0.0.1:{}", port);
    // Use a short timeout (200ms) to avoid blocking
    match timeout(Duration::from_millis(200), TcpStream::connect(&addr)).await {
        Ok(Ok(_)) => true,
        _ => false,
    }
}

/// Check if a port is available for binding (not in use).
///
/// IMPORTANT: we intentionally avoid binding `0.0.0.0` here because doing so can
/// trigger the macOS firewall prompt for the Moldable app itself.
#[tauri::command]
fn is_port_available(port: u16) -> bool {
    use std::net::TcpListener;
    use std::process::Command;

    // First, try the most reliable check: ask the OS if anything is LISTENing.
    // This avoids edge cases where bind checks can be misleading across interfaces.
    if let Ok(output) = Command::new("lsof")
        .args([
            "-nP",
            "-iTCP",
            &format!(":{}", port),
            "-sTCP:LISTEN",
            "-t",
        ])
        .output()
    {
        if output.status.success() && !output.stdout.is_empty() {
            return false;
        }
    }

    // Fallback bind checks (loopback only)
    let ipv4_available = TcpListener::bind(format!("127.0.0.1:{}", port)).is_ok();
    let ipv6_available = TcpListener::bind(format!("[::1]:{}", port)).is_ok();

    ipv4_available && ipv6_available
}

/// Find an available port starting from the given port
/// Checks IPv4, IPv6, and all-interfaces to ensure Next.js can bind
#[tauri::command]
fn find_free_port(start_port: u16) -> u16 {
    let mut port: u32 = start_port as u32;
    loop {
        if port > u16::MAX as u32 {
            return start_port; // Fallback
        }

        let candidate = port as u16;
        if is_port_available(candidate) {
            return candidate;
        }
        port += 1;
    }
}

#[derive(serde::Serialize)]
struct PortInfo {
    port: u16,
    pid: Option<u32>,
    process_name: Option<String>,
    command: Option<String>,
}

/// Get information about what process is using a port
#[tauri::command]
fn get_port_info(port: u16) -> Option<PortInfo> {
    // Use lsof to find process using port (macOS/Linux)
    // Don't filter by TCP state to catch all listeners including IPv6
    let output = std::process::Command::new("lsof")
        .args(["-i", &format!(":{}", port), "-t"])
        .output()
        .ok()?;
    
    if !output.status.success() || output.stdout.is_empty() {
        return None;
    }
    
    let pid_str = String::from_utf8_lossy(&output.stdout);
    let pid: u32 = pid_str.trim().lines().next()?.parse().ok()?;
    
    // Get process name using ps
    let ps_output = std::process::Command::new("ps")
        .args(["-p", &pid.to_string(), "-o", "comm=,args="])
        .output()
        .ok()?;
    
    let ps_str = String::from_utf8_lossy(&ps_output.stdout);
    let mut parts = ps_str.trim().splitn(2, ' ');
    let process_name = parts.next().map(|s| s.to_string());
    let command = parts.next().map(|s| s.to_string());
    
    Some(PortInfo {
        port,
        pid: Some(pid),
        process_name,
        command,
    })
}

/// Kill the process using a specific port
#[tauri::command]
fn kill_port(port: u16) -> Result<bool, String> {
    // Use lsof to find process using port
    let output = std::process::Command::new("lsof")
        .args(["-i", &format!(":{}", port), "-t", "-sTCP:LISTEN"])
        .output()
        .map_err(|e| format!("Failed to run lsof: {}", e))?;
    
    if !output.status.success() {
        return Ok(false); // No process found
    }
    
    let pid_str = String::from_utf8_lossy(&output.stdout);
    
    // Kill each PID found
    let mut killed_any = false;
    for line in pid_str.trim().lines() {
        if let Ok(pid) = line.parse::<u32>() {
            let kill_result = std::process::Command::new("kill")
                .args(["-9", &pid.to_string()])
                .output();
            
            if kill_result.is_ok() {
                killed_any = true;
            }
        }
    }
    
    // Give the OS a moment to clean up
    std::thread::sleep(std::time::Duration::from_millis(100));
    
    Ok(killed_any)
}

/// Update the actual port for a running app (used when port is detected from stdout)
#[tauri::command]
fn set_app_actual_port(app_id: String, port: u16, state: State<AppState>) -> Result<(), String> {
    let mut app_state = state.0.lock().map_err(|e| e.to_string())?;
    
    if let Some(app_proc) = app_state.processes.get_mut(&app_id) {
        app_proc.actual_port = Some(port);
    }
    
    Ok(())
}

/// Read port from .moldable.port file in app directory
fn read_port_file(working_dir: &str) -> Option<u16> {
    let port_file = std::path::Path::new(working_dir).join(".moldable.port");
    if port_file.exists() {
        if let Ok(content) = std::fs::read_to_string(&port_file) {
            return content.trim().parse().ok();
        }
    }
    None
}

/// Instance entry in .moldable.instances.json
#[derive(serde::Deserialize, Debug)]
struct AppInstance {
    pid: u32,
    #[allow(dead_code)]
    port: Option<u16>,
    #[allow(dead_code)]
    #[serde(rename = "startedAt")]
    started_at: Option<String>,
}

/// Read all instances from .moldable.instances.json in app directory
fn read_instances_file(working_dir: &str) -> Vec<AppInstance> {
    let instances_file = std::path::Path::new(working_dir).join(".moldable.instances.json");
    if instances_file.exists() {
        if let Ok(content) = std::fs::read_to_string(&instances_file) {
            if let Ok(instances) = serde_json::from_str::<Vec<AppInstance>>(&content) {
                return instances;
            }
        }
    }
    Vec::new()
}

/// Remove the .moldable.instances.json file
fn remove_instances_file(working_dir: &str) {
    let instances_file = std::path::Path::new(working_dir).join(".moldable.instances.json");
    let _ = std::fs::remove_file(instances_file);
}

/// Kill all orphaned app instances for a given app directory
/// Returns the number of processes killed
fn cleanup_orphaned_instances(working_dir: &str) -> usize {
    let instances = read_instances_file(working_dir);
    let mut killed = 0;
    
    for instance in &instances {
        // Check if process is still running
        let is_running = std::process::Command::new("kill")
            .args(["-0", &instance.pid.to_string()])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);
        
        if is_running {
            println!("  🔪 Killing orphaned process {} (port {:?})", instance.pid, instance.port);
            kill_process_tree(instance.pid);
            killed += 1;
        }
    }
    
    // Clean up the instances file
    if !instances.is_empty() {
        remove_instances_file(working_dir);
    }
    
    killed
}

/// Clean up all orphaned instances for all registered apps
/// Called on startup to ensure no zombie processes from previous runs
fn cleanup_all_orphaned_apps() {
    let apps = match get_registered_apps() {
        Ok(a) => a,
        Err(_) => return,
    };
    
    if apps.is_empty() {
        return;
    }
    
    println!("🧹 Checking for orphaned app instances...");
    let mut total_killed = 0;
    
    for app in &apps {
        let killed = cleanup_orphaned_instances(&app.path);
        if killed > 0 {
            println!("  ✅ Cleaned up {} orphaned instance(s) for {}", killed, app.id);
            total_killed += killed;
        }
    }
    
    if total_killed > 0 {
        println!("🧹 Cleaned up {} total orphaned process(es)", total_killed);
    } else {
        println!("✨ No orphaned processes found");
    }
}

/// Discover actual port for an app - checks process state, port file, and stdout detection
#[tauri::command]
fn discover_app_port(app_id: String, working_dir: String, state: State<AppState>) -> Option<u16> {
    // First check if we have the port from the running process
    if let Ok(app_state) = state.0.lock() {
        if let Some(proc) = app_state.processes.get(&app_id) {
            if proc.actual_port.is_some() {
                return proc.actual_port;
            }
        }
    }
    
    // Try reading from .moldable.port file
    if let Some(port) = read_port_file(&working_dir) {
        // Verify the port is actually in use
        if std::net::TcpStream::connect(format!("127.0.0.1:{}", port)).is_ok() {
            return Some(port);
        }
    }
    
    None
}

#[tauri::command]
fn get_moldable_config_path() -> Result<String, String> {
    let home = std::env::var("HOME").map_err(|_| "Could not get HOME directory")?;
    Ok(format!("{}/.moldable", home))
}

/// Get the Moldable home directory (~/.moldable)
#[tauri::command]
fn get_moldable_root() -> Result<String, String> {
    let home = std::env::var("HOME").map_err(|_| "Could not get HOME directory")?;
    Ok(format!("{}/.moldable", home))
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
struct RegisteredApp {
    id: String,
    name: String,
    icon: String,
    #[serde(default)]
    icon_path: Option<String>,
    port: u16,
    path: String,
    command: String,
    args: Vec<String>,
    #[serde(default = "default_widget_size")]
    widget_size: String,
    /// If true, app requires this specific port (show kill dialog on conflict)
    /// If false (default), auto-pick a free port
    #[serde(default)]
    requires_port: bool,
}

fn default_widget_size() -> String {
    "medium".to_string()
}

#[derive(serde::Serialize, serde::Deserialize, Default)]
struct MoldableConfig {
    /// Path to the Moldable development workspace (for self-modification)
    #[serde(default)]
    workspace: Option<String>,
    #[serde(default)]
    apps: Vec<RegisteredApp>,
    /// User preferences (model, theme, reasoning effort, etc.)
    #[serde(default)]
    preferences: serde_json::Map<String, serde_json::Value>,
}

fn get_config_file_path() -> Result<std::path::PathBuf, String> {
    // Get the active workspace config path
    let workspaces_config = get_workspaces_config_internal()?;
    let home = std::env::var("HOME").map_err(|_| "Could not get HOME directory")?;
    Ok(std::path::PathBuf::from(format!(
        "{}/.moldable/workspaces/{}/config.json",
        home, workspaces_config.active_workspace
    )))
}

// ==================== WORKSPACES ====================

#[derive(serde::Serialize, serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Workspace {
    id: String,
    name: String,
    color: String,
    created_at: String,
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct WorkspacesConfig {
    active_workspace: String,
    workspaces: Vec<Workspace>,
}

impl Default for WorkspacesConfig {
    fn default() -> Self {
        Self {
            active_workspace: "personal".to_string(),
            workspaces: vec![Workspace {
                id: "personal".to_string(),
                name: "Personal".to_string(),
                color: "#10b981".to_string(),
                created_at: chrono::Utc::now().to_rfc3339(),
            }],
        }
    }
}

fn get_workspaces_file_path() -> Result<std::path::PathBuf, String> {
    let home = std::env::var("HOME").map_err(|_| "Could not get HOME directory")?;
    Ok(std::path::PathBuf::from(format!("{}/.moldable/workspaces.json", home)))
}

fn get_workspaces_config_internal() -> Result<WorkspacesConfig, String> {
    let workspaces_path = get_workspaces_file_path()?;
    
    if !workspaces_path.exists() {
        return Ok(WorkspacesConfig::default());
    }
    
    let content = std::fs::read_to_string(&workspaces_path)
        .map_err(|e| format!("Failed to read workspaces config: {}", e))?;
    
    serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse workspaces config: {}", e))
}

fn save_workspaces_config(config: &WorkspacesConfig) -> Result<(), String> {
    let workspaces_path = get_workspaces_file_path()?;
    
    // Ensure parent directory exists
    if let Some(parent) = workspaces_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create config directory: {}", e))?;
    }
    
    let content = serde_json::to_string_pretty(config)
        .map_err(|e| format!("Failed to serialize workspaces config: {}", e))?;
    
    std::fs::write(&workspaces_path, content)
        .map_err(|e| format!("Failed to write workspaces config: {}", e))?;
    
    Ok(())
}

fn ensure_workspace_dirs(workspace_id: &str) -> Result<(), String> {
    let home = std::env::var("HOME").map_err(|_| "Could not get HOME directory")?;
    let workspace_dir = format!("{}/.moldable/workspaces/{}", home, workspace_id);
    
    // Create workspace directories
    let dirs = [
        format!("{}/apps", workspace_dir),
        format!("{}/conversations", workspace_dir),
        format!("{}/config", workspace_dir),
    ];
    
    for dir in &dirs {
        std::fs::create_dir_all(dir)
            .map_err(|e| format!("Failed to create directory {}: {}", dir, e))?;
    }
    
    // Create empty config.json if it doesn't exist
    let config_path = format!("{}/config.json", workspace_dir);
    if !std::path::Path::new(&config_path).exists() {
        let default_config = MoldableConfig::default();
        let content = serde_json::to_string_pretty(&default_config)
            .map_err(|e| format!("Failed to serialize config: {}", e))?;
        std::fs::write(&config_path, content)
            .map_err(|e| format!("Failed to write config: {}", e))?;
    }
    
    Ok(())
}

#[tauri::command]
fn get_workspaces_config() -> Result<WorkspacesConfig, String> {
    get_workspaces_config_internal()
}

#[tauri::command]
fn set_active_workspace(workspace_id: String) -> Result<(), String> {
    let mut config = get_workspaces_config_internal()?;
    
    // Verify workspace exists
    if !config.workspaces.iter().any(|w| w.id == workspace_id) {
        return Err(format!("Workspace '{}' not found", workspace_id));
    }
    
    config.active_workspace = workspace_id;
    save_workspaces_config(&config)
}

#[tauri::command]
fn create_workspace(name: String, color: Option<String>) -> Result<Workspace, String> {
    let mut config = get_workspaces_config_internal()?;
    
    // Generate ID from name
    let id = name
        .to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    
    // Check for duplicate ID
    if config.workspaces.iter().any(|w| w.id == id) {
        return Err(format!("A workspace with ID '{}' already exists", id));
    }
    
    let workspace = Workspace {
        id: id.clone(),
        name,
        color: color.unwrap_or_else(|| "#10b981".to_string()),
        created_at: chrono::Utc::now().to_rfc3339(),
    };
    
    config.workspaces.push(workspace.clone());
    save_workspaces_config(&config)?;
    
    // Create workspace directories
    ensure_workspace_dirs(&id)?;
    
    Ok(workspace)
}

#[tauri::command]
fn update_workspace(workspace_id: String, name: Option<String>, color: Option<String>) -> Result<Workspace, String> {
    let mut config = get_workspaces_config_internal()?;
    
    let workspace = config.workspaces
        .iter_mut()
        .find(|w| w.id == workspace_id)
        .ok_or_else(|| format!("Workspace '{}' not found", workspace_id))?;
    
    if let Some(n) = name {
        workspace.name = n;
    }
    if let Some(c) = color {
        workspace.color = c;
    }
    
    let updated = workspace.clone();
    save_workspaces_config(&config)?;
    
    Ok(updated)
}

#[tauri::command]
fn delete_workspace(workspace_id: String) -> Result<(), String> {
    let mut config = get_workspaces_config_internal()?;
    
    if config.workspaces.len() <= 1 {
        return Err("Cannot delete the last workspace".to_string());
    }
    
    if !config.workspaces.iter().any(|w| w.id == workspace_id) {
        return Err(format!("Workspace '{}' not found", workspace_id));
    }
    
    config.workspaces.retain(|w| w.id != workspace_id);
    
    // If we deleted the active workspace, switch to the first remaining one
    if config.active_workspace == workspace_id {
        config.active_workspace = config.workspaces[0].id.clone();
    }
    
    save_workspaces_config(&config)?;
    
    // Note: We don't delete the workspace directory to prevent data loss
    // Users can manually delete ~/.moldable/workspaces/{id}/ if they want
    
    Ok(())
}

/// Ensure default workspace structure exists on fresh install
fn ensure_default_workspace() -> Result<(), String> {
    let home = std::env::var("HOME").map_err(|_| "Could not get HOME directory")?;
    let moldable_root = std::path::PathBuf::from(format!("{}/.moldable", home));
    let workspaces_file = moldable_root.join("workspaces.json");
    let personal_workspace = moldable_root.join("workspaces/personal");
    let shared_dir = moldable_root.join("shared");
    let shared_apps_dir = moldable_root.join("shared/apps");
    let shared_scripts_dir = moldable_root.join("shared/scripts");
    let cache_dir = moldable_root.join("cache");

    // Skip if already set up
    if workspaces_file.exists() && personal_workspace.join("config.json").exists() {
        // Still ensure shared/apps, shared/scripts, and cache exist (may be missing from older installs)
        let _ = std::fs::create_dir_all(&shared_apps_dir);
        let _ = std::fs::create_dir_all(&shared_scripts_dir);
        let _ = std::fs::create_dir_all(&cache_dir);
        return Ok(());
    }

    println!("🏠 Setting up default workspace structure...");

    // Create directories
    std::fs::create_dir_all(&personal_workspace)
        .map_err(|e| format!("Failed to create personal workspace: {}", e))?;
    std::fs::create_dir_all(&shared_dir)
        .map_err(|e| format!("Failed to create shared directory: {}", e))?;
    std::fs::create_dir_all(&shared_apps_dir)
        .map_err(|e| format!("Failed to create shared apps directory: {}", e))?;
    std::fs::create_dir_all(&shared_scripts_dir)
        .map_err(|e| format!("Failed to create shared scripts directory: {}", e))?;
    std::fs::create_dir_all(&cache_dir)
        .map_err(|e| format!("Failed to create cache directory: {}", e))?;

    // Create default workspaces.json
    save_workspaces_config(&WorkspacesConfig::default())?;

    // Create default config.json in personal workspace
    ensure_workspace_dirs("personal")?;

    println!("✅ Created default workspace structure");
    Ok(())
}

/// Ensure bundled scripts are installed in ~/.moldable/shared/scripts/
/// This copies scripts from the app bundle to the user's data directory
fn ensure_bundled_scripts(app_handle: &tauri::AppHandle) -> Result<(), String> {
    let home = std::env::var("HOME").map_err(|_| "Could not get HOME directory")?;
    let scripts_dir = std::path::PathBuf::from(format!("{}/.moldable/shared/scripts", home));
    
    // Ensure scripts directory exists
    std::fs::create_dir_all(&scripts_dir)
        .map_err(|e| format!("Failed to create scripts directory: {}", e))?;
    
    // Scripts to install
    let scripts = vec!["lint-moldable-app.js"];
    
    for script_name in scripts {
        let dest_path = scripts_dir.join(script_name);
        
        // Try to get from bundled resources first
        let resource_path = app_handle.path().resource_dir()
            .map_err(|e| format!("Failed to get resource dir: {}", e))?
            .join(script_name);
        
        if resource_path.exists() {
            // Copy from bundled resources (production)
            std::fs::copy(&resource_path, &dest_path)
                .map_err(|e| format!("Failed to copy {}: {}", script_name, e))?;
            println!("📜 Installed {} to ~/.moldable/shared/scripts/", script_name);
        } else {
            // In development, try to copy from the workspace scripts directory
            // Get the workspace root by going up from src-tauri
            if let Ok(manifest_dir) = std::env::var("CARGO_MANIFEST_DIR") {
                let dev_script_path = std::path::PathBuf::from(&manifest_dir)
                    .parent() // desktop
                    .and_then(|p| p.parent()) // moldable root
                    .map(|p| p.join("scripts").join(script_name));
                
                if let Some(dev_path) = dev_script_path {
                    if dev_path.exists() {
                        std::fs::copy(&dev_path, &dest_path)
                            .map_err(|e| format!("Failed to copy {}: {}", script_name, e))?;
                        println!("📜 Installed {} to ~/.moldable/shared/scripts/ (dev)", script_name);
                    }
                }
            }
        }
    }
    
    Ok(())
}

// ==================== END WORKSPACES ====================

#[tauri::command]
fn get_registered_apps() -> Result<Vec<RegisteredApp>, String> {
    let config_path = get_config_file_path()?;
    
    if !config_path.exists() {
        return Ok(Vec::new());
    }
    
    let content = std::fs::read_to_string(&config_path)
        .map_err(|e| format!("Failed to read config: {}", e))?;
    
    let config: MoldableConfig = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse config: {}", e))?;
    
    let mut apps = config.apps;
    for app in &mut apps {
        // If icon_path is not set in config, try to read from the app's moldable.json manifest
        if app.icon_path.is_none() {
            let manifest_path = std::path::Path::new(&app.path).join("moldable.json");
            if manifest_path.exists() {
                if let Ok(manifest_content) = std::fs::read_to_string(&manifest_path) {
                    if let Ok(manifest) = serde_json::from_str::<MoldableManifest>(&manifest_content) {
                        if let Some(icon_path) = manifest.icon_path {
                            // Resolve relative paths to absolute
                            let resolved = if std::path::Path::new(&icon_path).is_absolute() {
                                icon_path
                            } else {
                                std::path::Path::new(&app.path).join(&icon_path).to_string_lossy().to_string()
                            };
                            app.icon_path = Some(resolved);
                        }
                    }
                }
            }
        }
        
    }
    
    Ok(apps)
}

/// Get registered apps for a specific workspace (used during onboarding before workspace is active)
#[tauri::command]
fn get_registered_apps_for_workspace(workspace_id: String) -> Result<Vec<RegisteredApp>, String> {
    let home = std::env::var("HOME").map_err(|_| "Could not get HOME directory")?;
    let config_path = std::path::PathBuf::from(format!(
        "{}/.moldable/workspaces/{}/config.json",
        home, workspace_id
    ));
    
    if !config_path.exists() {
        return Ok(Vec::new());
    }
    
    let content = std::fs::read_to_string(&config_path)
        .map_err(|e| format!("Failed to read config: {}", e))?;
    
    let config: MoldableConfig = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse config: {}", e))?;
    
    Ok(config.apps)
}

#[tauri::command]
fn register_app(app_handle: tauri::AppHandle, app: RegisteredApp) -> Result<Vec<RegisteredApp>, String> {
    let config_path = get_config_file_path()?;
    
    // Ensure directory exists
    if let Some(parent) = config_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create config directory: {}", e))?;
    }
    
    // Load existing config
    let mut config = if config_path.exists() {
        let content = std::fs::read_to_string(&config_path)
            .map_err(|e| format!("Failed to read config: {}", e))?;
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        MoldableConfig::default()
    };

    // Remove existing app with same id if present
    config.apps.retain(|a| a.id != app.id);
    
    // Add the new app
    config.apps.push(app);
    
    // Save config
    let content = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;
    std::fs::write(&config_path, content)
        .map_err(|e| format!("Failed to write config: {}", e))?;
    
    // Emit config-changed event to notify frontend immediately
    // (file watcher has 500ms debounce which can cause delays)
    if let Err(e) = app_handle.emit("config-changed", ()) {
        eprintln!("Failed to emit config-changed event: {}", e);
    }
    
    get_registered_apps()
}

#[tauri::command]
fn unregister_app(app_handle: tauri::AppHandle, app_id: String) -> Result<Vec<RegisteredApp>, String> {
    let config_path = get_config_file_path()?;
    
    if !config_path.exists() {
        return Ok(Vec::new());
    }
    
    let content = std::fs::read_to_string(&config_path)
        .map_err(|e| format!("Failed to read config: {}", e))?;
    
    let mut config: MoldableConfig = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse config: {}", e))?;
    
    config.apps.retain(|a| a.id != app_id);
    
    let content = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;
    std::fs::write(&config_path, content)
        .map_err(|e| format!("Failed to write config: {}", e))?;
    
    // Emit config-changed event to notify frontend immediately
    if let Err(e) = app_handle.emit("config-changed", ()) {
        eprintln!("Failed to emit config-changed event: {}", e);
    }
    
    get_registered_apps()
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Default)]
struct EnvRequirement {
    key: String,
    name: String,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    url: Option<String>,
    #[serde(default)]
    required: bool,
}

#[derive(serde::Serialize, serde::Deserialize, Default)]
struct MoldableManifest {
    name: Option<String>,
    icon: Option<String>,
    #[serde(rename = "iconPath")]
    icon_path: Option<String>,
    description: Option<String>,
    #[serde(rename = "widgetSize")]
    widget_size: Option<String>,
    port: Option<u16>,
    /// If true, app requires this specific port (show kill dialog on conflict)
    #[serde(default, rename = "requiresPort")]
    requires_port: bool,
    command: Option<String>,
    args: Option<Vec<String>>,
    #[serde(default)]
    env: Vec<EnvRequirement>,
}

#[tauri::command]
fn detect_app_in_folder(path: String) -> Result<Option<RegisteredApp>, String> {
    use std::path::Path;
    
    let folder = Path::new(&path);
    
    if !folder.exists() || !folder.is_dir() {
        return Ok(None);
    }
    
    // Try to read moldable.json manifest first
    let manifest_path = folder.join("moldable.json");
    let manifest: MoldableManifest = if manifest_path.exists() {
        let content = std::fs::read_to_string(&manifest_path)
            .map_err(|e| format!("Failed to read moldable.json: {}", e))?;
        serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse moldable.json: {}", e))?
    } else {
        MoldableManifest::default()
    };
    
    // Check for package.json (Node.js app)
    let package_json = folder.join("package.json");
    if package_json.exists() {
        let content = std::fs::read_to_string(&package_json)
            .map_err(|e| format!("Failed to read package.json: {}", e))?;
        
        if let Ok(pkg) = serde_json::from_str::<serde_json::Value>(&content) {
            // Get name from manifest, then package.json, then folder name
            let pkg_name = pkg.get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown");
            
            let name = manifest.name
                .unwrap_or_else(|| pkg_name.to_string());
            
            // Generate a simple id from the folder name
            let id = folder.file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("app")
                .to_lowercase()
                .replace(' ', "-");
            
            // Check if it has a dev script
            let has_dev = pkg.get("scripts")
                .and_then(|s| s.get("dev"))
                .is_some();
            
            if has_dev {
                // Use manifest port or find an available one
                // Start at 4100 to avoid conflicts with common dev server ports (3000-3100)
                let port = manifest.port.unwrap_or_else(|| find_available_port(4100));
                
                // Use manifest command or find pnpm
                let command = manifest.command
                    .unwrap_or_else(find_pnpm_path);
                
                // Use manifest args or default dev args
                // Don't include -p <port> here - it's added at runtime by start_app
                // This allows dynamic port selection when starting
                let args = manifest.args
                    .unwrap_or_else(|| vec!["dev".to_string()]);
                
                // Use manifest icon or default
                let icon = manifest.icon.unwrap_or_else(|| "📦".to_string());
                let icon_path = manifest.icon_path.map(|p| {
                    if std::path::Path::new(&p).is_absolute() {
                        p
                    } else {
                        folder.join(p).to_string_lossy().to_string()
                    }
                });
                
                // Use manifest widget_size or default
                let widget_size = manifest.widget_size.unwrap_or_else(|| "medium".to_string());
                
                return Ok(Some(RegisteredApp {
                    id,
                    name,
                    icon,
                    icon_path,
                    port,
                    path: path.clone(),
                    command,
                    args,
                    widget_size,
                    requires_port: manifest.requires_port,
                }));
            }
        }
    }
    
    Ok(None)
}

fn find_available_port(start: u16) -> u16 {
    let config_path = get_config_file_path().ok();
    let used_ports: Vec<u16> = config_path
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|c| serde_json::from_str::<MoldableConfig>(&c).ok())
        .map(|c| c.apps.iter().map(|a| a.port).collect())
        .unwrap_or_default();
    
    let mut port: u32 = start as u32;
    while port <= u16::MAX as u32 {
        let candidate = port as u16;
        if !used_ports.contains(&candidate) {
            return candidate;
        }
        port += 1;
    }
    start
}

fn find_pnpm_path() -> String {
    // Check common pnpm locations
    let paths = [
        "/opt/homebrew/bin/pnpm",      // macOS ARM (Homebrew)
        "/usr/local/bin/pnpm",          // macOS Intel (Homebrew)
        "/usr/bin/pnpm",                // Linux system
        "/home/linuxbrew/.linuxbrew/bin/pnpm", // Linux Homebrew
    ];
    
    for path in paths {
        if std::path::Path::new(path).exists() {
            return path.to_string();
        }
    }
    
    // Try to find via `which` command
    if let Ok(output) = std::process::Command::new("which").arg("pnpm").output() {
        if output.status.success() {
            if let Ok(path) = String::from_utf8(output.stdout) {
                let path = path.trim();
                if !path.is_empty() {
                    return path.to_string();
                }
            }
        }
    }
    
    // Fallback to just "pnpm" and hope it's in PATH
    "pnpm".to_string()
}

fn find_node_path() -> Option<String> {
    // Check for NVM installation (most common for devs)
    if let Ok(home) = std::env::var("HOME") {
        // Check NVM default
        let nvm_default = format!("{}/.nvm/versions/node", home);
        if let Ok(entries) = std::fs::read_dir(&nvm_default) {
            // Find the latest version (or any version)
            let mut versions: Vec<_> = entries
                .filter_map(|e| e.ok())
                .filter(|e| e.path().is_dir())
                .collect();
            // Sort by name to get latest version
            versions.sort_by(|a, b| b.file_name().cmp(&a.file_name()));
            
            if let Some(version_dir) = versions.first() {
                let bin_dir = version_dir.path().join("bin");
                if bin_dir.join("node").exists() {
                    return Some(bin_dir.to_string_lossy().to_string());
                }
            }
        }
        
        // Check for fnm (another node version manager)
        let fnm_path = format!("{}/.local/share/fnm/aliases/default/bin", home);
        if std::path::Path::new(&fnm_path).join("node").exists() {
            return Some(fnm_path);
        }
    }
    
    // Check common system locations
    let system_paths = [
        "/opt/homebrew/bin",
        "/usr/local/bin",
        "/usr/bin",
    ];
    
    for path in system_paths {
        if std::path::Path::new(path).join("node").exists() {
            return Some(path.to_string());
        }
    }
    
    // Try to find via shell (this will use the user's shell config)
    if let Ok(output) = std::process::Command::new("/bin/bash")
        .args(["-l", "-c", "which node"])
        .output() 
    {
        if output.status.success() {
            if let Ok(path) = String::from_utf8(output.stdout) {
                let path = path.trim();
                if !path.is_empty() {
                    // Return the directory containing node
                    if let Some(parent) = std::path::Path::new(path).parent() {
                        return Some(parent.to_string_lossy().to_string());
                    }
                }
            }
        }
    }
    
    None
}

// Get the .env file path (workspace-aware with layered resolution)
fn get_env_file_path() -> Result<std::path::PathBuf, String> {
    let workspaces_config = get_workspaces_config_internal()?;
    let home = std::env::var("HOME").map_err(|_| "Could not get HOME directory")?;
    Ok(std::path::PathBuf::from(format!(
        "{}/.moldable/workspaces/{}/.env",
        home, workspaces_config.active_workspace
    )))
}

// Get the shared .env file path
fn get_shared_env_file_path() -> Result<std::path::PathBuf, String> {
    let home = std::env::var("HOME").map_err(|_| "Could not get HOME directory")?;
    Ok(std::path::PathBuf::from(format!("{}/.moldable/shared/.env", home)))
}

// Get merged env vars (shared + workspace-specific overrides)
fn get_merged_env_vars() -> HashMap<String, String> {
    let mut env = HashMap::new();
    
    // Load shared env first
    if let Ok(shared_path) = get_shared_env_file_path() {
        let shared_env = parse_env_file(&shared_path);
        env.extend(shared_env);
    }
    
    // Load workspace-specific env (overrides shared)
    if let Ok(workspace_path) = get_env_file_path() {
        let workspace_env = parse_env_file(&workspace_path);
        env.extend(workspace_env);
    }
    
    env
}

// Parse a .env file into a HashMap
fn parse_env_file(path: &std::path::Path) -> HashMap<String, String> {
    let mut env = HashMap::new();
    
    if let Ok(content) = std::fs::read_to_string(path) {
        for line in content.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with('#') {
                continue;
            }
            if let Some(eq_idx) = trimmed.find('=') {
                let key = trimmed[..eq_idx].trim().to_string();
                let value = trimmed[eq_idx + 1..].trim().to_string();
                if !value.is_empty() {
                    env.insert(key, value);
                }
            }
        }
    }
    
    env
}

// Write env vars to .env file, preserving comments and structure
fn write_env_var(key: &str, value: &str) -> Result<(), String> {
    let env_path = get_env_file_path()?;
    
    // Ensure directory exists
    if let Some(parent) = env_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create config directory: {}", e))?;
    }
    
    // Read existing content
    let content = std::fs::read_to_string(&env_path).unwrap_or_default();
    let mut lines: Vec<String> = content.lines().map(|s| s.to_string()).collect();
    
    // Find and replace existing key, or add new one
    let key_prefix = format!("{}=", key);
    let mut found = false;
    
    for line in &mut lines {
        if line.starts_with(&key_prefix) || line.starts_with(&format!("# {}=", key)) {
            *line = format!("{}={}", key, value);
            found = true;
            break;
        }
    }
    
    if !found {
        // Add to end
        if !lines.is_empty() && !lines.last().map(|l| l.is_empty()).unwrap_or(true) {
            lines.push(String::new());
        }
        lines.push(format!("{}={}", key, value));
    }
    
    std::fs::write(&env_path, lines.join("\n"))
        .map_err(|e| format!("Failed to write .env: {}", e))?;
    
    Ok(())
}

#[derive(serde::Serialize)]
struct AppEnvStatus {
    requirements: Vec<EnvRequirement>,
    missing: Vec<String>,
    present: Vec<String>,
}

#[tauri::command]
fn get_app_env_requirements(app_path: String) -> Result<AppEnvStatus, String> {
    let manifest_path = std::path::Path::new(&app_path).join("moldable.json");
    
    let manifest: MoldableManifest = if manifest_path.exists() {
        let content = std::fs::read_to_string(&manifest_path)
            .map_err(|e| format!("Failed to read moldable.json: {}", e))?;
        serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse moldable.json: {}", e))?
    } else {
        return Ok(AppEnvStatus {
            requirements: Vec::new(),
            missing: Vec::new(),
            present: Vec::new(),
        });
    };
    
    // Use merged env vars (shared + workspace-specific) to check requirements
    let current_env = get_merged_env_vars();
    
    let mut missing = Vec::new();
    let mut present = Vec::new();
    
    for req in &manifest.env {
        if current_env.contains_key(&req.key) {
            present.push(req.key.clone());
        } else if req.required {
            missing.push(req.key.clone());
        }
    }
    
    Ok(AppEnvStatus {
        requirements: manifest.env,
        missing,
        present,
    })
}

#[tauri::command]
fn set_app_env_var(key: String, value: String) -> Result<(), String> {
    write_env_var(&key, &value)
}

#[tauri::command]
fn get_all_env_vars() -> Result<HashMap<String, String>, String> {
    let env_path = get_env_file_path()?;
    Ok(parse_env_file(&env_path))
}

/// Save an API key to the shared .env file (for onboarding)
/// Auto-detects the key type based on prefix and saves with the appropriate env var name
#[tauri::command]
fn save_api_key(api_key: String) -> Result<String, String> {
    let api_key = api_key.trim();
    
    if api_key.is_empty() {
        return Err("API key cannot be empty".to_string());
    }
    
    // Auto-detect key type based on prefix
    let (env_var_name, provider_name) = if api_key.starts_with("sk-or-") {
        ("OPENROUTER_API_KEY", "OpenRouter")
    } else if api_key.starts_with("sk-ant-") {
        ("ANTHROPIC_API_KEY", "Anthropic")
    } else if api_key.starts_with("sk-proj-") || api_key.starts_with("sk-") {
        ("OPENAI_API_KEY", "OpenAI")
    } else {
        // Default to OpenRouter for unrecognized keys (most flexible)
        ("OPENROUTER_API_KEY", "OpenRouter")
    };
    
    // Write to shared .env file
    let env_path = get_shared_env_file_path()?;
    
    // Ensure directory exists
    if let Some(parent) = env_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create config directory: {}", e))?;
    }
    
    // Read existing content
    let content = std::fs::read_to_string(&env_path).unwrap_or_default();
    let mut lines: Vec<String> = content.lines().map(|s| s.to_string()).collect();
    
    // Find and replace existing key, or add new one
    let key_prefix = format!("{}=", env_var_name);
    let mut found = false;
    
    for line in &mut lines {
        if line.starts_with(&key_prefix) || line.starts_with(&format!("# {}=", env_var_name)) {
            *line = format!("{}={}", env_var_name, api_key);
            found = true;
            break;
        }
    }
    
    if !found {
        // Add header comment if file is empty
        if lines.is_empty() || (lines.len() == 1 && lines[0].is_empty()) {
            lines = vec![
                "# Moldable Configuration".to_string(),
                "# API keys for LLM providers".to_string(),
                String::new(),
            ];
        } else if !lines.last().map(|l| l.is_empty()).unwrap_or(true) {
            lines.push(String::new());
        }
        lines.push(format!("{}={}", env_var_name, api_key));
    }
    
    // Write and sync to ensure data is flushed to disk before returning
    // This prevents race conditions where the AI server reads stale data
    let file = std::fs::File::create(&env_path)
        .map_err(|e| format!("Failed to create .env: {}", e))?;
    use std::io::Write;
    let mut writer = std::io::BufWriter::new(file);
    writer.write_all(lines.join("\n").as_bytes())
        .map_err(|e| format!("Failed to write .env: {}", e))?;
    writer.flush()
        .map_err(|e| format!("Failed to flush .env: {}", e))?;
    writer.get_ref().sync_all()
        .map_err(|e| format!("Failed to sync .env: {}", e))?;
    
    Ok(provider_name.to_string())
}

/// Get a preference value from config
#[tauri::command]
fn get_preference(key: String) -> Result<Option<serde_json::Value>, String> {
    let config_path = get_config_file_path()?;
    
    if !config_path.exists() {
        return Ok(None);
    }
    
    let content = std::fs::read_to_string(&config_path)
        .map_err(|e| format!("Failed to read config: {}", e))?;
    
    let config: MoldableConfig = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse config: {}", e))?;
    
    Ok(config.preferences.get(&key).cloned())
}

/// Set a preference value in config
#[tauri::command]
fn set_preference(key: String, value: serde_json::Value) -> Result<(), String> {
    let config_path = get_config_file_path()?;
    
    // Ensure directory exists
    if let Some(parent) = config_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create config directory: {}", e))?;
    }
    
    // Load existing config
    let mut config = if config_path.exists() {
        let content = std::fs::read_to_string(&config_path)
            .map_err(|e| format!("Failed to read config: {}", e))?;
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        MoldableConfig::default()
    };
    
    // Update preference
    config.preferences.insert(key, value);
    
    // Save config
    let content = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;
    std::fs::write(&config_path, content)
        .map_err(|e| format!("Failed to write config: {}", e))?;
    
    Ok(())
}

/// Get all preferences from config
#[tauri::command]
fn get_all_preferences() -> Result<serde_json::Map<String, serde_json::Value>, String> {
    let config_path = get_config_file_path()?;
    
    if !config_path.exists() {
        return Ok(serde_json::Map::new());
    }
    
    let content = std::fs::read_to_string(&config_path)
        .map_err(|e| format!("Failed to read config: {}", e))?;
    
    let config: MoldableConfig = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse config: {}", e))?;
    
    Ok(config.preferences)
}

/// Available app info for installation
#[derive(serde::Serialize, Clone)]
struct AvailableApp {
    id: String,
    name: String,
    icon: String,
    icon_path: Option<String>,
    description: Option<String>,
    path: String,
    widget_size: String,
}

/// List available apps from the workspace apps/ folder
#[tauri::command]
fn list_available_apps() -> Result<Vec<AvailableApp>, String> {
    // Get workspace path from config
    let config_path = get_config_file_path()?;
    
    let workspace_path = if config_path.exists() {
        let content = std::fs::read_to_string(&config_path)
            .map_err(|e| format!("Failed to read config: {}", e))?;
        let config: MoldableConfig = serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse config: {}", e))?;
        config.workspace
    } else {
        None
    };
    
    // Try configured workspace path first, then fallback to common development locations
    let workspace = workspace_path.or_else(|| {
        // Check common development workspace locations
        let home = std::env::var("HOME").ok()?;
        let candidates = [
            format!("{}/moldable", home),
            format!("{}/code/moldable", home),
            format!("{}/dev/moldable", home),
            format!("{}/projects/moldable", home),
        ];
        
        for candidate in candidates {
            let apps_dir = std::path::Path::new(&candidate).join("apps");
            if apps_dir.exists() && apps_dir.is_dir() {
                return Some(candidate);
            }
        }
        None
    });
    
    let workspace = match workspace {
        Some(p) => p,
        None => return Ok(Vec::new()), // No workspace found
    };
    
    let apps_dir = std::path::Path::new(&workspace).join("apps");
    if !apps_dir.exists() || !apps_dir.is_dir() {
        return Ok(Vec::new());
    }
    
    // Get already registered app paths to filter them out
    let registered_apps = get_registered_apps().unwrap_or_default();
    let registered_paths: std::collections::HashSet<String> = registered_apps
        .iter()
        .map(|a| a.path.clone())
        .collect();
    
    let mut available = Vec::new();
    
    if let Ok(entries) = std::fs::read_dir(&apps_dir) {
        for entry in entries.flatten() {
            let app_path = entry.path();
            if !app_path.is_dir() {
                continue;
            }
            
            let app_path_str = app_path.to_string_lossy().to_string();
            
            // Skip if already registered
            if registered_paths.contains(&app_path_str) {
                continue;
            }
            
            let manifest_path = app_path.join("moldable.json");
            if !manifest_path.exists() {
                continue;
            }
            
            // Read the manifest
            if let Ok(content) = std::fs::read_to_string(&manifest_path) {
                if let Ok(manifest) = serde_json::from_str::<MoldableManifest>(&content) {
                    let folder_name = app_path
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or("app")
                        .to_string();
                    
                    let icon_path = manifest.icon_path.map(|p| {
                        if std::path::Path::new(&p).is_absolute() {
                            p
                        } else {
                            app_path.join(p).to_string_lossy().to_string()
                        }
                    });
                    
                    available.push(AvailableApp {
                        id: folder_name.clone(),
                        name: manifest.name.unwrap_or(folder_name),
                        icon: manifest.icon.unwrap_or_else(|| "📦".to_string()),
                        icon_path,
                        description: manifest.description,
                        path: app_path_str,
                        widget_size: manifest.widget_size.unwrap_or_else(|| "medium".to_string()),
                    });
                }
            }
        }
    }
    
    // Sort by name
    available.sort_by(|a, b| a.name.cmp(&b.name));
    
    Ok(available)
}

/// Install an available app by path (register it in config)
#[tauri::command]
fn install_available_app(app_handle: tauri::AppHandle, path: String) -> Result<RegisteredApp, String> {
    // Detect the app
    let detected = detect_app_in_folder(path.clone())?
        .ok_or_else(|| "Could not detect app in folder".to_string())?;
    
    // Register it
    register_app(app_handle, detected.clone())?;
    
    Ok(detected)
}

// ==================== APP REGISTRY (GitHub) ====================

/// Entry for an app in the remote registry manifest
#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct AppRegistryEntry {
    id: String,
    name: String,
    version: String,
    description: Option<String>,
    icon: String,
    icon_url: Option<String>,
    widget_size: String,
    category: Option<String>,
    tags: Option<Vec<String>>,
    path: String,
    required_env: Option<Vec<String>>,
    moldable_dependencies: Option<std::collections::HashMap<String, String>>,
    /// Commit SHA to install from
    commit: String,
}

/// Category in the registry
#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
struct Category {
    id: String,
    name: String,
    icon: String,
}

/// The full app registry manifest from GitHub
#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct AppRegistry {
    #[serde(rename = "$schema")]
    schema: Option<String>,
    version: String,
    generated_at: Option<String>,
    registry: String,
    apps: Vec<AppRegistryEntry>,
    categories: Option<Vec<Category>>,
}

/// Get the shared apps directory path
fn get_shared_apps_dir() -> Result<std::path::PathBuf, String> {
    let home = std::env::var("HOME").map_err(|_| "Could not get HOME directory")?;
    Ok(std::path::PathBuf::from(format!("{}/.moldable/shared/apps", home)))
}

/// Get the cache directory for registry manifest
fn get_cache_dir() -> Result<std::path::PathBuf, String> {
    let home = std::env::var("HOME").map_err(|_| "Could not get HOME directory")?;
    Ok(std::path::PathBuf::from(format!("{}/.moldable/cache", home)))
}

/// Fetch the app registry manifest from GitHub (cached for 1 hour)
#[tauri::command]
async fn fetch_app_registry(force_refresh: Option<bool>) -> Result<AppRegistry, String> {
    let cache_dir = get_cache_dir()?;
    let cache_path = cache_dir.join("app-registry.json");
    let force = force_refresh.unwrap_or(false);
    
    // Check cache first (valid for 1 hour) unless force refresh
    if !force && cache_path.exists() {
        if let Ok(metadata) = std::fs::metadata(&cache_path) {
            if let Ok(modified) = metadata.modified() {
                if let Ok(age) = std::time::SystemTime::now().duration_since(modified) {
                    if age < std::time::Duration::from_secs(3600) {
                        // Cache is fresh, use it
                        if let Ok(content) = std::fs::read_to_string(&cache_path) {
                            if let Ok(registry) = serde_json::from_str::<AppRegistry>(&content) {
                                return Ok(registry);
                            }
                        }
                    }
                }
            }
        }
    }
    
    // Fetch from GitHub
    let manifest_url = "https://raw.githubusercontent.com/moldable-ai/apps/main/manifest.json";
    
    let response = reqwest::get(manifest_url)
        .await
        .map_err(|e| format!("Failed to fetch registry: {}", e))?;
    
    if !response.status().is_success() {
        return Err(format!("Failed to fetch registry: HTTP {}", response.status()));
    }
    
    let registry: AppRegistry = response.json()
        .await
        .map_err(|e| format!("Failed to parse registry: {}", e))?;
    
    // Cache the result
    if let Err(e) = std::fs::create_dir_all(&cache_dir) {
        eprintln!("Warning: Failed to create cache dir: {}", e);
    } else if let Ok(content) = serde_json::to_string_pretty(&registry) {
        if let Err(e) = std::fs::write(&cache_path, content) {
            eprintln!("Warning: Failed to cache registry: {}", e);
        }
    }
    
    Ok(registry)
}

/// Install an app from the registry (download from GitHub)
#[tauri::command]
async fn install_app_from_registry(
    app_handle: tauri::AppHandle,
    app_id: String,
    app_path: String,
    commit: String,
    version: String,
) -> Result<RegisteredApp, String> {
    use std::io::{Read, Write};

    let shared_apps_dir = get_shared_apps_dir()?;
    let app_dir = shared_apps_dir.join(&app_id);

    // Check if already registered in the current workspace
    let config_path = get_config_file_path()?;
    let current_apps: Vec<RegisteredApp> = if config_path.exists() {
        let content = std::fs::read_to_string(&config_path)
            .map_err(|e| format!("Failed to read config: {}", e))?;
        let config: MoldableConfig = serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse config: {}", e))?;
        config.apps
    } else {
        Vec::new()
    };
    
    if current_apps.iter().any(|a| a.id == app_id) {
        return Err(format!("App '{}' is already installed in this workspace", app_id));
    }
    
    // If app code already exists in shared/apps (installed for another workspace),
    // just register it in this workspace without re-downloading
    if app_dir.exists() {
        println!("📦 App '{}' already downloaded, registering in workspace...", app_id);
        
        let app_dir_str = app_dir.to_string_lossy().to_string();
        let detected = detect_app_in_folder(app_dir_str)?
            .ok_or_else(|| "Failed to detect app".to_string())?;
        
        register_app(app_handle.clone(), detected.clone())?;
        
        println!("✅ Registered {} in workspace!", app_id);
        
        return Ok(detected);
    }
    
    println!("📦 Installing {} from moldable-ai/apps...", app_id);
    
    // Download the repo archive for the specific commit
    let archive_url = format!(
        "https://github.com/moldable-ai/apps/archive/{}.zip",
        commit
    );
    
    println!("  Downloading from {}...", archive_url);
    
    let response = reqwest::get(&archive_url)
        .await
        .map_err(|e| format!("Failed to download: {}", e))?;
    
    if !response.status().is_success() {
        return Err(format!("Failed to download: HTTP {}", response.status()));
    }
    
    let bytes = response.bytes()
        .await
        .map_err(|e| format!("Failed to read response: {}", e))?;
    
    println!("  Downloaded {} bytes, extracting...", bytes.len());
    
    // Create a temporary directory for extraction
    let temp_dir = std::env::temp_dir().join(format!("moldable-app-{}", app_id));
    if temp_dir.exists() {
        std::fs::remove_dir_all(&temp_dir)
            .map_err(|e| format!("Failed to clean temp dir: {}", e))?;
    }
    std::fs::create_dir_all(&temp_dir)
        .map_err(|e| format!("Failed to create temp dir: {}", e))?;
    
    // Extract the zip
    let cursor = std::io::Cursor::new(bytes.as_ref());
    let mut archive = zip::ZipArchive::new(cursor)
        .map_err(|e| format!("Failed to open zip: {}", e))?;
    
    // The archive structure is: apps-{commit}/{app_path}/...
    // We need to find the prefix that contains our app
    let short_commit = if commit.len() > 7 { &commit[..7] } else { &commit };
    let possible_prefixes = vec![
        format!("apps-{}/{}/", commit, app_path),
        format!("apps-{}/{}/", short_commit, app_path),
        format!("moldable-apps-{}/{}/", commit, app_path),
        format!("moldable-apps-{}/{}/", short_commit, app_path),
    ];
    
    // Find which prefix is used in this archive
    let mut actual_prefix: Option<String> = None;
    for i in 0..archive.len() {
        if let Ok(file) = archive.by_index(i) {
            let name = file.name();
            for prefix in &possible_prefixes {
                if name.starts_with(prefix) {
                    actual_prefix = Some(prefix.clone());
                    break;
                }
            }
            if actual_prefix.is_some() {
                break;
            }
        }
    }
    
    let prefix = actual_prefix.ok_or_else(|| {
        format!("Could not find app '{}' in archive (tried prefixes: {:?})", app_path, possible_prefixes)
    })?;
    
    println!("  Found app at prefix: {}", prefix);
    
    // Ensure the shared apps directory exists
    std::fs::create_dir_all(&shared_apps_dir)
        .map_err(|e| format!("Failed to create shared apps dir: {}", e))?;
    
    // Extract just the app folder
    let mut extracted_count = 0;
    for i in 0..archive.len() {
        let mut file = archive.by_index(i)
            .map_err(|e| format!("Failed to read archive entry: {}", e))?;
        
        let file_name = file.name().to_string();
        
        if !file_name.starts_with(&prefix) {
            continue;
        }
        
        // Get the relative path within the app
        let relative_path = &file_name[prefix.len()..];
        if relative_path.is_empty() {
            continue;
        }
        
        let dest_path = app_dir.join(relative_path);
        
        if file.is_dir() {
            std::fs::create_dir_all(&dest_path)
                .map_err(|e| format!("Failed to create dir {:?}: {}", dest_path, e))?;
        } else {
            // Ensure parent directory exists
            if let Some(parent) = dest_path.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("Failed to create parent dir: {}", e))?;
            }
            
            let mut content = Vec::new();
            file.read_to_end(&mut content)
                .map_err(|e| format!("Failed to read file: {}", e))?;
            
            let mut dest_file = std::fs::File::create(&dest_path)
                .map_err(|e| format!("Failed to create file {:?}: {}", dest_path, e))?;
            dest_file.write_all(&content)
                .map_err(|e| format!("Failed to write file: {}", e))?;
            
            extracted_count += 1;
        }
    }
    
    println!("  Extracted {} files", extracted_count);
    
    // Clean up temp dir
    let _ = std::fs::remove_dir_all(&temp_dir);
    
    // Update moldable.json with upstream info
    let moldable_json_path = app_dir.join("moldable.json");
    if moldable_json_path.exists() {
        let content = std::fs::read_to_string(&moldable_json_path)
            .map_err(|e| format!("Failed to read moldable.json: {}", e))?;
        
        let mut manifest: serde_json::Value = serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse moldable.json: {}", e))?;
        
        // Add upstream tracking info
        manifest["upstream"] = serde_json::json!({
            "repo": "moldable-ai/apps",
            "path": app_path,
            "installedVersion": version,
            "installedCommit": commit,
            "installedAt": chrono::Utc::now().to_rfc3339()
        });
        manifest["modified"] = serde_json::json!(false);
        
        let updated_content = serde_json::to_string_pretty(&manifest)
            .map_err(|e| format!("Failed to serialize moldable.json: {}", e))?;
        
        std::fs::write(&moldable_json_path, updated_content)
            .map_err(|e| format!("Failed to write moldable.json: {}", e))?;
    }
    
    println!("  Running pnpm install...");
    
    // Run pnpm install
    let pnpm_path = find_pnpm_path();
    let install_output = std::process::Command::new(&pnpm_path)
        .arg("install")
        .current_dir(&app_dir)
        .output()
        .map_err(|e| format!("Failed to run pnpm install: {}", e))?;
    
    if !install_output.status.success() {
        let stderr = String::from_utf8_lossy(&install_output.stderr);
        eprintln!("pnpm install stderr: {}", stderr);
        // Don't fail - the app might still work or user can fix it
        println!("  Warning: pnpm install had issues, but continuing...");
    } else {
        println!("  pnpm install completed");
    }
    
    // Detect and register the app
    let app_dir_str = app_dir.to_string_lossy().to_string();
    let detected = detect_app_in_folder(app_dir_str.clone())?
        .ok_or_else(|| "Failed to detect installed app".to_string())?;
    
    register_app(app_handle, detected.clone())?;
    
    println!("✅ Installed {} successfully!", app_id);
    
    Ok(detected)
}

/// Uninstall an app from the shared directory
#[tauri::command]
fn uninstall_app_from_shared(app_handle: tauri::AppHandle, app_id: String) -> Result<(), String> {
    let shared_apps_dir = get_shared_apps_dir()?;
    let app_dir = shared_apps_dir.join(&app_id);
    
    if !app_dir.exists() {
        return Err(format!("App '{}' is not installed in shared directory", app_id));
    }
    
    // First unregister from config
    let _ = unregister_app(app_handle, app_id.clone());
    
    // Then remove the directory
    std::fs::remove_dir_all(&app_dir)
        .map_err(|e| format!("Failed to remove app directory: {}", e))?;
    
    println!("🗑️  Uninstalled {} from shared apps", app_id);
    
    Ok(())
}

// ==================== END APP REGISTRY ====================

#[tauri::command]
fn get_workspace_path() -> Result<Option<String>, String> {
    let config_path = get_config_file_path()?;
    
    if !config_path.exists() {
        return Ok(None);
    }
    
    let content = std::fs::read_to_string(&config_path)
        .map_err(|e| format!("Failed to read config: {}", e))?;
    
    let config: MoldableConfig = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse config: {}", e))?;
    
    Ok(config.workspace)
}

#[tauri::command]
fn set_workspace_path(path: Option<String>) -> Result<(), String> {
    let config_path = get_config_file_path()?;
    
    // Ensure directory exists
    if let Some(parent) = config_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create config directory: {}", e))?;
    }
    
    // Load existing config
    let mut config = if config_path.exists() {
        let content = std::fs::read_to_string(&config_path)
            .map_err(|e| format!("Failed to read config: {}", e))?;
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        MoldableConfig::default()
    };
    
    config.workspace = path;
    
    // Save config
    let content = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;
    std::fs::write(&config_path, content)
        .map_err(|e| format!("Failed to write config: {}", e))?;
    
    Ok(())
}

// ==================== CONVERSATIONS ====================

/// Conversation metadata for listing
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConversationMeta {
    id: String,
    title: String,
    created_at: String,
    updated_at: String,
    message_count: usize,
}

/// Get the conversations directory path (workspace-aware)
fn get_conversations_dir() -> Result<std::path::PathBuf, String> {
    let workspaces_config = get_workspaces_config_internal()?;
    let home = std::env::var("HOME").map_err(|_| "Could not get HOME directory")?;
    Ok(std::path::PathBuf::from(home)
        .join(".moldable")
        .join("workspaces")
        .join(&workspaces_config.active_workspace)
        .join("conversations"))
}

/// List all conversations (metadata only)
#[tauri::command]
fn list_conversations() -> Result<Vec<ConversationMeta>, String> {
    let dir = get_conversations_dir()?;
    
    if !dir.exists() {
        return Ok(vec![]);
    }
    
    let mut conversations: Vec<ConversationMeta> = vec![];
    
    let entries = std::fs::read_dir(&dir)
        .map_err(|e| format!("Failed to read conversations dir: {}", e))?;
    
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().is_some_and(|e| e == "json") {
            if let Ok(content) = std::fs::read_to_string(&path) {
                if let Ok(meta) = serde_json::from_str::<ConversationMeta>(&content) {
                    conversations.push(meta);
                }
            }
        }
    }
    
    // Sort by updated_at descending (newest first)
    conversations.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    
    Ok(conversations)
}

/// Load a specific conversation by ID
#[tauri::command]
fn load_conversation(id: String) -> Result<Option<serde_json::Value>, String> {
    let dir = get_conversations_dir()?;
    let file_path = dir.join(format!("{}.json", id));
    
    if !file_path.exists() {
        return Ok(None);
    }
    
    let content = std::fs::read_to_string(&file_path)
        .map_err(|e| format!("Failed to read conversation: {}", e))?;
    
    let conversation: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse conversation: {}", e))?;
    
    Ok(Some(conversation))
}

/// Save a conversation
#[tauri::command]
fn save_conversation(conversation: serde_json::Value) -> Result<(), String> {
    let dir = get_conversations_dir()?;
    
    // Ensure directory exists
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create conversations dir: {}", e))?;
    
    let id = conversation.get("id")
        .and_then(|v| v.as_str())
        .ok_or("Conversation must have an id")?;
    
    let file_path = dir.join(format!("{}.json", id));
    
    let content = serde_json::to_string_pretty(&conversation)
        .map_err(|e| format!("Failed to serialize conversation: {}", e))?;
    
    std::fs::write(&file_path, content)
        .map_err(|e| format!("Failed to write conversation: {}", e))?;
    
    Ok(())
}

/// Delete a conversation
#[tauri::command]
fn delete_conversation(id: String) -> Result<(), String> {
    let dir = get_conversations_dir()?;
    let file_path = dir.join(format!("{}.json", id));
    
    if file_path.exists() {
        std::fs::remove_file(&file_path)
            .map_err(|e| format!("Failed to delete conversation: {}", e))?;
    }
    
    Ok(())
}

// Start the AI server sidecar
fn start_ai_server(app: &AppHandle, ai_server_state: Arc<Mutex<Option<CommandChild>>>) -> Result<(), Box<dyn std::error::Error>> {
    let shell = app.shell();
    
    // Get the sidecar command
    let sidecar = shell.sidecar("moldable-ai-server")?;
    
    // Spawn the sidecar
    let (mut rx, child) = sidecar.spawn()?;
    
    // Store the child handle for cleanup on exit
    if let Ok(mut state) = ai_server_state.lock() {
        *state = Some(child);
    }
    
    // Log output in background thread
    std::thread::spawn(move || {
        while let Some(event) = rx.blocking_recv() {
            match event {
                tauri_plugin_shell::process::CommandEvent::Stdout(line) => {
                    println!("[AI Server] {}", String::from_utf8_lossy(&line));
                }
                tauri_plugin_shell::process::CommandEvent::Stderr(line) => {
                    eprintln!("[AI Server] {}", String::from_utf8_lossy(&line));
                }
                tauri_plugin_shell::process::CommandEvent::Terminated(status) => {
                    println!("[AI Server] Terminated with status: {:?}", status);
                    break;
                }
                _ => {}
            }
        }
    });
    
    println!("🚀 AI Server sidecar started");
    Ok(())
}

/// Kill all running app processes
fn cleanup_all_apps(state: &AppState) {
    if let Ok(mut app_state) = state.0.lock() {
        let app_ids: Vec<String> = app_state.processes.keys().cloned().collect();
        for app_id in app_ids {
            if let Some(mut app_proc) = app_state.processes.remove(&app_id) {
                println!("🛑 Stopping {}...", app_id);
                let pid = app_proc.child.id();
                // Kill the entire process tree
                kill_process_tree(pid);
                let _ = app_proc.child.wait();
            }
        }
        println!("✅ All apps stopped");
    }
}

/// Kill the AI server sidecar
fn cleanup_ai_server(state: &Arc<Mutex<Option<CommandChild>>>) {
    if let Ok(mut ai_server) = state.lock() {
        if let Some(child) = ai_server.take() {
            println!("🛑 Stopping AI server...");
            let _ = child.kill();
            println!("✅ AI server stopped");
        }
    }
}

// ==================== AUDIO CAPTURE ====================

/// State for the audio capture sidecar
struct AudioCaptureState(Arc<Mutex<Option<CommandChild>>>);

/// Check if system audio capture is available (macOS 14.2+)
#[tauri::command]
fn is_system_audio_available() -> bool {
    // Check macOS version - Audio Taps requires 14.2+
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        if let Ok(output) = Command::new("sw_vers").arg("-productVersion").output() {
            if let Ok(version) = String::from_utf8(output.stdout) {
                let parts: Vec<&str> = version.trim().split('.').collect();
                if parts.len() >= 2 {
                    if let (Ok(major), Ok(minor)) = (parts[0].parse::<u32>(), parts[1].parse::<u32>()) {
                        return major > 14 || (major == 14 && minor >= 2);
                    }
                }
            }
        }
        false
    }
    #[cfg(not(target_os = "macos"))]
    {
        false // System audio capture not yet implemented for other platforms
    }
}

/// Start system audio capture
/// mode: 0 = microphone, 1 = system audio, 2 = both
#[tauri::command]
async fn start_audio_capture(
    app: AppHandle,
    mode: u32,
    sample_rate: u32,
    channels: u32,
    state: State<'_, AudioCaptureState>,
) -> Result<bool, String> {
    // Check if already running
    {
        let capture_state = state.0.lock().map_err(|e| e.to_string())?;
        if capture_state.is_some() {
            return Err("Audio capture already running".to_string());
        }
    }
    
    let shell = app.shell();
    
    // Get the sidecar command
    let sidecar = shell.sidecar("moldable-audio-capture")
        .map_err(|e| format!("Failed to get audio capture sidecar: {}", e))?;
    
    // Spawn the sidecar
    let (mut rx, child) = sidecar.spawn()
        .map_err(|e| format!("Failed to spawn audio capture: {}", e))?;
    
    // Store the child handle
    {
        let mut capture_state = state.0.lock().map_err(|e| e.to_string())?;
        *capture_state = Some(child);
    }
    
    // Clone state for the async task
    let state_clone = state.0.clone();
    let app_handle = app.clone();
    
    // Handle output in background task
    tokio::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                tauri_plugin_shell::process::CommandEvent::Stdout(line) => {
                    let line_str = String::from_utf8_lossy(&line);
                    
                    // Parse JSON message from sidecar
                    if let Ok(msg) = serde_json::from_str::<serde_json::Value>(&line_str) {
                        match msg.get("type").and_then(|t| t.as_str()) {
                            Some("ready") => {
                                println!("[AudioCapture] Ready");
                                
                                // Send start command with the specified mode
                                if let Ok(mut capture_state) = state_clone.lock() {
                                    if let Some(ref mut child) = *capture_state {
                                        let cmd = serde_json::json!({
                                            "command": "start",
                                            "mode": mode.to_string(),
                                            "sampleRate": sample_rate.to_string(),
                                            "channels": channels.to_string()
                                        });
                                        let _ = child.write((cmd.to_string() + "\n").as_bytes());
                                    }
                                }
                            }
                            Some("started") => {
                                println!("[AudioCapture] Started capturing");
                                let _ = app_handle.emit("audio-capture-started", ());
                            }
                            Some("stopped") => {
                                println!("[AudioCapture] Stopped");
                                let _ = app_handle.emit("audio-capture-stopped", ());
                            }
                            Some("audio") => {
                                // Forward audio data to frontend
                                if let Some(data) = msg.get("data").and_then(|d| d.as_str()) {
                                    let _ = app_handle.emit("audio-capture-data", data);
                                }
                            }
                            Some("error") => {
                                if let Some(error) = msg.get("error").and_then(|e| e.as_str()) {
                                    eprintln!("[AudioCapture] Error: {}", error);
                                    let _ = app_handle.emit("audio-capture-error", error);
                                }
                            }
                            _ => {}
                        }
                    }
                }
                tauri_plugin_shell::process::CommandEvent::Stderr(line) => {
                    eprintln!("[AudioCapture] {}", String::from_utf8_lossy(&line));
                }
                tauri_plugin_shell::process::CommandEvent::Terminated(status) => {
                    println!("[AudioCapture] Terminated with status: {:?}", status);
                    let _ = app_handle.emit("audio-capture-stopped", ());
                    
                    // Clear state
                    if let Ok(mut capture_state) = state_clone.lock() {
                        *capture_state = None;
                    }
                    break;
                }
                _ => {}
            }
        }
    });
    
    println!("🎤 Audio capture sidecar started");
    Ok(true)
}

/// Stop audio capture
#[tauri::command]
fn stop_audio_capture(state: State<'_, AudioCaptureState>) -> Result<bool, String> {
    let mut capture_state = state.0.lock().map_err(|e| e.to_string())?;
    
    if let Some(ref mut child) = *capture_state {
        // Send quit command
        let cmd = serde_json::json!({ "command": "quit" });
        let _ = child.write((cmd.to_string() + "\n").as_bytes());
    }
    
    // Give it a moment then kill
    std::thread::sleep(std::time::Duration::from_millis(100));
    
    // Take ownership and kill
    if let Some(child) = capture_state.take() {
        let _ = child.kill();
    }
    
    println!("🛑 Audio capture stopped");
    Ok(true)
}

/// Cleanup audio capture on exit
fn cleanup_audio_capture(state: &Arc<Mutex<Option<CommandChild>>>) {
    if let Ok(mut capture_state) = state.lock() {
        if let Some(child) = capture_state.take() {
            println!("🛑 Stopping audio capture...");
            let _ = child.kill();
            println!("✅ Audio capture stopped");
        }
    }
}

// ==================== END AUDIO CAPTURE ====================

/// Watch the config.json file for changes and emit events to the frontend
fn start_config_watcher(app_handle: AppHandle) {
    let config_path = match get_config_file_path() {
        Ok(p) => p,
        Err(e) => {
            eprintln!("Failed to get config path for watcher: {}", e);
            return;
        }
    };
    
    // Ensure the config directory exists
    if let Some(parent) = config_path.parent() {
        if !parent.exists() {
            if let Err(e) = std::fs::create_dir_all(parent) {
                eprintln!("Failed to create config directory: {}", e);
                return;
            }
        }
    }
    
    std::thread::spawn(move || {
        // Create a debounced watcher with 500ms delay to avoid duplicate events
        let (tx, rx) = std::sync::mpsc::channel();
        
        let mut debouncer = match new_debouncer(Duration::from_millis(500), tx) {
            Ok(d) => d,
            Err(e) => {
                eprintln!("Failed to create config watcher: {}", e);
                return;
            }
        };
        
        // Watch the config directory (watching the file directly can miss recreations)
        let watch_path = config_path.parent().unwrap_or(&config_path);
        if let Err(e) = debouncer.watcher().watch(watch_path, notify::RecursiveMode::NonRecursive) {
            eprintln!("Failed to watch config directory: {}", e);
            return;
        }
        
        println!("👁️  Watching config file for changes: {:?}", config_path);
        
        // Listen for events
        loop {
            match rx.recv() {
                Ok(Ok(events)) => {
                    // Check if any event is for our config file
                    let config_changed = events.iter().any(|e| {
                        e.kind == DebouncedEventKind::Any && 
                        e.path.file_name().map(|n| n == "config.json").unwrap_or(false)
                    });
                    
                    if config_changed {
                        println!("📝 Config file changed, notifying frontend");
                        if let Err(e) = app_handle.emit("config-changed", ()) {
                            eprintln!("Failed to emit config-changed event: {}", e);
                        }
                    }
                }
                Ok(Err(e)) => {
                    eprintln!("Config watcher error: {:?}", e);
                }
                Err(e) => {
                    eprintln!("Config watcher channel error: {:?}", e);
                    break;
                }
            }
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app_state = AppState(Arc::new(Mutex::new(AppStateInner {
        processes: HashMap::new(),
        last_errors: HashMap::new(),
    })));
    
    // Create AI server state to track the sidecar process
    let ai_server_state: Arc<Mutex<Option<CommandChild>>> = Arc::new(Mutex::new(None));
    
    // Create audio capture state
    let audio_capture_state = AudioCaptureState(Arc::new(Mutex::new(None)));
    
    // Clone for the exit handler
    let app_state_for_exit = app_state.0.clone();
    let ai_server_for_exit = ai_server_state.clone();
    let audio_capture_for_exit = audio_capture_state.0.clone();
    
    // Clone for setup closure
    let ai_server_for_setup = ai_server_state.clone();
    
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(app_state)
        .manage(audio_capture_state)
        .invoke_handler(tauri::generate_handler![
            start_app,
            stop_app,
            get_app_status,
            get_app_logs,
            check_port,
            is_port_available,
            find_free_port,
            get_port_info,
            kill_port,
            set_app_actual_port,
            discover_app_port,
            get_moldable_config_path,
            get_moldable_root,
            get_registered_apps,
            get_registered_apps_for_workspace,
            register_app,
            unregister_app,
            detect_app_in_folder,
            get_workspace_path,
            set_workspace_path,
            list_available_apps,
            install_available_app,
            // App registry commands (GitHub)
            fetch_app_registry,
            install_app_from_registry,
            uninstall_app_from_shared,
            get_app_env_requirements,
            set_app_env_var,
            get_all_env_vars,
            save_api_key,
            // Preferences commands
            get_preference,
            set_preference,
            get_all_preferences,
            // Workspace commands
            get_workspaces_config,
            set_active_workspace,
            create_workspace,
            update_workspace,
            delete_workspace,
            // Conversation commands
            list_conversations,
            load_conversation,
            save_conversation,
            delete_conversation,
            // Audio capture commands
            is_system_audio_available,
            start_audio_capture,
            stop_audio_capture
        ])
        .setup(move |app| {
            #[cfg(debug_assertions)]
            {
                let window = app.get_webview_window("main").unwrap();
                window.open_devtools();
            }
            
            // Ensure default workspace exists on fresh install
            if let Err(e) = ensure_default_workspace() {
                eprintln!("⚠️  Failed to create default workspace: {}", e);
            }
            
            // Install bundled scripts to ~/.moldable/shared/scripts/
            if let Err(e) = ensure_bundled_scripts(app.handle()) {
                eprintln!("⚠️  Failed to install bundled scripts: {}", e);
            }
            
            // Start AI server sidecar
            if let Err(e) = start_ai_server(app.handle(), ai_server_for_setup) {
                eprintln!("Failed to start AI server: {}", e);
                // Don't fail app startup - the UI will show onboarding if server isn't running
            }
            
            // Start watching config file for changes
            start_config_watcher(app.handle().clone());

            // Auto-start registered apps as early as possible (so widgets are live immediately).
            // Do this in Rust so it's not dependent on React timing.
            let state_for_autostart = {
                let s = app.state::<AppState>();
                AppState(Arc::clone(&s.0))
            };
            std::thread::spawn(move || {
                // First, clean up any orphaned instances from previous runs
                // This handles cases where Moldable crashed or hot-reloaded without cleanup
                cleanup_all_orphaned_apps();
                
                let apps = match get_registered_apps() {
                    Ok(a) => a,
                    Err(e) => {
                        eprintln!("Failed to load registered apps: {}", e);
                        return;
                    }
                };

                if apps.is_empty() {
                    return;
                }

                println!("🚀 Auto-starting {} registered app(s)...", apps.len());
                for a in apps {
                    // Prefer configured port, but always fall back if allowed.
                    // Retry a few times in case availability changes between checks and spawn.
                    let preferred = a.port;
                    let mut attempts_left = 5u8;
                    let mut next_port = preferred;

                    loop {
                        let chosen = if is_port_available(next_port) {
                            next_port
                        } else if a.requires_port {
                            next_port
                        } else {
                            find_free_port(next_port)
                        };

                        match start_app_internal(
                            a.id.clone(),
                            a.path.clone(),
                            a.command.clone(),
                            a.args.clone(),
                            Some(chosen),
                            &state_for_autostart,
                        ) {
                            Ok(_) => {
                                println!("✅ Started {} on :{}", a.id, chosen);
                                break;
                            }
                            Err(e) => {
                                attempts_left = attempts_left.saturating_sub(1);
                                if attempts_left == 0 || a.requires_port {
                                    eprintln!("❌ Failed to start {}: {}", a.id, e);
                                    break;
                                }
                                // Try the next free port
                                next_port = chosen.saturating_add(1);
                            }
                        }
                    }
                }
            });
            
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(move |_app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                println!("🔄 Moldable shutting down, cleaning up...");
                // Kill audio capture first
                cleanup_audio_capture(&audio_capture_for_exit);
                // Kill AI server sidecar
                cleanup_ai_server(&ai_server_for_exit);
                // Kill all running apps on exit
                let state = AppState(app_state_for_exit.clone());
                cleanup_all_apps(&state);
            }
        });
}

#[cfg(test)]
mod tests;
