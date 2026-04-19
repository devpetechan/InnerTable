// ══════════════════════════════════════════════════
//  AUTH — Supabase Google sign-in
//  currentUser shape: { id, display_name, avatar_url }
// ══════════════════════════════════════════════════

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { flowType: 'implicit' }
});

// ── Google OAuth sign-in ──────────────────────────
// Redirects to Google; Supabase handles the callback and sets a session cookie.
document.getElementById('google-signin-btn').addEventListener('click', () => {
  supabaseClient.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.href }
  });
});

// ── Auth state listener ───────────────────────────
// Handles all auth state transitions in one place:
//  - INITIAL_SESSION: fires on every page load. If a session exists it means
//    either the user just returned from OAuth or they have a stored session.
//  - SIGNED_IN: fires after token refresh or explicit sign-in events.
//  - SIGNED_OUT: fires after signOut() — reload to show the welcome screen.
supabaseClient.auth.onAuthStateChange(async (event, session) => {
  console.log('[auth] event:', event, '| has session:', !!session);
  if ((event === 'INITIAL_SESSION' || event === 'SIGNED_IN') && session) {
    try {
      await buildCurrentUser(session.user);
      showApp();
    } catch (err) {
      console.error('[auth] buildCurrentUser or showApp failed:', err);
      // Still show the app using whatever we have from the session itself
      if (!currentUser) {
        currentUser = {
          id:           session.user.id,
          display_name: session.user.user_metadata?.full_name || session.user.email,
          avatar_url:   session.user.user_metadata?.avatar_url || null,
          is_admin:     false
        };
      }
      showApp();
    }
  } else if (event === 'SIGNED_OUT') {
    location.reload();
  }
});

// ── Helpers ───────────────────────────────────────
// buildCurrentUser: builds the global currentUser object.
// We query the public.users table to get the stored display_name and the
// is_admin flag (set manually in the Supabase dashboard, never in client code).
async function buildCurrentUser(user) {
  const { data: profile, error } = await supabaseClient
    .from('users')
    .select('display_name, is_admin')
    .eq('id', user.id)
    .single();

  if (error) console.warn('[auth] users table query:', error.message);

  currentUser = {
    id:           user.id,
    display_name: profile?.display_name || user.user_metadata?.full_name || user.email,
    avatar_url:   user.user_metadata?.avatar_url || null,
    is_admin:     profile?.is_admin || false
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
