//! Regression: configuration backups written by the 2.x line must import here.
//!
//! The two lines disagree only on the outer envelope. 2.x writes an
//! `NYASNAP` v2 envelope keyed by Argon2id; this branch used to write and read
//! only the legacy `nonce || ciphertext` SHA-256 form, so every 2.x export
//! failed with "cloud snapshot decryption failed: ... aead::Error".
use nyaterm_core::core::backup_crypto::decrypt_snapshot_bytes;

/// Captured 2.x envelope: `NYASNAP\0` v2, Argon2id m=19MiB t=2 p=1.
const TWO_X_BACKUP: &[u8] = include_bytes!("fixtures/2.x-backup.nya");
const PASSWORD: &str = "interop-password";

#[test]
fn imports_a_backup_written_by_the_2_x_line() {
    let plaintext = decrypt_snapshot_bytes(TWO_X_BACKUP, PASSWORD).expect("2.x backup decrypts");
    assert!(
        plaintext.starts_with(b"PK\x03\x04"),
        "expected a zip payload"
    );
}

#[test]
fn rejects_the_same_backup_with_a_wrong_password() {
    assert!(decrypt_snapshot_bytes(TWO_X_BACKUP, "wrong-password").is_err());
}

#[test]
fn the_2_x_envelope_is_not_mistaken_for_a_legacy_one() {
    // This is exactly the reported failure: only the legacy reader existed, so
    // it reported an AEAD error instead of decoding the envelope.
    assert!(TWO_X_BACKUP.starts_with(b"NYASNAP\0"));
    assert!(!TWO_X_BACKUP.starts_with(b"PK"));
}
