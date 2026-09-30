/* One entry operation at a time, including when a phone resumes the PWA. */
let jgcLoginOperation = null;
let jgcPendingLoginAuth = null;
let jgcLoginMode = "recovering";
const JGC_LOGIN_WAIT_MS = 12000;

function setJgcLoginView(mode, message) {
  jgcLoginMode = mode;
  const controls = document.getElementById("loginControls");
  controls.hidden = mode !== "ready" && mode !== "signing-in";
  controls.disabled = mode !== "ready";
  document.getElementById("loginRetry").hidden = mode !== "retry";
  document.querySelector(".login-card").setAttribute("aria-busy",
    mode === "recovering" || mode === "signing-in" ? "true" : "false");
  setStatus(message);
}

function isJgcLoginBusy() {
  return Boolean(jgcLoginOperation || jgcPendingLoginAuth);
}

function requestJgcLoginAuth(request) {
  // A UI deadline cannot cancel the SDK's refresh lock. Reuse the still-running
  // request instead of starting another one, and check again once it settles.
  if (jgcPendingLoginAuth) return jgcPendingLoginAuth;
  const pending = Promise.resolve().then(request);
  jgcPendingLoginAuth = pending;
  const settled = () => {
    if (jgcPendingLoginAuth === pending) jgcPendingLoginAuth = null;
    if (jgcLoginMode === "retry" && !jgcLoginOperation) {
      setTimeout(checkExistingSession, 0);
    }
  };
  pending.then(settled, settled);
  return pending;
}

function isJgcExpiredSessionError(error) {
  return ["refresh_token_not_found", "refresh_token_already_used", "session_not_found",
    "session_expired", "invalid_refresh_token"].includes(error && error.code);
}

async function runJgcLoginOperation(kind, credentials) {
  if (jgcLoginOperation) return;
  const operation = { current: true, controller: new AbortController() };
  jgcLoginOperation = operation;
  setJgcLoginView(kind === "sign-in" ? "signing-in" : "recovering",
    kind === "sign-in" ? "Signing in…" : "Restoring your session…");
  let timer;
  try {
    await Promise.race([
      (async () => {
        if (!supabaseClient) throw new Error("Auth unavailable");
        const result = await requestJgcLoginAuth(() => kind === "sign-in"
          ? supabaseClient.auth.signInWithPassword(credentials)
          : supabaseClient.auth.getSession());
        if (!operation.current) return;
        if (result.error) {
          if (kind !== "sign-in" && isJgcExpiredSessionError(result.error)) {
            clearJgcSession();
            setJgcLoginView("ready", "Your session has expired. Please sign in again.");
            return;
          }
          throw result.error;
        }
        const user = kind === "sign-in" ? result.data.user
          : result.data.session && result.data.session.user;
        if (!user) {
          clearJgcSession();
          setJgcLoginView("ready", "");
          return;
        }
        setStatus("Opening your Portal…");
        const entered = await loadJgcProfileAndEnter(supabaseClient, user, setStatus, {
          stayLoggedIn: localStorage.getItem("jgcStayLoggedIn") !== "false",
          isLogin: kind === "sign-in",
          allowProfileCreation: kind === "sign-in",
          signal: operation.controller.signal,
          isCurrent: () => operation.current
        });
        if (operation.current && !entered) {
          setJgcLoginView("ready", document.getElementById("loginStatus").textContent);
        }
      })(),
      new Promise((resolve, reject) => {
        timer = setTimeout(() => {
          operation.current = false;
          operation.controller.abort();
          reject(new Error("Session recovery timed out"));
        }, JGC_LOGIN_WAIT_MS);
      })
    ]);
  } catch (error) {
    operation.current = false;
    operation.controller.abort();
    if (kind === "sign-in" && error && (error.code === "invalid_credentials"
        || (error.status === 400 && /invalid login credentials/i.test(error.message || "")))) {
      setJgcLoginView("ready", "Sign in failed. Check your email and password.");
    } else if (kind === "sign-in" && error && error.code === "email_not_confirmed") {
      setJgcLoginView("ready", "Please confirm your email before signing in.");
    } else if (kind === "sign-in" && error && error.status === 429) {
      setJgcLoginView("ready", "Too many sign-in attempts. Wait a little, then try again.");
    } else {
      setJgcLoginView("retry", navigator.onLine === false
        ? "You’re offline. Reconnect, then try again. Your saved session has been kept."
        : "We couldn’t finish connecting to your Portal. Try again; your saved session has been kept.");
    }
  } finally {
    clearTimeout(timer);
    if (jgcLoginOperation === operation) jgcLoginOperation = null;
  }
}

// All buttons and Enter use the same entry guard.
function checkExistingSession() {
  return runJgcLoginOperation("restore");
}

function signIn() {
  if (isJgcLoginBusy() || jgcLoginMode !== "ready") return;
  const email = cleanLoginEmail(document.getElementById("email").value);
  const password = document.getElementById("password").value;
  if (!email || !password) {
    setStatus("Enter your email and password.");
    return;
  }
  if (!isValidLoginEmail(email) || password.length > 128) {
    setStatus("Enter a valid email address and password.");
    return;
  }
  setJgcAuthPersistencePreference(document.getElementById("stayLoggedIn").checked);
  return runJgcLoginOperation("sign-in", { email, password });
}

async function signUp() {
  if (isJgcLoginBusy() || jgcLoginMode !== "ready") return;
  const operation = { current: true };
  jgcLoginOperation = operation;
  setJgcLoginView("signing-in", "Creating account…");
  try {
    await submitJgcAccountRequest();
  } catch (error) {
    setStatus("We couldn’t finish your account request. Please try again.");
  } finally {
    if (jgcLoginOperation === operation) jgcLoginOperation = null;
    setJgcLoginView("ready", document.getElementById("loginStatus").textContent);
  }
}

window.addEventListener("online", () => {
  if (jgcLoginMode === "retry") checkExistingSession();
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && jgcLoginMode === "retry") checkExistingSession();
});
if (supabaseClient) {
  supabaseClient.auth.onAuthStateChange((event, session) => {
    if ((event === "SIGNED_IN" || event === "TOKEN_REFRESHED") && session && !isJgcLoginBusy()) {
      // Run after the SDK releases its callback/refresh lock.
      setTimeout(() => {
        if (!isJgcLoginBusy() && jgcLoginMode !== "recovering" && jgcLoginMode !== "signing-in") {
          checkExistingSession();
        }
      }, 0);
    }
  });
}
checkExistingSession();
