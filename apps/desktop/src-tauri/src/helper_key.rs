// The Anthropic key that lets Blurry ask Claude, kept by the operating system's own credential store (Windows
// Credential Manager, the macOS keychain), never written to a file of ours. It is the user's own key: Studio 3D
// sends it only to Anthropic, from the app, when the user asks Blurry something with Claude turned on.

const SERVICE: &str = "Studio 3D";
const USER: &str = "Anthropic API key for Blurry";

/// A key looks like `sk-ant-…`: no spaces, nothing that isn't printable ASCII, and not absurdly long.
pub fn check(key: &str) -> Result<(), String> {
    let ok = key.starts_with("sk-ant-")
        && key.len() <= 512
        && key.bytes().all(|b| b.is_ascii_graphic());
    if ok {
        Ok(())
    } else {
        Err("That doesn't look like an Anthropic API key. Keys start with sk-ant-.".into())
    }
}

fn entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, USER).map_err(|e| format!("Couldn't open the computer's key store: {e}"))
}

pub fn read() -> Result<Option<String>, String> {
    match entry()?.get_password() {
        Ok(key) => Ok(Some(key)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("Couldn't read the key: {e}")),
    }
}

pub fn write(key: &str) -> Result<(), String> {
    check(key)?;
    entry()?
        .set_password(key)
        .map_err(|e| format!("Couldn't keep the key: {e}"))
}

pub fn clear() -> Result<(), String> {
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("Couldn't remove the key: {e}")),
    }
}

#[cfg(test)]
mod tests {
    use super::check;

    #[test]
    fn only_anthropic_keys_are_kept() {
        assert!(check("sk-ant-api03-abcDEF_123-xyz").is_ok());
        assert!(check("").is_err());
        assert!(check("sk-proj-123").is_err());
        assert!(check("sk-ant-has space").is_err());
        assert!(check("sk-ant-line\nbreak").is_err());
        assert!(check(&format!("sk-ant-{}", "a".repeat(600))).is_err());
    }
}
