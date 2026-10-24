//! Handing a part to a slicer the user installed: Bambu Studio, OrcaSlicer, PrusaSlicer, or any other they pick.
//!
//! The slicer runs as its own program, opened with the file the way double-clicking it would. Nothing of the slicer is
//! linked or bundled. The file always goes to Studio 3D's own hand-off folder, written here, so the only things the
//! interface can ask for are "write this part there" and "open it with this program".

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Child, Command};

pub struct Known {
    pub id: &'static str,
    pub name: &'static str,
    /// Where the maker's installer puts the program, under Program Files (or the user's own programs folder).
    pub install: &'static str,
}

pub const KNOWN: [Known; 3] = [
    Known { id: "bambu-studio", name: "Bambu Studio", install: "Bambu Studio/bambu-studio.exe" },
    Known { id: "orca-slicer", name: "OrcaSlicer", install: "OrcaSlicer/orca-slicer.exe" },
    Known { id: "prusa-slicer", name: "PrusaSlicer", install: "Prusa3D/PrusaSlicer/prusa-slicer.exe" },
];

#[derive(Debug, PartialEq)]
pub struct Found {
    pub id: String,
    pub name: String,
    pub path: PathBuf,
}

/// The folders programs are installed in on Windows.
pub fn program_folders() -> Vec<PathBuf> {
    let mut roots: Vec<PathBuf> = ["ProgramW6432", "ProgramFiles", "ProgramFiles(x86)"]
        .iter()
        .filter_map(|v| std::env::var_os(v).map(PathBuf::from))
        .collect();
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        roots.push(PathBuf::from(local).join("Programs"));
    }
    roots.dedup();
    roots
}

/// Every known slicer installed in one of `roots`, first copy of each.
pub fn find(roots: &[PathBuf]) -> Vec<Found> {
    KNOWN
        .iter()
        .filter_map(|k| {
            roots.iter().map(|r| r.join(k.install)).find(|p| p.is_file()).map(|path| Found {
                id: k.id.into(),
                name: k.name.into(),
                path,
            })
        })
        .collect()
}

/// A program the user picked must be a program file that is really there.
pub fn check_program(path: &Path) -> Result<(), String> {
    if !path.is_file() {
        return Err("Studio 3D can't find that slicer any more. Locate it again.".into());
    }
    if cfg!(windows) && !path.extension().is_some_and(|e| e.eq_ignore_ascii_case("exe")) {
        return Err("Pick the slicer's program file (it ends in .exe).".into());
    }
    Ok(())
}

/// A file name made only of characters every system accepts, so the part's name can't reach outside the folder.
pub fn safe_name(name: &str, ext: &str) -> String {
    let stem: String = name
        .chars()
        .map(|c| if c.is_alphanumeric() || " -_()".contains(c) { c } else { '_' })
        .collect::<String>()
        .trim()
        .chars()
        .take(80)
        .collect();
    format!("{}.{ext}", if stem.trim_matches('_').is_empty() { "part".into() } else { stem })
}

/// Writes the part to the hand-off folder and returns where it went.
pub fn write_handoff(dir: &Path, name: &str, ext: &str, bytes: &[u8]) -> Result<PathBuf, String> {
    if ext != "3mf" && ext != "stl" {
        return Err("Studio 3D only hands .3mf and .stl files to a slicer.".into());
    }
    fs::create_dir_all(dir).map_err(|e| format!("Couldn't make a folder for the file: {e}"))?;
    let path = dir.join(safe_name(name, ext));
    crate::files::write_atomic(&path, bytes)?;
    Ok(path)
}

/// Opens `file` with the slicer, as its own program; Studio 3D doesn't wait for it.
pub fn open(program: &Path, file: &Path) -> Result<Child, String> {
    check_program(program)?;
    Command::new(program)
        .arg(file)
        .spawn()
        .map_err(|e| format!("Couldn't start the slicer: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("studio3d-slicer-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn install(root: &Path, rel: &str) -> PathBuf {
        let p = root.join(rel);
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(&p, b"").unwrap();
        p
    }

    #[test]
    fn finds_each_installed_slicer_once_in_its_usual_folder() {
        let a = temp_dir("a");
        let b = temp_dir("b");
        let orca = install(&a, "OrcaSlicer/orca-slicer.exe");
        install(&b, "OrcaSlicer/orca-slicer.exe"); // a second copy isn't listed twice
        let bambu = install(&b, "Bambu Studio/bambu-studio.exe");
        install(&a, "Prusa3D/PrusaSlicer/readme.txt"); // a folder without the program isn't a slicer
        let found = find(&[a.clone(), b.clone(), a.join("missing")]);
        assert_eq!(
            found,
            vec![
                Found { id: "bambu-studio".into(), name: "Bambu Studio".into(), path: bambu },
                Found { id: "orca-slicer".into(), name: "OrcaSlicer".into(), path: orca },
            ]
        );
        assert!(find(&[temp_dir("empty")]).is_empty());
    }

    #[test]
    fn a_picked_program_must_exist() {
        let dir = temp_dir("pick");
        assert!(check_program(&dir.join("gone.exe")).is_err());
        assert!(check_program(&dir).is_err()); // a folder isn't a program
        assert!(check_program(&install(&dir, "slicer.exe")).is_ok());
        if cfg!(windows) {
            assert!(check_program(&install(&dir, "notes.txt")).is_err());
        }
    }

    #[test]
    fn the_part_name_cannot_leave_the_handoff_folder() {
        assert_eq!(safe_name("Tray <A&B>", "3mf"), "Tray _A_B_.3mf");
        assert_eq!(safe_name("..\\..\\Windows\\evil", "3mf"), "______Windows_evil.3mf");
        assert_eq!(safe_name("../", "stl"), "part.stl");
        assert_eq!(safe_name("", "3mf"), "part.3mf");
        assert_eq!(safe_name(&"x".repeat(300), "3mf").len(), 84);
        let dir = temp_dir("handoff");
        let p = write_handoff(&dir, "../Tray", "3mf", b"one").unwrap();
        assert_eq!(p, dir.join("___Tray.3mf"));
        write_handoff(&dir, "../Tray", "3mf", b"two").unwrap(); // a new hand-off replaces the last
        assert_eq!(fs::read(&p).unwrap(), b"two");
        assert!(write_handoff(&dir, "Tray", "exe", b"x").is_err());
    }

    #[test]
    fn opens_the_file_with_the_program() {
        let dir = temp_dir("open");
        let file = write_handoff(&dir, "Tray", "3mf", b"x").unwrap();
        // A real program that takes a file argument and exits: Windows' `where`, or `ls` elsewhere.
        let program = if cfg!(windows) {
            PathBuf::from(std::env::var_os("SystemRoot").unwrap()).join("System32").join("where.exe")
        } else {
            PathBuf::from("/bin/ls")
        };
        // Started with the file and ran; what the stand-in program makes of the file doesn't matter.
        open(&program, &file).unwrap().wait().unwrap();
        assert!(open(&dir.join("gone.exe"), &file).is_err());
    }
}
