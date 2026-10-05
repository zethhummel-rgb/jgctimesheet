function cleanJgcAuthText(value, maxLength) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

async function loadJgcProfileAndEnter(supabaseClient, user, setStatus, options) {
  const settings = options || {};
  const stayLoggedIn = settings.stayLoggedIn !== false;
  const isCurrent = settings.isCurrent || (() => true);
  let { data: profile, error } = await supabaseClient
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .abortSignal(settings.signal)
    .maybeSingle();

  if (!isCurrent()) return false;
  if (error) throw error;

  if (!profile) {
    if (!settings.allowProfileCreation) {
      setStatus("Your account profile could not be found. Please ask admin.");
      return false;
    }
    const displayName = user.user_metadata && user.user_metadata.display_name
      ? cleanJgcAuthText(user.user_metadata.display_name, 80)
      : user.email;
    const workerKey = normalizeWorkerName(displayName);
    const phone = cleanJgcAuthText(user.user_metadata && user.user_metadata.phone, 40);
    if (!phone || phone.replace(/\D/g, '').length < 10) {
      setStatus("Your profile needs a phone number. Please ask admin to complete account setup.");
      return false;
    }

    const { data: createdProfile, error: createProfileError } = await supabaseClient
      .from("profiles")
      .insert({
        id: user.id,
        email: cleanJgcAuthText(user.email, 254).toLowerCase(),
        display_name: displayName,
        worker_key: workerKey,
        phone,
        add_to_contacts: !!(user.user_metadata && user.user_metadata.add_to_contacts === true),
        role: "worker",
        account_status: "pending"
      })
      .select("*")
      .abortSignal(settings.signal)
      .single();

    if (!isCurrent()) return false;
    if (createProfileError || !createdProfile) {
      setStatus("Account found, but profile setup failed. Please ask admin.");
      return false;
    }

    profile = createdProfile;
  }

  if (profile.account_status === "pending") {
    await supabaseClient.auth.signOut();
    if (!isCurrent()) return false;
    clearJgcSession();
    setStatus("Your account is waiting for admin approval.");
    return false;
  }

  if (profile.account_status === "inactive") {
    await supabaseClient.auth.signOut();
    if (!isCurrent()) return false;
    clearJgcSession();
    setStatus("This account has been deactivated. Please ask admin.");
    return false;
  }

  const hasLimitedAccess = profile.account_status === "limited";

  if (typeof recordJgcProfileActivity === "function") {
    // Give activity recording a brief chance; it must never hold Portal entry.
    let activityTimer;
    const loginActivity = await Promise.race([
      Promise.resolve().then(() => recordJgcProfileActivity(supabaseClient, {
        user,
        profileId: profile.id,
        isLogin: settings.isLogin !== false
      })).catch(() => null),
      new Promise(resolve => { activityTimer = setTimeout(() => resolve(null), 600); })
    ]);
    clearTimeout(activityTimer);
    const activityRow = loginActivity && loginActivity.data;

    if (activityRow) {
      profile.last_login_at = activityRow.last_login_at || profile.last_login_at;
      profile.last_portal_activity = activityRow.last_portal_activity || profile.last_portal_activity;
    }
  }

  if (!isCurrent()) return false;
  setJgcAuthPersistencePreference(stayLoggedIn);
  localStorage.setItem("currentWorker", profile.worker_key);
  localStorage.setItem("currentWorkerDisplay", profile.display_name);
  localStorage.setItem("currentUserEmail", profile.email);
  localStorage.setItem("currentUserRole", profile.role || "worker");
  localStorage.setItem("currentAccountStatus", profile.account_status || "approved");
  localStorage.setItem("jgcStayLoggedIn", stayLoggedIn ? "true" : "false");
  sessionStorage.setItem("jgcActiveSession", "true");

  window.location.href = hasLimitedAccess
    ? "limited-access.html"
    : (isAdminWorker(profile.worker_key, profile.role, profile.email) ? "admin.html" : "home.html");
  return true;
}
