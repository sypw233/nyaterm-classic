//! End-to-end probe for the reported failure: a 2.x backup must survive the
//! whole import preparation path, not just envelope decryption.

use nyaterm_core::core::backup::prepare_import;

const TWO_X_BACKUP: &[u8] = include_bytes!("fixtures/2.x-backup.nya");
const PASSWORD: &str = "interop-password";

#[test]
fn a_2_x_backup_reaches_a_fully_decoded_snapshot() {
    let snapshot = prepare_import(TWO_X_BACKUP, PASSWORD).expect("2.x backup prepares");
    assert_eq!(snapshot.schema_version, 3);
    assert_eq!(snapshot.app_version, "2.0.5");
}

#[test]
fn a_wrong_password_still_fails_closed() {
    assert!(prepare_import(TWO_X_BACKUP, "wrong-password").is_err());
}
