/* Supabase backend for the Posting Board.
   Provides the same window.claude.use("db" | "user" | "downloads") interface the board was
   written against, so index.html keeps one code path. Anyone with the link can read;
   only accounts listed in public.editors can write (enforced by RLS, not by this file). */
(function () {
  var SUPABASE_URL = "https://ovlhpquppowfnoutcbec.supabase.co";
  var SUPABASE_KEY = "sb_publishable_Fri5euXoqatrLk1GE_Evvw_LXc5L_YC"; // publishable key: safe in the browser
  var EDITOR_NAME = "Mufeed";

  var sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  var cache = {};

  function denied(e) {
    var err = new Error((e && e.message) || "Not allowed");
    err.code = "invalid_argument";
    return err;
  }
  function failed(e) {
    var err = new Error((e && e.message) || "Request failed");
    err.code = (e && (e.code === "42501" || /row-level security/i.test(e.message || ""))) ? "invalid_argument" : "unavailable";
    return err;
  }
  function snapshot() {
    var ids = Object.keys(cache);
    return {
      size: ids.length,
      metadata: { fromCache: false },
      docs: ids.map(function (id) { return { id: id, exists: true, data: function () { return cache[id]; } }; })
    };
  }
  var listeners = [];
  function emit() { var s = snapshot(); listeners.forEach(function (l) { l(s); }); }

  async function loadAll() {
    var all = [], from = 0, size = 1000;
    while (true) {
      var r = await sb.from("posts").select("id,data").range(from, from + size - 1);
      if (r.error) throw failed(r.error);
      all = all.concat(r.data);
      if (r.data.length < size) break;
      from += size;
    }
    var next = {}; all.forEach(function (row) { next[row.id] = row.data || {}; });
    cache = next;
  }

  var db = {
    collection: function (name) {
      return {
        onSnapshot: function (onNext, onError) {
          listeners.push(onNext);
          loadAll().then(function () { onNext(snapshot()); }).catch(function (e) { if (onError) onError(e); });
          var ch = sb.channel("posts-live")
            .on("postgres_changes", { event: "*", schema: "public", table: "posts" }, function (p) {
              if (p.eventType === "DELETE") { if (p.old && p.old.id) delete cache[p.old.id]; }
              else if (p.new && p.new.id) cache[p.new.id] = p.new.data || {};
              emit();
            })
            .subscribe(function (status) {
              // after a dropped connection, reload everything so nothing is missed
              if (status === "SUBSCRIBED" && Object.keys(cache).length) loadAll().then(emit).catch(function () {});
            });
          return function () { sb.removeChannel(ch); listeners = listeners.filter(function (l) { return l !== onNext; }); };
        },
        add: async function (data) {
          var id = "p-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
          var r = await sb.from("posts").insert({ id: id, data: data }).select("id");
          if (r.error) throw failed(r.error);
          if (!r.data || !r.data.length) throw denied();
          cache[id] = data; emit();
          return { id: id };
        }
      };
    },
    doc: function (path) {
      var id = path.split("/")[1];
      return {
        update: async function (patch) {
          var merged = Object.assign({}, cache[id] || {}, patch);
          var r = await sb.from("posts").update({ data: merged, updated_at: new Date().toISOString() }).eq("id", id).select("id");
          if (r.error) throw failed(r.error);
          if (!r.data || !r.data.length) throw denied(); // RLS hides the row from writers who are not editors
          cache[id] = merged; emit();
        },
        delete: async function () {
          var r = await sb.from("posts").delete().eq("id", id).select("id");
          if (r.error) throw failed(r.error);
          if (!r.data || !r.data.length) throw denied();
          delete cache[id]; emit();
        }
      };
    }
  };

  var sessionUser = null;
  var user = {
    id: async function () { return sessionUser ? sessionUser.id : null; },
    can: async function () {
      if (!sessionUser) return false;
      var r = await sb.rpc("is_editor");
      return !r.error && r.data === true;
    },
    profiles: async function (ids) {
      var out = {}; (ids || []).forEach(function (i) { out[i] = { name: EDITOR_NAME }; }); return out;
    }
  };

  var downloads = {
    save: async function (o) {
      var blob = o.data instanceof Blob ? o.data : new Blob([o.data], { type: /\.csv$/i.test(o.filename) ? "text/csv;charset=utf-8" : "application/octet-stream" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = o.filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
    }
  };

  var ready = sb.auth.getSession().then(function (r) { sessionUser = r.data && r.data.session ? r.data.session.user : null; });

  window.claude = {
    use: async function (name) {
      await ready;
      if (name === "db") return db;
      if (name === "user") return user;
      if (name === "downloads") return downloads;
      return null;
    }
  };

  /* ---------- editor sign-in (management never needs it) ---------- */
  function buildAuthUi() {
    var header = document.querySelector("header.top");
    if (!header) return;
    var css = document.createElement("style");
    css.textContent =
      "header.top { position: relative; padding-right: 48px; }" +
      "#authBtn { position: absolute; top: 0; right: 0; width: 36px; height: 36px; padding: 0; display: grid; place-items: center;" +
      " border: 1px solid var(--line); border-radius: 50%; background: var(--panel); color: var(--muted); cursor: pointer; }" +
      "#authBtn:hover, #authBtn:focus-visible { color: var(--accent); border-color: var(--accent); }" +
      "#authBtn.on { color: var(--ok); border-color: var(--ok); }" +
      "#authBtn svg { width: 18px; height: 18px; }";
    document.head.appendChild(css);
    var btn = document.createElement("button");
    btn.type = "button"; btn.id = "authBtn";
    if (sessionUser) btn.className = "on";
    btn.setAttribute("aria-label", sessionUser ? "Sign out" : "Editor sign in");
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true">' +
      '<path d="M12 3v9"/><path d="M6.3 6.8a8 8 0 1 0 11.4 0"/></svg>';
    header.appendChild(btn);

    var dlg = document.createElement("dialog");
    dlg.id = "authDlg"; dlg.setAttribute("aria-labelledby", "authTitle");
    dlg.innerHTML =
      '<form method="dialog" class="dlgform" id="authForm" style="padding:18px 20px;display:grid;gap:12px">' +
      '<h2 id="authTitle" style="margin:0;font-size:18px">Editor sign in</h2>' +
      '<p class="fine" style="margin:0">Only the board editor signs in. Everyone else can view the board without an account.</p>' +
      '<label class="fine" for="authEmail">Email<input class="link" id="authEmail" type="email" autocomplete="username" required></label>' +
      '<label class="fine" for="authPass">Password<input class="link" id="authPass" type="password" autocomplete="current-password" required></label>' +
      '<div class="row" style="justify-content:flex-end;gap:8px"><span class="fine" id="authErr"></span>' +
      '<button type="button" class="btn" id="authCancel">Cancel</button>' +
      '<button type="submit" class="btn primary" id="authGo">Sign in</button></div></form>';
    document.body.appendChild(dlg);

    btn.addEventListener("click", async function () {
      if (sessionUser) { await sb.auth.signOut(); location.reload(); return; }
      document.getElementById("authErr").textContent = "";
      if (dlg.showModal) dlg.showModal(); else dlg.setAttribute("open", "");
    });
    document.getElementById("authCancel").addEventListener("click", function () { dlg.close(); });
    document.getElementById("authForm").addEventListener("submit", async function (ev) {
      ev.preventDefault();
      var go = document.getElementById("authGo"); go.disabled = true;
      var r = await sb.auth.signInWithPassword({ email: document.getElementById("authEmail").value.trim(), password: document.getElementById("authPass").value });
      go.disabled = false;
      if (r.error) { document.getElementById("authErr").textContent = "Email or password is not right."; return; }
      location.reload();
    });
  }
  ready.then(function () {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", buildAuthUi); else buildAuthUi();
  });
})();
