import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import EstimateDesk from "../app/estimate-desk";
import "../app/globals.css";
import "./portal-shell.css";
import { installEstimatorApiBridge } from "./portal-api";

declare global {
  interface Window {
    createJgcSupabaseClient?: () => any;
  }
}

type GateState = "loading" | "allowed" | "denied" | "signed-out" | "error";

function PortalEstimator() {
  const [gate, setGate] = useState<GateState>("loading");
  const [name, setName] = useState("");
  const [userId, setUserId] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    const run = async () => {
      try {
        if ((window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost") && new URLSearchParams(window.location.search).get("dev") === "1") {
          if (active) {
            setName("Local QA");
            setUserId("local-qa");
            setGate("allowed");
          }
          return;
        }
        if (!window.createJgcSupabaseClient) throw new Error("The Portal connection did not load.");
        const client = window.createJgcSupabaseClient();
        const sessionResult = await client.auth.getSession();
        const user = sessionResult.data?.session?.user;
        if (!user) {
          if (active) setGate("signed-out");
          return;
        }
        const profileResult = await client.from("profiles").select("display_name,role,account_status").eq("id", user.id).single();
        if (profileResult.error) throw new Error(profileResult.error.message || "Your Portal profile could not be checked.");
        const profile = profileResult.data;
        const approved = profile?.role === "admin" && profile?.account_status === "approved";
        if (!approved) {
          if (active) setGate("denied");
          return;
        }
        installEstimatorApiBridge(client);
        if (active) {
          setName(profile.display_name || user.email || "Administrator");
          setUserId(user.id);
          setGate("allowed");
        }
      } catch (error) {
        if (!active) return;
        setMessage(error instanceof Error ? error.message : "The estimator could not connect to the Portal.");
        setGate("error");
      }
    };
    void run();
    return () => { active = false; };
  }, []);

  if (gate === "allowed") return <><div className="estimator-portal-strip"><span>Connected to JGC Portal</span><small>{name}</small></div><EstimateDesk currentEstimator={{ id: userId, name, isAdmin: true }} /></>;
  const title = gate === "denied" ? "Admin access required" : gate === "signed-out" ? "Sign in to the JGC Portal" : gate === "error" ? "Connection problem" : "Opening Estimate Desk";
  const detail = gate === "denied" ? "The Estimate Desk is available only to approved Portal administrators." : gate === "signed-out" ? "Use your existing Portal account. You will return here after signing in." : gate === "error" ? message : "Checking your Portal access and shared data…";
  return <main className="estimator-gate"><img className="estimator-gate-logo" src="../icon-192.png" alt="JGC" /><p>JGC ESTIMATE DESK</p><h1>{title}</h1><span>{detail}</span>{gate !== "loading" && <a className="gate-button" href="../index.html">{gate === "signed-out" ? "Go to Portal sign in" : "Return to Portal"}</a>}</main>;
}

createRoot(document.getElementById("root")!).render(<React.StrictMode><PortalEstimator /></React.StrictMode>);
