//! Portable snapshot envelope encryption.
//!
//! Two formats exist and both must stay readable:
//!
//! * The current `NYASNAP` v2 envelope: Argon2id-derived key over a
//!   self-describing header used as AES-GCM associated data. New snapshots use
//!   this, and snapshots written by the 2.x line already use it.
//! * The legacy `nonce || ciphertext` envelope keyed by a SHA-256 hash of a
//!   domain prefix plus the password. It is still read so files exported by
//!   older 1.x builds keep importing, but it is never written again.

use crate::error::{AppError, AppResult};

use aes_gcm::aead::{Aead, Payload};
use aes_gcm::{Aes256Gcm, Key, KeyInit};
use argon2::{Algorithm, Argon2, Params, Version};
use sha2::{Digest, Sha256};
use zeroize::Zeroizing;

const CLOUD_SNAPSHOT_KEY_PREFIX: &[u8] = b"nyaterm-cloud-snapshot-v1:";
const LEGACY_CLOUD_SNAPSHOT_KEY_PREFIX: &[u8] = b"dragonfly-cloud-snapshot-v1:";

/// Magic and version of the versioned envelope, shared with the 2.x line.
const MAGIC: &[u8; 8] = b"NYASNAP\0";
const VERSION: u8 = 2;
const ARGON2ID: u8 = 1;
const MEMORY_KIB: u32 = 19 * 1024;
const ITERATIONS: u32 = 2;
const LANES: u32 = 1;
/// magic(8) + version(1) + algorithm(1) + params(12) + salt(16) + nonce(12)
const HEADER_BYTES: usize = 50;
const TAG_BYTES: usize = 16;

fn derive_snapshot_key_with_prefix(prefix: &[u8], master_password: &str) -> Key<Aes256Gcm> {
    let mut hasher = Sha256::new();
    hasher.update(prefix);
    hasher.update(master_password.as_bytes());
    let digest = hasher.finalize();
    *Key::<Aes256Gcm>::from_slice(&digest)
}

fn derive_snapshot_key(master_password: &str) -> Key<Aes256Gcm> {
    derive_snapshot_key_with_prefix(CLOUD_SNAPSHOT_KEY_PREFIX, master_password)
}

fn derive_legacy_snapshot_key(master_password: &str) -> Key<Aes256Gcm> {
    derive_snapshot_key_with_prefix(LEGACY_CLOUD_SNAPSHOT_KEY_PREFIX, master_password)
}

/// Trimmed password, matching the 2.x contract. An empty password is rejected
/// before any key derivation work happens.
fn password(value: &str) -> AppResult<&str> {
    let value = value.trim();
    if value.is_empty() {
        Err(AppError::Crypto(
            "master password must not be empty".to_string(),
        ))
    } else {
        Ok(value)
    }
}

pub fn encrypt_snapshot_bytes(plaintext: &[u8], master_password: &str) -> AppResult<Vec<u8>> {
    let password = password(master_password)?;
    let mut salt = [0u8; 16];
    let mut nonce = [0u8; 12];
    fill_random(&mut salt)?;
    fill_random(&mut nonce)?;

    let mut envelope = Vec::with_capacity(HEADER_BYTES + plaintext.len() + TAG_BYTES);
    envelope.extend_from_slice(MAGIC);
    envelope.extend_from_slice(&[VERSION, ARGON2ID]);
    for parameter in [MEMORY_KIB, ITERATIONS, LANES] {
        envelope.extend_from_slice(&parameter.to_le_bytes());
    }
    envelope.extend_from_slice(&salt);
    envelope.extend_from_slice(&nonce);

    let key = derive_key(password, &salt)?;
    let ciphertext = Aes256Gcm::new_from_slice(key.as_ref())
        .map_err(|error| AppError::Crypto(format!("snapshot cipher init failed: {error}")))?
        .encrypt(
            &nonce.into(),
            Payload {
                msg: plaintext,
                aad: &envelope,
            },
        )
        .map_err(|error| AppError::Crypto(format!("cloud snapshot encryption failed: {error}")))?;
    envelope.extend_from_slice(&ciphertext);
    Ok(envelope)
}

pub fn decrypt_snapshot_bytes(ciphertext: &[u8], master_password: &str) -> AppResult<Vec<u8>> {
    let password = password(master_password)?;
    if ciphertext.starts_with(MAGIC) {
        return decrypt_versioned(password, ciphertext);
    }

    if ciphertext.len() < 12 + TAG_BYTES {
        return Err(AppError::Crypto(
            "cloud snapshot ciphertext is too short".to_string(),
        ));
    }

    match decrypt_legacy_snapshot_bytes(ciphertext, &derive_snapshot_key(password)) {
        Ok(plaintext) => Ok(plaintext),
        Err(new_error) => {
            decrypt_legacy_snapshot_bytes(ciphertext, &derive_legacy_snapshot_key(password)).map_err(
                |legacy_error| {
                    AppError::Crypto(format!(
                        "cloud snapshot decryption failed: NyaTerm key prefix failed ({new_error}); legacy Dragonfly key prefix failed ({legacy_error})"
                    ))
                },
            )
        }
    }
}

fn decrypt_versioned(password: &str, envelope: &[u8]) -> AppResult<Vec<u8>> {
    if envelope.len() < HEADER_BYTES + TAG_BYTES {
        return Err(AppError::Crypto(
            "cloud snapshot ciphertext is too short".to_string(),
        ));
    }
    if envelope[8] != VERSION {
        return Err(AppError::Crypto(format!(
            "unsupported snapshot encryption version {}",
            envelope[8]
        )));
    }
    // Bound attacker-controlled KDF work before deriving anything. A new cost
    // profile has to be added here deliberately, never read from the file.
    if envelope[9] != ARGON2ID
        || envelope[10..14] != MEMORY_KIB.to_le_bytes()
        || envelope[14..18] != ITERATIONS.to_le_bytes()
        || envelope[18..22] != LANES.to_le_bytes()
    {
        return Err(AppError::Crypto(
            "snapshot encryption envelope is invalid".to_string(),
        ));
    }

    let key = derive_key(password, &envelope[22..38])?;
    let nonce: [u8; 12] = envelope[38..50]
        .try_into()
        .expect("header layout guarantees a 12-byte nonce");
    Aes256Gcm::new_from_slice(key.as_ref())
        .map_err(|error| AppError::Crypto(format!("snapshot cipher init failed: {error}")))?
        .decrypt(
            &nonce.into(),
            Payload {
                msg: &envelope[HEADER_BYTES..],
                aad: &envelope[..HEADER_BYTES],
            },
        )
        .map_err(|error| AppError::Crypto(format!("cloud snapshot decryption failed: {error}")))
}

fn decrypt_legacy_snapshot_bytes(ciphertext: &[u8], key: &Key<Aes256Gcm>) -> AppResult<Vec<u8>> {
    let cipher = Aes256Gcm::new(key);
    let (nonce_bytes, payload) = ciphertext.split_at(12);
    let nonce = aes_gcm::Nonce::from_slice(nonce_bytes);
    cipher
        .decrypt(nonce, payload)
        .map_err(|error| AppError::Crypto(format!("cloud snapshot decryption failed: {error}")))
}

fn derive_key(password: &str, salt: &[u8]) -> AppResult<Zeroizing<[u8; 32]>> {
    let params = Params::new(MEMORY_KIB, ITERATIONS, LANES, Some(32))
        .map_err(|error| AppError::Crypto(format!("snapshot KDF params rejected: {error}")))?;
    let mut key = Zeroizing::new([0u8; 32]);
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
        .hash_password_into(password.as_bytes(), salt, key.as_mut())
        .map_err(|error| AppError::Crypto(format!("snapshot KDF failed: {error}")))?;
    Ok(key)
}

fn fill_random(bytes: &mut [u8]) -> AppResult<()> {
    use aes_gcm::aead::rand_core::RngCore as _;
    aes_gcm::aead::OsRng
        .try_fill_bytes(bytes)
        .map_err(|error| AppError::Crypto(format!("snapshot nonce generation failed: {error}")))
}

#[cfg(test)]
mod tests {
    use super::{
        CLOUD_SNAPSHOT_KEY_PREFIX, HEADER_BYTES, LEGACY_CLOUD_SNAPSHOT_KEY_PREFIX, MAGIC,
        TAG_BYTES, decrypt_snapshot_bytes, derive_legacy_snapshot_key, derive_snapshot_key,
        encrypt_snapshot_bytes,
    };
    use aes_gcm::aead::{Aead, OsRng};
    use aes_gcm::{AeadCore, Aes256Gcm, KeyInit};

    #[test]
    fn versioned_envelope_roundtrips_with_random_salt_and_nonce() {
        let first = encrypt_snapshot_bytes(b"snapshot data", "test-password").unwrap();
        let second = encrypt_snapshot_bytes(b"snapshot data", "test-password").unwrap();
        assert!(first.starts_with(MAGIC));
        assert_ne!(&first[22..38], &second[22..38]);
        assert_ne!(&first[38..50], &second[38..50]);
        for bytes in [first, second] {
            assert_eq!(
                decrypt_snapshot_bytes(&bytes, "test-password").unwrap(),
                b"snapshot data"
            );
        }
    }

    #[test]
    fn wrong_password_and_damaged_envelope_are_rejected() {
        let bytes = encrypt_snapshot_bytes(b"snapshot data", "test-password").unwrap();
        assert!(decrypt_snapshot_bytes(&bytes, "wrong").is_err());

        for length in [0usize, 12, HEADER_BYTES, HEADER_BYTES + TAG_BYTES - 1] {
            assert!(
                decrypt_snapshot_bytes(&bytes[..length.min(bytes.len())], "test-password").is_err(),
                "length {length}"
            );
        }

        let mut damaged = bytes.clone();
        let last = damaged.len() - 1;
        damaged[last] ^= 0x01;
        assert!(decrypt_snapshot_bytes(&damaged, "test-password").is_err());

        // The header is authenticated, so bumping the stored cost profile is
        // rejected before any expensive derivation starts.
        let mut reparameterized = bytes.clone();
        reparameterized[10..14].copy_from_slice(&(128 * 1024u32).to_le_bytes());
        assert!(decrypt_snapshot_bytes(&reparameterized, "test-password").is_err());
    }

    #[test]
    fn blank_password_is_rejected_without_deriving_a_key() {
        assert!(encrypt_snapshot_bytes(b"data", "   ").is_err());
        assert!(decrypt_snapshot_bytes(&[0u8; 64], "").is_err());
    }

    #[test]
    fn legacy_envelopes_stay_readable_for_both_key_prefixes() {
        for (prefix, key) in [
            (
                CLOUD_SNAPSHOT_KEY_PREFIX,
                derive_snapshot_key("legacy-password"),
            ),
            (
                LEGACY_CLOUD_SNAPSHOT_KEY_PREFIX,
                derive_legacy_snapshot_key("legacy-password"),
            ),
        ] {
            let plaintext = format!("legacy payload for {:?}", prefix).into_bytes();
            let cipher = Aes256Gcm::new(&key);
            let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
            let mut encoded = nonce.to_vec();
            encoded.extend_from_slice(&cipher.encrypt(&nonce, plaintext.as_slice()).unwrap());

            assert_eq!(
                decrypt_snapshot_bytes(&encoded, "legacy-password").unwrap(),
                plaintext
            );
        }
    }

    #[test]
    fn password_surrounding_whitespace_matches_the_trimmed_contract() {
        let bytes = encrypt_snapshot_bytes(b"snapshot data", "  test-password  ").unwrap();
        assert_eq!(
            decrypt_snapshot_bytes(&bytes, "test-password").unwrap(),
            b"snapshot data"
        );
    }
}
