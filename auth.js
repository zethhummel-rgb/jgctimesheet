function cleanJgcAuthText(value, maxLength) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

async function loadJgcProfileAndEnter(supabaseClient, user, setStatus, options) {
  const stayLoggedIn = !options || options.stayLoggedIn !== false;
  let { data: profile, error } = await supabaseClient
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (error || !profile) {
    const displayName = user.user_metadata && user.user_metadata.display_name
      ? cleanJgcAuthText(user.user_metadata.display_name, 80)
      : user.email;
    const workerKey = normalizeWorkerName(displayName);

    const { data: createdProfile, error: createProfileError } = await supabaseClient
      .from("profiles")
      .insert({
        id: user.id,
        email: cleanJgcAuthText(user.email, 254).toLowerCase(),
        display_name: displayName,
        worker_key: workerKey,
        role: "worker",
        account_status: "pending"
      })
      .select("*")
      .single();

    if (createProfileError || !createdProfile) {
      setStatus("Account found, but profile setup failed. Please ask admin.");
      return;
    }

    profile = createdProfile;
  }

  if (profile.account_status === "pending") {
    await supabaseClient.auth.signOut();
    clearJgcSession();
    setStatus("Your account is waiting for admin approval.");
    return;
  }

  if (profile.account_status === "inactive") {
    await supabaseClient.auth.signOut();
    clearJgcSession();
    setStatus("This account has been deactivated. Please ask admin.");
    return;
  }

  if (typeof recordJgcProfileActivity === "function") {
    const loginActivity = await recordJgcProfileActivity(supabaseClient, {
      user,
      profileId: profile.id,
      isLogin: true
    });
    const activityRow = loginActivity && loginActivity.data;

    if (activityRow) {
      profile.last_login_at = activityRow.last_login_at || profile.last_login_at;
      profile.last_portal_activity = activityRow.last_portal_activity || profile.last_portal_activity;
    }
  }

  setJgcAuthPersistencePreference(stayLoggedIn);
  localStorage.setItem("currentWorker", profile.worker_key);
  localStorage.setItem("currentWorkerDisplay", profile.display_name);
  localStorage.setItem("currentUserEmail", profile.email);
  localStorage.setItem("currentUserRole", profile.role || "worker");
  localStorage.setItem("currentAccountStatus", profile.account_status || "approved");
  localStorage.setItem("jgcStayLoggedIn", stayLoggedIn ? "true" : "false");
  sessionStorage.setItem("jgcActiveSession", "true");

  window.location.href = isAdminWorker(profile.worker_key, profile.role, profile.email) ? "admin.html" : "home.html";
}
