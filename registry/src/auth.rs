//! The user management of the HTTP side (ADR-0035, C-113 D-2): users with
//! a role, their passwords (PBKDF2-HMAC-SHA256 of aws-lc-rs), the sessions
//! and the login throttle. Sans-IO except the store file; the server is
//! [`crate::http`]. Passwords never go through `log` (its records also go
//! to Syslog on the bus).

use std::collections::HashMap;
use std::net::IpAddr;
use std::num::NonZeroU32;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use aws_lc_rs::rand::{SecureRandom, SystemRandom};
use aws_lc_rs::{digest, pbkdf2};
use serde_json::{Value, json};

/// The PBKDF2 iterations of a new hash (OWASP 2023 for PBKDF2-HMAC-SHA256).
pub(crate) const ITERATIONS: u32 = 600_000;
const SALT_LEN: usize = 16;
const HASH_LEN: usize = 32;
const SCHEME: &str = "pbkdf2-sha256";
/// At most this many users.
pub(crate) const MAX_USERS: usize = 64;
/// At most this many sessions; the oldest is evicted.
pub(crate) const MAX_SESSIONS: usize = 256;
/// A session ends after this time without a request.
pub(crate) const IDLE: Duration = Duration::from_secs(30 * 60);
/// A session ends this time after the login.
pub(crate) const ABSOLUTE: Duration = Duration::from_secs(12 * 60 * 60);
/// The length of a password in characters.
pub(crate) const PASSWORD_LEN: std::ops::RangeInclusive<usize> = 12..=256;
/// Failed logins of a client in a row before it is blocked.
pub(crate) const MAX_FAILURES: u32 = 5;
/// How long a client is blocked.
pub(crate) const BLOCK: Duration = Duration::from_secs(60);
/// At most this many clients in the throttle table.
const MAX_CLIENTS: usize = 1024;
/// The length of a generated bootstrap password.
const GENERATED_LEN: usize = 20;
/// The version of the store file.
const STORE_VERSION: u64 = 1;

/// The role of a user.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Role {
    /// Reads everything and manages the users.
    Admin,
    /// Reads everything.
    User,
}

impl Role {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Admin => "admin",
            Self::User => "user",
        }
    }

    pub(crate) fn parse(s: &str) -> Option<Self> {
        match s {
            "admin" => Some(Self::Admin),
            "user" => Some(Self::User),
            _ => None,
        }
    }
}

/// A user of the store.
#[derive(Clone, PartialEq, Eq)]
pub(crate) struct User {
    pub(crate) name: String,
    pub(crate) role: Role,
    hash: String,
    /// The password was set by an admin (or generated): it must be changed
    /// before anything else.
    pub(crate) must_change: bool,
}

impl std::fmt::Debug for User {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "User({}, {}, mustChange {})",
            self.name,
            self.role.as_str(),
            self.must_change
        )
    }
}

impl User {
    /// The public view (`/api/session`, `/api/users`).
    pub(crate) fn view(&self) -> Value {
        json!({ "name": self.name, "role": self.role.as_str(), "mustChange": self.must_change })
    }
}

fn random(out: &mut [u8]) {
    // the system generator of aws-lc fails only without an entropy source
    SystemRandom::new()
        .fill(out)
        .expect("the system random generator");
}

fn hex(bytes: &[u8]) -> String {
    use std::fmt::Write;
    bytes.iter().fold(String::new(), |mut s, b| {
        let _ = write!(s, "{b:02x}");
        s
    })
}

fn unhex(s: &str) -> Option<Vec<u8>> {
    if s.len() % 2 != 0 || !s.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).ok())
        .collect()
}

/// The stored form of `password`: `pbkdf2-sha256$<iterations>$<salt>$<hash>`
/// (hex). Slow by design: call it off the runtime.
pub(crate) fn hash(password: &str, iterations: u32) -> String {
    let n = NonZeroU32::new(iterations.max(1)).unwrap_or(NonZeroU32::MIN);
    let mut salt = [0; SALT_LEN];
    random(&mut salt);
    let mut out = [0; HASH_LEN];
    pbkdf2::derive(
        pbkdf2::PBKDF2_HMAC_SHA256,
        n,
        &salt,
        password.as_bytes(),
        &mut out,
    );
    format!("{SCHEME}${n}${}${}", hex(&salt), hex(&out))
}

/// The parts of a stored hash; `None`: not of this form.
fn parse_hash(stored: &str) -> Option<(NonZeroU32, Vec<u8>, Vec<u8>)> {
    let mut parts = stored.split('$');
    let (Some(SCHEME), Some(n), Some(salt), Some(out), None) = (
        parts.next(),
        parts.next(),
        parts.next(),
        parts.next(),
        parts.next(),
    ) else {
        return None;
    };
    let n = n.parse::<NonZeroU32>().ok()?;
    let (salt, out) = (unhex(salt)?, unhex(out)?);
    (!salt.is_empty() && out.len() == HASH_LEN).then_some((n, salt, out))
}

/// `password` matches the stored hash (constant-time). Slow by design.
pub(crate) fn verify(password: &str, stored: &str) -> bool {
    let Some((n, salt, out)) = parse_hash(stored) else {
        return false;
    };
    pbkdf2::verify(
        pbkdf2::PBKDF2_HMAC_SHA256,
        n,
        &salt,
        password.as_bytes(),
        &out,
    )
    .is_ok()
}

/// A valid user name: 1 … 64 characters `[A-Za-z0-9._@-]`.
pub(crate) fn valid_name(name: &str) -> bool {
    (1..=64).contains(&name.len())
        && name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'@' | b'-'))
}

/// The password policy (ADR-0035 §1); `Err`: why not.
pub(crate) fn check_password(name: &str, password: &str) -> Result<(), &'static str> {
    if !PASSWORD_LEN.contains(&password.chars().count()) {
        return Err("a password has 12 … 256 characters");
    }
    if password.eq_ignore_ascii_case(name) {
        return Err("the password must not be the user name");
    }
    Ok(())
}

/// A random password for the bootstrap (no characters that look alike).
fn generate_password() -> String {
    const ALPHABET: &[u8] = b"abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let mut bytes = [0u8; GENERATED_LEN];
    random(&mut bytes);
    // 256 % 54 != 0: rejection of the biased top keeps it uniform
    let limit = 256 - 256 % ALPHABET.len();
    let mut out = String::with_capacity(GENERATED_LEN);
    let mut buf = [0u8; 1];
    for mut b in bytes {
        while usize::from(b) >= limit {
            random(&mut buf);
            b = buf[0];
        }
        out.push(char::from(ALPHABET[usize::from(b) % ALPHABET.len()]));
    }
    out
}

/// The key of a session: SHA-256 of its token.
type Key = [u8; 32];

fn key(token: &str) -> Option<Key> {
    if token.len() != 64
        || !token
            .bytes()
            .all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
    {
        return None;
    }
    let d = digest::digest(&digest::SHA256, token.as_bytes());
    d.as_ref().try_into().ok()
}

struct Session {
    name: String,
    created: Instant,
    last: Instant,
}

struct Throttle {
    failures: u32,
    until: Option<Instant>,
}

/// A refusal of the user management: status and reason.
pub(crate) type Refusal = (u16, &'static str);

/// The users, the sessions and the throttle.
pub(crate) struct Auth {
    /// The store file (`None`: in memory only).
    path: Option<PathBuf>,
    users: Vec<User>,
    sessions: HashMap<Key, Session>,
    clients: HashMap<IpAddr, Throttle>,
    /// Checked for an unknown name, so that it takes as long.
    dummy: String,
    /// The iterations of a new hash ([`ITERATIONS`]; lower in the tests).
    pub(crate) iterations: u32,
}

impl std::fmt::Debug for Auth {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "Auth({} users, {} sessions)",
            self.users.len(),
            self.sessions.len()
        )
    }
}

/// What [`Auth::open`] did.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Opened {
    /// The users of the store.
    Loaded(usize),
    /// `admin` with the password of the file.
    Bootstrapped,
    /// `admin` with this generated password (print it once).
    Generated(String),
}

impl Auth {
    /// The users of the store below `root` (`etc/oi4/app/registry/users.json`
    /// if the application-specific volume `etc/oi4/app` exists, else in
    /// memory); without a store the bootstrap `admin` with the password of
    /// `password_file` (`explicit`: it must exist) or a generated one.
    ///
    /// # Errors
    ///
    /// The store is invalid or cannot be written, or the password file is
    /// unreadable or its password is too weak.
    pub(crate) fn open(
        root: &Path,
        password_file: &Path,
        explicit: bool,
        iterations: u32,
    ) -> Result<(Self, Opened), String> {
        let app = root.join("etc/oi4/app");
        let path = app
            .is_dir()
            .then(|| app.join("registry").join("users.json"));
        let mut auth = Self {
            path,
            users: Vec::new(),
            sessions: HashMap::new(),
            clients: HashMap::new(),
            dummy: hash(&generate_password(), iterations),
            iterations,
        };
        if let Some(p) = auth.path.clone()
            && p.exists()
        {
            let text = std::fs::read_to_string(&p).map_err(|e| format!("{}: {e}", p.display()))?;
            auth.users = parse_store(&text).map_err(|e| {
                format!(
                    "{}: {e} (delete the file to create the user admin again)",
                    p.display()
                )
            })?;
            let n = auth.users.len();
            return Ok((auth, Opened::Loaded(n)));
        }
        let (password, opened) = match std::fs::read_to_string(password_file) {
            Ok(text) => {
                let p = text
                    .strip_suffix('\n')
                    .map_or(text.as_str(), |t| t.strip_suffix('\r').unwrap_or(t));
                check_password("admin", p)
                    .map_err(|e| format!("{}: {e}", password_file.display()))?;
                (p.to_owned(), Opened::Bootstrapped)
            }
            Err(e) if explicit || e.kind() != std::io::ErrorKind::NotFound => {
                return Err(format!("{}: {e}", password_file.display()));
            }
            Err(_) => {
                let p = generate_password();
                (p.clone(), Opened::Generated(p))
            }
        };
        let users = vec![User {
            name: "admin".to_owned(),
            role: Role::Admin,
            hash: hash(&password, iterations),
            must_change: matches!(opened, Opened::Generated(_)),
        }];
        auth.commit(users)?;
        Ok((auth, opened))
    }

    /// The store is a file (else in memory).
    pub(crate) fn persistent(&self) -> bool {
        self.path.is_some()
    }

    /// Writes `users` (atomically) and takes them.
    fn commit(&mut self, users: Vec<User>) -> Result<(), String> {
        if let Some(p) = &self.path {
            write_store(p, &users).map_err(|e| format!("{}: {e}", p.display()))?;
        }
        self.users = users;
        Ok(())
    }

    fn user(&self, name: &str) -> Option<&User> {
        self.users.iter().find(|u| u.name == name)
    }

    /// The users (`/api/users`).
    pub(crate) fn list(&self) -> Value {
        json!({ "users": self.users.iter().map(User::view).collect::<Vec<_>>() })
    }

    /// The stored hash to check for a login of `name` (the dummy for an
    /// unknown name), or `429` with the seconds to wait.
    pub(crate) fn login_hash(
        &mut self,
        ip: IpAddr,
        name: &str,
        now: Instant,
    ) -> Result<String, u64> {
        if let Some(t) = self.clients.get(&ip)
            && let Some(until) = t.until
            && until > now
        {
            return Err((until - now).as_secs().max(1));
        }
        Ok(self
            .user(name)
            .map_or_else(|| self.dummy.clone(), |u| u.hash.clone()))
    }

    /// A failed check of a password from `ip`.
    pub(crate) fn failed(&mut self, ip: IpAddr, now: Instant) {
        if self.clients.len() >= MAX_CLIENTS && !self.clients.contains_key(&ip) {
            self.clients
                .retain(|_, t| t.until.is_some_and(|u| u > now) || t.failures > 1);
            if self.clients.len() >= MAX_CLIENTS {
                return;
            }
        }
        let t = self.clients.entry(ip).or_insert(Throttle {
            failures: 0,
            until: None,
        });
        if t.until.is_some_and(|u| u <= now) {
            *t = Throttle {
                failures: 0,
                until: None,
            };
        }
        t.failures += 1;
        if t.failures >= MAX_FAILURES {
            t.until = Some(now + BLOCK);
        }
    }

    /// A login of `name` whose password matched `checked` (the hash it was
    /// checked against): a new session and its token. `None`: the user is
    /// gone or its password changed meanwhile.
    pub(crate) fn logged_in(
        &mut self,
        ip: IpAddr,
        name: &str,
        checked: &str,
        now: Instant,
    ) -> Option<(User, String)> {
        let user = self.user(name).filter(|u| u.hash == checked)?.clone();
        self.clients.remove(&ip);
        self.sessions
            .retain(|_, s| now - s.last < IDLE && now - s.created < ABSOLUTE);
        if self.sessions.len() >= MAX_SESSIONS
            && let Some(oldest) = self
                .sessions
                .iter()
                .min_by_key(|(_, s)| s.last)
                .map(|(k, _)| *k)
        {
            self.sessions.remove(&oldest);
        }
        let mut raw = [0u8; 32];
        random(&mut raw);
        let token = hex(&raw);
        let k = key(&token)?;
        self.sessions.insert(
            k,
            Session {
                name: user.name.clone(),
                created: now,
                last: now,
            },
        );
        Some((user, token))
    }

    /// The user of the session of `token`, if it is alive (and marks it
    /// active).
    pub(crate) fn session(&mut self, token: &str, now: Instant) -> Option<User> {
        let k = key(token)?;
        let s = self.sessions.get_mut(&k)?;
        let user = self.users.iter().find(|u| u.name == s.name).cloned();
        if now - s.last >= IDLE || now - s.created >= ABSOLUTE || user.is_none() {
            self.sessions.remove(&k);
            return None;
        }
        s.last = now;
        user
    }

    /// Ends the session of `token`.
    pub(crate) fn logout(&mut self, token: &str) {
        if let Some(k) = key(token) {
            self.sessions.remove(&k);
        }
    }

    /// The stored hash of `name`.
    #[cfg(test)]
    pub(crate) fn hash_of(&self, name: &str) -> Option<String> {
        self.user(name).map(|u| u.hash.clone())
    }

    /// Sets the password of `name` to `new_hash` by the user itself, if its
    /// hash is still `checked`; ends its other sessions than `token`.
    ///
    /// # Errors
    ///
    /// `409` the password changed meanwhile, `500` the store.
    pub(crate) fn change_own(
        &mut self,
        name: &str,
        checked: &str,
        new_hash: String,
        token: &str,
    ) -> Result<User, Refusal> {
        let mut users = self.users.clone();
        let u = users
            .iter_mut()
            .find(|u| u.name == name && u.hash == checked)
            .ok_or((409, "the password changed meanwhile"))?;
        u.hash = new_hash;
        u.must_change = false;
        let user = u.clone();
        self.store(users)?;
        let keep = key(token);
        self.sessions
            .retain(|k, s| s.name != name || Some(*k) == keep);
        Ok(user)
    }

    fn store(&mut self, users: Vec<User>) -> Result<(), Refusal> {
        self.commit(users).map_err(|e| {
            eprintln!("oec-registry: users: {e}");
            (500, "the users cannot be stored")
        })
    }

    fn admins(users: &[User]) -> usize {
        users.iter().filter(|u| u.role == Role::Admin).count()
    }

    /// A new user (admin), its password to be changed at the first login.
    ///
    /// # Errors
    ///
    /// `400` invalid, `409` exists or too many, `500` the store.
    pub(crate) fn create(&mut self, name: &str, role: Role, hash: String) -> Result<User, Refusal> {
        if !valid_name(name) {
            return Err((400, "a name has 1 … 64 characters A-Z a-z 0-9 . _ @ -"));
        }
        if self.user(name).is_some() {
            return Err((409, "the user exists"));
        }
        if self.users.len() >= MAX_USERS {
            return Err((409, "too many users (64)"));
        }
        let user = User {
            name: name.to_owned(),
            role,
            hash,
            must_change: true,
        };
        let mut users = self.users.clone();
        users.push(user.clone());
        self.store(users)?;
        Ok(user)
    }

    /// Changes the role and/or the password (to be changed at the next
    /// login, every session of the user ends) of `name` (admin).
    ///
    /// # Errors
    ///
    /// `404` no such user, `409` the last admin, `500` the store.
    pub(crate) fn update(
        &mut self,
        name: &str,
        role: Option<Role>,
        hash: Option<String>,
    ) -> Result<User, Refusal> {
        let mut users = self.users.clone();
        let u = users
            .iter_mut()
            .find(|u| u.name == name)
            .ok_or((404, "no such user"))?;
        if let Some(r) = role {
            u.role = r;
        }
        let reset = hash.is_some();
        if let Some(h) = hash {
            u.hash = h;
            u.must_change = true;
        }
        let user = u.clone();
        if Self::admins(&users) == 0 {
            return Err((409, "the last admin stays an admin"));
        }
        self.store(users)?;
        if reset {
            self.sessions.retain(|_, s| s.name != name);
        }
        Ok(user)
    }

    /// Deletes `name` and ends its sessions (admin).
    ///
    /// # Errors
    ///
    /// `404` no such user, `409` the last admin, `500` the store.
    pub(crate) fn delete(&mut self, name: &str) -> Result<(), Refusal> {
        let mut users = self.users.clone();
        let before = users.len();
        users.retain(|u| u.name != name);
        if users.len() == before {
            return Err((404, "no such user"));
        }
        if Self::admins(&users) == 0 {
            return Err((409, "the last admin cannot be deleted"));
        }
        self.store(users)?;
        self.sessions.retain(|_, s| s.name != name);
        Ok(())
    }
}

fn parse_store(text: &str) -> Result<Vec<User>, String> {
    let v: Value = serde_json::from_str(text).map_err(|e| format!("not JSON: {e}"))?;
    if v["version"].as_u64() != Some(STORE_VERSION) {
        return Err(format!("version is not {STORE_VERSION}"));
    }
    let list = v["users"].as_array().ok_or("no users")?;
    let mut users: Vec<User> = Vec::new();
    for u in list {
        let name = u["name"].as_str().filter(|n| valid_name(n));
        let role = u["role"].as_str().and_then(Role::parse);
        let hash = u["hash"].as_str().filter(|h| parse_hash(h).is_some());
        let must_change = u["mustChange"].as_bool();
        let (Some(name), Some(role), Some(hash), Some(must_change)) =
            (name, role, hash, must_change)
        else {
            return Err(format!("invalid user {u}"));
        };
        if users.iter().any(|x| x.name == name) {
            return Err(format!("user {name} twice"));
        }
        users.push(User {
            name: name.to_owned(),
            role,
            hash: hash.to_owned(),
            must_change,
        });
    }
    if users.len() > MAX_USERS || Auth::admins(&users) == 0 {
        return Err("no admin, or more than 64 users".to_owned());
    }
    Ok(users)
}

fn write_store(path: &Path, users: &[User]) -> std::io::Result<()> {
    use std::io::Write;
    let dir = path.parent().unwrap_or(Path::new("."));
    std::fs::create_dir_all(dir)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700))?;
    }
    let doc = json!({
        "version": STORE_VERSION,
        "users": users.iter().map(|u| json!({
            "name": u.name, "role": u.role.as_str(), "hash": u.hash, "mustChange": u.must_change,
        })).collect::<Vec<_>>(),
    });
    let tmp = path.with_extension("json.tmp");
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut f = options.open(&tmp)?;
    f.write_all(serde_json::to_string_pretty(&doc)?.as_bytes())?;
    f.write_all(b"\n")?;
    f.sync_all()?;
    drop(f);
    std::fs::rename(&tmp, path)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    pub(crate) const FAST: u32 = 2;

    fn ip() -> IpAddr {
        "192.0.2.1".parse().unwrap()
    }

    pub(crate) fn temp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!(
            "oec-registry-auth-{name}-{}-{:?}",
            std::process::id(),
            Instant::now()
        ));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn hashes() {
        let h = hash("correct horse battery", FAST);
        assert!(h.starts_with("pbkdf2-sha256$2$"), "{h}");
        assert!(verify("correct horse battery", &h));
        assert!(!verify("correct horse batterY", &h));
        assert_ne!(h, hash("correct horse battery", FAST), "salted");
        for bad in [
            "",
            "pbkdf2-sha256$2$00$00",
            "pbkdf2-sha256$0$00$",
            "md5$2$00$00",
            "pbkdf2-sha256$x$00$00",
            &format!("{h}$x"),
        ] {
            assert!(!verify("correct horse battery", bad), "{bad}");
        }
        let (n, salt, out) = parse_hash(&hash("x", ITERATIONS)).unwrap();
        assert_eq!((n.get(), salt.len(), out.len()), (ITERATIONS, 16, 32));
    }

    #[test]
    fn policy() {
        for ok in ["admin", "a", "Jane.Doe@acme-1_x", &"n".repeat(64)] {
            assert!(valid_name(ok), "{ok}");
        }
        for bad in ["", "a b", "ä", "x/y", &"n".repeat(65), "a:b"] {
            assert!(!valid_name(bad), "{bad}");
        }
        assert!(check_password("admin", "twelve chars").is_ok());
        assert!(check_password("admin", "elevenchars").is_err());
        assert!(check_password("admin", &"ü".repeat(12)).is_ok());
        assert!(check_password("admin", &"x".repeat(257)).is_err());
        assert!(check_password("longusername", "LongUserName").is_err());
        let g = generate_password();
        assert_eq!(g.len(), GENERATED_LEN);
        assert!(check_password("admin", &g).is_ok());
        assert_ne!(g, generate_password());
    }

    fn open(root: &Path) -> (Auth, Opened) {
        Auth::open(root, &root.join("run/secrets/oi4/pw"), false, FAST).unwrap()
    }

    #[test]
    fn bootstrap_and_store() {
        // no volume: in memory, a generated password to be changed
        let root = temp("memory");
        let (a, o) = open(&root);
        assert!(!a.persistent());
        let Opened::Generated(pw) = o else {
            panic!("{o:?}")
        };
        assert!(verify(&pw, &a.users[0].hash) && a.users[0].must_change);
        assert!(!root.join("etc").exists());

        // the volume and the password file: stored, nothing to change
        let root = temp("file");
        std::fs::create_dir_all(root.join("etc/oi4/app")).unwrap();
        std::fs::create_dir_all(root.join("run/secrets/oi4")).unwrap();
        std::fs::write(root.join("run/secrets/oi4/pw"), "a secret of mine\n").unwrap();
        let (a, o) = open(&root);
        assert_eq!(o, Opened::Bootstrapped);
        assert!(a.persistent());
        assert!(verify("a secret of mine", &a.users[0].hash) && !a.users[0].must_change);
        let store = root.join("etc/oi4/app/registry/users.json");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = |p: &Path| std::fs::metadata(p).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode(&store), 0o600);
            assert_eq!(mode(store.parent().unwrap()), 0o700);
        }
        let text = std::fs::read_to_string(&store).unwrap();
        assert!(!text.contains("a secret of mine"), "{text}");
        // the next start loads the store and ignores the password file
        std::fs::write(root.join("run/secrets/oi4/pw"), "another secret!\n").unwrap();
        let (b, o) = open(&root);
        assert_eq!(o, Opened::Loaded(1));
        assert_eq!(b.users, a.users);

        // an invalid store is an error, a weak or unreadable file too
        for bad in [
            "{",
            r#"{"version": 2, "users": []}"#,
            r#"{"version": 1, "users": []}"#,
            r#"{"version": 1, "users": [{"name": "admin", "role": "user", "hash": "x", "mustChange": false}]}"#,
        ] {
            std::fs::write(&store, bad).unwrap();
            let e = Auth::open(&root, &root.join("pw"), false, FAST).unwrap_err();
            assert!(e.contains("users.json") && e.contains("delete"), "{e}");
        }
        let root = temp("weak");
        std::fs::write(root.join("pw"), "short\n").unwrap();
        assert!(Auth::open(&root, &root.join("pw"), false, FAST).is_err());
        assert!(Auth::open(&root, &root.join("nope"), true, FAST).is_err());
    }

    #[test]
    fn sessions_and_throttle() {
        let root = temp("sessions");
        let (mut a, _) = open(&root);
        let t0 = Instant::now();
        let h = a.login_hash(ip(), "admin", t0).unwrap();
        let (u, token) = a.logged_in(ip(), "admin", &h, t0).unwrap();
        assert_eq!(u.name, "admin");
        assert_eq!(token.len(), 64);
        assert_eq!(a.session(&token, t0).map(|u| u.role), Some(Role::Admin));
        assert!(a.session("nope", t0).is_none());
        assert!(a.session(&"0".repeat(64), t0).is_none());
        // idle
        let t1 = t0 + (IDLE - Duration::from_secs(1));
        assert!(a.session(&token, t1).is_some());
        assert!(a.session(&token, t1 + IDLE).is_none());
        // absolute, even when active
        let (_, token) = a.logged_in(ip(), "admin", &h, t0).unwrap();
        let mut t = t0;
        while t < t0 + (ABSOLUTE - IDLE) {
            t += IDLE / 2;
            assert!(a.session(&token, t).is_some());
        }
        assert!(a.session(&token, t0 + ABSOLUTE).is_none());
        // logout
        let (_, token) = a.logged_in(ip(), "admin", &h, t0).unwrap();
        a.logout(&token);
        assert!(a.session(&token, t0).is_none());
        // a changed hash is no login
        assert!(a.logged_in(ip(), "admin", "other", t0).is_none());
        assert!(a.logged_in(ip(), "nobody", &h, t0).is_none());
        // the unknown name is checked against the dummy
        assert_eq!(a.login_hash(ip(), "nobody", t0).unwrap(), a.dummy);
        // bounded sessions
        for _ in 0..MAX_SESSIONS + 5 {
            a.logged_in(ip(), "admin", &h, t0).unwrap();
        }
        assert_eq!(a.sessions.len(), MAX_SESSIONS);

        // throttle: blocked after MAX_FAILURES, released after BLOCK, a
        // login resets
        for _ in 0..MAX_FAILURES - 1 {
            a.failed(ip(), t0);
        }
        assert!(a.login_hash(ip(), "admin", t0).is_ok());
        a.failed(ip(), t0);
        assert_eq!(a.login_hash(ip(), "admin", t0), Err(BLOCK.as_secs()));
        let other: IpAddr = "192.0.2.2".parse().unwrap();
        assert!(a.login_hash(other, "admin", t0).is_ok());
        assert!(a.login_hash(ip(), "admin", t0 + BLOCK).is_ok());
        a.failed(ip(), t0 + BLOCK);
        assert!(
            a.login_hash(ip(), "admin", t0 + BLOCK).is_ok(),
            "starts again"
        );
        a.logged_in(ip(), "admin", &h, t0 + BLOCK).unwrap();
        assert!(!a.clients.contains_key(&ip()));
        for i in 0..u16::try_from(MAX_CLIENTS + 10).unwrap() {
            let [hi, lo] = i.to_be_bytes();
            let ip = IpAddr::from([10, 0, hi, lo]);
            a.failed(ip, t0);
        }
        assert!(a.clients.len() <= MAX_CLIENTS);
    }

    #[test]
    fn users() {
        let root = temp("users");
        std::fs::create_dir_all(root.join("etc/oi4/app")).unwrap();
        let (mut a, _) = open(&root);
        let t0 = Instant::now();
        let u = a
            .create("jane", Role::User, hash("jane's secret", FAST))
            .unwrap();
        assert!(u.must_change);
        assert_eq!(
            a.create("jane", Role::User, String::new()),
            Err((409, "the user exists"))
        );
        assert_eq!(
            a.create("a b", Role::User, String::new()).map_err(|e| e.0),
            Err(400)
        );
        assert_eq!(
            a.list(),
            json!({"users": [
                {"name": "admin", "role": "admin", "mustChange": true},
                {"name": "jane", "role": "user", "mustChange": true},
            ]})
        );
        // persisted
        let (b, _) = open(&root);
        assert_eq!(b.users, a.users);

        // jane changes her password: her other sessions end
        let h = a.hash_of("jane").unwrap();
        let (_, t1) = a.logged_in(ip(), "jane", &h, t0).unwrap();
        let (_, t2) = a.logged_in(ip(), "jane", &h, t0).unwrap();
        let u = a
            .change_own("jane", &h, hash("a new secret!", FAST), &t1)
            .unwrap();
        assert!(!u.must_change);
        assert!(a.session(&t1, t0).is_some() && a.session(&t2, t0).is_none());
        assert_eq!(
            a.change_own("jane", &h, String::new(), &t1)
                .map_err(|e| e.0),
            Err(409)
        );

        // the admin resets it: every session of jane ends
        let u = a
            .update("jane", None, Some(hash("reset by admin", FAST)))
            .unwrap();
        assert!(u.must_change && a.session(&t1, t0).is_none());
        // role, the last admin
        let u = a.update("jane", Some(Role::Admin), None).unwrap();
        assert_eq!(u.role, Role::Admin);
        a.update("admin", Some(Role::User), None).unwrap();
        assert_eq!(
            a.update("jane", Some(Role::User), None).map_err(|e| e.0),
            Err(409)
        );
        assert_eq!(a.delete("jane").map_err(|e| e.0), Err(409));
        assert_eq!(a.update("nobody", None, None).map_err(|e| e.0), Err(404));
        assert_eq!(a.delete("nobody").map_err(|e| e.0), Err(404));
        a.update("admin", Some(Role::Admin), None).unwrap();
        let h = a.hash_of("jane").unwrap();
        let (_, t3) = a.logged_in(ip(), "jane", &h, t0).unwrap();
        a.delete("jane").unwrap();
        assert!(a.session(&t3, t0).is_none());
        // too many
        for i in 1..MAX_USERS {
            a.create(&format!("u{i}"), Role::User, h.clone()).unwrap();
        }
        assert_eq!(
            a.create("one-more", Role::User, h).map_err(|e| e.0),
            Err(409)
        );
    }
}
