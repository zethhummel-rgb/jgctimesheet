async function loadJgcProfileAndEnter(supabaseClient, user, setStatus) {
  let { data: profile, error } = await supabaseClient
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (error || !profile) {
    const displayName = user.user_metadata && user.user_metadata.display_name
      ? user.user_metadata.display_name
      : user.email;
    const workerKey = user.user_metadata && user.user_metadata.worker_key
      ? user.user_metadata.worker_key
      : normalizeWorkerName(displayName);

    const { data: createdProfile, error: createProfileError } = await supabaseClient
      .from("profiles")
      .insert({
        id: user.id,
        email: user.email,
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

  localStorage.setItem("currentWorker", profile.worker_key);
  localStorage.setItem("currentWorkerDisplay", profile.display_name);
  localStorage.setItem("currentUserEmail", profile.email);
  localStorage.setItem("currentUserRole", profile.role || "worker");
  localStorage.setItem("currentAccountStatus", profile.account_status || "approved");
  window.location.href = "home.html";
}
