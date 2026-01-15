//! Tests for Moldable desktop core functionality
//!
//! Covers:
//! - Workspace management (creation, switching, env layering)
//! - Environment variable parsing and merging
//! - App registration and configuration
//! - Conversation persistence
//! - Port management utilities
//! - File operations

use super::*;
use std::fs;
use std::path::PathBuf;
use tempfile::TempDir;

// ==================== HELPER FUNCTION TESTS ====================

#[test]
fn test_command_basename_with_full_path() {
    assert_eq!(command_basename("/opt/homebrew/bin/pnpm"), "pnpm");
    assert_eq!(command_basename("/usr/local/bin/npm"), "npm");
    assert_eq!(command_basename("/usr/bin/yarn"), "yarn");
}

#[test]
fn test_command_basename_with_simple_name() {
    assert_eq!(command_basename("pnpm"), "pnpm");
    assert_eq!(command_basename("npm"), "npm");
    assert_eq!(command_basename("node"), "node");
}

#[test]
fn test_command_basename_case_insensitive() {
    assert_eq!(command_basename("/usr/bin/PNPM"), "pnpm");
    assert_eq!(command_basename("NPM"), "npm");
}

#[test]
fn test_is_package_manager_command_positive() {
    assert!(is_package_manager_command("pnpm"));
    assert!(is_package_manager_command("npm"));
    assert!(is_package_manager_command("yarn"));
    assert!(is_package_manager_command("bun"));
    assert!(is_package_manager_command("/opt/homebrew/bin/pnpm"));
    assert!(is_package_manager_command("/usr/local/bin/npm"));
}

#[test]
fn test_is_package_manager_command_negative() {
    assert!(!is_package_manager_command("node"));
    assert!(!is_package_manager_command("python"));
    assert!(!is_package_manager_command("/usr/bin/cargo"));
    assert!(!is_package_manager_command("next"));
}

#[test]
fn test_upsert_flag_value_existing_flag() {
    let mut args = vec!["-p".to_string(), "3000".to_string()];
    upsert_flag_value(&mut args, &["-p", "--port"], "4000".to_string());
    assert_eq!(args, vec!["-p", "4000"]);
}

#[test]
fn test_upsert_flag_value_existing_long_flag() {
    let mut args = vec!["--port".to_string(), "3000".to_string()];
    upsert_flag_value(&mut args, &["-p", "--port"], "4000".to_string());
    assert_eq!(args, vec!["--port", "4000"]);
}

#[test]
fn test_upsert_flag_value_missing_flag() {
    let mut args = vec!["dev".to_string()];
    upsert_flag_value(&mut args, &["-p", "--port"], "3001".to_string());
    assert_eq!(args, vec!["dev", "-p", "3001"]);
}

#[test]
fn test_upsert_flag_value_empty_args() {
    let mut args: Vec<String> = vec![];
    upsert_flag_value(&mut args, &["-p"], "3000".to_string());
    assert_eq!(args, vec!["-p", "3000"]);
}

#[test]
fn test_with_script_args_forwarded_no_port() {
    let args = vec!["dev".to_string()];
    let result = with_script_args_forwarded("pnpm", args.clone(), None);
    assert_eq!(result, args);
}

#[test]
fn test_with_script_args_forwarded_pnpm_without_separator() {
    let args = vec!["dev".to_string()];
    let result = with_script_args_forwarded("pnpm", args, Some(3001));
    assert_eq!(result, vec!["dev", "--", "-p", "3001"]);
}

#[test]
fn test_with_script_args_forwarded_pnpm_with_separator() {
    let args = vec![
        "dev".to_string(),
        "--".to_string(),
        "-p".to_string(),
        "3000".to_string(),
    ];
    let result = with_script_args_forwarded("pnpm", args, Some(3001));
    assert_eq!(result, vec!["dev", "--", "-p", "3001"]);
}

#[test]
fn test_with_script_args_forwarded_npm() {
    let args = vec!["run".to_string(), "dev".to_string()];
    let result = with_script_args_forwarded("/usr/local/bin/npm", args, Some(3002));
    assert_eq!(result, vec!["run", "dev", "--", "-p", "3002"]);
}

#[test]
fn test_with_script_args_forwarded_non_package_manager() {
    let args = vec!["--watch".to_string()];
    let result = with_script_args_forwarded("node", args, Some(3003));
    assert_eq!(result, vec!["--watch", "-p", "3003"]);
}

#[test]
fn test_with_script_args_forwarded_full_path_pnpm() {
    let args = vec!["dev".to_string()];
    let result = with_script_args_forwarded("/opt/homebrew/bin/pnpm", args, Some(3004));
    assert_eq!(result, vec!["dev", "--", "-p", "3004"]);
}

// ==================== ENV FILE PARSING TESTS ====================

fn create_temp_env_file(dir: &TempDir, filename: &str, content: &str) -> PathBuf {
    let path = dir.path().join(filename);
    fs::write(&path, content).unwrap();
    path
}

#[test]
fn test_parse_env_file_basic() {
    let dir = TempDir::new().unwrap();
    let path = create_temp_env_file(&dir, ".env", "KEY1=value1\nKEY2=value2");

    let env = parse_env_file(&path);

    assert_eq!(env.get("KEY1"), Some(&"value1".to_string()));
    assert_eq!(env.get("KEY2"), Some(&"value2".to_string()));
}

#[test]
fn test_parse_env_file_with_comments() {
    let dir = TempDir::new().unwrap();
    let content = "# This is a comment\nKEY1=value1\n# Another comment\nKEY2=value2";
    let path = create_temp_env_file(&dir, ".env", content);

    let env = parse_env_file(&path);

    assert_eq!(env.len(), 2);
    assert_eq!(env.get("KEY1"), Some(&"value1".to_string()));
    assert_eq!(env.get("KEY2"), Some(&"value2".to_string()));
}

#[test]
fn test_parse_env_file_with_empty_lines() {
    let dir = TempDir::new().unwrap();
    let content = "KEY1=value1\n\n\nKEY2=value2\n";
    let path = create_temp_env_file(&dir, ".env", content);

    let env = parse_env_file(&path);

    assert_eq!(env.len(), 2);
}

#[test]
fn test_parse_env_file_with_whitespace() {
    let dir = TempDir::new().unwrap();
    let content = "  KEY1 = value1  \n  KEY2=value2";
    let path = create_temp_env_file(&dir, ".env", content);

    let env = parse_env_file(&path);

    // After trimming
    assert_eq!(env.get("KEY1"), Some(&"value1".to_string()));
    assert_eq!(env.get("KEY2"), Some(&"value2".to_string()));
}

#[test]
fn test_parse_env_file_ignores_empty_values() {
    let dir = TempDir::new().unwrap();
    let content = "KEY1=\nKEY2=value2";
    let path = create_temp_env_file(&dir, ".env", content);

    let env = parse_env_file(&path);

    assert_eq!(env.len(), 1);
    assert_eq!(env.get("KEY2"), Some(&"value2".to_string()));
}

#[test]
fn test_parse_env_file_nonexistent() {
    let path = PathBuf::from("/nonexistent/.env");
    let env = parse_env_file(&path);
    assert!(env.is_empty());
}

#[test]
fn test_parse_env_file_with_equals_in_value() {
    let dir = TempDir::new().unwrap();
    let content = "DATABASE_URL=postgres://user:pass@host:5432/db?sslmode=require";
    let path = create_temp_env_file(&dir, ".env", content);

    let env = parse_env_file(&path);

    // The value should include everything after the first =
    assert_eq!(
        env.get("DATABASE_URL"),
        Some(&"postgres://user:pass@host:5432/db?sslmode=require".to_string())
    );
}

// ==================== TEMP MOLDABLE ENV HELPER ====================

/// Helper to create a temporary Moldable-like directory structure for testing
#[allow(dead_code)]
struct TempMoldableEnv {
    _temp_dir: TempDir,
    pub moldable_root: PathBuf,
}

#[allow(dead_code)]
impl TempMoldableEnv {
    fn new() -> Self {
        let temp_dir = TempDir::new().unwrap();
        let moldable_root = temp_dir.path().join(".moldable");
        fs::create_dir_all(&moldable_root).unwrap();

        Self {
            _temp_dir: temp_dir,
            moldable_root,
        }
    }

    fn create_workspaces_config(&self, config: &WorkspacesConfig) {
        let path = self.moldable_root.join("workspaces.json");
        let content = serde_json::to_string_pretty(config).unwrap();
        fs::write(path, content).unwrap();
    }

    fn create_workspace_dir(&self, workspace_id: &str) {
        let workspace_dir = self.moldable_root.join("workspaces").join(workspace_id);
        fs::create_dir_all(workspace_dir.join("apps")).unwrap();
        fs::create_dir_all(workspace_dir.join("conversations")).unwrap();
        fs::create_dir_all(workspace_dir.join("config")).unwrap();
    }

    fn create_shared_dir(&self) {
        let shared_dir = self.moldable_root.join("shared");
        fs::create_dir_all(shared_dir.join("apps")).unwrap();
        fs::create_dir_all(shared_dir.join("scripts")).unwrap();
        fs::create_dir_all(shared_dir.join("skills")).unwrap();
        fs::create_dir_all(shared_dir.join("config")).unwrap();
    }

    fn create_workspace_config(&self, workspace_id: &str, config: &MoldableConfig) {
        let path = self
            .moldable_root
            .join("workspaces")
            .join(workspace_id)
            .join("config.json");
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        let content = serde_json::to_string_pretty(config).unwrap();
        fs::write(path, content).unwrap();
    }

    fn create_env_file(&self, workspace_id: &str, content: &str) {
        let path = self
            .moldable_root
            .join("workspaces")
            .join(workspace_id)
            .join(".env");
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, content).unwrap();
    }

    fn create_shared_env_file(&self, content: &str) {
        let path = self.moldable_root.join("shared").join(".env");
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, content).unwrap();
    }

    fn read_workspaces_config(&self) -> WorkspacesConfig {
        let path = self.moldable_root.join("workspaces.json");
        let content = fs::read_to_string(path).unwrap();
        serde_json::from_str(&content).unwrap()
    }

    fn read_workspace_config(&self, workspace_id: &str) -> MoldableConfig {
        let path = self
            .moldable_root
            .join("workspaces")
            .join(workspace_id)
            .join("config.json");
        let content = fs::read_to_string(path).unwrap();
        serde_json::from_str(&content).unwrap()
    }
}

// ==================== WORKSPACE CONFIG TESTS ====================

#[test]
fn test_workspaces_config_default() {
    let config = WorkspacesConfig::default();

    assert_eq!(config.active_workspace, "personal");
    assert_eq!(config.workspaces.len(), 1);
    assert_eq!(config.workspaces[0].id, "personal");
    assert_eq!(config.workspaces[0].name, "Personal");
    assert_eq!(config.workspaces[0].color, "#10b981");
}

#[test]
fn test_workspaces_config_serialization() {
    let config = WorkspacesConfig {
        active_workspace: "work".to_string(),
        workspaces: vec![
            Workspace {
                id: "personal".to_string(),
                name: "Personal".to_string(),
                color: "#10b981".to_string(),
                created_at: "2026-01-01T00:00:00Z".to_string(),
            },
            Workspace {
                id: "work".to_string(),
                name: "Work".to_string(),
                color: "#3b82f6".to_string(),
                created_at: "2026-01-01T00:00:00Z".to_string(),
            },
        ],
    };

    let json = serde_json::to_string(&config).unwrap();
    let parsed: WorkspacesConfig = serde_json::from_str(&json).unwrap();

    assert_eq!(parsed.active_workspace, "work");
    assert_eq!(parsed.workspaces.len(), 2);
    assert_eq!(parsed.workspaces[0].id, "personal");
    assert_eq!(parsed.workspaces[1].id, "work");
}

#[test]
fn test_workspaces_config_camel_case_serialization() {
    let config = WorkspacesConfig::default();
    let json = serde_json::to_string(&config).unwrap();

    // Verify camelCase is used in JSON
    assert!(json.contains("activeWorkspace"));
    assert!(json.contains("createdAt"));
    assert!(!json.contains("active_workspace"));
    assert!(!json.contains("created_at"));
}

#[test]
fn test_workspace_color_formats() {
    // Test that various color formats are accepted
    let colors = vec!["#10b981", "#3b82f6", "#ef4444", "#000000", "#ffffff"];

    for color in colors {
        let workspace = Workspace {
            id: "test".to_string(),
            name: "Test".to_string(),
            color: color.to_string(),
            created_at: "2026-01-01T00:00:00Z".to_string(),
        };

        let json = serde_json::to_string(&workspace).unwrap();
        let parsed: Workspace = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.color, color);
    }
}

#[test]
fn test_workspace_file_persistence() {
    let env = TempMoldableEnv::new();

    let config = WorkspacesConfig {
        active_workspace: "work".to_string(),
        workspaces: vec![
            Workspace {
                id: "personal".to_string(),
                name: "Personal".to_string(),
                color: "#10b981".to_string(),
                created_at: "2026-01-01T00:00:00Z".to_string(),
            },
            Workspace {
                id: "work".to_string(),
                name: "Work".to_string(),
                color: "#3b82f6".to_string(),
                created_at: "2026-01-02T00:00:00Z".to_string(),
            },
        ],
    };

    env.create_workspaces_config(&config);

    // Read back and verify
    let read_config = env.read_workspaces_config();
    assert_eq!(read_config.active_workspace, "work");
    assert_eq!(read_config.workspaces.len(), 2);
}

#[test]
fn test_fresh_install_default_workspace_setup() {
    // Simulates what ensure_default_workspace() does on a fresh install
    let env = TempMoldableEnv::new();

    // Fresh install: no workspaces.json, no directories
    assert!(!env.moldable_root.join("workspaces.json").exists());
    assert!(!env.moldable_root.join("workspaces/personal").exists());

    // Simulate ensure_default_workspace() logic:
    // 1. Create personal workspace directory
    let personal_workspace = env.moldable_root.join("workspaces/personal");
    fs::create_dir_all(&personal_workspace).unwrap();

    // 2. Create shared directory with subdirs
    let shared_dir = env.moldable_root.join("shared");
    fs::create_dir_all(shared_dir.join("apps")).unwrap();
    fs::create_dir_all(shared_dir.join("scripts")).unwrap();
    fs::create_dir_all(shared_dir.join("skills")).unwrap();
    fs::create_dir_all(shared_dir.join("config")).unwrap();

    // 3. Create cache directory
    fs::create_dir_all(env.moldable_root.join("cache")).unwrap();

    // 4. Create default workspaces.json
    env.create_workspaces_config(&WorkspacesConfig::default());

    // 5. Create workspace subdirectories (apps, conversations, config)
    fs::create_dir_all(personal_workspace.join("apps")).unwrap();
    fs::create_dir_all(personal_workspace.join("conversations")).unwrap();
    fs::create_dir_all(personal_workspace.join("config")).unwrap();

    // 6. Create default config.json
    let default_config = MoldableConfig::default();
    let config_path = personal_workspace.join("config.json");
    let content = serde_json::to_string_pretty(&default_config).unwrap();
    fs::write(&config_path, content).unwrap();

    // Verify the complete structure
    assert!(env.moldable_root.join("workspaces.json").exists());
    assert!(env.moldable_root.join("workspaces/personal").exists());
    assert!(env.moldable_root.join("workspaces/personal/apps").exists());
    assert!(env.moldable_root.join("workspaces/personal/conversations").exists());
    assert!(env.moldable_root.join("workspaces/personal/config").exists());
    assert!(env.moldable_root.join("workspaces/personal/config.json").exists());
    assert!(env.moldable_root.join("shared").exists());
    assert!(env.moldable_root.join("shared/apps").exists());
    assert!(env.moldable_root.join("shared/scripts").exists());
    assert!(env.moldable_root.join("shared/skills").exists());
    assert!(env.moldable_root.join("shared/config").exists());
    assert!(env.moldable_root.join("cache").exists());

    // Verify workspaces.json has correct defaults
    let workspaces_config = env.read_workspaces_config();
    assert_eq!(workspaces_config.active_workspace, "personal");
    assert_eq!(workspaces_config.workspaces.len(), 1);
    assert_eq!(workspaces_config.workspaces[0].id, "personal");
    assert_eq!(workspaces_config.workspaces[0].name, "Personal");
    assert_eq!(workspaces_config.workspaces[0].color, "#10b981");

    // Verify config.json has correct defaults
    let config = env.read_workspace_config("personal");
    assert!(config.workspace.is_none());
    assert!(config.apps.is_empty());
    assert!(config.preferences.is_empty());
}

#[test]
fn test_workspace_directory_structure() {
    let env = TempMoldableEnv::new();
    env.create_workspace_dir("personal");
    env.create_shared_dir();

    // Verify workspace directories exist
    assert!(env.moldable_root.join("workspaces/personal/apps").exists());
    assert!(env
        .moldable_root
        .join("workspaces/personal/conversations")
        .exists());
    assert!(env
        .moldable_root
        .join("workspaces/personal/config")
        .exists());
    
    // Verify shared directories exist
    assert!(env.moldable_root.join("shared/apps").exists());
    assert!(env.moldable_root.join("shared/scripts").exists());
    assert!(env.moldable_root.join("shared/skills").exists());
    assert!(env.moldable_root.join("shared/config").exists());
}

#[test]
fn test_shared_scripts_directory() {
    let env = TempMoldableEnv::new();
    env.create_shared_dir();

    let scripts_dir = env.moldable_root.join("shared/scripts");
    assert!(scripts_dir.exists());

    // Simulate installing a script
    let test_script = scripts_dir.join("lint-moldable-app.js");
    fs::write(&test_script, "// test script content").unwrap();
    
    assert!(test_script.exists());
    let content = fs::read_to_string(&test_script).unwrap();
    assert!(content.contains("test script content"));
}

// ==================== ENV VAR LAYERING TESTS ====================

#[test]
fn test_env_file_layering() {
    // Test that workspace env vars override shared env vars
    let dir = TempDir::new().unwrap();

    let shared_path = dir.path().join("shared.env");
    fs::write(&shared_path, "KEY1=shared1\nKEY2=shared2").unwrap();

    let workspace_path = dir.path().join("workspace.env");
    fs::write(&workspace_path, "KEY2=workspace2\nKEY3=workspace3").unwrap();

    let shared_env = parse_env_file(&shared_path);
    let mut merged = shared_env;

    let workspace_env = parse_env_file(&workspace_path);
    merged.extend(workspace_env);

    // KEY1 should be from shared
    assert_eq!(merged.get("KEY1"), Some(&"shared1".to_string()));
    // KEY2 should be overridden by workspace
    assert_eq!(merged.get("KEY2"), Some(&"workspace2".to_string()));
    // KEY3 should be from workspace only
    assert_eq!(merged.get("KEY3"), Some(&"workspace3".to_string()));
}

#[test]
fn test_env_layering_with_temp_moldable_env() {
    let env = TempMoldableEnv::new();
    env.create_shared_dir();
    env.create_workspace_dir("personal");

    // Create shared env with base values
    env.create_shared_env_file("ANTHROPIC_API_KEY=sk-shared\nOPENAI_API_KEY=sk-openai-shared");

    // Create workspace env with override
    env.create_env_file("personal", "OPENAI_API_KEY=sk-openai-personal\nWORKSPACE_KEY=personal-only");

    // Read and merge
    let shared = parse_env_file(&env.moldable_root.join("shared/.env"));
    let workspace = parse_env_file(&env.moldable_root.join("workspaces/personal/.env"));

    let mut merged = shared;
    merged.extend(workspace);

    assert_eq!(merged.get("ANTHROPIC_API_KEY"), Some(&"sk-shared".to_string()));
    assert_eq!(
        merged.get("OPENAI_API_KEY"),
        Some(&"sk-openai-personal".to_string())
    );
    assert_eq!(
        merged.get("WORKSPACE_KEY"),
        Some(&"personal-only".to_string())
    );
}

#[test]
fn test_env_layering_empty_workspace() {
    let env = TempMoldableEnv::new();
    env.create_shared_dir();
    env.create_workspace_dir("personal");

    // Only shared env exists
    env.create_shared_env_file("SHARED_KEY=shared_value");

    let shared = parse_env_file(&env.moldable_root.join("shared/.env"));
    let workspace = parse_env_file(&env.moldable_root.join("workspaces/personal/.env"));

    let mut merged = shared;
    merged.extend(workspace);

    assert_eq!(merged.get("SHARED_KEY"), Some(&"shared_value".to_string()));
    assert_eq!(merged.len(), 1);
}

#[test]
fn test_env_layering_empty_shared() {
    let env = TempMoldableEnv::new();
    env.create_shared_dir();
    env.create_workspace_dir("personal");

    // Only workspace env exists
    env.create_env_file("personal", "WORKSPACE_KEY=workspace_value");

    let shared = parse_env_file(&env.moldable_root.join("shared/.env"));
    let workspace = parse_env_file(&env.moldable_root.join("workspaces/personal/.env"));

    let mut merged = shared;
    merged.extend(workspace);

    assert_eq!(
        merged.get("WORKSPACE_KEY"),
        Some(&"workspace_value".to_string())
    );
    assert_eq!(merged.len(), 1);
}

// ==================== MOLDABLE CONFIG TESTS ====================

#[test]
fn test_moldable_config_default() {
    let config = MoldableConfig::default();

    assert!(config.workspace.is_none());
    assert!(config.apps.is_empty());
    assert!(config.preferences.is_empty());
}

#[test]
fn test_moldable_config_with_apps() {
    let config = MoldableConfig {
        workspace: Some("/Users/test/moldable".to_string()),
        apps: vec![RegisteredApp {
            id: "scribo".to_string(),
            name: "Scribo".to_string(),
            icon: "✍️".to_string(),
            icon_path: None,
            port: 3001,
            path: "/path/to/scribo".to_string(),
            command: "pnpm".to_string(),
            args: vec!["dev".to_string()],
            widget_size: "medium".to_string(),
            requires_port: false,
        }],
        preferences: serde_json::Map::new(),
    };

    let json = serde_json::to_string(&config).unwrap();
    let parsed: MoldableConfig = serde_json::from_str(&json).unwrap();

    assert_eq!(parsed.apps.len(), 1);
    assert_eq!(parsed.apps[0].id, "scribo");
    assert_eq!(parsed.apps[0].port, 3001);
    assert!(!parsed.apps[0].requires_port);
}

#[test]
fn test_moldable_config_persistence() {
    let env = TempMoldableEnv::new();
    env.create_workspace_dir("personal");

    let config = MoldableConfig {
        workspace: Some("/Users/test/moldable".to_string()),
        apps: vec![
            RegisteredApp {
                id: "app1".to_string(),
                name: "App 1".to_string(),
                icon: "📱".to_string(),
                icon_path: None,
                port: 3001,
                path: "/app1".to_string(),
                command: "pnpm".to_string(),
                args: vec!["dev".to_string()],
                widget_size: "medium".to_string(),
                requires_port: false,
            },
            RegisteredApp {
                id: "app2".to_string(),
                name: "App 2".to_string(),
                icon: "💻".to_string(),
                icon_path: None,
                port: 3002,
                path: "/app2".to_string(),
                command: "pnpm".to_string(),
                args: vec!["dev".to_string()],
                widget_size: "large".to_string(),
                requires_port: true,
            },
        ],
        preferences: serde_json::Map::new(),
    };

    env.create_workspace_config("personal", &config);

    let read_config = env.read_workspace_config("personal");
    assert_eq!(read_config.apps.len(), 2);
    assert_eq!(read_config.apps[0].id, "app1");
    assert_eq!(read_config.apps[1].id, "app2");
    assert!(read_config.apps[1].requires_port);
}

#[test]
fn test_registered_app_default_widget_size() {
    // Test that widget_size defaults to "medium" when not specified
    let json = r#"{
        "id": "test",
        "name": "Test",
        "icon": "📦",
        "port": 3000,
        "path": "/test",
        "command": "pnpm",
        "args": ["dev"]
    }"#;

    let app: RegisteredApp = serde_json::from_str(json).unwrap();
    assert_eq!(app.widget_size, "medium");
    assert!(!app.requires_port);
}

#[test]
fn test_registered_app_requires_port() {
    let json = r#"{
        "id": "test",
        "name": "Test",
        "icon": "📦",
        "port": 3000,
        "path": "/test",
        "command": "pnpm",
        "args": ["dev"],
        "requires_port": true
    }"#;

    let app: RegisteredApp = serde_json::from_str(json).unwrap();
    assert!(app.requires_port);
}

#[test]
fn test_registered_app_custom_widget_size() {
    let app = RegisteredApp {
        id: "test".to_string(),
        name: "Test".to_string(),
        icon: "📦".to_string(),
        icon_path: None,
        port: 3000,
        path: "/test".to_string(),
        command: "pnpm".to_string(),
        args: vec!["dev".to_string()],
        widget_size: "large".to_string(),
        requires_port: false,
    };

    let json = serde_json::to_string(&app).unwrap();
    let parsed: RegisteredApp = serde_json::from_str(&json).unwrap();
    assert_eq!(parsed.widget_size, "large");
}

// ==================== MOLDABLE MANIFEST TESTS ====================

#[test]
fn test_moldable_manifest_minimal() {
    let json = r#"{}"#;
    let manifest: MoldableManifest = serde_json::from_str(json).unwrap();

    assert!(manifest.name.is_none());
    assert!(manifest.icon.is_none());
    assert!(manifest.port.is_none());
    assert!(!manifest.requires_port);
    assert!(manifest.env.is_empty());
}

#[test]
fn test_moldable_manifest_full() {
    let json = r#"{
        "name": "My App",
        "icon": "🚀",
        "description": "A cool app",
        "widgetSize": "large",
        "port": 3005,
        "requiresPort": true,
        "command": "pnpm",
        "args": ["dev"],
        "env": [
            {
                "key": "API_KEY",
                "name": "API Key",
                "description": "Your API key",
                "url": "https://example.com/api-keys",
                "required": true
            }
        ]
    }"#;

    let manifest: MoldableManifest = serde_json::from_str(json).unwrap();

    assert_eq!(manifest.name, Some("My App".to_string()));
    assert_eq!(manifest.icon, Some("🚀".to_string()));
    assert_eq!(manifest.widget_size, Some("large".to_string()));
    assert_eq!(manifest.port, Some(3005));
    assert!(manifest.requires_port);
    assert_eq!(manifest.env.len(), 1);
    assert_eq!(manifest.env[0].key, "API_KEY");
    assert!(manifest.env[0].required);
}

#[test]
fn test_env_requirement_defaults() {
    let json = r#"{
        "key": "TEST_KEY",
        "name": "Test Key"
    }"#;

    let req: EnvRequirement = serde_json::from_str(json).unwrap();

    assert_eq!(req.key, "TEST_KEY");
    assert_eq!(req.name, "Test Key");
    assert!(req.description.is_none());
    assert!(req.url.is_none());
    assert!(!req.required);
}

// ==================== CONVERSATION TESTS ====================

#[test]
fn test_conversation_meta_serialization() {
    let meta = ConversationMeta {
        id: "conv-123".to_string(),
        title: "Test Conversation".to_string(),
        created_at: "2026-01-14T10:00:00Z".to_string(),
        updated_at: "2026-01-14T11:00:00Z".to_string(),
        message_count: 5,
    };

    let json = serde_json::to_string(&meta).unwrap();

    // Verify camelCase
    assert!(json.contains("createdAt"));
    assert!(json.contains("updatedAt"));
    assert!(json.contains("messageCount"));

    let parsed: ConversationMeta = serde_json::from_str(&json).unwrap();
    assert_eq!(parsed.id, "conv-123");
    assert_eq!(parsed.message_count, 5);
}

#[test]
fn test_conversation_file_format() {
    let conversation = serde_json::json!({
        "id": "conv-abc123",
        "title": "Building a Todo App",
        "createdAt": "2026-01-14T10:00:00Z",
        "updatedAt": "2026-01-14T12:00:00Z",
        "messageCount": 10,
        "messages": [
            {
                "role": "user",
                "content": "Create a todo app"
            },
            {
                "role": "assistant",
                "content": "I'll create a todo app for you..."
            }
        ]
    });

    // Verify it can be serialized and parsed
    let json = serde_json::to_string_pretty(&conversation).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();

    assert_eq!(parsed["id"], "conv-abc123");
    assert_eq!(parsed["messageCount"], 10);
}

// ==================== APP STATUS TESTS ====================

#[test]
fn test_app_status_serialization() {
    let status = AppStatus {
        running: true,
        pid: Some(12345),
        exit_code: None,
        recent_output: vec!["line1".to_string(), "line2".to_string()],
        actual_port: Some(3001),
    };

    let json = serde_json::to_string(&status).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();

    assert_eq!(parsed["running"], true);
    assert_eq!(parsed["pid"], 12345);
    assert!(parsed["exit_code"].is_null());
    assert_eq!(parsed["actual_port"], 3001);
}

#[test]
fn test_app_status_stopped() {
    let status = AppStatus {
        running: false,
        pid: None,
        exit_code: Some(0),
        recent_output: vec![],
        actual_port: None,
    };

    let json = serde_json::to_string(&status).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();

    assert_eq!(parsed["running"], false);
    assert!(parsed["pid"].is_null());
    assert_eq!(parsed["exit_code"], 0);
}

// ==================== PORT INFO TESTS ====================

#[test]
fn test_port_info_serialization() {
    let info = PortInfo {
        port: 3001,
        pid: Some(12345),
        process_name: Some("node".to_string()),
        command: Some("node server.js".to_string()),
    };

    let json = serde_json::to_string(&info).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();

    assert_eq!(parsed["port"], 3001);
    assert_eq!(parsed["pid"], 12345);
    assert_eq!(parsed["process_name"], "node");
}

// ==================== APP INSTANCE TESTS ====================

#[test]
fn test_app_instance_deserialization() {
    let json = r#"{
        "pid": 12345,
        "port": 3001,
        "startedAt": "2026-01-14T10:00:00Z"
    }"#;

    let instance: AppInstance = serde_json::from_str(json).unwrap();
    assert_eq!(instance.pid, 12345);
}

#[test]
fn test_app_instance_minimal() {
    let json = r#"{"pid": 12345}"#;
    let instance: AppInstance = serde_json::from_str(json).unwrap();
    assert_eq!(instance.pid, 12345);
}

// ==================== WIDGET SIZE TESTS ====================

#[test]
fn test_default_widget_size() {
    assert_eq!(default_widget_size(), "medium");
}

#[test]
fn test_widget_sizes() {
    let sizes = vec!["small", "medium", "large"];

    for size in sizes {
        let app = RegisteredApp {
            id: "test".to_string(),
            name: "Test".to_string(),
            icon: "📦".to_string(),
            icon_path: None,
            port: 3000,
            path: "/test".to_string(),
            command: "pnpm".to_string(),
            args: vec!["dev".to_string()],
            widget_size: size.to_string(),
            requires_port: false,
        };

        let json = serde_json::to_string(&app).unwrap();
        let parsed: RegisteredApp = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.widget_size, size);
    }
}

// ==================== APP ENV STATUS TESTS ====================

#[test]
fn test_app_env_status_serialization() {
    let status = AppEnvStatus {
        requirements: vec![EnvRequirement {
            key: "API_KEY".to_string(),
            name: "API Key".to_string(),
            description: Some("Your API key".to_string()),
            url: Some("https://example.com".to_string()),
            required: true,
        }],
        missing: vec!["API_KEY".to_string()],
        present: vec![],
    };

    let json = serde_json::to_string(&status).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();

    assert!(parsed["requirements"].is_array());
    assert_eq!(parsed["requirements"][0]["key"], "API_KEY");
    assert_eq!(parsed["missing"][0], "API_KEY");
}

// ==================== PREFERENCES TESTS ====================

#[test]
fn test_preferences_in_config() {
    let mut preferences = serde_json::Map::new();
    preferences.insert("theme".to_string(), serde_json::json!("dark"));
    preferences.insert("model".to_string(), serde_json::json!("claude-3-opus"));
    preferences.insert("reasoning_effort".to_string(), serde_json::json!(0.8));

    let config = MoldableConfig {
        workspace: None,
        apps: vec![],
        preferences,
    };

    let json = serde_json::to_string(&config).unwrap();
    let parsed: MoldableConfig = serde_json::from_str(&json).unwrap();

    assert_eq!(parsed.preferences.get("theme").unwrap(), "dark");
    assert_eq!(parsed.preferences.get("model").unwrap(), "claude-3-opus");
    assert_eq!(parsed.preferences.get("reasoning_effort").unwrap(), 0.8);
}

#[test]
fn test_preferences_persistence() {
    let env = TempMoldableEnv::new();
    env.create_workspace_dir("personal");

    let mut preferences = serde_json::Map::new();
    preferences.insert("theme".to_string(), serde_json::json!("dark"));
    preferences.insert("model".to_string(), serde_json::json!("claude-opus-4"));
    preferences.insert("reasoning_effort".to_string(), serde_json::json!("high"));

    let config = MoldableConfig {
        workspace: None,
        apps: vec![],
        preferences,
    };

    env.create_workspace_config("personal", &config);

    let read_config = env.read_workspace_config("personal");
    assert_eq!(read_config.preferences.get("theme").unwrap(), "dark");
    assert_eq!(read_config.preferences.get("model").unwrap(), "claude-opus-4");
}

// ==================== FILE PATH TESTS ====================

#[test]
fn test_instances_file_parsing() {
    let dir = TempDir::new().unwrap();
    let instances_file = dir.path().join(".moldable.instances.json");

    let content = r#"[
        {"pid": 12345, "port": 3001, "startedAt": "2026-01-14T10:00:00Z"},
        {"pid": 12346, "port": 3002, "startedAt": "2026-01-14T10:01:00Z"}
    ]"#;
    fs::write(&instances_file, content).unwrap();

    let content = fs::read_to_string(&instances_file).unwrap();
    let instances: Vec<AppInstance> = serde_json::from_str(&content).unwrap();

    assert_eq!(instances.len(), 2);
    assert_eq!(instances[0].pid, 12345);
    assert_eq!(instances[1].pid, 12346);
}

#[test]
fn test_port_file_content() {
    let dir = TempDir::new().unwrap();
    let port_file = dir.path().join(".moldable.port");

    fs::write(&port_file, "3001\n").unwrap();

    let content = fs::read_to_string(&port_file).unwrap();
    let port: u16 = content.trim().parse().unwrap();

    assert_eq!(port, 3001);
}

// ==================== EDGE CASE TESTS ====================

#[test]
fn test_empty_args_with_port_forwarding() {
    let args: Vec<String> = vec![];
    let result = with_script_args_forwarded("pnpm", args, Some(3000));
    assert_eq!(result, vec!["--", "-p", "3000"]);
}

#[test]
fn test_args_with_multiple_separators() {
    // Only the first -- should be treated as separator
    let args = vec![
        "dev".to_string(),
        "--".to_string(),
        "extra".to_string(),
        "--".to_string(),
        "more".to_string(),
    ];
    let result = with_script_args_forwarded("pnpm", args, Some(3000));

    // Should insert -p after first --, updating existing port if present
    assert!(result.contains(&"-p".to_string()));
    assert!(result.contains(&"3000".to_string()));
}

#[test]
fn test_unicode_in_app_names() {
    let app = RegisteredApp {
        id: "scribo".to_string(),
        name: "Scribo 語言學習".to_string(),
        icon: "✍️".to_string(),
        icon_path: None,
        port: 3001,
        path: "/path/to/app".to_string(),
        command: "pnpm".to_string(),
        args: vec!["dev".to_string()],
        widget_size: "medium".to_string(),
        requires_port: false,
    };

    let json = serde_json::to_string(&app).unwrap();
    let parsed: RegisteredApp = serde_json::from_str(&json).unwrap();

    assert_eq!(parsed.name, "Scribo 語言學習");
    assert_eq!(parsed.icon, "✍️");
}

#[test]
fn test_workspace_id_generation_from_name() {
    // Test that workspace IDs are generated correctly from names
    let test_cases = vec![
        ("Personal", "personal"),
        ("Work Projects", "work-projects"),
        ("My Side Project", "my-side-project"),
        ("Test  Multiple   Spaces", "test-multiple-spaces"),
    ];

    for (name, expected_id) in test_cases {
        let id: String = name
            .to_lowercase()
            .chars()
            .map(|c| if c.is_alphanumeric() { c } else { '-' })
            .collect::<String>()
            .split('-')
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join("-");

        assert_eq!(
            id, expected_id,
            "Name '{}' should produce ID '{}'",
            name, expected_id
        );
    }
}

#[test]
fn test_port_range() {
    // Test that port values are within valid range
    let app = RegisteredApp {
        id: "test".to_string(),
        name: "Test".to_string(),
        icon: "📦".to_string(),
        icon_path: None,
        port: 65535, // Max valid port
        path: "/test".to_string(),
        command: "pnpm".to_string(),
        args: vec!["dev".to_string()],
        widget_size: "medium".to_string(),
        requires_port: false,
    };

    let json = serde_json::to_string(&app).unwrap();
    let parsed: RegisteredApp = serde_json::from_str(&json).unwrap();
    assert_eq!(parsed.port, 65535);
}

#[test]
fn test_env_file_special_characters() {
    let dir = TempDir::new().unwrap();
    let content = r#"API_KEY=sk-ant-api03-abc123XYZ_-
DATABASE_URL=postgres://user:p@ss!word@localhost:5432/db
JSON_CONFIG={"key": "value", "nested": {"a": 1}}"#;
    let path = create_temp_env_file(&dir, ".env", content);

    let env = parse_env_file(&path);

    assert_eq!(
        env.get("API_KEY"),
        Some(&"sk-ant-api03-abc123XYZ_-".to_string())
    );
    assert!(env.get("DATABASE_URL").is_some());
    assert!(env.get("JSON_CONFIG").is_some());
}

#[test]
fn test_multiple_apps_registration() {
    let config = MoldableConfig {
        workspace: None,
        apps: vec![
            RegisteredApp {
                id: "app1".to_string(),
                name: "App 1".to_string(),
                icon: "1️⃣".to_string(),
                icon_path: None,
                port: 3001,
                path: "/app1".to_string(),
                command: "pnpm".to_string(),
                args: vec!["dev".to_string()],
                widget_size: "small".to_string(),
                requires_port: false,
            },
            RegisteredApp {
                id: "app2".to_string(),
                name: "App 2".to_string(),
                icon: "2️⃣".to_string(),
                icon_path: None,
                port: 3002,
                path: "/app2".to_string(),
                command: "pnpm".to_string(),
                args: vec!["dev".to_string()],
                widget_size: "medium".to_string(),
                requires_port: true,
            },
            RegisteredApp {
                id: "app3".to_string(),
                name: "App 3".to_string(),
                icon: "3️⃣".to_string(),
                icon_path: None,
                port: 3003,
                path: "/app3".to_string(),
                command: "pnpm".to_string(),
                args: vec!["dev".to_string()],
                widget_size: "large".to_string(),
                requires_port: false,
            },
        ],
        preferences: serde_json::Map::new(),
    };

    let json = serde_json::to_string(&config).unwrap();
    let parsed: MoldableConfig = serde_json::from_str(&json).unwrap();

    assert_eq!(parsed.apps.len(), 3);

    // Verify each app has unique port
    let ports: Vec<u16> = parsed.apps.iter().map(|a| a.port).collect();
    let unique_ports: std::collections::HashSet<u16> = ports.iter().cloned().collect();
    assert_eq!(ports.len(), unique_ports.len());
}

// ==================== INTEGRATION-STYLE TESTS ====================

#[test]
fn test_full_workspace_config_roundtrip() {
    let config = WorkspacesConfig {
        active_workspace: "work".to_string(),
        workspaces: vec![
            Workspace {
                id: "personal".to_string(),
                name: "Personal".to_string(),
                color: "#10b981".to_string(),
                created_at: "2026-01-01T00:00:00Z".to_string(),
            },
            Workspace {
                id: "work".to_string(),
                name: "Work".to_string(),
                color: "#3b82f6".to_string(),
                created_at: "2026-01-02T00:00:00Z".to_string(),
            },
            Workspace {
                id: "side-project".to_string(),
                name: "Side Project".to_string(),
                color: "#ef4444".to_string(),
                created_at: "2026-01-03T00:00:00Z".to_string(),
            },
        ],
    };

    // Serialize
    let json = serde_json::to_string_pretty(&config).unwrap();

    // Parse back
    let parsed: WorkspacesConfig = serde_json::from_str(&json).unwrap();

    assert_eq!(parsed.active_workspace, config.active_workspace);
    assert_eq!(parsed.workspaces.len(), config.workspaces.len());

    for (original, parsed_ws) in config.workspaces.iter().zip(parsed.workspaces.iter()) {
        assert_eq!(original.id, parsed_ws.id);
        assert_eq!(original.name, parsed_ws.name);
        assert_eq!(original.color, parsed_ws.color);
        assert_eq!(original.created_at, parsed_ws.created_at);
    }
}

#[test]
fn test_full_moldable_config_roundtrip() {
    let mut preferences = serde_json::Map::new();
    preferences.insert("theme".to_string(), serde_json::json!("dark"));
    preferences.insert("model".to_string(), serde_json::json!("claude-3-opus"));

    let config = MoldableConfig {
        workspace: Some("/Users/test/moldable".to_string()),
        apps: vec![
            RegisteredApp {
                id: "scribo".to_string(),
                name: "Scribo".to_string(),
                icon: "✍️".to_string(),
                icon_path: None,
                port: 3001,
                path: "/path/to/scribo".to_string(),
                command: "/opt/homebrew/bin/pnpm".to_string(),
                args: vec!["dev".to_string()],
                widget_size: "medium".to_string(),
                requires_port: false,
            },
            RegisteredApp {
                id: "todo".to_string(),
                name: "Todo".to_string(),
                icon: "✅".to_string(),
                icon_path: None,
                port: 3002,
                path: "/path/to/todo".to_string(),
                command: "/opt/homebrew/bin/pnpm".to_string(),
                args: vec!["dev".to_string()],
                widget_size: "small".to_string(),
                requires_port: true,
            },
        ],
        preferences,
    };

    let json = serde_json::to_string_pretty(&config).unwrap();
    let parsed: MoldableConfig = serde_json::from_str(&json).unwrap();

    assert_eq!(parsed.workspace, config.workspace);
    assert_eq!(parsed.apps.len(), config.apps.len());
    assert_eq!(parsed.preferences.len(), 2);
}

#[test]
fn test_complete_workspace_setup() {
    let env = TempMoldableEnv::new();

    // Create workspaces config
    let workspaces_config = WorkspacesConfig {
        active_workspace: "personal".to_string(),
        workspaces: vec![
            Workspace {
                id: "personal".to_string(),
                name: "Personal".to_string(),
                color: "#10b981".to_string(),
                created_at: "2026-01-01T00:00:00Z".to_string(),
            },
            Workspace {
                id: "work".to_string(),
                name: "Work".to_string(),
                color: "#3b82f6".to_string(),
                created_at: "2026-01-02T00:00:00Z".to_string(),
            },
        ],
    };
    env.create_workspaces_config(&workspaces_config);

    // Create workspace directories
    env.create_workspace_dir("personal");
    env.create_workspace_dir("work");
    env.create_shared_dir();

    // Create shared env
    env.create_shared_env_file("ANTHROPIC_API_KEY=sk-shared-key");

    // Create workspace-specific env
    env.create_env_file("personal", "PERSONAL_KEY=personal-value");
    env.create_env_file("work", "WORK_KEY=work-value");

    // Create workspace configs
    let personal_config = MoldableConfig {
        workspace: None,
        apps: vec![RegisteredApp {
            id: "personal-app".to_string(),
            name: "Personal App".to_string(),
            icon: "🏠".to_string(),
            icon_path: None,
            port: 3001,
            path: "/personal-app".to_string(),
            command: "pnpm".to_string(),
            args: vec!["dev".to_string()],
            widget_size: "medium".to_string(),
            requires_port: false,
        }],
        preferences: serde_json::Map::new(),
    };
    env.create_workspace_config("personal", &personal_config);

    let work_config = MoldableConfig {
        workspace: None,
        apps: vec![RegisteredApp {
            id: "work-app".to_string(),
            name: "Work App".to_string(),
            icon: "💼".to_string(),
            icon_path: None,
            port: 3002,
            path: "/work-app".to_string(),
            command: "pnpm".to_string(),
            args: vec!["dev".to_string()],
            widget_size: "large".to_string(),
            requires_port: true,
        }],
        preferences: serde_json::Map::new(),
    };
    env.create_workspace_config("work", &work_config);

    // Verify everything exists and is readable
    let read_workspaces = env.read_workspaces_config();
    assert_eq!(read_workspaces.workspaces.len(), 2);

    let read_personal = env.read_workspace_config("personal");
    assert_eq!(read_personal.apps.len(), 1);
    assert_eq!(read_personal.apps[0].id, "personal-app");

    let read_work = env.read_workspace_config("work");
    assert_eq!(read_work.apps.len(), 1);
    assert_eq!(read_work.apps[0].id, "work-app");

    // Verify env layering for personal workspace
    let shared = parse_env_file(&env.moldable_root.join("shared/.env"));
    let personal_env = parse_env_file(&env.moldable_root.join("workspaces/personal/.env"));
    let mut merged = shared.clone();
    merged.extend(personal_env);
    assert_eq!(
        merged.get("ANTHROPIC_API_KEY"),
        Some(&"sk-shared-key".to_string())
    );
    assert_eq!(
        merged.get("PERSONAL_KEY"),
        Some(&"personal-value".to_string())
    );

    // Verify env layering for work workspace
    let work_env = parse_env_file(&env.moldable_root.join("workspaces/work/.env"));
    let mut work_merged = shared;
    work_merged.extend(work_env);
    assert_eq!(
        work_merged.get("ANTHROPIC_API_KEY"),
        Some(&"sk-shared-key".to_string())
    );
    assert_eq!(work_merged.get("WORK_KEY"), Some(&"work-value".to_string()));
}

// ==================== APP STATE TESTS ====================

#[test]
fn test_app_state_inner_default() {
    let state = AppStateInner {
        processes: HashMap::new(),
        last_errors: HashMap::new(),
    };

    assert!(state.processes.is_empty());
    assert!(state.last_errors.is_empty());
}

// ==================== STRESS TESTS ====================

#[test]
fn test_many_env_vars() {
    let dir = TempDir::new().unwrap();

    // Create env file with many variables
    let mut content = String::new();
    for i in 0..100 {
        content.push_str(&format!("KEY_{}=value_{}\n", i, i));
    }
    let path = create_temp_env_file(&dir, ".env", &content);

    let env = parse_env_file(&path);

    assert_eq!(env.len(), 100);
    assert_eq!(env.get("KEY_0"), Some(&"value_0".to_string()));
    assert_eq!(env.get("KEY_99"), Some(&"value_99".to_string()));
}

#[test]
fn test_many_workspaces() {
    let workspaces: Vec<Workspace> = (0..50)
        .map(|i| Workspace {
            id: format!("workspace-{}", i),
            name: format!("Workspace {}", i),
            color: format!("#{:06x}", i * 10000),
            created_at: "2026-01-01T00:00:00Z".to_string(),
        })
        .collect();

    let config = WorkspacesConfig {
        active_workspace: "workspace-25".to_string(),
        workspaces,
    };

    let json = serde_json::to_string(&config).unwrap();
    let parsed: WorkspacesConfig = serde_json::from_str(&json).unwrap();

    assert_eq!(parsed.workspaces.len(), 50);
    assert_eq!(parsed.active_workspace, "workspace-25");
}

#[test]
fn test_many_apps() {
    let apps: Vec<RegisteredApp> = (0..100)
        .map(|i| RegisteredApp {
            id: format!("app-{}", i),
            name: format!("App {}", i),
            icon: "📦".to_string(),
            icon_path: None,
            port: 3000 + i,
            path: format!("/path/to/app-{}", i),
            command: "pnpm".to_string(),
            args: vec!["dev".to_string()],
            widget_size: "medium".to_string(),
            requires_port: false,
        })
        .collect();

    let config = MoldableConfig {
        workspace: None,
        apps,
        preferences: serde_json::Map::new(),
    };

    let json = serde_json::to_string(&config).unwrap();
    let parsed: MoldableConfig = serde_json::from_str(&json).unwrap();

    assert_eq!(parsed.apps.len(), 100);
}

// ==================== ERROR HANDLING TESTS ====================

#[test]
fn test_invalid_json_parsing() {
    let invalid_json = "{ invalid json }";
    let result: Result<MoldableConfig, _> = serde_json::from_str(invalid_json);
    assert!(result.is_err());
}

#[test]
fn test_missing_required_fields() {
    // RegisteredApp without required fields should fail
    let json = r#"{"id": "test"}"#;
    let result: Result<RegisteredApp, _> = serde_json::from_str(json);
    assert!(result.is_err());
}

#[test]
fn test_wrong_type_fields() {
    // Port should be a number, not a string
    let json = r#"{
        "id": "test",
        "name": "Test",
        "icon": "📦",
        "port": "not a number",
        "path": "/test",
        "command": "pnpm",
        "args": ["dev"]
    }"#;
    let result: Result<RegisteredApp, _> = serde_json::from_str(json);
    assert!(result.is_err());
}

#[test]
fn test_malformed_workspaces_config() {
    let json = r#"{"activeWorkspace": 123, "workspaces": "not an array"}"#;
    let result: Result<WorkspacesConfig, _> = serde_json::from_str(json);
    assert!(result.is_err());
}

#[test]
fn test_empty_workspaces_array() {
    let json = r#"{"activeWorkspace": "personal", "workspaces": []}"#;
    let result: Result<WorkspacesConfig, _> = serde_json::from_str(json);
    assert!(result.is_ok());
    let config = result.unwrap();
    assert!(config.workspaces.is_empty());
}

// ==================== APP REGISTRY TESTS ====================

#[test]
fn test_app_registry_entry_serialization() {
    let entry = AppRegistryEntry {
        id: "scribo".to_string(),
        name: "Scribo".to_string(),
        version: "0.1.0".to_string(),
        description: Some("A translation journal app".to_string()),
        icon: "✍️".to_string(),
        icon_url: Some("https://example.com/icon.png".to_string()),
        widget_size: "medium".to_string(),
        category: Some("productivity".to_string()),
        tags: Some(vec!["translation".to_string(), "language".to_string()]),
        path: "scribo".to_string(),
        required_env: Some(vec!["OPENAI_API_KEY".to_string()]),
        moldable_dependencies: None,
        commit: "abc123def456".to_string(),
    };

    let json = serde_json::to_string(&entry).unwrap();
    let parsed: AppRegistryEntry = serde_json::from_str(&json).unwrap();

    assert_eq!(parsed.id, "scribo");
    assert_eq!(parsed.version, "0.1.0");
    assert_eq!(parsed.commit, "abc123def456");
    assert_eq!(parsed.widget_size, "medium");
}

#[test]
fn test_app_registry_entry_camel_case() {
    let entry = AppRegistryEntry {
        id: "test".to_string(),
        name: "Test".to_string(),
        version: "1.0.0".to_string(),
        description: None,
        icon: "📦".to_string(),
        icon_url: None,
        widget_size: "small".to_string(),
        category: None,
        tags: None,
        path: "test".to_string(),
        required_env: Some(vec!["API_KEY".to_string()]),
        moldable_dependencies: None,
        commit: "deadbeef".to_string(),
    };

    let json = serde_json::to_string(&entry).unwrap();

    // Verify camelCase is used
    assert!(json.contains("widgetSize"));
    assert!(json.contains("iconUrl"));
    assert!(json.contains("requiredEnv"));
    assert!(json.contains("moldableDependencies"));
    assert!(!json.contains("widget_size"));
    assert!(!json.contains("icon_url"));
}

#[test]
fn test_app_registry_entry_minimal() {
    let json = r#"{
        "id": "minimal-app",
        "name": "Minimal App",
        "version": "0.0.1",
        "icon": "📦",
        "widgetSize": "medium",
        "path": "minimal-app",
        "commit": "abc123"
    }"#;

    let entry: AppRegistryEntry = serde_json::from_str(json).unwrap();

    assert_eq!(entry.id, "minimal-app");
    assert!(entry.description.is_none());
    assert!(entry.icon_url.is_none());
    assert!(entry.category.is_none());
    assert!(entry.tags.is_none());
    assert!(entry.required_env.is_none());
    assert!(entry.moldable_dependencies.is_none());
}

#[test]
fn test_category_serialization() {
    let category = Category {
        id: "productivity".to_string(),
        name: "Productivity".to_string(),
        icon: "⚡".to_string(),
    };

    let json = serde_json::to_string(&category).unwrap();
    let parsed: Category = serde_json::from_str(&json).unwrap();

    assert_eq!(parsed.id, "productivity");
    assert_eq!(parsed.name, "Productivity");
    assert_eq!(parsed.icon, "⚡");
}

#[test]
fn test_app_registry_full() {
    let registry = AppRegistry {
        schema: Some("https://moldable.sh/schemas/manifest.json".to_string()),
        version: "1".to_string(),
        generated_at: Some("2026-01-14T10:00:00Z".to_string()),
        registry: "moldable-ai/apps".to_string(),
        apps: vec![
            AppRegistryEntry {
                id: "app1".to_string(),
                name: "App 1".to_string(),
                version: "1.0.0".to_string(),
                description: Some("First app".to_string()),
                icon: "1️⃣".to_string(),
                icon_url: None,
                widget_size: "small".to_string(),
                category: Some("productivity".to_string()),
                tags: None,
                path: "app1".to_string(),
                required_env: None,
                moldable_dependencies: None,
                commit: "commit1".to_string(),
            },
            AppRegistryEntry {
                id: "app2".to_string(),
                name: "App 2".to_string(),
                version: "2.0.0".to_string(),
                description: None,
                icon: "2️⃣".to_string(),
                icon_url: None,
                widget_size: "large".to_string(),
                category: Some("developer".to_string()),
                tags: Some(vec!["dev".to_string()]),
                path: "app2".to_string(),
                required_env: Some(vec!["SECRET_KEY".to_string()]),
                moldable_dependencies: None,
                commit: "commit2".to_string(),
            },
        ],
        categories: Some(vec![
            Category {
                id: "productivity".to_string(),
                name: "Productivity".to_string(),
                icon: "⚡".to_string(),
            },
            Category {
                id: "developer".to_string(),
                name: "Developer Tools".to_string(),
                icon: "🛠️".to_string(),
            },
        ]),
    };

    let json = serde_json::to_string(&registry).unwrap();
    let parsed: AppRegistry = serde_json::from_str(&json).unwrap();

    assert_eq!(parsed.version, "1");
    assert_eq!(parsed.registry, "moldable-ai/apps");
    assert_eq!(parsed.apps.len(), 2);
    assert_eq!(parsed.categories.unwrap().len(), 2);
}

#[test]
fn test_app_registry_camel_case() {
    let registry = AppRegistry {
        schema: Some("https://moldable.sh/schemas/manifest.json".to_string()),
        version: "1".to_string(),
        generated_at: Some("2026-01-14T10:00:00Z".to_string()),
        registry: "moldable-ai/apps".to_string(),
        apps: vec![],
        categories: None,
    };

    let json = serde_json::to_string(&registry).unwrap();

    // Verify $schema is preserved and generatedAt uses camelCase
    assert!(json.contains("\"$schema\""));
    assert!(json.contains("generatedAt"));
    assert!(!json.contains("generated_at"));
}

#[test]
fn test_app_registry_from_github_format() {
    // This is the format returned by the GitHub manifest
    let json = r#"{
        "$schema": "https://moldable.sh/schemas/manifest.json",
        "version": "1",
        "generatedAt": "2026-01-15T04:20:46.412Z",
        "registry": "moldable-ai/apps",
        "apps": [
            {
                "id": "calendar",
                "name": "Calendar",
                "version": "0.1.0",
                "description": "Integrated calendar with Google Calendar connection",
                "icon": "🗓️",
                "iconUrl": "https://raw.githubusercontent.com/moldable-ai/apps/main/calendar/public/icon.png",
                "widgetSize": "medium",
                "category": "productivity",
                "tags": ["calendar", "schedule"],
                "path": "calendar",
                "requiredEnv": ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
                "moldableDependencies": {},
                "commit": "994b1cc123456789"
            }
        ],
        "categories": [
            {"id": "productivity", "name": "Productivity", "icon": "⚡"}
        ]
    }"#;

    let registry: AppRegistry = serde_json::from_str(json).unwrap();

    assert_eq!(registry.version, "1");
    assert_eq!(registry.registry, "moldable-ai/apps");
    assert_eq!(registry.apps.len(), 1);
    assert_eq!(registry.apps[0].id, "calendar");
    assert_eq!(registry.apps[0].commit, "994b1cc123456789");
    assert_eq!(
        registry.apps[0].required_env,
        Some(vec![
            "GOOGLE_CLIENT_ID".to_string(),
            "GOOGLE_CLIENT_SECRET".to_string()
        ])
    );
}

#[test]
fn test_app_registry_with_moldable_dependencies() {
    let mut deps = std::collections::HashMap::new();
    deps.insert("@moldable-ai/ui".to_string(), "^0.1.0".to_string());
    deps.insert("@moldable-ai/storage".to_string(), "^0.1.0".to_string());

    let entry = AppRegistryEntry {
        id: "test".to_string(),
        name: "Test".to_string(),
        version: "1.0.0".to_string(),
        description: None,
        icon: "📦".to_string(),
        icon_url: None,
        widget_size: "medium".to_string(),
        category: None,
        tags: None,
        path: "test".to_string(),
        required_env: None,
        moldable_dependencies: Some(deps),
        commit: "abc123".to_string(),
    };

    let json = serde_json::to_string(&entry).unwrap();
    let parsed: AppRegistryEntry = serde_json::from_str(&json).unwrap();

    let parsed_deps = parsed.moldable_dependencies.unwrap();
    assert_eq!(parsed_deps.get("@moldable-ai/ui"), Some(&"^0.1.0".to_string()));
    assert_eq!(
        parsed_deps.get("@moldable-ai/storage"),
        Some(&"^0.1.0".to_string())
    );
}

// ==================== SHARED APPS DIRECTORY TESTS ====================

#[test]
fn test_shared_apps_directory_structure() {
    let env = TempMoldableEnv::new();

    // Create shared apps directory
    let shared_apps_dir = env.moldable_root.join("shared/apps");
    fs::create_dir_all(&shared_apps_dir).unwrap();

    // Simulate installing an app to shared location
    let app_dir = shared_apps_dir.join("scribo");
    fs::create_dir_all(&app_dir).unwrap();

    // Create a moldable.json for the app
    let manifest = serde_json::json!({
        "name": "Scribo",
        "icon": "✍️",
        "version": "0.1.0",
        "upstream": {
            "repo": "moldable-ai/apps",
            "path": "scribo",
            "installedVersion": "0.1.0",
            "installedCommit": "abc123",
            "installedAt": "2026-01-14T10:00:00Z"
        },
        "modified": false
    });
    fs::write(
        app_dir.join("moldable.json"),
        serde_json::to_string_pretty(&manifest).unwrap(),
    )
    .unwrap();

    // Verify structure
    assert!(env.moldable_root.join("shared/apps/scribo").exists());
    assert!(env
        .moldable_root
        .join("shared/apps/scribo/moldable.json")
        .exists());
}

#[test]
fn test_app_shared_across_workspaces() {
    let env = TempMoldableEnv::new();

    // Create shared app directory (app code lives here)
    let shared_apps_dir = env.moldable_root.join("shared/apps");
    fs::create_dir_all(shared_apps_dir.join("notes")).unwrap();

    // Create two workspaces
    env.create_workspace_dir("personal");
    env.create_workspace_dir("work");

    // Both workspaces register the same shared app
    let app_registration = RegisteredApp {
        id: "notes".to_string(),
        name: "Notes".to_string(),
        icon: "📝".to_string(),
        icon_path: None,
        port: 3001,
        path: env
            .moldable_root
            .join("shared/apps/notes")
            .to_string_lossy()
            .to_string(),
        command: "pnpm".to_string(),
        args: vec!["dev".to_string()],
        widget_size: "medium".to_string(),
        requires_port: false,
    };

    // Register in personal workspace
    let personal_config = MoldableConfig {
        workspace: None,
        apps: vec![app_registration.clone()],
        preferences: serde_json::Map::new(),
    };
    env.create_workspace_config("personal", &personal_config);

    // Register in work workspace (same app, same path)
    let work_config = MoldableConfig {
        workspace: None,
        apps: vec![app_registration],
        preferences: serde_json::Map::new(),
    };
    env.create_workspace_config("work", &work_config);

    // Verify both workspaces have the app registered
    let read_personal = env.read_workspace_config("personal");
    let read_work = env.read_workspace_config("work");

    assert_eq!(read_personal.apps.len(), 1);
    assert_eq!(read_work.apps.len(), 1);

    // Both point to the same shared path
    assert_eq!(read_personal.apps[0].path, read_work.apps[0].path);
    assert!(read_personal.apps[0].path.contains("shared/apps/notes"));
}

#[test]
fn test_workspace_app_data_isolation() {
    let env = TempMoldableEnv::new();

    // Create workspace data directories for app-specific data
    let personal_data = env
        .moldable_root
        .join("workspaces/personal/apps/notes/data");
    let work_data = env.moldable_root.join("workspaces/work/apps/notes/data");

    fs::create_dir_all(&personal_data).unwrap();
    fs::create_dir_all(&work_data).unwrap();

    // Write different data to each workspace
    fs::write(personal_data.join("notes.db"), "personal data").unwrap();
    fs::write(work_data.join("notes.db"), "work data").unwrap();

    // Verify data is isolated
    let personal_content = fs::read_to_string(personal_data.join("notes.db")).unwrap();
    let work_content = fs::read_to_string(work_data.join("notes.db")).unwrap();

    assert_eq!(personal_content, "personal data");
    assert_eq!(work_content, "work data");
    assert_ne!(personal_content, work_content);
}

#[test]
fn test_check_app_registered_in_workspace() {
    let env = TempMoldableEnv::new();
    env.create_workspace_dir("personal");
    env.create_workspace_dir("work");

    // Register app only in personal workspace
    let personal_config = MoldableConfig {
        workspace: None,
        apps: vec![RegisteredApp {
            id: "scribo".to_string(),
            name: "Scribo".to_string(),
            icon: "✍️".to_string(),
            icon_path: None,
            port: 3001,
            path: "/shared/apps/scribo".to_string(),
            command: "pnpm".to_string(),
            args: vec!["dev".to_string()],
            widget_size: "medium".to_string(),
            requires_port: false,
        }],
        preferences: serde_json::Map::new(),
    };
    env.create_workspace_config("personal", &personal_config);

    // Work workspace has no apps
    let work_config = MoldableConfig {
        workspace: None,
        apps: vec![],
        preferences: serde_json::Map::new(),
    };
    env.create_workspace_config("work", &work_config);

    // Check registrations
    let read_personal = env.read_workspace_config("personal");
    let read_work = env.read_workspace_config("work");

    // App is registered in personal
    assert!(read_personal.apps.iter().any(|a| a.id == "scribo"));

    // App is NOT registered in work
    assert!(!read_work.apps.iter().any(|a| a.id == "scribo"));
}

#[test]
fn test_same_app_different_ports_per_workspace() {
    // While app code is shared, each workspace can configure different ports
    let env = TempMoldableEnv::new();
    env.create_workspace_dir("personal");
    env.create_workspace_dir("work");

    let personal_config = MoldableConfig {
        workspace: None,
        apps: vec![RegisteredApp {
            id: "notes".to_string(),
            name: "Notes".to_string(),
            icon: "📝".to_string(),
            icon_path: None,
            port: 3001, // Personal uses port 3001
            path: "/shared/apps/notes".to_string(),
            command: "pnpm".to_string(),
            args: vec!["dev".to_string()],
            widget_size: "medium".to_string(),
            requires_port: false,
        }],
        preferences: serde_json::Map::new(),
    };
    env.create_workspace_config("personal", &personal_config);

    let work_config = MoldableConfig {
        workspace: None,
        apps: vec![RegisteredApp {
            id: "notes".to_string(),
            name: "Notes".to_string(),
            icon: "📝".to_string(),
            icon_path: None,
            port: 4001, // Work uses port 4001
            path: "/shared/apps/notes".to_string(),
            command: "pnpm".to_string(),
            args: vec!["dev".to_string()],
            widget_size: "large".to_string(), // Can also have different widget size
            requires_port: false,
        }],
        preferences: serde_json::Map::new(),
    };
    env.create_workspace_config("work", &work_config);

    let read_personal = env.read_workspace_config("personal");
    let read_work = env.read_workspace_config("work");

    // Same app ID, same path
    assert_eq!(read_personal.apps[0].id, read_work.apps[0].id);
    assert_eq!(read_personal.apps[0].path, read_work.apps[0].path);

    // Different ports and widget sizes
    assert_ne!(read_personal.apps[0].port, read_work.apps[0].port);
    assert_ne!(read_personal.apps[0].widget_size, read_work.apps[0].widget_size);
}

// ==================== WORKSPACE ISOLATION TESTS ====================

#[test]
fn test_workspace_directory_isolation() {
    let env = TempMoldableEnv::new();

    // Create two completely separate workspaces
    env.create_workspace_dir("personal");
    env.create_workspace_dir("work");

    let personal_config = MoldableConfig {
        workspace: None,
        apps: vec![RegisteredApp {
            id: "personal-app".to_string(),
            name: "Personal App".to_string(),
            icon: "🏠".to_string(),
            icon_path: None,
            port: 3001,
            path: "/personal".to_string(),
            command: "pnpm".to_string(),
            args: vec!["dev".to_string()],
            widget_size: "medium".to_string(),
            requires_port: false,
        }],
        preferences: serde_json::Map::new(),
    };

    let work_config = MoldableConfig {
        workspace: None,
        apps: vec![RegisteredApp {
            id: "work-app".to_string(),
            name: "Work App".to_string(),
            icon: "💼".to_string(),
            icon_path: None,
            port: 3001, // Same port is fine - different workspace
            path: "/work".to_string(),
            command: "pnpm".to_string(),
            args: vec!["dev".to_string()],
            widget_size: "large".to_string(),
            requires_port: false,
        }],
        preferences: serde_json::Map::new(),
    };

    env.create_workspace_config("personal", &personal_config);
    env.create_workspace_config("work", &work_config);

    // Verify they're isolated
    let read_personal = env.read_workspace_config("personal");
    let read_work = env.read_workspace_config("work");

    assert_eq!(read_personal.apps[0].id, "personal-app");
    assert_eq!(read_work.apps[0].id, "work-app");

    // Both can use same port (they're isolated)
    assert_eq!(read_personal.apps[0].port, read_work.apps[0].port);
}
