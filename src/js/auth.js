// ══════════════════════════════════════════════════
//  AUTH — Supabase Google sign-in
//  currentUser shape: { id, display_name, avatar_url }
// ══════════════════════════════════════════════════

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ── Google OAuth sign-in ──────────────────────────
// Redirects to Google; Supabase handles the callback and sets a session cookie.
document.getElementById('google-signin-btn').addEventListener('click', () => {
  supabaseClient.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin }
  });
});

// ── Auth state listener ───────────────────────────
// Handles all auth state transitions in one place:
//  - INITIAL_SESSION: fires on every page load. If a session exists it means
//    either the user just returned from OAuth or they have a stored session.
//  - SIGNED_IN: fires after token refresh or explicit sign-in events.
//  - SIGNED_OUT: fires after signOut() — reload to show the welcome screen.
supabaseClient.auth.onAuthStateChange((event, session) => {
  if ((event === 'INITIAL_SESSION' || event === 'SIGNED_IN') && session) {
    buildCurrentUser(session.user);
    showApp();
  } else if (event === 'SIGNED_OUT') {
    location.reload();
  }
});

// ── Helpers ───────────────────────────────────────
function buildCurrentUser(user) {
  currentUser = {
    id:           user.id,
    display_name: user.user_metadata?.full_name || user.email,
    avatar_url:   user.user_metadata?.avatar_url || null
  };
}

function showApp() {
  document.getElementById('welcome-screen').style.display = 'none';
  document.getElementById('app').style.display = 'block';

  const avatarEl = document.getElementById('header-avatar');
  if (currentUser.avatar_url) {
    avatarEl.innerHTML = `<img src="${currentUser.avatar_url}" alt="${currentUser.display_name}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`;
  } else {
    avatarEl.textContent = currentUser.display_name.slice(0, 2).toUpperCase();
  }
  document.getElementById('header-name').textContent = currentUser.display_name;

  goHome();
  loadRecs();
}

function signOut() {
  supabaseClient.auth.signOut();
}
