// The user management of the registry UI (ADR-0035): the login, the change of
// the own password (forced after a new or reset password) and the users page
// of the admins. The session is the HttpOnly cookie of the registry.
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  ApiError,
  changePassword,
  createUser,
  deleteUser,
  fetchSession,
  fetchUsers,
  login,
  PASSWORD_MAX,
  PASSWORD_MIN,
  SESSION_ENDED,
  updateUser,
  type Role,
  type User,
} from "./api";
import { Atom } from "./logo";

export type Session = { state: "loading" } | { state: "anonymous"; note: string | null } | { state: "user"; user: User };

/** The session of the page: asked once, ended by any 401 of the API. */
export function useSession(): [Session, (s: Session) => void] {
  const [session, setSession] = useState<Session>({ state: "loading" });
  useEffect(() => {
    let alive = true;
    fetchSession()
      .then((user) => alive && setSession(user === null ? { state: "anonymous", note: null } : { state: "user", user }))
      .catch((e: unknown) => alive && setSession({ state: "anonymous", note: message(e) }));
    const ended = () => setSession({ state: "anonymous", note: "The session has ended. Please log in again." });
    window.addEventListener(SESSION_ENDED, ended);
    return () => {
      alive = false;
      window.removeEventListener(SESSION_ENDED, ended);
    };
  }, []);
  return [session, setSession];
}

function message(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 429) {
      return `Too many failed attempts – try again in ${e.retryAfter ?? 60} s.`;
    }
    if (e.status === 503) {
      return "The registry is busy – try again in a moment.";
    }
    return e.message.length > 0 ? e.message.charAt(0).toUpperCase() + e.message.slice(1) + "." : `Error ${e.status}.`;
  }
  return "The registry cannot be reached.";
}

/** A new password: the rules of the registry, checked before it is sent. */
function weak(name: string, password: string, repeat: string): string | null {
  if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
    return `The password needs ${PASSWORD_MIN} … ${PASSWORD_MAX} characters.`;
  }
  if (password.toLowerCase() === name.toLowerCase()) {
    return "The password must not be the user name.";
  }
  if (password !== repeat) {
    return "The two passwords differ.";
  }
  return null;
}

/** The centred card of the login and of the forced password change. */
function Gate({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="gate">
      <div className="card gate-card">
        <div className="gate-brand">
          <Atom />
          <span className="brand-text">
            <span className="brand-kicker">OI4 Open Edge Computing</span>
            <span className="brand-name">
              OEC <b>Registry</b>
            </span>
          </span>
        </div>
        <h1 className="gate-title">{title}</h1>
        {children}
      </div>
    </div>
  );
}

function Field({
  label,
  type = "text",
  value,
  onChange,
  autoComplete,
  autoFocus,
}: {
  label: string;
  type?: "text" | "password";
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
  autoFocus?: boolean;
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        required
        maxLength={PASSWORD_MAX}
        spellCheck={false}
        autoCapitalize="off"
      />
    </label>
  );
}

export function Login({ note, onUser }: { note: string | null; onUser: (u: User) => void }) {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    login(name, password)
      .then(onUser)
      .catch((x: unknown) => {
        setError(x instanceof ApiError && x.status === 401 ? "Wrong user name or password." : message(x));
        setPassword("");
        setBusy(false);
      });
  };
  return (
    <Gate title="Log in">
      <form className="form" onSubmit={submit}>
        {note !== null && error === null && <p className="note">{note}</p>}
        <Field label="User name" value={name} onChange={setName} autoComplete="username" autoFocus />
        <Field label="Password" type="password" value={password} onChange={setPassword} autoComplete="current-password" />
        {error !== null && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="button primary" disabled={busy}>
          {busy ? "Logging in …" : "Log in"}
        </button>
      </form>
    </Gate>
  );
}

function PasswordForm({ user, onDone, onCancel }: { user: User; onDone: (u: User) => void; onCancel?: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const w = weak(user.name, next, repeat);
    if (w !== null) {
      setError(w);
      return;
    }
    setBusy(true);
    setError(null);
    changePassword(current, next)
      .then(onDone)
      .catch((x: unknown) => {
        setError(x instanceof ApiError && x.status === 403 ? "The current password is wrong." : message(x));
        setBusy(false);
      });
  };
  return (
    <form className="form" onSubmit={submit}>
      {/* lets password managers store the new password for the right user */}
      <input type="text" className="sr-only" value={user.name} autoComplete="username" readOnly tabIndex={-1} aria-hidden="true" />
      <Field label="Current password" type="password" value={current} onChange={setCurrent} autoComplete="current-password" autoFocus />
      <Field label={`New password (${PASSWORD_MIN} … ${PASSWORD_MAX} characters)`} type="password" value={next} onChange={setNext} autoComplete="new-password" />
      <Field label="Repeat the new password" type="password" value={repeat} onChange={setRepeat} autoComplete="new-password" />
      {error !== null && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        <button type="submit" className="button primary" disabled={busy}>
          {busy ? "Saving …" : "Change password"}
        </button>
        {onCancel && (
          <button type="button" className="button" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

/** The password change before anything else (`mustChange`). */
export function ForcedPassword({ user, onDone, onLogout }: { user: User; onDone: (u: User) => void; onLogout: () => void }) {
  return (
    <Gate title="Choose a new password">
      <p className="note">
        <b>{user.name}</b>, your password was set by an administrator or generated at the start. Please choose your own
        password to continue.
      </p>
      <PasswordForm user={user} onDone={onDone} onCancel={onLogout} />
    </Gate>
  );
}

/** `#/password`: the change of the own password. */
export function PasswordView({ user, onDone }: { user: User; onDone: (u: User) => void }) {
  const [done, setDone] = useState(false);
  return (
    <section className="card pad account">
      <h2>Change password</h2>
      {done ? (
        <p className="note ok" role="status">
          Your password has been changed. Your other sessions have been ended.
        </p>
      ) : (
        <PasswordForm
          user={user}
          onDone={(u) => {
            setDone(true);
            onDone(u);
          }}
          onCancel={() => window.history.back()}
        />
      )}
    </section>
  );
}

const ROLES: readonly Role[] = ["user", "admin"];

function NewUser({ onCreated }: { onCreated: (u: User) => void }) {
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("user");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const w = weak(name, password, password);
    if (w !== null) {
      setError(w);
      return;
    }
    setBusy(true);
    setError(null);
    createUser(name, role, password)
      .then((u) => {
        setName("");
        setPassword("");
        setRole("user");
        setBusy(false);
        onCreated(u);
      })
      .catch((x: unknown) => {
        setError(message(x));
        setBusy(false);
      });
  };
  return (
    <form className="form form-inline" onSubmit={submit}>
      <Field label="User name" value={name} onChange={setName} autoComplete="off" />
      <label className="field">
        <span className="field-label">Role</span>
        <select value={role} onChange={(e) => setRole(e.target.value === "admin" ? "admin" : "user")}>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </label>
      <Field label="Initial password" type="password" value={password} onChange={setPassword} autoComplete="new-password" />
      <button type="submit" className="button primary" disabled={busy}>
        Add user
      </button>
      {error !== null && (
        <p className="error form-wide" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

function UserRow({ user, self, onChanged }: { user: User; self: boolean; onChanged: () => void }) {
  const [reset, setReset] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = (p: Promise<unknown>) => {
    setError(null);
    p.then(() => {
      setReset(null);
      onChanged();
    }).catch((x: unknown) => setError(message(x)));
  };
  return (
    <tr>
      <td className="mono">
        {user.name}
        {self && <span className="muted"> (you)</span>}
      </td>
      <td>
        <select
          value={user.role}
          aria-label={`Role of ${user.name}`}
          onChange={(e) => run(updateUser(user.name, { role: e.target.value === "admin" ? "admin" : "user" }))}
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </td>
      <td>{user.mustChange ? <span className="badge tone-warn">must change password</span> : <span className="muted">–</span>}</td>
      <td className="user-actions">
        {reset === null ? (
          <button type="button" className="button" onClick={() => setReset("")}>
            Set password
          </button>
        ) : (
          <form
            className="inline"
            onSubmit={(e) => {
              e.preventDefault();
              const w = weak(user.name, reset, reset);
              if (w !== null) {
                setError(w);
                return;
              }
              run(updateUser(user.name, { password: reset }));
            }}
          >
            <input
              type="password"
              value={reset}
              onChange={(e) => setReset(e.target.value)}
              aria-label={`New password of ${user.name}`}
              autoComplete="new-password"
              maxLength={PASSWORD_MAX}
              autoFocus
            />
            <button type="submit" className="button primary">
              Set
            </button>
            <button type="button" className="button" onClick={() => setReset(null)}>
              Cancel
            </button>
          </form>
        )}
        {!self && (
          <button
            type="button"
            className="button danger"
            onClick={() => {
              if (window.confirm(`Delete the user "${user.name}"? Its sessions end at once.`)) {
                run(deleteUser(user.name));
              }
            }}
          >
            Delete
          </button>
        )}
        {error !== null && (
          <span className="error" role="alert">
            {error}
          </span>
        )}
      </td>
    </tr>
  );
}

/** `#/users`: the users of the registry (admins only). */
export function UsersView({ self }: { self: User }) {
  const [users, setUsers] = useState<User[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    fetchUsers()
      .then((u) => {
        setUsers(u);
        setError(null);
      })
      .catch((x: unknown) => setError(message(x)));
  }, []);
  useEffect(load, [load]);
  return (
    <section className="card pad account">
      <h2>Users</h2>
      <p className="muted small">
        An <b>admin</b> also manages the users; a <b>user</b> reads the registry. A new or reset password has to be
        changed at the next login; setting it ends the sessions of the user.
      </p>
      {error !== null && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {users !== null && (
        <table className="users">
          <thead>
            <tr>
              <th>Name</th>
              <th>Role</th>
              <th>Password</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <UserRow key={u.name} user={u} self={u.name === self.name} onChanged={load} />
            ))}
          </tbody>
        </table>
      )}
      <h3>Add a user</h3>
      <NewUser onCreated={load} />
    </section>
  );
}
