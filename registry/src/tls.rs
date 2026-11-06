//! The TLS identity of the HTTP side (ADR-0029 §7, increment 3): the
//! application certificate of the container storage – the certificate and
//! key the SDK uses at the Message Bus (`/etc/oi4/certs/<containername>.pem`,
//! `/run/secrets/oi4/private_key.pem`, REQ-CNT-008/009) – or, if the
//! registry authenticates with username and password, a certificate signed
//! by itself at the start, kept in memory only. Both are read once at the
//! start: a rotated certificate takes effect with the next start.

use std::path::Path;
use std::sync::Arc;

use oec::app::Auth;
use pkcs8::der::Decode;
use rustls::ServerConfig;
use rustls_pki_types::pem::PemObject;
use rustls_pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer};

const ENCRYPTED_PKCS8: &str = "-----BEGIN ENCRYPTED PRIVATE KEY-----";
const LEGACY_ENCRYPTED: &str = "Proc-Type: 4,ENCRYPTED";

/// Where the certificate comes from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Origin {
    /// The application certificate of the container storage.
    Application,
    /// Signed by the registry itself at the start.
    SelfSigned,
}

/// The files of an application certificate.
#[derive(Debug, Clone, Copy)]
pub(crate) struct Files<'a> {
    /// PEM certificate, the leaf first.
    pub(crate) cert: &'a Path,
    /// PEM private key.
    pub(crate) key: &'a Path,
    /// Passphrase of an encrypted key.
    pub(crate) passphrase: Option<&'a [u8]>,
}

impl<'a> Files<'a> {
    /// The application certificate of the means of authentication at the
    /// Message Bus (`None`: username and password).
    pub(crate) fn of(auth: &'a Auth) -> Option<Self> {
        match auth {
            Auth::ClientCertificate {
                cert,
                key,
                passphrase,
            } => Some(Self {
                cert,
                key,
                passphrase: passphrase.as_ref().map(oec::app::Secret::expose),
            }),
            _ => None,
        }
    }
}

/// The server configuration with the application certificate `files`, or
/// without one with a certificate signed by the registry itself for
/// `names` (DNS names and IP addresses).
///
/// # Errors
///
/// The certificate or key cannot be read, or rustls refuses them.
pub(crate) fn server_config(
    files: Option<Files<'_>>,
    names: &[String],
) -> Result<(Arc<ServerConfig>, Origin), String> {
    let (certs, key, origin) = if let Some(f) = files {
        (
            certificates(f.cert)?,
            private_key(f.key, f.passphrase)?,
            Origin::Application,
        )
    } else {
        let (cert, key) = self_signed(names)?;
        (vec![cert], key, Origin::SelfSigned)
    };
    let provider = Arc::new(rustls::crypto::aws_lc_rs::default_provider());
    let mut config = ServerConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .map_err(|e| format!("TLS: {e}"))?
        .with_no_client_auth()
        .with_single_cert(certs, key)
        .map_err(|e| format!("TLS: the certificate and key do not fit: {e}"))?;
    config.alpn_protocols = vec![b"http/1.1".to_vec()];
    Ok((Arc::new(config), origin))
}

/// A certificate for `names`, signed by itself (ECDSA P-256, for
/// `serverAuth`).
fn self_signed(
    names: &[String],
) -> Result<(CertificateDer<'static>, PrivateKeyDer<'static>), String> {
    let fail = |e: rcgen::Error| format!("TLS: no self-signed certificate: {e}");
    let mut params = rcgen::CertificateParams::new(names.to_vec()).map_err(fail)?;
    params
        .distinguished_name
        .push(rcgen::DnType::CommonName, "OEC Registry");
    params.extended_key_usages = vec![rcgen::ExtendedKeyUsagePurpose::ServerAuth];
    params.key_usages = vec![rcgen::KeyUsagePurpose::DigitalSignature];
    let key = rcgen::KeyPair::generate().map_err(fail)?;
    let cert = params.self_signed(&key).map_err(fail)?;
    Ok((
        cert.der().clone(),
        PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(key.serialize_der())),
    ))
}

fn read(path: &Path) -> Result<Vec<u8>, String> {
    std::fs::read(path).map_err(|e| format!("TLS: {}: {e}", path.display()))
}

/// The PEM certificates of `path`, the leaf first.
fn certificates(path: &Path) -> Result<Vec<CertificateDer<'static>>, String> {
    let certs = CertificateDer::pem_slice_iter(&read(path)?)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("TLS: {}: {e}", path.display()))?;
    if certs.is_empty() {
        return Err(format!("TLS: {}: no PEM certificate", path.display()));
    }
    Ok(certs)
}

/// The private key of a PEM file, as the SDK reads it at the Message Bus:
/// PKCS#8, PKCS#1 or SEC1, or an encrypted PKCS#8 key (PBES2) with the
/// passphrase of the container storage (REQ-CNT-008/009).
fn private_key(path: &Path, passphrase: Option<&[u8]>) -> Result<PrivateKeyDer<'static>, String> {
    let pem = read(path)?;
    let text = String::from_utf8_lossy(&pem);
    let fail = |what: &str| format!("TLS: {}: {what}", path.display());
    if let Some(start) = text.find(ENCRYPTED_PKCS8) {
        let passphrase =
            passphrase.ok_or_else(|| fail("the key is encrypted, but there is no passphrase"))?;
        let (_, der) = pkcs8::der::pem::decode_vec(text[start..].as_bytes())
            .map_err(|e| fail(&format!("no PKCS#8 encrypted key: {e}")))?;
        let info = pkcs8::EncryptedPrivateKeyInfoRef::from_der(&der)
            .map_err(|e| fail(&format!("no PKCS#8 encrypted key: {e}")))?;
        let doc = info
            .decrypt(passphrase)
            .map_err(|e| fail(&format!("cannot decrypt the key: {e}")))?;
        return Ok(PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(
            doc.as_bytes().to_vec(),
        )));
    }
    if text.contains(LEGACY_ENCRYPTED) {
        return Err(fail("legacy OpenSSL key encryption is not supported"));
    }
    PrivateKeyDer::from_pem_slice(&pem).map_err(|e| fail(&format!("no PEM private key: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names() -> Vec<String> {
        ["localhost", "reg-1", "127.0.0.1", "::1"]
            .map(str::to_owned)
            .to_vec()
    }

    #[test]
    fn self_signed_for_the_names() {
        let (config, origin) = server_config(None, &names()).unwrap();
        assert_eq!(origin, Origin::SelfSigned);
        assert_eq!(config.alpn_protocols, [b"http/1.1".to_vec()]);
        let (cert, _) = self_signed(&names()).unwrap();
        // the SANs: DNS names and IP addresses as such
        let der = cert.as_ref();
        for dns in ["localhost", "reg-1"] {
            assert!(der.windows(dns.len()).any(|w| w == dns.as_bytes()), "{dns}");
        }
        assert!(der.windows(4).any(|w| w == [127, 0, 0, 1]));
        assert!(!der.windows(9).any(|w| w == b"127.0.0.1"));
    }

    fn write(dir: &Path, name: &str, content: &str) -> std::path::PathBuf {
        let p = dir.join(name);
        std::fs::write(&p, content).unwrap();
        p
    }

    #[test]
    fn application_certificate() {
        let dir = std::env::temp_dir().join(format!("oec-registry-tls-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let key = rcgen::KeyPair::generate().unwrap();
        let cert = rcgen::CertificateParams::new(names())
            .unwrap()
            .self_signed(&key)
            .unwrap();
        let cert_path = write(&dir, "reg-1.pem", &cert.pem());
        let key_path = write(&dir, "private_key.pem", &key.serialize_pem());
        let files = |cert, key| {
            Some(Files {
                cert,
                key,
                passphrase: None,
            })
        };
        assert_eq!(
            server_config(files(&cert_path, &key_path), &[]).unwrap().1,
            Origin::Application
        );

        // a key that is not the certificate's, a missing file, no PEM
        let other = write(
            &dir,
            "other.pem",
            &rcgen::KeyPair::generate().unwrap().serialize_pem(),
        );
        assert!(
            server_config(files(&cert_path, &other), &[])
                .unwrap_err()
                .contains("do not fit")
        );
        let nope = dir.join("nope.pem");
        assert!(server_config(files(&nope, &nope), &[]).is_err());
        let empty = write(&dir, "empty.pem", "");
        assert!(
            certificates(&empty)
                .unwrap_err()
                .contains("no PEM certificate")
        );
        let encrypted = write(
            &dir,
            "enc.pem",
            "-----BEGIN ENCRYPTED PRIVATE KEY-----\nAAAA\n-----END ENCRYPTED PRIVATE KEY-----\n",
        );
        assert!(
            private_key(&encrypted, None)
                .unwrap_err()
                .contains("no passphrase")
        );
        assert!(private_key(&encrypted, Some(b"x".as_slice())).is_err());
        let legacy = write(
            &dir,
            "legacy.pem",
            "-----BEGIN RSA PRIVATE KEY-----\nProc-Type: 4,ENCRYPTED\n\nAAAA\n-----END RSA PRIVATE KEY-----\n",
        );
        assert!(private_key(&legacy, None).unwrap_err().contains("legacy"));
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
