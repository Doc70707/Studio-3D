//! Safe file reads and writes for projects and exports.
//!
//! Writes are atomic: the new content goes to a temporary file next to the target, is flushed
//! to disk, and only then renamed over the target. A crash or power cut mid-save leaves either
//! the old file or the new one, never half of each. The previous version is kept as `<name>.bak`.

use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};

/// Projects are small parameter files; anything bigger is not something we wrote.
pub const MAX_PROJECT_BYTES: u64 = 50 * 1024 * 1024;

pub fn check_extension(path: &Path, allowed: &[&str]) -> Result<(), String> {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();
    if allowed.iter().any(|a| *a == ext) {
        Ok(())
    } else {
        Err(format!("Studio 3D can only use .{} files here.", allowed.join(" or .")))
    }
}

pub fn read_limited(path: &Path, max: u64) -> Result<Vec<u8>, String> {
    let meta = fs::metadata(path).map_err(|e| format!("Couldn't open the file: {e}"))?;
    if meta.len() > max {
        return Err(format!(
            "This file is too large to be a Studio 3D project ({} MB).",
            meta.len() / (1024 * 1024)
        ));
    }
    fs::read(path).map_err(|e| format!("Couldn't read the file: {e}"))
}

fn sibling(path: &Path, suffix: &str) -> PathBuf {
    let mut name = path.file_name().unwrap_or_default().to_os_string();
    name.push(suffix);
    path.with_file_name(name)
}

pub fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let tmp = sibling(path, &format!(".tmp-{}", std::process::id()));
    let result = (|| {
        let mut f = File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
        drop(f);
        if path.exists() {
            fs::copy(path, sibling(path, ".bak"))?;
        }
        // On Windows this replaces the existing file (MoveFileEx with REPLACE_EXISTING).
        fs::rename(&tmp, path)
    })();
    if let Err(e) = result {
        let _ = fs::remove_file(&tmp);
        return Err(format!("Couldn't save the file: {e}. Your previous file was not changed."));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("studio3d-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn writes_new_file_without_leaving_temp_files() {
        let dir = temp_dir("new");
        let p = dir.join("part.s3d");
        write_atomic(&p, b"one").unwrap();
        assert_eq!(fs::read(&p).unwrap(), b"one");
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 1);
    }

    #[test]
    fn replaces_existing_file_and_keeps_backup() {
        let dir = temp_dir("replace");
        let p = dir.join("part.s3d");
        write_atomic(&p, b"one").unwrap();
        write_atomic(&p, b"two").unwrap();
        assert_eq!(fs::read(&p).unwrap(), b"two");
        assert_eq!(fs::read(dir.join("part.s3d.bak")).unwrap(), b"one");
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 2);
    }

    #[test]
    fn failed_write_leaves_original_untouched() {
        let dir = temp_dir("fail");
        let missing_dir = dir.join("does-not-exist").join("part.s3d");
        assert!(write_atomic(&missing_dir, b"x").is_err());
        let p = dir.join("part.s3d");
        write_atomic(&p, b"original").unwrap();
        // A directory where the temp file should go makes the write fail.
        fs::create_dir(sibling(&p, &format!(".tmp-{}", std::process::id()))).unwrap();
        assert!(write_atomic(&p, b"new").is_err());
        assert_eq!(fs::read(&p).unwrap(), b"original");
    }

    #[test]
    fn extension_and_size_checks() {
        assert!(check_extension(Path::new("a.S3D"), &["s3d"]).is_ok());
        assert!(check_extension(Path::new("a.exe"), &["s3d"]).is_err());
        assert!(check_extension(Path::new("noext"), &["stl"]).is_err());
        let dir = temp_dir("size");
        let p = dir.join("big.s3d");
        fs::write(&p, vec![0u8; 2048]).unwrap();
        assert!(read_limited(&p, 1024).is_err());
        assert_eq!(read_limited(&p, 4096).unwrap().len(), 2048);
    }
}
